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

test('AC-19002-1: rcf build finalise <fbs-id> --ci-run <ref> with a valid verifier PASS report exits 0, sets executionStatus verified and prints "finalise: <fbs-id> verified from <report path> (head <sha7>, ci <ref>)", spawning nothing but git', async () => {
  const world = await buildWorld();
  assert.equal(await status(world), 'complete', 'fixture: FBS starts complete');
  const r = await rcf(world.root, ['build', 'finalise', FBS, '--ci-run', CI_REF], { trace: true });
  assert.equal(r.code, 0, `finalise ingests the report and promotes: exit 0\nstderr:\n${r.stderr}`);
  const reportRe = world.reportRel.replace(/[.]/g, '\\.');
  assert.match(r.stdout, new RegExp(`finalise: ${FBS} verified from (\\S*/)?${reportRe} \\(head ${world.headSha.slice(0, 7)}, ci ${CI_REF}\\)`));
  assert.equal(await status(world), 'verified');
  assert.deepEqual(nonGitSpawns(r.spawns), [], 'no child process other than git is spawned');
});

test('AC-19002-2: rcf build finalise <fbs-id> --ci-run <ref> with no report exits 4 with "finalise refused: no Test-stage verify report for <fbs-id>; the verifier runs rcf verify run --fbs <fbs-id> --hand verifier before merge" and the FBS stays complete', async () => {
  const world = await buildWorld({ report: false });
  const r = await rcf(world.root, ['build', 'finalise', FBS, '--ci-run', CI_REF]);
  assert.equal(r.code, 4, `no report refuses exit 4\nstderr:\n${r.stderr}`);
  assert.ok(r.stderr.includes(`finalise refused: no Test-stage verify report for ${FBS}; the verifier runs rcf verify run --fbs ${FBS} --hand verifier before merge`), r.stderr);
  assert.equal(await status(world), 'complete');
});

test('AC-19002-3: rcf build finalise exits 4 with "finalise refused: report head <sha7> is not contained in HEAD <sha7>; re-verify the merged head", "report target <url> is loopback" or "report is <n> days old"', async (t) => {
  await t.test('report head not contained in HEAD', async () => {
    const world = await buildWorld({ report: false });
    // A stray branch off base whose tree matches no commit main contains.
    git(world.root, 'checkout', '-q', '-b', 'stray', world.base);
    await writeFile(join(world.root, 'src', 'stray.js'), 'export const stray = 1;\n', 'utf8');
    const stray = commitAll(world.root, 'feat: stray', { Hand: 'builder', 'Hand-Id': BUILDER_ID });
    git(world.root, 'checkout', '-q', 'main');
    await writeReport(world, verifyReport(world, { headSha: stray }), `rcf/verify-reports/${FBS}/${stray.slice(0, 12)}.json`);
    const head = commitAll(world.root, 'test: verify report', { Hand: 'verifier', 'Hand-Id': VERIFIER_ID });
    const r = await rcf(world.root, ['build', 'finalise', FBS, '--ci-run', CI_REF]);
    assert.equal(r.code, 4, `uncontained head refuses exit 4\nstderr:\n${r.stderr}`);
    assert.ok(r.stderr.includes(`finalise refused: report head ${stray.slice(0, 7)} is not contained in HEAD ${head.slice(0, 7)}; re-verify the merged head`), r.stderr);
    assert.equal(await status(world), 'complete');
  });

  await t.test('loopback target', async () => {
    const world = await buildWorld();
    for (const url of ['http://localhost:5173', 'http://app.localhost', 'http://127.0.0.1:8080', 'http://127.4.5.6', 'http://[::1]:3000', 'http://0.0.0.0:8787']) {
      await replantReport(world, { target: { kind: 'url', url } });
      const r = await rcf(world.root, ['build', 'finalise', FBS, '--ci-run', CI_REF]);
      assert.equal(r.code, 4, `${url}: loopback target refuses exit 4\nstderr:\n${r.stderr}`);
      assert.ok(r.stderr.includes(`finalise refused: report target ${url} is loopback`), `${url}\n${r.stderr}`);
      assert.equal(await status(world), 'complete');
    }
  });

  await t.test('report older than --max-report-age (default 7 days)', async () => {
    const world = await buildWorld({ reportOverrides: { startedAt: isoAgo(10 * DAY_MS + 2 * 60 * 60 * 1000), finishedAt: isoAgo(10 * DAY_MS + 60 * 60 * 1000) } });
    const r = await rcf(world.root, ['build', 'finalise', FBS, '--ci-run', CI_REF]);
    assert.equal(r.code, 4, `a 10-day-old report refuses exit 4 under the 7-day default\nstderr:\n${r.stderr}`);
    assert.ok(r.stderr.includes('finalise refused: report is 10 days old'), r.stderr);
    assert.equal(await status(world), 'complete');
    const tight = await rcf(world.root, ['build', 'finalise', FBS, '--ci-run', CI_REF, '--max-report-age', '5']);
    assert.equal(tight.code, 4, tight.stderr);
    assert.ok(tight.stderr.includes('finalise refused: report is 10 days old'), tight.stderr);
    const wide = await rcf(world.root, ['build', 'finalise', FBS, '--ci-run', CI_REF, '--max-report-age', '30']);
    assert.equal(wide.code, 0, `--max-report-age 30 admits a 10-day-old report\nstderr:\n${wide.stderr}`);
    assert.equal(await status(world), 'verified');
  });
});

