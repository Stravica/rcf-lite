// FBS-230 (US-19005, ADR-4151): Finalise runs on the PR branch before the
// merge and accepts a loopback report that names its engine, port and served
// sha (operator ruling 2026-10-21, claim C-26 reversed).
//
// Every test drives `node bin/rcf.js build finalise` in a fixture project
// that is a real git repository with a bare local remote: a base commit on
// `main`, a feature branch carrying a `Hand: builder` commit with a `Hand-Id:`
// and after it a `Hand: test-author` commit (the verified head, as on a PR whose
// last test-author commit follows the build), a `Hand: verifier` commit adding
// the VerifyReport v1
// under rcf/verify-reports/FBS-001/, and the complete mark committed on the
// branch. The branch world stays on the branch (the pre-merge Finalise); the
// merged world merges it into `main` with --no-ff first.
//
// Children run with PATH=/usr/bin:/bin so a regression that reaches the agent
// CLI can never launch it, and with the FBS-218 spawn-trace preload where a
// test asserts that nothing but git is spawned. Every target server is a local
// HTTP server on 127.0.0.1 started by the test; there is no host-map preload,
// because the point of AC-19005-2 is that the loopback URL itself is accepted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initProject } from '#core/store/init.js';
import { declareUiNoneForTests } from '../_helpers/d0.js';
import { scratchDir } from '../_helpers/scratch.js';

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');
const SPAWN_TRACE_PRELOAD = resolve(here, '..', 'verify', 'fixtures', 'probe-catalog', 'trace-spawn.mjs');

const FBS = 'FBS-001';
const AC = 'AC-101-1';
const CI_REF = 'gh-run-5151';
const MERGED_CI_REF = 'gh-run-5152';
const BUILDER_ID = 'build-hand-7';
const VERIFIER_ID = 'verify-hand-3';
const FBS_PATH = 'rcf/fbs/fbs-001.json';
const DAY_MS = 24 * 60 * 60 * 1000;
const LOOPBACK_URLS = ['http://localhost:5173', 'http://app.localhost:5173', 'http://127.0.0.1:8080', 'http://127.4.5.6:8080', 'http://[::1]:3000', 'http://0.0.0.0:8787'];
const DEPRECATION = '[warn] finalise: --allow-pre-merge is deprecated and changes nothing; Finalise runs on the PR branch before the merge';

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

function commitAll(cwd, subject, trailers = {}) {
  git(cwd, 'add', '-A');
  const body = Object.entries(trailers).map(([k, v]) => `${k}: ${v}`).join('\n');
  git(cwd, 'commit', '-q', '--allow-empty', '-m', body ? `${subject}\n\n${body}` : subject);
  return git(cwd, 'rev-parse', 'HEAD');
}

