// FBS-220 (US-19002): Finalise promotes to verified by ingesting the Test-stage report, with no agent spawn.
//
// Every test drives `node bin/rcf.js build finalise` in a fixture project
// that is a real git repository: a base commit on `main`, a feature branch
// carrying a `Hand: builder` commit (the verified head) and a `Hand: verifier`
// commit adding the VerifyReport v1 under rcf/verify-reports/FBS-001/, merged
// into `main` with --no-ff, then the chain's complete mark committed on top.
//
// Children run with PATH=/usr/bin:/bin so a regression that reaches the agent
// CLI can never launch it, and with the FBS-218 spawn-trace preload so every
// child_process launch the finalise process makes is recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
const CI_REF = 'gh-run-4242';
const BUILDER_ID = 'build-hand-7';
const VERIFIER_ID = 'verify-hand-3';
const FBS_PATH = 'rcf/fbs/fbs-001.json';
const DAY_MS = 24 * 60 * 60 * 1000;

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

// Run bin/rcf.js in `cwd`. Returns exit code, streams, and the list of
// child_process launches the rcf process made (file = the command).
async function rcf(cwd, args, { trace = false } = {}) {
  const env = { ...process.env, CI: '1', PATH: '/usr/bin:/bin' };
  let tracePath = null;
  if (trace) {
    tracePath = join(await scratchDir('rcf-fin220-trace-'), 'spawn.jsonl');
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
    profile: 'deployed',
    verdict: 'PASS',
    verdictAuthority: 'ship',
    runStats: { counts: { verified: 1, failed: 0, skipped: 0, total: 1 } },
    perAc: [{ acId: AC, result: 'pass', probe: { path: '/health', expectStatus: 200 }, evidence: { status: 200 } }],
    ...overrides,
  };
}

