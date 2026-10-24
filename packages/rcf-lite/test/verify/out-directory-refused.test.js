// FBS-231 (US-19001, AC-19001-7): rcf verify run --out takes a file path. A
// --out that names an existing directory is refused as a usage error (exit 2)
// before any request reaches the target, and --help says --out is a file path.
//
// Every test drives `node bin/rcf.js verify run --mode deterministic` as a
// child process against a real HTTP server on 127.0.0.1 started by the test.
// The server records every request, so a refusal that probes first is visible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initProject } from '#core/store/init.js';
import { declareUiNoneForTests } from '../_helpers/d0.js';
import { scratchDir } from '../_helpers/scratch.js';

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

const REFUSAL = '--out must be a file path, not a directory';

function rcf(cwd, args) {
  const env = { ...process.env, CI: '1', PATH: '/usr/bin:/bin' };
  return new Promise((res) => {
    execFile(process.execPath, [bin, ...args], { cwd, env, encoding: 'utf8', timeout: 90_000 }, (err, stdout, stderr) => {
      res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

async function world(t) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(new URL(req.url, 'http://x').pathname);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = await scratchDir('rcf-fbs231-out-');
  const root = join(base, 'project');
  await mkdir(root, { recursive: true });
  await initProject({ projectRoot: root, projectName: 'OutDirectory' });
  await declareUiNoneForTests(root);
  await writeFile(join(root, 'rcf', 'verify-catalog.json'), `${JSON.stringify({
    catalogVersion: 1, probes: { 'AC-101-1': { path: '/health', expectStatus: 200 } },
  }, null, 2)}\n`, 'utf8');
  const outDir = join(base, 'reports');
  await mkdir(outDir, { recursive: true });
  return { root, base, outDir, hits, url: `http://127.0.0.1:${server.address().port}` };
}

function verifyRun(w, out) {
  return rcf(w.root, ['verify', 'run', '--repo', w.root, '--profile', 'local-dev', '--provision-mode', 'skip',
    '--mode', 'deterministic', '--url', w.url, '--fbs', 'FBS-001', '--out', out]);
}

test('AC-19001-7: rcf verify run --url <url> --out <existing directory> (with or without a trailing slash) exits 2 with "--out must be a file path, not a directory" before any request reaches the target and writes nothing in the directory', async (t) => {
  for (const shape of ['trailing slash', 'no trailing slash']) {
    await t.test(shape, async () => {
      const w = await world(t);
      const out = shape === 'trailing slash' ? `${w.outDir}${sep}` : w.outDir;
      const r = await verifyRun(w, out);
      assert.deepEqual(w.hits, [], `no request reaches the target before the refusal (exit ${r.code}; stderr: ${r.stderr.trim().split('\n').pop()})`);
      assert.equal(r.code, 2, `exit 2 (usage error)\nstderr:\n${r.stderr}`);
      assert.ok(r.stderr.includes(REFUSAL), `stderr says "${REFUSAL}"\nstderr:\n${r.stderr}`);
      assert.deepEqual(await readdir(w.outDir), [], 'nothing is written inside the directory');
    });
  }
});

test('AC-19001-7: rcf verify run --help describes --out as a file path and says a directory is refused (exit 2)', async () => {
  const r = await rcf(here, ['verify', 'run', '--help']);
  assert.equal(r.code, 0, r.stderr);
  const lines = r.stdout.split('\n');
  const at = lines.findIndex((l) => /^\s+--out\s/.test(l));
  assert.ok(at >= 0, 'the help lists --out');
  const block = [lines[at]];
  for (let i = at + 1; i < lines.length && lines[i].trim() !== '' && !/^\s{1,4}--/.test(lines[i]); i += 1) block.push(lines[i]);
  const text = block.join(' ').replace(/\s+/g, ' ');
  assert.ok(text.includes('file path'), `the --out entry says "file path": ${text}`);
  assert.ok(/director/.test(text), `the --out entry says a directory is refused: ${text}`);
});

// Guard (true at main): the file-path form keeps working.
test('AC-19001-7 guard: rcf verify run --out <file path> still writes the report at that path', async (t) => {
  const w = await world(t);
  const out = join(w.outDir, 'rcf-verify-report.json');
  const r = await verifyRun(w, out);
  assert.ok(existsSync(out), `the report is written at the file path (exit ${r.code})\nstderr:\n${r.stderr}`);
  const report = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(typeof report.verdict, 'string', 'the written report carries a verdict');
  assert.ok(w.hits.includes('/health'), 'the run probed the target');
});