// Run bin/rcf.js in `cwd`. Returns exit code, streams, and (with trace) the
// list of child_process launches the rcf process made (file = the command).
async function rcf(cwd, args, { trace = false } = {}) {
  const env = { ...process.env, CI: '1', PATH: '/usr/bin:/bin' };
  let tracePath = null;
  if (trace) {
    tracePath = join(await scratchDir('rcf-fin230-trace-'), 'spawn.jsonl');
    env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --import ${SPAWN_TRACE_PRELOAD}`.trim();
    env.RCF_SPAWN_TRACE = tracePath;
  }
  const result = await new Promise((res) => {
    execFile(process.execPath, [bin, ...args], { cwd, env, encoding: 'utf8', timeout: 90_000 }, (err, stdout, stderr) => {
      res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
  if (trace) {
    let lines = [];
    try { lines = (await readFile(tracePath, 'utf8')).split('\n').filter(Boolean); } catch { lines = []; }
    result.spawns = lines.map((l) => JSON.parse(l));
  }
  return result;
}

function finalise(world, extra = [], opts = {}) {
  return rcf(world.root, ['build', 'finalise', FBS, '--ci-run', CI_REF, ...extra], opts);
}

function isoAgo(ms) {
  return new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// A VerifyReport v1 (the TAC-4148 recordShape) for the world's verified head.
function verifyReport(world, overrides = {}) {
  return {
    reportVersion: 1,
    fbsId: FBS,
    headSha: world.headSha,
    target: { kind: 'url', url: 'https://preview.example.com' },
    mode: 'deterministic',
    hand: 'verifier',
    verifierId: VERIFIER_ID,
    startedAt: isoAgo(2 * 60 * 60 * 1000),
    finishedAt: isoAgo(60 * 60 * 1000),
    rcfLiteVersion: '0.35.0',
    profile: 'local-dev',
    verdict: 'PASS',
    verdictAuthority: 'ship',
    runStats: { counts: { verified: 1, failed: 0, skipped: 0, total: 1 } },
    perAc: [{ acId: AC, result: 'pass', probe: { path: '/health', expectStatus: 200 }, evidence: { status: 200 } }],
    ...overrides,
  };
}

// A loopback target naming the engine, the port and the served sha.
function loopbackTarget(world, url = 'http://127.0.0.1:8787', fields = {}) {
  const port = Number(new URL(url).port || 80);
  return { kind: 'url', url, engine: 'wrangler dev', port, servedSha: world.headSha, ...fields };
}

function reportText(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

async function writeReport(world, report, relPath = world.reportRel) {
  await mkdir(dirname(join(world.root, relPath)), { recursive: true });
  await writeFile(join(world.root, relPath), reportText(report), 'utf8');
}

// Re-plant the report as a fresh verifier commit on the current branch (the
// verified head stays an ancestor of HEAD; HEAD moves to the new commit).
async function replantReport(world, overrides) {
  await writeReport(world, verifyReport(world, overrides));
  world.head = commitAll(world.root, 'test: re-plant verify report', { Hand: 'verifier', 'Hand-Id': VERIFIER_ID });
}

// The pre-merge world: a bare remote, `main` at the base commit, and the PR
// branch `branch` carrying the builder commit, a later test-author commit (the
// report head, so the builder commit is not the report head), the verifier's
// report commit and the complete mark, checked out. `report: false` commits no
// report. `subdir` (gate r2 BH-1) puts the rcf project in that subdirectory
// of the git repository (a monorepo); `world.repo` is the repo root.
async function branchWorld({ branch = 'feature', report = true, reportOverrides = {}, subdir = null } = {}) {
  const repo = await scratchDir('rcf-fin230-');
  const root = subdir ? join(repo, subdir) : repo;
  if (subdir) await mkdir(root, { recursive: true });
  const remote = await scratchDir('rcf-fin230-remote-');
  await initProject({ projectRoot: root, projectName: 'PreMergeFinalise' });
  await declareUiNoneForTests(root);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'save.js'), 'export function save() {}\n', 'utf8');
  const cn = await rcf(root, ['define', 'create', 'cn', '--path', 'src/save.js#save', '--acs', AC]);
  assert.equal(cn.code, 0, `fixture: create cn\n${cn.stderr}`);
  const ip = await rcf(root, ['build', 'mark', FBS, 'inProgress']);
  assert.equal(ip.code, 0, `fixture: mark inProgress\n${ip.stderr}`);

  git(remote, 'init', '-q', '--bare', '-b', 'main');
  git(repo, 'init', '-q', '-b', 'main');
  const base = commitAll(root, 'chore: base');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-q', 'origin', 'main');
  git(root, 'checkout', '-q', '-b', branch);
  await writeFile(join(root, 'src', 'save.js'), 'export function save() { return true; }\n', 'utf8');
  const builderSha = commitAll(root, 'feat: save returns true', { Hand: 'builder', 'Hand-Id': BUILDER_ID });
  const headSha = commitAll(root, 'test: goldens after the build', { Hand: 'test-author' });
  const world = { root, repo, remote, base, branch, builderSha, headSha, reportRel: `rcf/verify-reports/${FBS}/${headSha.slice(0, 12)}.json` };
  if (report) {
    await writeReport(world, verifyReport(world, reportOverrides));
    commitAll(root, 'test: verify report', { Hand: 'verifier', 'Hand-Id': VERIFIER_ID });
  }
  const done = await rcf(root, ['build', 'mark', FBS, 'complete']);
  assert.equal(done.code, 0, `fixture: mark complete\n${done.stderr}`);
  world.head = commitAll(root, 'chain: mark FBS-001 complete', { Hand: 'stage-keeper' });
  git(root, 'push', '-q', 'origin', branch);
  return world;
}

// The merged world: the branch world merged into `main` with --no-ff, on main.
async function mergedWorld(opts = {}) {
  const world = await branchWorld(opts);
  git(world.root, 'checkout', '-q', 'main');
  git(world.root, 'merge', '-q', '--no-ff', '-m', `Merge ${world.branch}`, world.branch);
  world.head = git(world.root, 'rev-parse', 'HEAD');
  return world;
}

async function fbsBytes(world) {
  return readFile(join(world.root, FBS_PATH));
}

async function status(world) {
  return JSON.parse(await fbsBytes(world)).executionStatus;
}

function nonGitSpawns(spawns) {
  return spawns.filter((s) => s.file !== 'git');
}

function verifiedLine(world, ci = CI_REF) {
  const reportRe = world.reportRel.replace(/[.]/g, '\\.');
  return new RegExp(`finalise: ${FBS} verified from (\\S*/)?${reportRe} \\(head ${world.headSha.slice(0, 7)}, ci ${ci}\\)`);
}

// One refusal: exit code, the exact stderr line, the FBS byte-identical and
// nothing but git spawned.
async function assertRefusal(world, { code = 4, line, extra = [], label }) {
  const before = await fbsBytes(world);
  const r = await finalise(world, extra, { trace: true });
  assert.ok(r.stderr.includes(line), `${label}: stderr carries "${line}"\nstderr:\n${r.stderr}`);
  assert.equal(r.code, code, `${label}: refuses exit ${code}\nstderr:\n${r.stderr}`);
  assert.ok((await fbsBytes(world)).equals(before), `${label}: ${FBS_PATH} is byte-identical after the refusal`);
  assert.deepEqual(nonGitSpawns(r.spawns), [], `${label}: no child process other than git is spawned`);
  return r;
}

test('AC-19005-1: on a branch other than main or master whose HEAD contains the report head, rcf build finalise <fbs-id> --ci-run <ref> exits 0 with no flag, writes verified on the branch and prints the verified-from line, with no "not a default trunk" refusal, no claim C-26 line and nothing but git spawned', async (t) => {
  for (const branch of ['feature', 'hotfix']) {
    await t.test(`branch ${branch}`, async () => {
      const world = await branchWorld({ branch });
      assert.equal(git(world.root, 'rev-parse', '--abbrev-ref', 'HEAD'), branch, 'fixture: the working tree is on the PR branch');
      assert.equal(await status(world), 'complete', 'fixture: FBS starts complete');
      const r = await finalise(world, [], { trace: true });
      assert.ok(!r.stderr.includes('not a default trunk'), `no off-trunk refusal on branch ${branch}\nstderr:\n${r.stderr}`);
      assert.equal(r.code, 0, `finalise promotes on branch ${branch}: exit 0\nstderr:\n${r.stderr}`);
      assert.match(r.stdout, verifiedLine(world));
      assert.ok(!/C-26/.test(r.stdout + r.stderr), `no output names claim C-26\n${r.stdout}${r.stderr}`);
      assert.equal(await status(world), 'verified', 'executionStatus verified is written on the branch');
      assert.equal(git(world.root, 'rev-parse', '--abbrev-ref', 'HEAD'), branch, 'Finalise leaves the working tree on the branch');
      assert.deepEqual(nonGitSpawns(r.spawns), [], 'no child process other than git is spawned');
    });
  }
});

test('AC-19005-2: a committed VerifyReport with a loopback target naming target.engine, target.port and target.servedSha equal to its headSha, hand verifier, PASS with ship authority, promotes: exit 0, verified, the verified-from line, no "is loopback"', async (t) => {
  for (const url of LOOPBACK_URLS) {
    await t.test(url, async () => {
      const world = await mergedWorld();
      await replantReport(world, { target: loopbackTarget(world, url) });
      const r = await finalise(world);
      assert.ok(!r.stderr.includes('is loopback'), `${url}: a loopback target naming engine, port and served sha is accepted\nstderr:\n${r.stderr}`);
      assert.equal(r.code, 0, `${url}: promotes, exit 0\nstderr:\n${r.stderr}`);
      assert.match(r.stdout, verifiedLine(world));
      assert.equal(await status(world), 'verified');
    });
  }
});

test('AC-19005-3: a committed loopback VerifyReport lacking target.engine, target.port or target.servedSha refuses exit 4 with "finalise refused: loopback report target <url> names no target.<field>" (first missing in the order engine, port, servedSha), the FBS byte-identical', async (t) => {
  await t.test('every loopback form with no engine, port or served sha names target.engine', async () => {
    const world = await mergedWorld();
    for (const url of LOOPBACK_URLS) {
      await replantReport(world, { target: { kind: 'url', url } });
      await assertRefusal(world, { line: `finalise refused: loopback report target ${url} names no target.engine`, label: url });
    }
  });

  await t.test('each single missing field is named', async () => {
    const world = await mergedWorld();
    const url = 'http://127.0.0.1:8787';
    for (const field of ['engine', 'port', 'servedSha']) {
      const target = loopbackTarget(world, url);
      delete target[field];
      await replantReport(world, { target });
      await assertRefusal(world, { line: `finalise refused: loopback report target ${url} names no target.${field}`, label: `no ${field}` });
    }
  });

  await t.test('guard (green at Define): a non-loopback report with no engine, port or served sha still promotes', async () => {
    const world = await mergedWorld();
    const r = await finalise(world);
    assert.equal(r.code, 0, `a non-loopback report needs no served sha\nstderr:\n${r.stderr}`);
    assert.equal(await status(world), 'verified');
  });
});

test('AC-19005-4: a committed loopback VerifyReport naming target.engine and target.port whose target.servedSha is not its headSha refuses exit 4 with "finalise refused: report target.servedSha <served sha7> is not the report head <head sha7>", the FBS byte-identical', async () => {
  const world = await mergedWorld();
  const other = world.base;
  await replantReport(world, { target: loopbackTarget(world, 'http://127.0.0.1:8787', { servedSha: other }) });
  await assertRefusal(world, {
    line: `finalise refused: report target.servedSha ${other.slice(0, 7)} is not the report head ${world.headSha.slice(0, 7)}`,
    label: 'served sha is the base commit',
  });
  assert.equal(await status(world), 'complete');
});

test('AC-19005-6: a report on disk but not committed in HEAD refuses exit 4 with "finalise refused: verify report <path> is not committed at HEAD", and a committed report whose bytes on disk differ refuses exit 4 with "finalise refused: verify report <path> differs from its committed bytes at HEAD", the FBS byte-identical', async (t) => {
  await t.test('the newest report is on disk and not committed', async () => {
    const world = await mergedWorld();
    // A newer report (finishedAt later) that the verifier never committed:
    // Finalise selects it and must refuse it.
    const loose = `rcf/verify-reports/${FBS}/${world.headSha.slice(0, 11)}x.json`;
    await writeReport(world, verifyReport(world, { finishedAt: isoAgo(60 * 1000) }), loose);
    assert.notEqual(git(world.root, 'status', '--porcelain'), '', 'fixture: the loose report is untracked');
    await assertRefusal(world, { line: `finalise refused: verify report ${loose} is not committed at HEAD`, label: 'uncommitted report' });
  });

  await t.test('the committed report differs on disk from its committed bytes', async () => {
    const world = await mergedWorld();
    await writeReport(world, verifyReport(world, { verifierId: 'verify-hand-4' }));
    assert.match(git(world.root, 'status', '--porcelain'), /verify-reports/, 'fixture: the report is modified on disk');
    await assertRefusal(world, { line: `finalise refused: verify report ${world.reportRel} differs from its committed bytes at HEAD`, label: 'modified report' });
  });

  await t.test('--report naming an uncommitted file refuses the same way', async () => {
    const world = await mergedWorld();
    const loose = `rcf/verify-reports/${FBS}/elsewhere.json`;
    await writeReport(world, verifyReport(world), loose);
    await assertRefusal(world, { line: `finalise refused: verify report ${loose} is not committed at HEAD`, extra: ['--report', loose], label: '--report uncommitted' });
  });

  // FBS-230 gate r1 BH-1: the report path, or any component of it below the
  // repo root, that is a symlink is refused before it is read; only the real,
  // committed file may promote.
  await t.test('a committed symlink at the report path pointing at an uncommitted report file refuses "is read through a symlink at <link>"', async () => {
    const world = await mergedWorld();
    const loose = 'out/report.json';
    await writeReport(world, verifyReport(world), loose);
    git(world.root, 'rm', '-q', world.reportRel);
    await mkdir(dirname(join(world.root, world.reportRel)), { recursive: true });
    await symlink(`../../../${loose}`, join(world.root, world.reportRel));
    git(world.root, 'add', world.reportRel);
    git(world.root, 'commit', '-q', '-m', 'test: link the verify report\n\nHand: verifier');
    assert.equal(git(world.root, 'ls-files', '-s', world.reportRel).split(' ')[0], '120000', 'fixture: the report path is a committed symlink');
    assert.match(git(world.root, 'status', '--porcelain'), /\?\? out\//, 'fixture: the report bytes behind the link are uncommitted');
    await assertRefusal(world, { line: `finalise refused: verify report ${world.reportRel} is read through a symlink at ${world.reportRel}`, label: 'symlinked report file' });
  });

  await t.test('a committed symlink pointing at a committed file whose bytes on disk were then edited refuses the same way', async () => {
    const world = await mergedWorld();
    const real = 'out/report.json';
    await writeReport(world, verifyReport(world), real);
    git(world.root, 'rm', '-q', world.reportRel);
    await mkdir(dirname(join(world.root, world.reportRel)), { recursive: true });
    await symlink(`../../../${real}`, join(world.root, world.reportRel));
    commitAll(world.root, 'test: link the verify report', { Hand: 'verifier' });
    await writeReport(world, verifyReport(world, { verifierId: 'verify-hand-4' }), real);
    await assertRefusal(world, { line: `finalise refused: verify report ${world.reportRel} is read through a symlink at ${world.reportRel}`, label: 'symlink to an edited file' });
  });

  await t.test('--report naming a committed symlink to an uncommitted file refuses the same way', async () => {
    const world = await mergedWorld();
    const loose = 'out/report.json';
    const link = `rcf/verify-reports/${FBS}/linked.json`;
    await writeReport(world, verifyReport(world, { finishedAt: isoAgo(60 * 1000) }), loose);
    await symlink(`../../../${loose}`, join(world.root, link));
    git(world.root, 'add', link);
    git(world.root, 'commit', '-q', '-m', 'test: link a verify report\n\nHand: verifier');
    await assertRefusal(world, { line: `finalise refused: verify report ${link} is read through a symlink at ${link}`, extra: ['--report', link], label: '--report through a link' });
  });

  await t.test('a committed symlinked directory component (rcf/verify-reports/<fbs-id> linking to a directory holding the report) refuses with the link named', async () => {
    const world = await mergedWorld();
    const dir = `rcf/verify-reports/${FBS}`;
    const name = world.reportRel.slice(dir.length + 1);
    await writeReport(world, verifyReport(world), `out/reports/${name}`);
    git(world.root, 'rm', '-q', '-r', dir);
    await mkdir(join(world.root, 'rcf', 'verify-reports'), { recursive: true });
    await symlink('../../out/reports', join(world.root, dir));
    git(world.root, 'add', dir);
    git(world.root, 'commit', '-q', '-m', 'test: link the verify reports directory\n\nHand: verifier');
    await assertRefusal(world, { line: `finalise refused: verify report ${world.reportRel} is read through a symlink at ${dir}`, label: 'symlinked directory component' });
  });

  // FBS-230 gate r2 BH-1: a --report whose real file is outside the project
  // root is refused before it is read, and the lstat walk starts at the repo
  // root (the git top level), so a symlinked component above the project
  // root is caught too. Both worlds are monorepos: the rcf project is the
  // subdirectory app/ of the git repository.
  await t.test('gate r2 BH-1: in a monorepo, --report ../link.json (a committed symlink at the repo root pointing at an uncommitted report file) refuses "finalise refused: verify report link.json is outside the project root"', async () => {
    const world = await branchWorld({ subdir: 'app' });
    await writeReport(world, verifyReport(world, { finishedAt: isoAgo(60 * 1000) }), '../out/report.json');
    await symlink('out/report.json', join(world.repo, 'link.json'));
    git(world.repo, 'add', 'link.json');
    git(world.repo, 'commit', '-q', '-m', 'test: link a verify report at the repo root\n\nHand: verifier');
    assert.equal(git(world.repo, 'ls-files', '-s', 'link.json').split(' ')[0], '120000', 'fixture: link.json is a committed symlink at the repo root');
    assert.match(git(world.repo, 'status', '--porcelain'), /\?\? out\//, 'fixture: the report bytes behind the link are uncommitted');
    await assertRefusal(world, { line: 'finalise refused: verify report link.json is outside the project root', extra: ['--report', '../link.json'], label: '--report outside the project root' });
  });

  await t.test('gate r2 BH-1: in a monorepo, --report through a committed symlink to the project directory (current linking to app) refuses "is read through a symlink at current", the walk starting at the repo root', async () => {
    const world = await branchWorld({ subdir: 'app' });
    await symlink('app', join(world.repo, 'current'));
    commitAll(world.repo, 'test: alias the project directory', { Hand: 'verifier' });
    assert.equal(git(world.repo, 'ls-files', '-s', 'current').split(' ')[0], '120000', 'fixture: current is a committed symlink to the project directory');
    assert.equal(git(world.repo, 'status', '--porcelain'), '', 'fixture: clean tree');
    const via = `current/${world.reportRel}`;
    await assertRefusal(world, { line: `finalise refused: verify report ${via} is read through a symlink at current`, extra: ['--report', `../${via}`], label: 'symlinked project directory component' });
  });

  await t.test('guard (green at Define): the committed, unmodified report promotes', async () => {
    const world = await mergedWorld();
    assert.equal(git(world.root, 'status', '--porcelain'), '', 'fixture: clean tree');
    const r = await finalise(world);
    assert.equal(r.code, 0, `the committed report promotes\nstderr:\n${r.stderr}`);
  });
});

test('AC-19005-7: on a branch other than main or master Finalise keeps provenance: a builder Hand-Id equal to verifierId, a report older than --max-report-age and a report head not contained in HEAD each exit 4 with their message, the FBS byte-identical and nothing but git spawned', async (t) => {
  await t.test('verifierId equals the Hand-Id of a Hand: builder commit on the branch', async () => {
    const world = await branchWorld();
    await replantReport(world, { verifierId: BUILDER_ID });
    await assertRefusal(world, { line: `finalise refused: report hand verifier/${BUILDER_ID} is not separate from the builder`, label: 'builder Hand-Id' });
  });

  // FBS-230 gate r1 BH-2: the builder Hand-Ids are collected over the whole
  // branch range (merge-base to the branch head), whatever commit the report
  // head is; here, as on a PR, the report head is a test-author commit after
  // the builder commit.
  await t.test('verifierId equals the Hand-Id of a Hand: builder commit before a later Hand: test-author report head (the whole branch range, merge-base to the branch head)', async () => {
    const world = await branchWorld({ reportOverrides: { verifierId: BUILDER_ID } });
    assert.equal(git(world.root, 'rev-parse', `${world.headSha}~1`), world.builderSha, 'fixture: the builder commit is the parent of the report head');
    assert.equal(git(world.root, 'log', '-1', '--format=%(trailers:key=Hand,valueonly)', world.headSha), 'test-author', 'fixture: the report head is a Hand: test-author commit');
    assert.equal(git(world.root, 'merge-base', 'main', 'HEAD'), world.base, 'fixture: the branch range starts at the base commit');
    await assertRefusal(world, { line: `finalise refused: report hand verifier/${BUILDER_ID} is not separate from the builder`, label: 'builder Hand-Id before the report head' });
  });

  // FBS-230 gate r2 BH-2: with no trunk ref the Hand-Ids are collected over
  // all of HEAD's history, and a branch already merged into the trunk (the
  // merge-base with the trunk ref is HEAD itself) is covered by the same walk.
  await t.test('gate r2 BH-2: in a single-branch clone (no main, master, origin/main or origin/master ref), verifierId equal to the Hand-Id of a Hand: builder commit before a later Hand: test-author report head refuses (all of HEAD\'s history)', async () => {
    const world = await branchWorld({ reportOverrides: { verifierId: BUILDER_ID } });
    const dir = await scratchDir('rcf-fin230-clone-');
    const clone = join(dir, 'clone');
    git(dir, 'clone', '-q', '--single-branch', '--branch', world.branch, world.remote, clone);
    const refs = git(clone, 'for-each-ref', '--format=%(refname)');
    assert.ok(!/\/(main|master)$/m.test(refs), `fixture: no trunk ref resolves in the clone\n${refs}`);
    assert.equal(git(clone, 'rev-parse', '--abbrev-ref', 'HEAD'), world.branch, 'fixture: the clone is on the PR branch');
    assert.equal(git(clone, 'rev-parse', `${world.headSha}~1`), world.builderSha, 'fixture: the builder commit is the parent of the report head');
    await assertRefusal({ ...world, root: clone }, { line: `finalise refused: report hand verifier/${BUILDER_ID} is not separate from the builder`, label: 'single-branch clone' });
  });

  for (const shape of ['fast-forward', '--no-ff']) {
    await t.test(`gate r2 BH-2: on the PR branch head after the branch merged into origin/main (${shape}), the merge-base with origin/main being HEAD itself, verifierId equal to the builder Hand-Id refuses`, async () => {
      const world = await branchWorld({ reportOverrides: { verifierId: BUILDER_ID } });
      if (shape === 'fast-forward') {
        git(world.root, 'push', '-q', 'origin', `${world.branch}:main`);
      } else {
        git(world.root, 'checkout', '-q', 'main');
        git(world.root, 'merge', '-q', '--no-ff', '-m', `Merge ${world.branch}`, world.branch);
        git(world.root, 'push', '-q', 'origin', 'main');
        git(world.root, 'checkout', '-q', world.branch);
      }
      git(world.root, 'fetch', '-q', 'origin');
      assert.equal(git(world.root, 'rev-parse', '--abbrev-ref', 'HEAD'), world.branch, `fixture (${shape}): the PR branch is checked out`);
      assert.equal(git(world.root, 'merge-base', 'HEAD', 'origin/main'), world.head, `fixture (${shape}): the merge-base with origin/main is HEAD`);
      await assertRefusal(world, { line: `finalise refused: report hand verifier/${BUILDER_ID} is not separate from the builder`, label: `merged into origin/main, ${shape}` });
    });
  }

  await t.test('a report older than --max-report-age (default 7 days)', async () => {
    const world = await branchWorld({ reportOverrides: { startedAt: isoAgo(10 * DAY_MS + 2 * 60 * 60 * 1000), finishedAt: isoAgo(10 * DAY_MS + 60 * 60 * 1000) } });
    await assertRefusal(world, { line: 'finalise refused: report is 10 days old', label: 'old report' });
    await assertRefusal(world, { line: 'finalise refused: report is 10 days old', extra: ['--max-report-age', '5'], label: 'old report, --max-report-age 5' });
  });

  await t.test('a report head not contained in HEAD', async () => {
    const world = await branchWorld({ report: false });
    git(world.root, 'checkout', '-q', '-b', 'stray', world.base);
    await writeFile(join(world.root, 'src', 'stray.js'), 'export const stray = 1;\n', 'utf8');
    const stray = commitAll(world.root, 'feat: stray', { Hand: 'builder', 'Hand-Id': 'build-hand-9' });
    git(world.root, 'checkout', '-q', world.branch);
    await writeReport(world, verifyReport(world, { headSha: stray }), `rcf/verify-reports/${FBS}/${stray.slice(0, 12)}.json`);
    const head = commitAll(world.root, 'test: verify report', { Hand: 'verifier', 'Hand-Id': VERIFIER_ID });
    await assertRefusal(world, {
      line: `finalise refused: report head ${stray.slice(0, 7)} is not contained in HEAD ${head.slice(0, 7)}; re-verify this head`,
      label: 'uncontained head',
    });
  });
});

test('AC-19005-8: after Finalise writes verified on the branch and the branch merges into main with --no-ff, rcf build finalise <fbs-id> --ci-run <ref> on main confirms: exit 0, the verified-from line, the FBS byte-identical, a clean tree, nothing but git spawned', async () => {
  const world = await branchWorld();
  const onBranch = await finalise(world);
  assert.equal(onBranch.code, 0, `Finalise promotes on the branch first\nstderr:\n${onBranch.stderr}`);
  assert.equal(await status(world), 'verified');
  commitAll(world.root, 'chain: FBS-001 verified', { Hand: 'stage-keeper' });
  git(world.root, 'push', '-q', 'origin', world.branch);

  git(world.root, 'checkout', '-q', 'main');
  git(world.root, 'merge', '-q', '--no-ff', '-m', `Merge ${world.branch}`, world.branch);
  git(world.root, 'push', '-q', 'origin', 'main');
  assert.equal(git(world.root, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3, 'fixture: HEAD is a merge commit');
  assert.equal(await status(world), 'verified', 'the merge carries verified');

  const before = await fbsBytes(world);
  const r = await rcf(world.root, ['build', 'finalise', FBS, '--ci-run', MERGED_CI_REF], { trace: true });
  assert.equal(r.code, 0, `the confirm on main exits 0\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, verifiedLine(world, MERGED_CI_REF));
  assert.ok((await fbsBytes(world)).equals(before), `${FBS_PATH} is byte-identical: the confirm writes nothing`);
  assert.equal(git(world.root, 'status', '--porcelain'), '', 'the working tree stays clean');
  assert.deepEqual(nonGitSpawns(r.spawns), [], 'no child process other than git is spawned');
});

