// FBS-230 (US-19005, AC-19005-5): rcf verify run --hand with a loopback --url
// records target.engine, target.port and target.servedSha, refuses a served
// sha that is not the committed HEAD, and refuses a loopback --hand run
// without --engine or --served-sha.
//
// Every test drives `node bin/rcf.js verify run` as a child process in a
// fixture project that is a real git repository with a committed head, against
// a real HTTP server on 127.0.0.1 started by the test (no host map: the URL the
// run records is the loopback URL itself). The server records every request,
// so a refusal that sends a probe is visible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initProject } from '#core/store/init.js';
import { declareUiNoneForTests } from '../_helpers/d0.js';
import { scratchDir } from '../_helpers/scratch.js';

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

const FBS = 'FBS-001';
const AC = 'AC-101-1';
const VERIFIER_ID = 'verify-hand-3';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
};

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd, env: GIT_ENV, encoding: 'utf8',
  }).trim();
}

function rcf(cwd, args, extraEnv = {}) {
  const env = { ...process.env, CI: '1', PATH: '/usr/bin:/bin', ...extraEnv };
  return new Promise((res) => {
    execFile(process.execPath, [bin, ...args], { cwd, env, encoding: 'utf8', timeout: 90_000 }, (err, stdout, stderr) => {
      res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

async function startServer(t) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(new URL(req.url, 'http://x').pathname);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const { port } = server.address();
  return { port, hits, url: `http://127.0.0.1:${port}`, localhostUrl: `http://localhost:${port}` };
}

// A committed project whose AC-101-1 probes GET /health for 200.
async function world(t) {
  const server = await startServer(t);
  const root = await scratchDir('rcf-fbs230-run-');
  await initProject({ projectRoot: root, projectName: 'LoopbackTargetRun' });
  await declareUiNoneForTests(root);
  await writeFile(join(root, 'rcf', 'verify-catalog.json'), `${JSON.stringify({
    catalogVersion: 1, probes: { [AC]: { path: '/health', expectStatus: 200 } },
  }, null, 2)}\n`, 'utf8');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'server.js'), 'export const port = Number(process.env.PORT ?? 8787);\n', 'utf8');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'chore: base');
  await writeFile(join(root, 'src', 'server.js'), 'export const port = Number(process.env.PORT ?? 8788);\n', 'utf8');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'feat: port\n\nHand: builder\nHand-Id: build-hand-7');
  const head = git(root, 'rev-parse', 'HEAD');
  return { root, server, head, base: git(root, 'rev-parse', 'HEAD~1'), reportRel: `rcf/verify-reports/${FBS}/${head.slice(0, 12)}.json` };
}

function verifyRun(w, url, extra) {
  return rcf(w.root, ['verify', 'run', '--repo', w.root, '--profile', 'local-dev', '--provision-mode', 'skip',
    '--mode', 'deterministic', '--url', url, '--fbs', FBS, '--hand', 'verifier', '--verifier-id', VERIFIER_ID, ...extra]);
}

function assertNothingWritten(w, label) {
  assert.equal(existsSync(join(w.root, 'rcf', 'verify-reports')), false, `${label}: no report is written under rcf/verify-reports/`);
  assert.deepEqual(w.server.hits, [], `${label}: no probe request reaches the server`);
}

test('AC-19005-5: rcf verify run --hand verifier --url <loopback-url> --engine <name> --served-sha <committed HEAD> records target { kind "url", url, engine, port, servedSha } in rcf/verify-reports/<fbs-id>/<head12>.json', async (t) => {
  for (const which of ['url', 'localhostUrl']) {
    await t.test(which === 'url' ? '127.0.0.1' : 'localhost', async () => {
      const w = await world(t);
      const url = w.server[which];
      const r = await verifyRun(w, url, ['--engine', 'wrangler dev', '--served-sha', w.head]);
      assert.equal(r.code, 0, `the loopback run passes and writes the report\nstderr:\n${r.stderr}`);
      assert.ok(w.server.hits.includes('/health'), 'the probe reached the loopback server');
      const report = JSON.parse(await readFile(join(w.root, w.reportRel), 'utf8'));
      assert.deepEqual(report.target, { kind: 'url', url, engine: 'wrangler dev', port: w.server.port, servedSha: w.head },
        'target records engine (--engine), port (from the URL, an integer) and servedSha (--served-sha)');
      assert.equal(report.headSha, w.head, 'headSha is the committed HEAD');
      assert.equal(report.verdictAuthority, 'ship', 'the ship-authority rule is unchanged: a deterministic PASS carries ship');
    });
  }
});