test('AC-19002-4: rcf build finalise on a report whose hand is not verifier or whose verifierId matches a builder Hand-Id exits 4 with "finalise refused: report hand <hand>/<id> is not separate from the builder" and the FBS is unchanged', async () => {
  const world = await buildWorld();
  const cases = [
    { hand: 'builder', verifierId: 'some-hand-9' },
    { hand: 'reviewer', verifierId: 'review-hand-2' },
    { hand: 'verifier', verifierId: BUILDER_ID },
  ];
  for (const c of cases) {
    await replantReport(world, c);
    const before = await fbsBytes(world);
    const r = await rcf(world.root, ['build', 'finalise', FBS, '--ci-run', CI_REF]);
    assert.equal(r.code, 4, `${c.hand}/${c.verifierId}: refuses exit 4\nstderr:\n${r.stderr}`);
    assert.ok(r.stderr.includes(`finalise refused: report hand ${c.hand}/${c.verifierId} is not separate from the builder`), r.stderr);
    assert.ok((await fbsBytes(world)).equals(before), 'the FBS is unchanged');
  }
});

test('AC-19002-5: rcf build finalise exits 4 "ci evidence missing: pass --ci-run <ref>", 4 not-complete, 4 off-trunk and 3 "missing Code Nodes: <ac-ids>"; a report failing VerifyReport v1 exits 3 naming the field', async (t) => {
  await t.test('--ci-run absent', async () => {
    const world = await buildWorld();
    const r = await rcf(world.root, ['build', 'finalise', FBS]);
    assert.equal(r.code, 4, `no --ci-run refuses exit 4\nstderr:\n${r.stderr}`);
    assert.ok(r.stderr.includes('ci evidence missing: pass --ci-run <ref>'), r.stderr);
    assert.equal(await status(world), 'complete');
  });

  await t.test('FBS not at complete', async () => {
    const world = await buildWorld();
    const back = await rcf(world.root, ['define', 'update', FBS, '--set', 'executionStatus=inProgress']);
    assert.equal(back.code, 0, back.stderr);
    commitAll(world.root, 'chain: back to inProgress');
    const r = await rcf(world.root, ['build', 'finalise', FBS, '--ci-run', CI_REF]);
    assert.equal(r.code, 4, `not complete refuses exit 4\nstderr:\n${r.stderr}`);
    assert.match(r.stderr, new RegExp(`refused finalise: ${FBS} is 'inProgress'; the finalise gate promotes 'complete' -> 'verified'`));
    assert.equal(await status(world), 'inProgress');
  });

  await t.test('HEAD off the default branch', async () => {
    const world = await buildWorld();
    git(world.root, 'checkout', '-q', '-b', 'hotfix');
    const r = await rcf(world.root, ['build', 'finalise', FBS, '--ci-run', CI_REF]);
    assert.equal(r.code, 4, `off-trunk refuses exit 4\nstderr:\n${r.stderr}`);
    assert.ok(r.stderr.includes("git working tree is on branch 'hotfix', not a default trunk (main / master)"), r.stderr);
    assert.equal(await status(world), 'complete');
  });

  await t.test('bound AC without a Code Node', async () => {
    const world = await buildWorld();
    assert.ok(world.cnId, 'fixture: the Code Node id was captured');
    const del = await rcf(world.root, ['define', 'delete', world.cnId, '--cascade']);
    assert.equal(del.code, 0, `fixture: delete cn\n${del.stderr}`);
    commitAll(world.root, 'chain: drop the code node');
    const r = await rcf(world.root, ['build', 'finalise', FBS, '--ci-run', CI_REF]);
    assert.equal(r.code, 3, `missing Code Node refuses exit 3\nstderr:\n${r.stderr}`);
    assert.ok(r.stderr.includes(`missing Code Nodes: ${AC}`), r.stderr);
    assert.equal(await status(world), 'complete');
  });

  await t.test('report failing VerifyReport v1 validation', async () => {
    const world = await buildWorld();
    const broken = [
      ['reportVersion', { reportVersion: 2 }],
      ['finishedAt', { finishedAt: undefined }],
      ['perAc', { perAc: 'none' }],
    ];
    for (const [field, overrides] of broken) {
      await replantReport(world, overrides);
      const r = await rcf(world.root, ['build', 'finalise', FBS, '--ci-run', CI_REF]);
      assert.equal(r.code, 3, `${field}: invalid report exits 3\nstderr:\n${r.stderr}`);
      assert.match(r.stderr, new RegExp(`\\b${field}\\b`), `${field}: stderr names the field`);
      assert.equal(await status(world), 'complete');
    }
  });
});