test('AC-19005-9: --allow-pre-merge is accepted and changes nothing: the same exit, write and refusal as without it, exactly one deprecation line on stderr, and no output naming claim C-26 or "records the pre-merge decision"', async (t) => {
  const deprecations = (r) => r.stderr.split('\n').filter((l) => l.includes('--allow-pre-merge'));

  await t.test('a promoting run on the branch', async () => {
    const plain = await branchWorld();
    const flagged = await branchWorld();
    const a = await finalise(plain);
    const b = await finalise(flagged, ['--allow-pre-merge']);
    assert.deepEqual(deprecations(b), [DEPRECATION], `exactly one deprecation line\nstderr:\n${b.stderr}`);
    assert.equal(b.code, a.code, `the same exit code with and without the flag\nwithout:\n${a.stderr}\nwith:\n${b.stderr}`);
    assert.equal(b.code, 0, `promotes\nstderr:\n${b.stderr}`);
    assert.equal(await status(flagged), await status(plain), 'the same executionStatus write');
    assert.equal(await status(flagged), 'verified');
    assert.ok(!/C-26/.test(b.stdout + b.stderr), `no output names claim C-26\n${b.stdout}${b.stderr}`);
    assert.ok(!(b.stdout + b.stderr).includes('records the pre-merge decision'), 'no pre-merge decision line');
  });

  await t.test('a refusing run on the branch', async () => {
    const old = { startedAt: isoAgo(10 * DAY_MS + 2 * 60 * 60 * 1000), finishedAt: isoAgo(10 * DAY_MS + 60 * 60 * 1000) };
    const world = await branchWorld({ reportOverrides: old });
    const before = await fbsBytes(world);
    const a = await finalise(world);
    const b = await finalise(world, ['--allow-pre-merge']);
    const refusal = (r) => r.stderr.split('\n').filter((l) => l.includes('finalise refused:'));
    assert.deepEqual(deprecations(b), [DEPRECATION], `exactly one deprecation line\nstderr:\n${b.stderr}`);
    assert.equal(b.code, a.code, 'the same exit code with and without the flag');
    assert.equal(b.code, 4);
    assert.deepEqual(refusal(b), refusal(a), 'the same refusal with and without the flag');
    assert.ok(refusal(b).some((l) => l.includes('finalise refused: report is 10 days old')), `the age refusal\n${b.stderr}`);
    assert.ok((await fbsBytes(world)).equals(before), 'no write');
    assert.ok(!/C-26/.test(b.stdout + b.stderr), 'no output names claim C-26');
  });
});