test('AC-19005-5: a --served-sha that is not the full sha of the committed HEAD exits 4 with "verify report refused: --served-sha <value> is not the committed HEAD <sha7>", writing no report and sending no probe', async (t) => {
  await t.test('another commit', async () => {
    const w = await world(t);
    const r = await verifyRun(w, w.server.url, ['--engine', 'node server', '--served-sha', w.base]);
    assert.ok(r.stderr.includes(`verify report refused: --served-sha ${w.base} is not the committed HEAD ${w.head.slice(0, 7)}`), r.stderr);
    assert.equal(r.code, 4, `exit 4\nstderr:\n${r.stderr}`);
    assertNothingWritten(w, 'another commit');
  });

  await t.test('an abbreviated HEAD sha', async () => {
    const w = await world(t);
    const short = w.head.slice(0, 7);
    const r = await verifyRun(w, w.server.url, ['--engine', 'node server', '--served-sha', short]);
    assert.ok(r.stderr.includes(`verify report refused: --served-sha ${short} is not the committed HEAD ${short}`), r.stderr);
    assert.equal(r.code, 4, `exit 4\nstderr:\n${r.stderr}`);
    assertNothingWritten(w, 'abbreviated sha');
  });
});

test('AC-19005-5: a loopback --url with --hand exits 2 with "[error] usage --engine <name> is required with --hand and a loopback --url" with no --engine, and "[error] usage --served-sha <sha> is required with --hand and a loopback --url" with no --served-sha, writing no report and sending no probe', async (t) => {
  await t.test('neither flag', async () => {
    const w = await world(t);
    const r = await verifyRun(w, w.server.url, []);
    assert.ok(r.stderr.includes('[error] usage --engine <name> is required with --hand and a loopback --url'), r.stderr);
    assert.equal(r.code, 2, `exit 2\nstderr:\n${r.stderr}`);
    assertNothingWritten(w, 'neither flag');
  });

  await t.test('--served-sha without --engine', async () => {
    const w = await world(t);
    const r = await verifyRun(w, w.server.localhostUrl, ['--served-sha', w.head]);
    assert.ok(r.stderr.includes('[error] usage --engine <name> is required with --hand and a loopback --url'), r.stderr);
    assert.equal(r.code, 2, `exit 2\nstderr:\n${r.stderr}`);
    assertNothingWritten(w, 'no --engine');
  });

  await t.test('--engine without --served-sha', async () => {
    const w = await world(t);
    const r = await verifyRun(w, w.server.url, ['--engine', 'node server']);
    assert.ok(r.stderr.includes('[error] usage --served-sha <sha> is required with --hand and a loopback --url'), r.stderr);
    assert.equal(r.code, 2, `exit 2\nstderr:\n${r.stderr}`);
    assertNothingWritten(w, 'no --served-sha');
  });
});

// FBS-230 gate r1 BH-3: --engine and --served-sha name what a served --url
// target serves, so outside a --url target (package target mode) each is a
// usage error before any pack or install, with or without --hand. The npm
// cache is forced offline so a run that reaches a pack or install never
// touches the network.
const NOT_URL_TAIL = 'applies only to a --url target; package target mode (--artefact <tgz> | --package <dir>) has no served URL';

test('AC-19005-5: outside a --url target (package target mode, --artefact <tgz> or --package <dir>) --engine and --served-sha each exit 2 with "[error] usage --engine applies only to a --url target; package target mode (--artefact <tgz> | --package <dir>) has no served URL" (and the same for --served-sha), with or without --hand, before any pack or install, writing no report', async (t) => {
  const forms = [
    ['--package <dir>', async () => ['--package', '.']],
    ['--artefact <tgz>', async () => {
      const dir = await scratchDir('rcf-fbs230-tgz-');
      const tgz = join(dir, 'app-1.0.0.tgz');
      await writeFile(tgz, gzipSync(Buffer.from('not a real package')));
      return ['--artefact', tgz];
    }],
  ];
  for (const [form, target] of forms) {
    for (const flag of ['--engine', '--served-sha']) {
      for (const withHand of [true, false]) {
        await t.test(`${form} with ${flag}, ${withHand ? 'with' : 'without'} --hand`, async () => {
          const w = await world(t);
          const value = flag === '--engine' ? 'node server' : w.head;
          const hand = withHand ? ['--hand', 'verifier', '--verifier-id', VERIFIER_ID] : [];
          const r = await rcf(w.root, ['verify', 'run', ...(await target()), '--fbs', FBS, ...hand, flag, value], { npm_config_offline: 'true' });
          assert.ok(r.stderr.includes(`[error] usage ${flag} ${NOT_URL_TAIL}`), `${form}: the flag is named as URL-target-only\nstderr:\n${r.stderr}`);
          assert.equal(r.code, 2, `${form}: exit 2\nstderr:\n${r.stderr}`);
          assertNothingWritten(w, `${form} ${flag}`);
          assert.equal(git(w.root, 'status', '--porcelain'), '', `${form}: the working tree is untouched (no pack, no install)`);
        });
      }
    }
  }
});