test('AC-19002-6: rcf build finalise on a report carrying MOCK-ONLY-DECLARED, EVAL-MISSING, EVAL-BELOW-THRESHOLD, UI-BASELINE-UNMET, BROWSER-VERIFICATION-MISSING or SCOPE-MISMATCH, or a non-PASS or non-ship verdict, exits 4 with the 0.20.0 and 0.28.0 message shapes', async () => {
  const world = await buildWorld();
  const row = (verdict) => ({ perAc: [{ acId: AC, result: 'pass', verdict, evidence: { status: 200 } }] });
  const left = `${FBS} left 'complete'`;
  const cases = [
    ['MOCK-ONLY-DECLARED', row('MOCK-ONLY-DECLARED'), ['AC(s) came back MOCK-ONLY-DECLARED', left]],
    ['EVAL-MISSING', row('EVAL-MISSING'), [`finalise refused: EVAL missing on AC(s) ${AC}; author an EVAL or --ship-without-eval "reason"`]],
    ['EVAL-BELOW-THRESHOLD', row('EVAL-BELOW-THRESHOLD'), [`finalise refused: EVAL below threshold on AC(s) ${AC}; investigate the run record or --ship-without-eval "reason"`]],
    ['UI-BASELINE-UNMET', row('UI-BASELINE-UNMET'), [`1 AC(s) came back UI-BASELINE-UNMET on the report (${AC}); ${left}`]],
    ['BROWSER-VERIFICATION-MISSING', row('BROWSER-VERIFICATION-MISSING'), [`1 AC(s) came back BROWSER-VERIFICATION-MISSING on the report (${AC}); ${left}`]],
    ['SCOPE-MISMATCH', row('SCOPE-MISMATCH'), [`1 AC(s) came back SCOPE-MISMATCH on the report (${AC}); ${left}`]],
    ['verdict BROKEN', { verdict: 'BROKEN' }, ['BROKEN', left]],
    ['correctness authority', { verdictAuthority: 'correctness' }, ["carries 'correctness' authority"]],
  ];
  for (const [label, overrides, expected] of cases) {
    await replantReport(world, overrides);
    const r = await rcf(world.root, ['build', 'finalise', FBS, '--ci-run', CI_REF]);
    assert.equal(r.code, 4, `${label}: refuses exit 4\nstderr:\n${r.stderr}`);
    for (const line of expected) assert.ok(r.stderr.includes(line), `${label}: stderr carries "${line}"\n${r.stderr}`);
    assert.equal(await status(world), 'complete', `${label}: the FBS stays complete`);
  }
});

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