// ---------------------------------------------------------------------------
// End to end: a real `rcf verify run --hand verifier` against a server on
// 127.0.0.1 that this test starts, with the AC-19005-5 flags, its report
// committed on the feature branch, then Finalise on that branch, then the
// --no-ff merge and the confirm on main.

async function startServer(t) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(new URL(req.url, 'http://x').pathname);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { url: `http://127.0.0.1:${server.address().port}`, port: server.address().port, hits };
}

async function e2eWorld(t) {
  const server = await startServer(t);
  const root = await scratchDir('rcf-fin230-e2e-');
  const remote = await scratchDir('rcf-fin230-e2e-remote-');
  await initProject({ projectRoot: root, projectName: 'PreMergeFinaliseE2E' });
  await declareUiNoneForTests(root);
  await writeFile(join(root, 'rcf', 'verify-catalog.json'), `${JSON.stringify({
    catalogVersion: 1, probes: { [AC]: { path: '/health', expectStatus: 200 } },
  }, null, 2)}\n`, 'utf8');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'save.js'), 'export function save() {}\n', 'utf8');
  await writeFile(join(root, 'src', 'server.js'), 'export const port = Number(process.env.PORT ?? 8787);\n', 'utf8');
  const cn = await rcf(root, ['define', 'create', 'cn', '--path', 'src/save.js#save', '--acs', AC]);
  assert.equal(cn.code, 0, `fixture: create cn\n${cn.stderr}`);
  const ip = await rcf(root, ['build', 'mark', FBS, 'inProgress']);
  assert.equal(ip.code, 0, `fixture: mark inProgress\n${ip.stderr}`);

  git(remote, 'init', '-q', '--bare', '-b', 'main');
  git(root, 'init', '-q', '-b', 'main');
  commitAll(root, 'chore: base');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-q', 'origin', 'main');
  git(root, 'checkout', '-q', '-b', 'feature');
  await writeFile(join(root, 'src', 'save.js'), 'export function save() { return true; }\n', 'utf8');
  const headSha = commitAll(root, 'feat: save returns true', { Hand: 'builder', 'Hand-Id': BUILDER_ID });
  return { root, remote, server, headSha, branch: 'feature', reportRel: `rcf/verify-reports/${FBS}/${headSha.slice(0, 12)}.json` };
}