async function writeReport(world, report, relPath = world.reportRel) {
  await mkdir(dirname(join(world.root, relPath)), { recursive: true });
  await writeFile(join(world.root, relPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

// Re-plant the report on main as a fresh verifier commit (the verified head
// stays an ancestor of HEAD; HEAD moves to the new commit).
async function replantReport(world, overrides) {
  await writeReport(world, verifyReport(world, overrides));
  world.head = commitAll(world.root, 'test: re-plant verify report', { Hand: 'verifier', 'Hand-Id': VERIFIER_ID });
}

// Build the post-merge world. `report: false` merges the feature with no report.
async function buildWorld({ report = true, reportOverrides = {} } = {}) {
  const root = await scratchDir('rcf-fin220-');
  await initProject({ projectRoot: root, projectName: 'AdminFinalise' });
  await declareUiNoneForTests(root);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'save.js'), 'export function save() {}\n', 'utf8');
  const cn = await rcf(root, ['define', 'create', 'cn', '--path', 'src/save.js#save', '--acs', AC]);
  assert.equal(cn.code, 0, `fixture: create cn\n${cn.stderr}`);
  const cnId = (cn.stdout.match(/CN-[A-Za-z0-9-]+/) ?? [])[0];
  const ip = await rcf(root, ['build', 'mark', FBS, 'inProgress']);
  assert.equal(ip.code, 0, `fixture: mark inProgress\n${ip.stderr}`);

  git(root, 'init', '-q', '-b', 'main');
  const base = commitAll(root, 'chore: base');
  git(root, 'checkout', '-q', '-b', 'feature');
  await writeFile(join(root, 'src', 'save.js'), 'export function save() { return true; }\n', 'utf8');
  const headSha = commitAll(root, 'feat: save returns true', { Hand: 'builder', 'Hand-Id': BUILDER_ID });
  const world = { root, base, headSha, cnId, reportRel: `rcf/verify-reports/${FBS}/${headSha.slice(0, 12)}.json` };
  if (report) {
    await writeReport(world, verifyReport(world, reportOverrides));
    commitAll(root, 'test: verify report', { Hand: 'verifier', 'Hand-Id': VERIFIER_ID });
  }
  git(root, 'checkout', '-q', 'main');
  git(root, 'merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature');
  const done = await rcf(root, ['build', 'mark', FBS, 'complete']);
  assert.equal(done.code, 0, `fixture: mark complete\n${done.stderr}`);
  world.head = commitAll(root, 'chain: mark FBS-001 complete');
  return world;
}

async function fbsBytes(world) {
  return readFile(join(world.root, FBS_PATH));
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function status(world) {
  return JSON.parse(await fbsBytes(world)).executionStatus;
}

function nonGitSpawns(spawns) {
  return spawns.filter((s) => s.file !== 'git');
}

test('AC-19002-7: rcf build finalise <fbs-id> --mode <any> or --url <url> exits 2 with "finalise no longer runs verify; run rcf verify run --fbs <fbs-id> --hand verifier at the Test stage" and spawns nothing', async () => {
  const world = await buildWorld();
  const retired = `finalise no longer runs verify; run rcf verify run --fbs ${FBS} --hand verifier at the Test stage`;
  const runs = [
    ['--mode', 'deterministic'],
    ['--mode', 'agentScreenshotCritique'],
    ['--mode', 'anything'],
    ['--url', 'https://preview.invalid'],
    ['--url', 'https://preview.invalid', '--mode', 'deterministic', '--ci-run', CI_REF],
  ];
  for (const extra of runs) {
    const r = await rcf(world.root, ['build', 'finalise', FBS, ...extra], { trace: true });
    assert.equal(r.code, 2, `${extra.join(' ')}: retired flag exits 2\nstderr:\n${r.stderr}`);
    assert.ok(r.stderr.includes(retired), `${extra.join(' ')}\n${r.stderr}`);
    assert.deepEqual(r.spawns, [], `${extra.join(' ')}: spawns nothing`);
    assert.equal(await status(world), 'complete');
  }
});

test('AC-19002-8: rcf build finalise never spawns rcf verify run, the verifier package or the agent CLI, and every refusal leaves rcf/fbs/<fbs-id>.json byte-identical', async () => {
  const world = await buildWorld();
  // Each refusal the ingest path names, with the exit code it must carry.
  const refusals = [
    ['retired --url', null, ['--url', 'https://preview.invalid', '--mode', 'deterministic'], 2],
    ['no --ci-run', null, [], 4],
    ['retired --mode', null, ['--mode', 'agentScreenshotCritique', '--ci-run', CI_REF], 2],
    ['loopback target', { target: { kind: 'url', url: 'http://localhost:5173' } }, ['--ci-run', CI_REF], 4],
    ['old report', { finishedAt: isoAgo(9 * DAY_MS) }, ['--ci-run', CI_REF], 4],
    ['builder hand', { hand: 'builder', verifierId: BUILDER_ID }, ['--ci-run', CI_REF], 4],
    ['verdict BROKEN', { verdict: 'BROKEN' }, ['--ci-run', CI_REF], 4],
    ['SCOPE-MISMATCH row', { perAc: [{ acId: AC, result: 'pass', verdict: 'SCOPE-MISMATCH', evidence: null }] }, ['--ci-run', CI_REF], 4],
    ['invalid report', { reportVersion: 2 }, ['--ci-run', CI_REF], 3],
  ];
  for (const [label, overrides, extra, code] of refusals) {
    if (overrides) await replantReport(world, overrides);
    const before = sha256(await fbsBytes(world));
    const r = await rcf(world.root, ['build', 'finalise', FBS, ...extra], { trace: true });
    assert.deepEqual(nonGitSpawns(r.spawns), [], `${label}: no verify subprocess, verifier package or agent CLI is spawned`);
    assert.equal(sha256(await fbsBytes(world)), before, `${label}: ${FBS_PATH} is byte-identical after the refusal`);
    assert.equal(r.code, code, `${label}: refuses exit ${code}\nstderr:\n${r.stderr}`);
  }
  // The promoting run spawns nothing but git either.
  await replantReport(world, {});
  const ok = await rcf(world.root, ['build', 'finalise', FBS, '--ci-run', CI_REF], { trace: true });
  assert.equal(ok.code, 0, `the valid report promotes\nstderr:\n${ok.stderr}`);
  assert.deepEqual(nonGitSpawns(ok.spawns), [], 'the promoting run spawns nothing but git');
});

// ---------------------------------------------------------------------------
// End to end: the report Finalise ingests is the one a real
// `rcf verify run --hand verifier` wrote, against a real HTTP target.
//
// The target is a server in this test process on 127.0.0.1, reached under a
// non-loopback name (PREVIEW_HOST) through the host-map preload, so the
// report's target.url is not loopback and AC-19002-3 does not refuse it.
// The verify invocation is the Test-stage one FBS-219 pins (AC-19001-1):
// deterministic, --profile ci, scoped to the FBS, stamped by the verifier.

const HOST_MAP_PRELOAD = resolve(here, 'fixtures', 'host-map-fetch.mjs');
const PREVIEW_HOST = 'preview.fbs220.test';
const PREVIEW_URL = `http://${PREVIEW_HOST}`;

async function startPreview(t) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(new URL(req.url, 'http://x').pathname);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { hostMap: `${PREVIEW_HOST}=127.0.0.1:${server.address().port}`, hits };
}

function verifyRunE2E(root, preview) {
  const env = {
    ...process.env, CI: '1', PATH: '/usr/bin:/bin', RCF_TEST_HOST_MAP: preview.hostMap,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${HOST_MAP_PRELOAD}`.trim(),
  };
  const args = ['verify', 'run', '--repo', root, '--profile', 'ci', '--provision-mode', 'skip',
    '--mode', 'deterministic', '--url', PREVIEW_URL, '--fbs', FBS, '--hand', 'verifier', '--verifier-id', VERIFIER_ID];
  return new Promise((res) => {
    execFile(process.execPath, [bin, ...args], { cwd: root, env, encoding: 'utf8', timeout: 90_000 }, (err, stdout, stderr) => {
      res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

// The post-merge world with a report the real writer produced on the
// feature head. `nonDeterministic` reclassifies AC-101-1 so the engine
// emits EVAL-MISSING for it (no EVAL is bound). `merge` is 'no-ff' or
// 'squash'.
async function buildE2EWorld(t, { nonDeterministic = false, merge = 'no-ff' } = {}) {
  const preview = await startPreview(t);
  const root = await scratchDir('rcf-fin220-e2e-');
  await initProject({ projectRoot: root, projectName: 'AdminFinaliseE2E' });
  await declareUiNoneForTests(root);
  if (nonDeterministic) {
    const usPath = join(root, 'rcf', 'user-stories', 'us-101.json');
    const us = JSON.parse(await readFile(usPath, 'utf8'));
    us.acceptanceCriteria = us.acceptanceCriteria.map((a) => (a.id === AC ? { ...a, determinism: 'nonDeterministic' } : a));
    await writeFile(usPath, `${JSON.stringify(us, null, 2)}\n`, 'utf8');
  }
  await writeFile(join(root, 'rcf', 'verify-catalog.json'), `${JSON.stringify({
    catalogVersion: 1, probes: { [AC]: { path: '/health', expectStatus: 200 } },
  }, null, 2)}\n`, 'utf8');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'save.js'), 'export function save() {}\n', 'utf8');
  const cn = await rcf(root, ['define', 'create', 'cn', '--path', 'src/save.js#save', '--acs', AC]);
  assert.equal(cn.code, 0, `fixture: create cn\n${cn.stderr}`);
  const ip = await rcf(root, ['build', 'mark', FBS, 'inProgress']);
  assert.equal(ip.code, 0, `fixture: mark inProgress\n${ip.stderr}`);

  git(root, 'init', '-q', '-b', 'main');
  const base = commitAll(root, 'chore: base');
  git(root, 'checkout', '-q', '-b', 'feature');
  await writeFile(join(root, 'src', 'save.js'), 'export function save() { return true; }\n', 'utf8');
  const headSha = commitAll(root, 'feat: save returns true', { Hand: 'builder', 'Hand-Id': BUILDER_ID });

  const run = await verifyRunE2E(root, preview);
  assert.equal(run.code, 0, `fixture: the verifier's deterministic run passes\nstderr:\n${run.stderr}`);
  assert.ok(preview.hits.includes('/health'), 'the probe reached the preview target');
  const reportRel = `rcf/verify-reports/${FBS}/${headSha.slice(0, 12)}.json`;
  const report = JSON.parse(await readFile(join(root, reportRel), 'utf8'));
  commitAll(root, 'test: verify report', { Hand: 'verifier', 'Hand-Id': VERIFIER_ID });

  git(root, 'checkout', '-q', 'main');
  if (merge === 'squash') {
    git(root, 'merge', '-q', '--squash', 'feature');
    commitAll(root, 'feat: save returns true (#1)');
  } else {
    git(root, 'merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature');
  }
  const done = await rcf(root, ['build', 'mark', FBS, 'complete']);
  assert.equal(done.code, 0, `fixture: mark complete\n${done.stderr}`);
  const head = commitAll(root, 'chain: mark FBS-001 complete');
  return { root, base, headSha, head, reportRel, report };
}

// ---------------------------------------------------------------------------
// The override flags keep their criteria (stage-keeper ruling 2026-10-17):
// each still does what its criterion says, now applied to the ingested report.