function verifyRunLoopback(world, extra) {
  return rcf(world.root, ['verify', 'run', '--repo', world.root, '--profile', 'local-dev', '--provision-mode', 'skip',
    '--mode', 'deterministic', '--url', world.server.url, '--fbs', FBS, '--hand', 'verifier', '--verifier-id', VERIFIER_ID, ...extra]);
}

test('AC-19005-1, AC-19005-2 and AC-19005-5 (end to end): a real rcf verify run --hand verifier --url http://127.0.0.1:<port> --engine --served-sha HEAD writes a loopback report naming engine, port and served sha; committed on the feature branch, rcf build finalise <fbs-id> --ci-run <ref> on that branch promotes it to verified', async (t) => {
  const world = await e2eWorld(t);
  const run = await verifyRunLoopback(world, ['--engine', 'node server', '--served-sha', world.headSha]);
  assert.equal(run.code, 0, `the verifier's deterministic run against the loopback server passes\nstderr:\n${run.stderr}`);
  assert.ok(world.server.hits.includes('/health'), 'the probe reached the loopback server');
  const report = JSON.parse(await readFile(join(world.root, world.reportRel), 'utf8'));
  assert.deepEqual(report.target, { kind: 'url', url: world.server.url, engine: 'node server', port: world.server.port, servedSha: world.headSha },
    'the report records target.engine, target.port and target.servedSha');
  assert.equal(report.verdict, 'PASS');
  assert.equal(report.verdictAuthority, 'ship', 'a deterministic PASS carries ship authority (rule unchanged)');
  commitAll(world.root, 'test: verify report', { Hand: 'verifier', 'Hand-Id': VERIFIER_ID });
  const done = await rcf(world.root, ['build', 'mark', FBS, 'complete']);
  assert.equal(done.code, 0, `fixture: mark complete\n${done.stderr}`);
  commitAll(world.root, 'chain: mark FBS-001 complete', { Hand: 'stage-keeper' });

  const r = await rcf(world.root, ['build', 'finalise', FBS, '--ci-run', CI_REF], { trace: true });
  assert.equal(r.code, 0, `Finalise on the feature branch ingests the loopback report and promotes\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, verifiedLine(world));
  assert.equal(await status(world), 'verified');
  assert.equal(git(world.root, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature');
  assert.deepEqual(nonGitSpawns(r.spawns), [], 'no child process other than git is spawned');
});

test('AC-19005-8 (end to end): the loopback report verified on the feature branch, merged into main with --no-ff, confirms on main with exit 0 and no write', async (t) => {
  const world = await e2eWorld(t);
  const run = await verifyRunLoopback(world, ['--engine', 'node server', '--served-sha', world.headSha]);
  assert.equal(run.code, 0, `the verifier's run passes\nstderr:\n${run.stderr}`);
  commitAll(world.root, 'test: verify report', { Hand: 'verifier', 'Hand-Id': VERIFIER_ID });
  const done = await rcf(world.root, ['build', 'mark', FBS, 'complete']);
  assert.equal(done.code, 0, `fixture: mark complete\n${done.stderr}`);
  commitAll(world.root, 'chain: mark FBS-001 complete', { Hand: 'stage-keeper' });
  const onBranch = await rcf(world.root, ['build', 'finalise', FBS, '--ci-run', CI_REF]);
  assert.equal(onBranch.code, 0, `Finalise promotes on the branch\nstderr:\n${onBranch.stderr}`);
  commitAll(world.root, 'chain: FBS-001 verified', { Hand: 'stage-keeper' });
  git(world.root, 'push', '-q', 'origin', 'feature');

  git(world.root, 'checkout', '-q', 'main');
  git(world.root, 'merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature');
  git(world.root, 'push', '-q', 'origin', 'main');
  const before = await fbsBytes(world);
  const r = await rcf(world.root, ['build', 'finalise', FBS, '--ci-run', MERGED_CI_REF], { trace: true });
  assert.equal(r.code, 0, `the confirm on main exits 0\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, verifiedLine(world, MERGED_CI_REF));
  assert.ok((await fbsBytes(world)).equals(before), 'the confirm writes nothing');
  assert.equal(git(world.root, 'status', '--porcelain'), '', 'the working tree stays clean');
  assert.deepEqual(nonGitSpawns(r.spawns), [], 'no child process other than git is spawned');
});
