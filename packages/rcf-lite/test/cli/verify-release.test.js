// FBS-238 (US-20101, US-20102, US-20103): the release Verify. rcf verify
// run --release --since runs only the bound e2e cases of the live
// external criteria of the specs changed since the release, plus the
// declared core-journey smoke suites, against a URL or a package
// installed cold, and with --record writes the ReleaseVerifyReport and
// verified; the catalog and agent probes stay optional ad hoc runs.
//
// Criteria: 16, all external (US-20101 9, US-20102 4, US-20103 3).
// The round E cases of AC-20101-8 and AC-20101-9 are red until the
// round's BUILD turns them green, but for two declared regression guards
// of AC-20101-8 (a pass row's null reason, no reason line after a blocked
// line), green throughout. Each test drives bin/rcf.js (or the
// packed artefact) as a child process over a fixture project made by its
// own rcf init, committed to git and tagged v1.0.0 at the release commit
// R. The target
// is a local node:http server (the network edge, the only stand-in), or
// the fixture package installed cold. Fixture cases append one JSON line
// to a log outside the tree when they run, so a test sees which cases ran
// and how long each took. The timing test prints the host facts (GR-45);
// spawn clauses read RCF_SPAWN_LOG (GR-46). Imports: Node builtins and
// test/_harness/ only (GR-40).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lines, rcf, run, toolPath } from '../_harness/spawn.js';
import { commit, git, gitTry, initRepo, porcelain, sha } from '../_harness/git.js';
import { project, readJson, readText, scratch, writeJson, writeText } from '../_harness/fixture.js';
import { commandName, hostFacts, readSpawnLog, spawnLog } from '../_harness/capture.js';

const REPORT = 'rcf/verify-reports/releases/1.1.0.json';

// ---------------------------------------------------------- the target

let server;
let URL_;
before(async () => {
  server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  URL_ = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

// ------------------------------------------------------------- fixtures

// One fixture case: it fetches RCF_TARGET_URL (when set), waits sleepMs,
// logs { name, ms } to the log and passes when the target answers "ok"
// (outcome "pass") or fails (outcome "fail").
function caseSource(name, { outcome = 'pass', sleepMs = 0 } = {}, log) {
  return [
    `test(${JSON.stringify(name)}, async () => {`,
    '  const t0 = performance.now();',
    "  const body = process.env.RCF_TARGET_URL ? await (await fetch(process.env.RCF_TARGET_URL)).text() : 'ok';",
    sleepMs ? `  await new Promise((r) => setTimeout(r, ${sleepMs}));` : '',
    `  appendFileSync(${JSON.stringify(log)}, JSON.stringify({ name: ${JSON.stringify(name)}, ms: performance.now() - t0 }) + '\\n');`,
    `  assert.equal(body, ${JSON.stringify(outcome === 'pass' ? 'ok' : 'a different answer')});`,
    '});',
  ].filter(Boolean).join('\n');
}
const HEAD_SRC = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { appendFileSync } from 'node:fs';\n";
const caseName = (acId) => `${acId} holds against the target`;

// Write a chain: specs [{ id, status, us, criteria: [{ id, flag, level, outcome, sleepMs, retired }] }],
// one story per spec, one suite per story and level, one test file per story,
// and the smoke story US-190 (FBS-090, verified) bound by TS-900.
function writeChain(dir, specs, log, { smoke = 'pass' } = {}) {
  const us0 = readJson(dir, 'rcf/user-stories/us-101.json');
  const fbs0 = readJson(dir, 'rcf/fbs/fbs-001.json');
  const all = [...specs, { id: 'FBS-090', status: 'verified', us: 'US-190', criteria: [{ id: 'AC-190-1', flag: 'external', level: null }] }];
  let ts = 1;
  for (const s of all) {
    const crit = s.criteria.map((c) => ({
      id: c.id, description: `[happy] ${c.id} holds`, testable: true, given: 'a fixture project', when: 'the fixture runs', then: `${c.id} holds`,
      ...(c.flag ? { verification: c.flag } : {}),
      ...(c.retired ? { supersededBy: c.retired, supersededOn: '2026-10-01', supersessionNote: `Retired: replaced by ${c.retired}.` } : {}),
    }));
    writeJson(dir, `rcf/user-stories/${s.us.toLowerCase()}.json`, { ...us0, usId: s.us, title: `${s.us} fixture story`, acceptanceCriteria: crit, tags: [] });
    writeJson(dir, `rcf/fbs/${s.id.toLowerCase()}.json`, { ...fbs0, fbsId: s.id, buildOrder: Number(s.id.slice(4)), title: `${s.id} fixture`, summary: `${s.id} scopes ${s.us}.`, acIds: s.criteria.map((c) => c.id), executionStatus: s.status });
    const file = `test/rcf/${s.us.toLowerCase()}.test.js`;
    const bound = s.criteria.filter((c) => c.level);
    if (bound.length) writeText(dir, file, `${HEAD_SRC}${bound.map((c) => caseSource(caseName(c.id), c, log)).join('\n')}\n`);
    for (const level of [...new Set(bound.map((c) => c.level))]) {
      const cases = bound.filter((c) => c.level === level);
      const id = `TS-${String(ts++).padStart(3, '0')}`;
      writeJson(dir, `rcf/test-suites/${id.toLowerCase()}.json`, {
        id, usId: s.us, status: 'draft', title: `${s.us} ${level} fixture suite`, purpose: 'fixture', testLevel: level, acIds: cases.map((c) => c.id),
        testCases: cases.map((c, i) => ({ id: `${id.replace('TS', 'TC')}-case-${i + 1}`, acId: c.id, description: caseName(c.id), status: 'pending', testPointer: `${file}::${caseName(c.id)}` })),
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      });
    }
  }
  writeText(dir, 'test/rcf/smoke.test.js', `${HEAD_SRC}${caseSource('core journey walks', { outcome: smoke }, log)}\n`);
  writeJson(dir, 'rcf/test-suites/ts-900.json', {
    id: 'TS-900', usId: 'US-190', status: 'draft', title: 'core-journey smoke', purpose: 'fixture smoke', testLevel: 'e2e', acIds: ['AC-190-1'],
    testCases: [{ id: 'TC-900-core-journey', acId: 'AC-190-1', description: 'core journey walks', status: 'pending', testPointer: 'test/rcf/smoke.test.js::core journey walks' }],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  });
}

// Edit a criterion field (by default its then text) after the release.
function amend(dir, us, acId, field = 'then', value = undefined) {
  const rel = `rcf/user-stories/${us.toLowerCase()}.json`;
  const doc = readJson(dir, rel);
  const c = doc.acceptanceCriteria.find((a) => a.id === acId);
  c[field] = value ?? `${c[field] ?? ''} (amended after the release)`;
  writeJson(dir, rel, doc);
}

// A release fixture: the chain committed as R and tagged v1.0.0, then
// `change(dir)` committed after R. Returns { dir, R, head, log }.
async function release(t, specs, { change, smoke = 'pass', releaseVerify = true, pkg } = {}) {
  const dir = await project(t, { name: 'rel' });
  const log = join(scratch(t, 'rcf-h-ran-'), 'ran.log');
  writeChain(dir, specs, log, { smoke });
  if (releaseVerify) writeJson(dir, 'rcf/release-verify.json', { smoke: ['TS-900'] });
  if (pkg) pkg(dir, log);
  writeText(dir, '.gitignore', 'node_modules/\n');
  initRepo(dir);
  const R = commit(dir, 'fixture: release 1.0.0');
  git(dir, 'tag', 'v1.0.0');
  if (change) { change(dir); commit(dir, 'BUILD: changes since 1.0.0'); }
  return { dir, R, head: sha(dir), log };
}
const ran = (log) => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const ranNames = (log) => ran(log).map((x) => x.name).sort();

const verify = (dir, args, env = {}) => rcf(['verify', 'run', ...args], { cwd: dir, env, timeout: 600_000 });
const releaseArgs = (extra = []) => ['--release', '1.1.0', '--since', 'v1.0.0', '--url', URL_, ...extra];
const outHas = (r, line) => assert.ok(lines(r.stdout).includes(line), `stdout carries "${line}"\nexit ${r.code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
const errHas = (r, line) => assert.ok(lines(r.stderr).includes(line), `stderr carries "${line}"\nexit ${r.code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
const status = (dir, id) => readJson(dir, `rcf/fbs/${id.toLowerCase()}.json`).executionStatus;
const fbsBytes = (dir) => Object.fromEntries(readdirSync(join(dir, 'rcf', 'fbs')).sort().map((f) => [f, readText(dir, `rcf/fbs/${f}`)]));

// The release story's PASS fixture (AC-20101-1): FBS-001 (complete)
// changed after R, AC-101-1 external bound e2e, AC-101-2 testOnly bound
// at integration level; FBS-002 (complete) unchanged since R.
const PASS_SPECS = (o1 = 'pass') => [
  { id: 'FBS-001', status: 'complete', us: 'US-101', criteria: [{ id: 'AC-101-1', flag: 'external', level: 'e2e', outcome: o1 }, { id: 'AC-101-2', flag: 'testOnly', level: 'integration' }] },
  { id: 'FBS-002', status: 'complete', us: 'US-102', criteria: [{ id: 'AC-102-1', flag: 'external', level: 'e2e' }] },
];
const passFixture = (t, opts = {}) => release(t, opts.specs ?? PASS_SPECS(opts.o1), { change: (d) => amend(d, 'US-101', 'AC-101-1'), ...opts });

// ---------------------------------------------------------------- US-20101

test('AC-20101-1: with FBS-001 changed after v1.0.0 and FBS-002 unchanged, verify run --release 1.1.0 --since v1.0.0 --url <server> --record exits 0, prints the pass, PASS and recorded lines, writes FBS-001 verified and a ReleaseVerifyReport v1 whose perAc holds AC-101-1 only', async (t) => {
  const { dir, R, head, log } = await passFixture(t);
  const two = readText(dir, 'rcf/fbs/fbs-002.json');
  const r = await verify(dir, releaseArgs(['--record']));
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  outHas(r, 'AC-101-1 FBS-001 pass');
  outHas(r, `verify: release 1.1.0 PASS 1/1 external criteria, smoke 1/1 (target ${URL_})`);
  outHas(r, `verify: recorded ${REPORT}; verified FBS-001`);
  assert.equal(status(dir, 'FBS-001'), 'verified');
  assert.equal(readText(dir, 'rcf/fbs/fbs-002.json'), two, 'FBS-002 is untouched');
  const rep = readJson(dir, REPORT);
  assert.equal(rep.version, 1);
  assert.equal(rep.release, '1.1.0');
  assert.equal(rep.head, head);
  assert.equal(rep.since, R);
  assert.deepEqual(rep.target, { kind: 'url', url: URL_ });
  assert.deepEqual(rep.perAc.map((x) => x.acId), ['AC-101-1'], 'perAc holds AC-101-1 only');
  assert.equal(rep.perAc[0].fbsId, 'FBS-001');
  assert.equal(rep.perAc[0].result, 'pass');
  assert.deepEqual(rep.scope.smokeSuites, ['TS-900']);
  assert.equal(rep.verdict, 'PASS');
  assert.deepEqual(rep.verifiedFbsIds, ['FBS-001']);
  for (const k of ['smoke', 'testOnlyOnly', 'unflagged', 'startedAt', 'finishedAt', 'node']) assert.ok(k in rep, `the report carries ${k}`);
  assert.deepEqual(ranNames(log), ['AC-101-1 holds against the target', 'core journey walks'], 'only the bound e2e case and the smoke case ran');
});

test('AC-20101-2: a failing e2e case of AC-101-1 exits 4 with the fail and FAIL lines, records verdict FAIL with verifiedFbsIds [] and leaves FBS-001 complete; a failing smoke writes no verified; two in-scope specs with one failing record verifiedFbsIds ["FBS-001"]', async (t) => {
  const a = await passFixture(t, { o1: 'fail' });
  const ra = await verify(a.dir, releaseArgs(['--record']));
  assert.equal(ra.code, 4, `${ra.stdout}${ra.stderr}`);
  outHas(ra, 'AC-101-1 FBS-001 fail');
  assert.ok(lines(ra.stdout).some((l) => l.startsWith('verify: release 1.1.0 FAIL ')), `a FAIL line\n${ra.stdout}`);
  const repA = readJson(a.dir, REPORT);
  assert.equal(repA.verdict, 'FAIL');
  assert.deepEqual(repA.verifiedFbsIds, []);
  assert.equal(status(a.dir, 'FBS-001'), 'complete');

  const b = await passFixture(t, { smoke: 'fail' });
  const rb = await verify(b.dir, releaseArgs(['--record']));
  assert.equal(rb.code, 4, `${rb.stdout}${rb.stderr}`);
  outHas(rb, 'AC-101-1 FBS-001 pass');
  assert.deepEqual(readJson(b.dir, REPORT).verifiedFbsIds, [], 'no spec is written verified');
  assert.deepEqual(['FBS-001', 'FBS-002'].map((id) => status(b.dir, id)), ['complete', 'complete']);

  // Section 8.1 (two-spec-partial): verifiedFbsIds ["FBS-001"] on an exit-4 run.
  const specs = [PASS_SPECS()[0], { id: 'FBS-002', status: 'complete', us: 'US-102', criteria: [{ id: 'AC-102-1', flag: 'external', level: 'e2e', outcome: 'fail' }] }];
  const c = await release(t, specs, { change: (d) => { amend(d, 'US-101', 'AC-101-1'); amend(d, 'US-102', 'AC-102-1'); } });
  const rc = await verify(c.dir, releaseArgs(['--record']));
  assert.equal(rc.code, 4, `${rc.stdout}${rc.stderr}`);
  const repC = readJson(c.dir, REPORT);
  assert.equal(repC.verdict, 'FAIL');
  assert.deepEqual(repC.verifiedFbsIds, ['FBS-001']);
  assert.deepEqual(['FBS-001', 'FBS-002'].map((id) => status(c.dir, id)), ['verified', 'complete']);
});

test('AC-20101-3: testOnly-only, unit-bound, inProgress, unflagged and already-verified specs in scope take their listed outcomes, and a notStarted spec or a spec changed only by a flag, a supersession field or its FBS record is not in scope', async (t) => {
  const specs = [
    { id: 'FBS-003', status: 'complete', us: 'US-103', criteria: [{ id: 'AC-103-1', flag: 'testOnly', level: 'integration' }] },
    { id: 'FBS-004', status: 'complete', us: 'US-104', criteria: [{ id: 'AC-104-1', flag: 'external', level: 'unit' }] },
    { id: 'FBS-005', status: 'inProgress', us: 'US-105', criteria: [{ id: 'AC-105-1', flag: 'external', level: 'e2e' }] },
    { id: 'FBS-006', status: 'complete', us: 'US-106', criteria: [{ id: 'AC-106-1', flag: 'external', level: 'e2e' }, { id: 'AC-106-2', flag: null, level: 'e2e' }] },
    { id: 'FBS-007', status: 'verified', us: 'US-107', criteria: [{ id: 'AC-107-1', flag: 'external', level: 'e2e' }] },
    { id: 'FBS-008', status: 'notStarted', us: 'US-108', criteria: [{ id: 'AC-108-1', flag: 'external', level: 'e2e' }] },
    { id: 'FBS-010', status: 'complete', us: 'US-110', criteria: [{ id: 'AC-110-1', flag: 'testOnly', level: 'e2e' }] },
    { id: 'FBS-011', status: 'complete', us: 'US-111', criteria: [{ id: 'AC-111-1', flag: 'external', level: 'e2e' }, { id: 'AC-111-2', flag: 'external', level: null, retired: 'AC-111-1' }] },
    { id: 'FBS-012', status: 'complete', us: 'US-112', criteria: [{ id: 'AC-112-1', flag: 'external', level: 'e2e' }] },
  ];
  const change = (d) => {
    for (const [us, ac] of [['US-103', 'AC-103-1'], ['US-104', 'AC-104-1'], ['US-105', 'AC-105-1'], ['US-106', 'AC-106-1'], ['US-107', 'AC-107-1'], ['US-108', 'AC-108-1']]) amend(d, us, ac);
    amend(d, 'US-110', 'AC-110-1', 'verification', 'external'); // a flag change only
    amend(d, 'US-111', 'AC-111-2', 'supersessionNote'); // a supersession field only
    const f = readJson(d, 'rcf/fbs/fbs-012.json'); f.summary = `${f.summary} Edited after the release.`; writeJson(d, 'rcf/fbs/fbs-012.json', f); // the FBS record only
  };
  const { dir, log } = await release(t, specs, { change });
  const r = await verify(dir, releaseArgs(['--record']));
  const rep = readJson(dir, REPORT);
  const per = (id) => rep.perAc.find((x) => x.acId === id);
  // FBS-003: testOnly only.
  assert.ok(rep.testOnlyOnly.includes('FBS-003'), `FBS-003 is listed in testOnlyOnly\n${JSON.stringify(rep.testOnlyOnly)}`);
  assert.equal(status(dir, 'FBS-003'), 'complete');
  // FBS-004: a unit-level binding only.
  outHas(r, 'AC-104-1 FBS-004 blocked');
  assert.equal(per('AC-104-1').reason, 'no bound e2e test');
  assert.notEqual(status(dir, 'FBS-004'), 'verified');
  // FBS-005: inProgress.
  assert.equal(per('AC-105-1').result, 'blocked');
  assert.equal(per('AC-105-1').reason, 'spec not complete');
  // FBS-006: one unflagged live criterion.
  for (const id of ['AC-106-1', 'AC-106-2']) assert.equal(per(id).reason, 'unflagged criteria', `${id} blocked as unflagged`);
  assert.ok(rep.unflagged.includes('FBS-006'), 'FBS-006 is listed in unflagged');
  assert.notEqual(status(dir, 'FBS-006'), 'verified');
  // FBS-007: already verified, run like a complete spec, stays verified.
  assert.equal(per('AC-107-1').result, 'pass');
  assert.ok(ranNames(log).includes(caseName('AC-107-1')), 'the FBS-007 case ran');
  assert.equal(status(dir, 'FBS-007'), 'verified');
  // Out of scope: FBS-008 (notStarted), FBS-010 (flag only), FBS-011 (supersession field only), FBS-012 (FBS record only).
  for (const id of ['FBS-008', 'FBS-010', 'FBS-011', 'FBS-012']) assert.ok(!rep.scope.fbsIds.includes(id), `${id} is not in scope`);
  for (const ac of ['AC-108-1', 'AC-110-1', 'AC-111-1', 'AC-112-1']) {
    assert.equal(per(ac), undefined, `${ac} has no perAc row`);
    assert.ok(!ranNames(log).includes(caseName(ac)), `${ac}: no case ran`);
  }
  assert.ok(!ranNames(log).includes(caseName('AC-103-1')), 'FBS-003 runs no test');
});

test('AC-20101-4: --record without --release or --since exits 2 with the usage line, --record with no rcf/release-verify.json exits 2 naming the missing smoke, a dirty tree exits 4 with the dirty line, and none writes a file', async (t) => {
  const a = await passFixture(t);
  const st = porcelain(a.dir);
  for (const args of [['--since', 'v1.0.0', '--url', URL_, '--record'], ['--release', '1.1.0', '--url', URL_, '--record']]) {
    const r = await verify(a.dir, args);
    assert.equal(r.code, 2, `${args.join(' ')}\n${r.stdout}${r.stderr}`);
    errHas(r, '[error] usage --record needs --release <label> and --since <ref>');
    assert.equal(porcelain(a.dir), st, 'writes no file');
  }
  const b = await passFixture(t, { releaseVerify: false });
  const rb = await verify(b.dir, releaseArgs(['--record']));
  assert.equal(rb.code, 2, `${rb.stdout}${rb.stderr}`);
  assert.ok(`${rb.stdout}\n${rb.stderr}`.split('\n').includes('verify: no core-journey smoke declared in rcf/release-verify.json'), `${rb.stdout}${rb.stderr}`);
  assert.equal(porcelain(b.dir), '', 'writes no file');
  const c = await passFixture(t);
  writeText(c.dir, 'src/dirty.js', 'export const dirty = true;\n');
  const before = porcelain(c.dir);
  const rc = await verify(c.dir, releaseArgs(['--record']));
  assert.equal(rc.code, 4, `${rc.stdout}${rc.stderr}`);
  errHas(rc, 'verify report refused: working tree is dirty; the report must name a committed head');
  assert.equal(porcelain(c.dir), before, 'writes no file');
  assert.ok(!existsSync(join(c.dir, 'rcf', 'verify-reports', 'releases')), 'no release report');
});

test('AC-20101-5: without --record the PASS fixture run writes no status and nothing under rcf/verify-reports/releases/, leaving every rcf/fbs/ file byte-identical and git status unchanged, and with --out <file> outside the tree only that file appears', async (t) => {
  const { dir } = await passFixture(t);
  const bytes = fbsBytes(dir);
  const r = await verify(dir, releaseArgs());
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(fbsBytes(dir), bytes, 'every rcf/fbs/ file is byte-identical');
  assert.equal(porcelain(dir), '', 'git status --porcelain is unchanged');
  const out = join(scratch(t, 'rcf-h-out-'), 'release.json');
  const ro = await verify(dir, releaseArgs(['--out', out]));
  assert.equal(ro.code, 0, `${ro.stdout}${ro.stderr}`);
  assert.ok(existsSync(out), 'the --out file appears');
  assert.deepEqual(fbsBytes(dir), bytes);
  assert.equal(porcelain(dir), '', 'nothing appears in the tree');
});

test('AC-20101-6: over 150 specs and 800 criteria with 12 changed specs holding 40 external criteria bound by one e2e case of about 1 second each, the release Verify runs exactly those 40 cases plus the smoke suite and adds at most 10 seconds of overhead over the case durations', async (t) => {
  hostFacts(t);
  // Specs 1 to 50 hold 6 criteria, 51 to 150 hold 5 (800 in all). Changed: 1 to 4 (4 external,
  // 2 testOnly) and 5 to 12 (3 external, 3 testOnly): 40 external criteria, each case 1000 ms.
  const specs = [];
  for (let n = 1; n <= 150; n++) {
    const size = n <= 50 ? 6 : 5;
    const ext = n <= 4 ? 4 : n <= 12 ? 3 : size;
    const us = `US-${1000 + n}`;
    const criteria = Array.from({ length: size }, (_, i) => {
      const external = i < ext;
      return { id: `AC-${1000 + n}-${i + 1}`, flag: external ? 'external' : 'testOnly', level: external ? 'e2e' : 'integration', sleepMs: n <= 12 && external ? 1000 : 0 };
    });
    specs.push({ id: `FBS-${String(n).padStart(3, '0')}`, status: 'complete', us, criteria });
  }
  assert.equal(specs.reduce((k, s) => k + s.criteria.length, 0), 800, 'given: 800 criteria');
  const changed = specs.slice(0, 12);
  const want = changed.flatMap((s) => s.criteria.filter((c) => c.flag === 'external').map((c) => caseName(c.id)));
  assert.equal(want.length, 40, 'given: 40 external criteria in the 12 changed specs');
  const { dir, log } = await release(t, specs, { change: (d) => { for (const s of changed) amend(d, s.us, s.criteria[0].id); } });
  const r = await verify(dir, releaseArgs());
  assert.equal(r.code, 0, `${r.stdout.slice(-2000)}${r.stderr.slice(-2000)}`);
  assert.deepEqual(ranNames(log), [...want, 'core journey walks'].sort(), 'exactly the 40 bound e2e cases and the smoke case ran');
  const caseMs = ran(log).reduce((k, x) => k + x.ms, 0);
  const overhead = r.ms - caseMs;
  t.diagnostic(`wall ${Math.round(r.ms)} ms, case durations ${Math.round(caseMs)} ms, overhead ${Math.round(overhead)} ms`);
  assert.ok(overhead <= 10_000, `overhead at most 10 s (got ${Math.round(overhead)} ms)`);
});

test('AC-20101-7: --since naming a missing ref, a tree or a blob exits 2 "[error] usage --since <ref> does not resolve to a commit", a commit that is not an ancestor of HEAD exits 2 "[error] usage --since <ref> is not an ancestor of HEAD", and none writes a file', async (t) => {
  const { dir } = await passFixture(t);
  const tree = git(dir, 'rev-parse', 'HEAD^{tree}');
  const blob = git(dir, 'rev-parse', 'HEAD:package.json');
  for (const ref of ['no-such-ref', tree, blob]) {
    const r = await verify(dir, ['--release', '1.1.0', '--since', ref, '--url', URL_, '--record']);
    assert.equal(r.code, 2, `${ref}\n${r.stdout}${r.stderr}`);
    errHas(r, `[error] usage --since ${ref} does not resolve to a commit`);
    assert.equal(porcelain(dir), '', 'writes no file');
  }
  git(dir, 'switch', '-q', '-c', 'elsewhere', 'v1.0.0');
  const other = commit(dir, 'fixture: a commit off the release line', { 'notes.txt': 'elsewhere\n' });
  git(dir, 'switch', '-q', 'main');
  const r = await verify(dir, ['--release', '1.1.0', '--since', other, '--url', URL_, '--record']);
  assert.equal(r.code, 2, `${r.stdout}${r.stderr}`);
  errHas(r, `[error] usage --since ${other} is not an ancestor of HEAD`);
  assert.equal(porcelain(dir), '', 'writes no file');
});

// FBS-238 amend round (round E, the stage-keeper's ruling Q2 A): the
// reason of each failing criterion. The fixture: FBS-001's bound e2e case
// throws a host guard's message; FBS-002's bound e2e file is gone at HEAD,
// so its runner reports no case and no diagnostic and its stderr is all
// there is; FBS-003's case passes. Red at the round E DEFINE head, where
// every perAc row carries the scope's blocked reason (null on a run row)
// and no reason line is printed.
const GUARD = 'harness: node sits beside an agent CLI in /opt/fixture/bin';
const REASON_SPECS = [
  { id: 'FBS-001', status: 'complete', us: 'US-101', criteria: [{ id: 'AC-101-1', flag: 'external', level: 'e2e' }] },
  { id: 'FBS-002', status: 'complete', us: 'US-102', criteria: [{ id: 'AC-102-1', flag: 'external', level: 'e2e' }] },
  { id: 'FBS-003', status: 'complete', us: 'US-103', criteria: [{ id: 'AC-103-1', flag: 'external', level: 'e2e' }] },
];
async function reasonFixture(t) {
  const f = await release(t, REASON_SPECS, {
    change: (d) => {
      for (const [us, ac] of [['US-101', 'AC-101-1'], ['US-102', 'AC-102-1'], ['US-103', 'AC-103-1']]) amend(d, us, ac);
      writeText(d, 'test/rcf/us-101.test.js', `${HEAD_SRC}test(${JSON.stringify(caseName('AC-101-1'))}, () => { throw new Error(${JSON.stringify(GUARD)}); });\n`);
      git(d, 'rm', '-q', 'test/rcf/us-102.test.js');
    },
  });
  // The runner's own last stderr line for the gone file, read here as the release Verify's runner meets it.
  const probe = run(process.execPath, ['--test', '--test-reporter=tap', 'test/rcf/us-102.test.js'], { cwd: f.dir });
  assert.notEqual(probe.code, 0, `the gone file's run fails\n${probe.stdout}${probe.stderr}`);
  assert.ok(!/^not ok /m.test(probe.stdout), `the gone file's run reports no case and no diagnostic\n${probe.stdout}`);
  const lastErr = probe.stderr.split('\n').map((l) => l.trim()).filter(Boolean).pop();
  assert.ok(lastErr, `the gone file's run prints a stderr line\n${probe.stderr}`);
  return { ...f, lastErr };
}

test('AC-20101-8: a bound e2e case throwing "harness: node sits beside an agent CLI in <dir>" gives its perAc row result "fail" with the thrown message as reason, and a failing case with no diagnostic carries the last stderr line of its runner', async (t) => {
  const { dir, lastErr } = await reasonFixture(t);
  const file = join(scratch(t, 'rcf-h-out-'), 'report.json');
  const r = await verify(dir, releaseArgs(['--out', file]));
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  const per = (id) => JSON.parse(readFileSync(file, 'utf8')).perAc.find((x) => x.acId === id);
  assert.equal(per('AC-101-1').result, 'fail', `AC-101-1 fails\n${r.stdout}`);
  assert.equal(per('AC-101-1').reason, GUARD, 'the thrown message is the reason');
  assert.equal(per('AC-102-1').result, 'fail', `AC-102-1 fails\n${r.stdout}`);
  assert.equal(per('AC-102-1').reason, lastErr, 'a failing case with no diagnostic carries the runner\'s last stderr line');
  assert.equal(per('AC-103-1').result, 'pass');
});

// AC-20101-8's third reason (the stage-keeper's ruling on the stopped
// DEFINE): FBS-001's bound e2e case ends its runner's process with exit
// code 1 and prints nothing, so its runner's TAP reports no case for the
// pointer (only the file's own "not ok" line), no diagnostic of the case,
// and an empty stderr. Red at the round E DEFINE head, where the perAc
// row carries the scope's blocked reason (null on a run row).
async function noResultFixture(t) {
  const f = await release(t, [{ id: 'FBS-001', status: 'complete', us: 'US-101', criteria: [{ id: 'AC-101-1', flag: 'external', level: 'e2e' }] }], {
    change: (d) => {
      amend(d, 'US-101', 'AC-101-1');
      writeText(d, 'test/rcf/us-101.test.js', `${HEAD_SRC}test(${JSON.stringify(caseName('AC-101-1'))}, () => { process.exit(1); });\n`);
    },
  });
  const file = 'test/rcf/us-101.test.js';
  // The runner as the release Verify runs it, read here: its exit code, no case for the pointer, an empty stderr.
  const probe = run(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=(?:^| )${caseName('AC-101-1')}$`, file], { cwd: f.dir });
  assert.notEqual(probe.code, 0, `the case's run fails\n${probe.stdout}${probe.stderr}`);
  assert.ok(!probe.stdout.includes(caseName('AC-101-1')), `the runner reports no case for the pointer, so no diagnostic of it\n${probe.stdout}`);
  assert.equal(probe.stderr.trim(), '', `the runner prints no stderr line\n${probe.stderr}`);
  return { ...f, pointer: `${file}::${caseName('AC-101-1')}`, code: probe.code };
}

test('AC-20101-8: a failing bound e2e case with neither a TAP diagnostic nor a stderr line gives its perAc row result "fail" with the reason "no result for <pointer> (exit <code>)"', async (t) => {
  const { dir, pointer, code } = await noResultFixture(t);
  const file = join(scratch(t, 'rcf-h-out-'), 'report.json');
  const r = await verify(dir, releaseArgs(['--out', file]));
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  const per = JSON.parse(readFileSync(file, 'utf8')).perAc.find((x) => x.acId === 'AC-101-1');
  assert.equal(per.result, 'fail', `AC-101-1 fails\n${r.stdout}`);
  assert.equal(per.reason, `no result for ${pointer} (exit ${code})`, 'a failing case with neither a TAP diagnostic nor a stderr line carries "no result for <pointer> (exit <code>)"');
});

// AC-20101-8's reason shape (the stage-keeper's gate ruling 3): the
// reason is the first non-empty line of the TAP diagnostic's error,
// trimmed. FBS-001's bound e2e case fails a deep-equal assertion, whose
// message node:test writes as a block scalar of several lines. Red at the
// round E DEFINE head, where the perAc row carries the scope's blocked
// reason (null on a run row).
async function multiLineFixture(t) {
  const f = await release(t, [{ id: 'FBS-001', status: 'complete', us: 'US-101', criteria: [{ id: 'AC-101-1', flag: 'external', level: 'e2e' }] }], {
    change: (d) => {
      amend(d, 'US-101', 'AC-101-1');
      writeText(d, 'test/rcf/us-101.test.js', `${HEAD_SRC}test(${JSON.stringify(caseName('AC-101-1'))}, () => { assert.deepEqual({ port: 80 }, { port: 8080 }); });\n`);
    },
  });
  const file = 'test/rcf/us-101.test.js';
  // The runner as the release Verify runs it, read here: the case's own
  // diagnostic, its error a block scalar whose first non-empty line is the expected reason.
  const probe = run(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=(?:^| )${caseName('AC-101-1')}$`, file], { cwd: f.dir });
  assert.notEqual(probe.code, 0, `the case's run fails\n${probe.stdout}${probe.stderr}`);
  const tap = probe.stdout.split('\n');
  const at = tap.indexOf(`not ok 1 - ${caseName('AC-101-1')}`);
  assert.ok(at >= 0, `the runner reports the case as not ok\n${probe.stdout}`);
  const err = tap.findIndex((l, i) => i > at && /^ {2}error: [|>]/.test(l));
  assert.ok(err > at, `the case's diagnostic holds its error as a block scalar\n${probe.stdout}`);
  const block = [];
  for (const l of tap.slice(err + 1)) {
    if (l.trim() && !l.startsWith('    ')) break;
    block.push(l.trim());
  }
  const message = block.filter(Boolean);
  assert.ok(message.length > 1, `the assertion message spans several lines\n${probe.stdout}`);
  return { ...f, first: message[0] };
}

test('AC-20101-8: a failing bound e2e case whose assertion message spans several lines gives its perAc row result "fail" with the first non-empty line of that message as reason', async (t) => {
  const { dir, first } = await multiLineFixture(t);
  const file = join(scratch(t, 'rcf-h-out-'), 'report.json');
  const r = await verify(dir, releaseArgs(['--out', file]));
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  const per = JSON.parse(readFileSync(file, 'utf8')).perAc.find((x) => x.acId === 'AC-101-1');
  assert.equal(per.result, 'fail', `AC-101-1 fails\n${r.stdout}`);
  assert.equal(per.reason, first, 'a multi-line assertion message gives its first non-empty line, trimmed, as reason');
});

test('AC-20101-9: the line after each fail line reads "  reason: <reason>" and pass lines are unchanged', async (t) => {
  const { dir, lastErr } = await reasonFixture(t);
  const r = await verify(dir, releaseArgs());
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  const out = lines(r.stdout);
  const after = (line) => {
    const i = out.indexOf(line);
    assert.ok(i >= 0, `stdout carries "${line}"\n${r.stdout}`);
    return out[i + 1];
  };
  assert.equal(after('AC-101-1 FBS-001 fail'), `  reason: ${GUARD}`, `the line after AC-101-1's fail line\n${r.stdout}`);
  assert.equal(after('AC-102-1 FBS-002 fail'), `  reason: ${lastErr}`, `the line after AC-102-1's fail line\n${r.stdout}`);
  assert.ok(!after('AC-103-1 FBS-003 pass').startsWith('  reason:'), `the pass line stands as it is, no reason line after it\n${r.stdout}`);
  assert.ok(out.some((l) => l.startsWith('verify: release 1.1.0 FAIL 1/3 external criteria, smoke 1/1 ')), `the FAIL line\n${r.stdout}`);
});

// The stage-keeper's DEFINE-3 ruling 2 (gate ruling 3's reason clauses no
// test pinned): with several failing bound cases the first failing case in
// the tests order of its row gives the reason, a pass row's reason stays
// null, and no reason line follows a blocked line. The fixture: AC-101-1
// (FBS-001) is bound to two e2e cases in one file, each failing with its
// own one-line message, its suite listing the file's second case first,
// so the row's tests order is the opposite of the order its runner runs
// and reports the cases; AC-102-1 (FBS-002) is bound by a unit-level case
// only, so its row is blocked ("no bound e2e test"); AC-103-1 (FBS-003)
// passes. The first two tests are red at the round E DEFINE head, where
// every run row's reason is null and no reason line is printed; the last
// two are declared regression guards, green there and through the BUILD.
const RUN_FIRST = { name: 'AC-101-1 runs first in its file', message: 'the case run first fails, listed second in the tests' };
const LISTED_FIRST = { name: 'AC-101-1 is listed first in the tests', message: 'the case listed first in the tests fails, run second' };
const ORDER_SPECS = [
  { id: 'FBS-001', status: 'complete', us: 'US-101', criteria: [{ id: 'AC-101-1', flag: 'external', level: 'e2e' }] },
  { id: 'FBS-002', status: 'complete', us: 'US-102', criteria: [{ id: 'AC-102-1', flag: 'external', level: 'unit' }] },
  { id: 'FBS-003', status: 'complete', us: 'US-103', criteria: [{ id: 'AC-103-1', flag: 'external', level: 'e2e' }] },
];
async function firstFailFixture(t) {
  const file = 'test/rcf/us-101.test.js';
  const pointer = (c) => `${file}::${c.name}`;
  const f = await release(t, ORDER_SPECS, {
    change: (d) => {
      for (const [us, ac] of [['US-101', 'AC-101-1'], ['US-102', 'AC-102-1'], ['US-103', 'AC-103-1']]) amend(d, us, ac);
      writeText(d, file, `${HEAD_SRC}${[RUN_FIRST, LISTED_FIRST].map((c) => `test(${JSON.stringify(c.name)}, () => { throw new Error(${JSON.stringify(c.message)}); });`).join('\n')}\n`);
      const ts = readJson(d, 'rcf/test-suites/ts-001.json');
      assert.ok(ts.usId === 'US-101' && ts.testLevel === 'e2e', `TS-001 is the US-101 e2e suite\n${JSON.stringify(ts)}`);
      ts.testCases = [LISTED_FIRST, RUN_FIRST].map((c, i) => ({ id: `TC-001-case-${i + 1}`, acId: 'AC-101-1', description: c.name, status: 'pending', testPointer: pointer(c) }));
      writeJson(d, 'rcf/test-suites/ts-001.json', ts);
    },
  });
  // The runner as the release Verify runs it (one run of the file, one name
  // pattern per case), read here: it runs and reports the file's first case
  // first, each case not ok with its own message in its diagnostic.
  const patterns = [LISTED_FIRST, RUN_FIRST].map((c) => `--test-name-pattern=(?:^| )${c.name}$`);
  const probe = run(process.execPath, ['--test', '--test-reporter=tap', ...patterns, file], { cwd: f.dir });
  assert.notEqual(probe.code, 0, `the file's run fails\n${probe.stdout}${probe.stderr}`);
  const tap = probe.stdout.split('\n');
  const at = (c) => tap.findIndex((l) => new RegExp(`^not ok \\d+ - ${c.name}$`).test(l));
  assert.ok(at(RUN_FIRST) >= 0 && at(LISTED_FIRST) > at(RUN_FIRST), `the runner reports "${RUN_FIRST.name}" first, then "${LISTED_FIRST.name}", each not ok\n${probe.stdout}`);
  for (const c of [RUN_FIRST, LISTED_FIRST]) {
    const end = tap.findIndex((l, i) => i > at(c) && l === '  ...');
    assert.ok(tap.slice(at(c), end).includes(`  error: '${c.message}'`), `the diagnostic of "${c.name}" holds its own one-line message\n${probe.stdout}`);
  }
  return { ...f, tests: [pointer(LISTED_FIRST), pointer(RUN_FIRST)] };
}
const perAcOf = (file, id) => JSON.parse(readFileSync(file, 'utf8')).perAc.find((x) => x.acId === id);

test('AC-20101-8: with two failing bound e2e cases of different messages on one criterion, the first failing case in the tests order of its row gives the reason, not the case its runner reports first', async (t) => {
  const { dir, tests } = await firstFailFixture(t);
  const file = join(scratch(t, 'rcf-h-out-'), 'report.json');
  const r = await verify(dir, releaseArgs(['--out', file]));
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  const per = perAcOf(file, 'AC-101-1');
  assert.equal(per.result, 'fail', `AC-101-1 fails\n${r.stdout}`);
  assert.deepEqual(per.tests, tests, `the tests order of the row lists "${LISTED_FIRST.name}" first, the case the runner reports second`);
  assert.equal(per.reason, LISTED_FIRST.message, 'the first failing case in the tests order of the row gives the reason');
});

test('AC-20101-9: with two failing bound e2e cases on one criterion, the line after its fail line reads "  reason: <reason>" with the message of the first failing case in the tests order of its row', async (t) => {
  const { dir } = await firstFailFixture(t);
  const r = await verify(dir, releaseArgs());
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  const out = lines(r.stdout);
  const i = out.indexOf('AC-101-1 FBS-001 fail');
  assert.ok(i >= 0, `stdout carries "AC-101-1 FBS-001 fail"\n${r.stdout}`);
  assert.equal(out[i + 1], `  reason: ${LISTED_FIRST.message}`, `the line after AC-101-1's fail line\n${r.stdout}`);
});

// A declared regression guard (green at the round E DEFINE head, where a
// run row's reason is null): the BUILD gives a fail row its reason and a
// pass row none.
test('AC-20101-8: a pass row keeps its reason null in a run that also holds a failing row and a blocked row', async (t) => {
  const { dir } = await firstFailFixture(t);
  const file = join(scratch(t, 'rcf-h-out-'), 'report.json');
  const r = await verify(dir, releaseArgs(['--out', file]));
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.equal(perAcOf(file, 'AC-101-1').result, 'fail', `AC-101-1 fails\n${r.stdout}`);
  assert.equal(perAcOf(file, 'AC-102-1').result, 'blocked', `AC-102-1 is blocked\n${r.stdout}`);
  const pass = perAcOf(file, 'AC-103-1');
  assert.equal(pass.result, 'pass', `AC-103-1 passes\n${r.stdout}`);
  assert.equal(pass.reason, null, `a pass row's reason stays null\n${JSON.stringify(pass)}`);
});

// A declared regression guard (green at the round E DEFINE head, where no
// reason line is printed): the BUILD prints a reason line after each fail
// line and none after a blocked line, though a blocked row has a reason.
test('AC-20101-8: no "  reason:" line follows a blocked line, in a run that also holds a failing row', async (t) => {
  const { dir } = await firstFailFixture(t);
  const r = await verify(dir, releaseArgs());
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  const out = lines(r.stdout);
  assert.ok(out.includes('AC-101-1 FBS-001 fail'), `stdout carries "AC-101-1 FBS-001 fail"\n${r.stdout}`);
  const i = out.indexOf('AC-102-1 FBS-002 blocked');
  assert.ok(i >= 0, `stdout carries "AC-102-1 FBS-002 blocked"\n${r.stdout}`);
  assert.ok(!out[i + 1].startsWith('  reason:'), `no reason line follows the blocked line\n${r.stdout}`);
  assert.ok(!out.includes('  reason: no bound e2e test'), `the blocked row's reason is never printed as a reason line\n${r.stdout}`);
});

// ---------------------------------------------------------------- US-20102

// The fixture package: name fixture-app, version 1.1.0, shipping its rcf/
// tree and tests; AC-101-1 is bound by an e2e case that, inside the
// installed copy, writes what it observes to a file outside every tree.
function packageFixture(observed) {
  return (dir) => {
    writeJson(dir, 'package.json', { name: 'fixture-app', version: '1.1.0', type: 'module', files: ['rcf', 'test', 'src'] });
    writeText(dir, 'src/index.js', 'export const app = () => "ok";\n');
    writeText(dir, 'test/rcf/us-101.test.js', [
      "import { test } from 'node:test';",
      "import { execFileSync } from 'node:child_process';",
      "import { appendFileSync, writeFileSync } from 'node:fs';",
      `test(${JSON.stringify(caseName('AC-101-1'))}, () => {`,
      "  const cache = execFileSync('npm', ['config', 'get', 'cache'], { encoding: 'utf8' }).trim();",
      "  const registry = execFileSync('npm', ['config', 'get', 'registry'], { encoding: 'utf8' }).trim();",
      `  writeFileSync(${JSON.stringify(observed)}, JSON.stringify({ home: process.env.HOME, cache, registry, leak: 'FIXTURE_LEAK' in process.env, kind: process.env.RCF_TARGET_KIND ?? null, cwd: process.cwd() }));`,
      '});',
      '',
    ].join('\n'));
  };
}
async function packageRelease(t) {
  const observed = join(scratch(t, 'rcf-h-observed-'), 'observed.json');
  const specs = [{ id: 'FBS-001', status: 'complete', us: 'US-101', criteria: [{ id: 'AC-101-1', flag: 'external', level: 'e2e' }] }];
  const f = await release(t, specs, { change: (d) => amend(d, 'US-101', 'AC-101-1'), pkg: packageFixture(observed) });
  return { ...f, observed };
}
// The child PATH must reach sh as well as npm: npm spawns sh for a package's
// install scripts, and on macOS npm does not sit beside sh in /bin.
const NPM_PATH = () => toolPath(['npm', 'sh']);
function commonDir(a, b) {
  const x = a.split('/');
  const y = b.split('/');
  const out = [];
  for (let i = 0; i < Math.min(x.length, y.length) && x[i] === y[i]; i++) out.push(x[i]);
  return out.join('/');
}
const TMPS = () => [tmpdir(), realpathSync(tmpdir())];
const underTmp = (p) => TMPS().some((d) => p.startsWith(`${d}/`)) && !TMPS().includes(p);

test('AC-20102-1: a cold --package . release Verify runs the bound test with HOME and the npm cache inside the run scratch directory under the OS temp directory, a fresh cache, no FIXTURE_LEAK, and records target kind package with name, version, sha256 and cold true', async (t) => {
  const { dir, observed } = await packageRelease(t);
  const r = await verify(dir, ['--release', '1.1.0', '--since', 'v1.0.0', '--package', '.', '--record'], { PATH: NPM_PATH(), FIXTURE_LEAK: 'visible' });
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const o = JSON.parse(readFileSync(observed, 'utf8'));
  // The run scratch directory: the deepest directory holding both HOME and the npm cache.
  const run0 = commonDir(o.home, o.cache);
  assert.ok(underTmp(run0), `HOME (${o.home}) and the npm cache (${o.cache}) sit in one scratch directory under the OS temp directory`);
  assert.notEqual(o.home, process.env.HOME, 'HOME is not the caller HOME');
  // A fresh cache: it lives in the run's own scratch directory, which is gone after the run.
  assert.ok(!existsSync(run0), `the run scratch directory ${run0} (and so the cache) is fresh to the run and removed after it`);
  assert.equal(o.leak, false, 'FIXTURE_LEAK is not visible');
  assert.equal(o.kind, 'package', 'RCF_TARGET_KIND=package');
  const target = readJson(dir, REPORT).target;
  assert.equal(target.kind, 'package');
  assert.equal(target.name, 'fixture-app');
  assert.equal(target.version, '1.1.0');
  assert.match(target.sha256, /^[0-9a-f]{64}$/);
  assert.equal(target.cold, true);
});

test('AC-20102-2: --offline in release mode exits 2 "[error] usage --offline cannot install cold", two targets or none exit 2 "[error] usage give exactly one target: --url, --artefact or --package", and an artefact whose dependency resolves nowhere exits 1 naming the install command and writes no report', async (t) => {
  const { dir } = await packageRelease(t);
  const base = ['--release', '1.1.0', '--since', 'v1.0.0'];
  const env = { PATH: NPM_PATH() };
  const off = await verify(dir, [...base, '--package', '.', '--offline'], env);
  assert.equal(off.code, 2, `${off.stdout}${off.stderr}`);
  errHas(off, '[error] usage --offline cannot install cold');
  const tgzDir = scratch(t, 'rcf-h-tgz-');
  for (const args of [[...base, '--url', URL_, '--artefact', join(tgzDir, 'x.tgz')], base]) {
    const r = await verify(dir, args, env);
    assert.equal(r.code, 2, `${args.join(' ')}\n${r.stdout}${r.stderr}`);
    errHas(r, '[error] usage give exactly one target: --url, --artefact or --package');
  }
  // An artefact whose dependency resolves nowhere: a file: dependency on a tarball that does not exist, by absolute
  // path in this test's scratch, so npm must open it to read its manifest and fails ENOENT on every version, offline or not.
  const badRoot = scratch(t, 'rcf-h-badpkg-');
  const src = join(badRoot, 'pkg');
  writeJson(src, 'package.json', { name: 'fixture-broken', version: '1.1.0', dependencies: { 'fixture-missing': `file:${join(badRoot, 'does-not-exist.tgz')}` } });
  const packed = run('npm', ['pack', '--pack-destination', tgzDir], { cwd: src, env });
  assert.equal(packed.code, 0, `npm pack\n${packed.stderr}`);
  const tgz = join(tgzDir, packed.stdout.trim().split('\n').pop());
  const bad = await verify(dir, [...base, '--artefact', tgz, '--record'], env);
  assert.equal(bad.code, 1, `${bad.stdout}${bad.stderr}`);
  assert.ok(lines(bad.stderr).some((l) => l.includes('install') && l.includes(tgz)), `stderr names the install command for ${tgz}\n${bad.stderr}`);
  assert.ok(!existsSync(join(dir, REPORT)), 'no report is written');
});

test('AC-20102-3: a user npmrc at the caller HOME setting an unreachable registry is ignored by the cold release Verify, which installs and runs with the default registry configuration', async (t) => {
  const { dir, observed } = await packageRelease(t);
  // F-8: the npm configuration the cold install itself reads, observed by
  // a postinstall script of the fixture package, which the install's own
  // npm runs (no registry fetch: the package has no dependencies).
  const installed = join(scratch(t, 'rcf-h-observed-'), 'install.json');
  commit(dir, 'BUILD: the package observes its own install', {
    'package.json': { ...readJson(dir, 'package.json'), scripts: { postinstall: 'node src/postinstall.cjs' } },
    'src/postinstall.cjs': [
      "const { execFileSync } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const registry = execFileSync('npm', ['config', 'get', 'registry'], { encoding: 'utf8' }).trim();",
      `writeFileSync(${JSON.stringify(installed)}, JSON.stringify({ home: process.env.HOME, userconfig: process.env.npm_config_userconfig ?? null, registry }));`,
      '',
    ].join('\n'),
  });
  const home = scratch(t, 'rcf-h-home-');
  writeText(home, '.npmrc', 'registry=http://127.0.0.1:9/\n');
  const r = await verify(dir, ['--release', '1.1.0', '--since', 'v1.0.0', '--package', '.', '--record'], { PATH: NPM_PATH(), HOME: home });
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const o = JSON.parse(readFileSync(observed, 'utf8'));
  assert.equal(o.registry, 'https://registry.npmjs.org/', 'the run sees the default registry, not the caller npmrc');
  assert.notEqual(o.home, home);
  assert.ok(existsSync(installed), 'the cold install ran the package postinstall');
  const i = JSON.parse(readFileSync(installed, 'utf8'));
  assert.equal(i.registry, 'https://registry.npmjs.org/', 'the cold install reads the default registry, not the caller npmrc');
  assert.notEqual(i.home, home, 'the cold install does not run under the caller HOME');
  assert.notEqual(i.userconfig, join(home, '.npmrc'), 'the cold install does not read the caller npmrc');
});

test('AC-20102-4: a cold release Verify writes in the project only under rcf/verify-reports/releases/ and rcf/fbs/ (with --record), leaves no tarball, node_modules or lockfile change, and removes its scratch directory', async (t) => {
  const { dir, observed } = await packageRelease(t);
  const env = { PATH: NPM_PATH() };
  const plain = await verify(dir, ['--release', '1.1.0', '--since', 'v1.0.0', '--package', '.'], env);
  assert.equal(plain.code, 0, `${plain.stdout}${plain.stderr}`);
  assert.equal(porcelain(dir), '', 'without --record nothing changes in the project');
  const r = await verify(dir, ['--release', '1.1.0', '--since', 'v1.0.0', '--package', '.', '--record'], env);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const changed = lines(gitTryPaths(dir));
  assert.ok(changed.length > 0 && changed.every((p) => p.startsWith('rcf/verify-reports/releases/') || p.startsWith('rcf/fbs/')), `only release reports and spec files change: ${changed.join(', ')}`);
  assert.ok(!readdirSync(dir).some((f) => f.endsWith('.tgz')), 'no tarball in the project');
  assert.ok(!existsSync(join(dir, 'node_modules')), 'no node_modules in the project');
  for (const lock of ['package-lock.json', 'pnpm-lock.yaml', 'npm-shrinkwrap.json']) assert.ok(!existsSync(join(dir, lock)), `no ${lock}`);
  const o = JSON.parse(readFileSync(observed, 'utf8'));
  assert.ok(!existsSync(o.home), `the scratch directory is removed after the run: ${o.home}`);
  // F-6: a --release label holding ../ keeps the same write boundary, on a
  // fresh fixture (the first --record run changed rcf/fbs/). The label
  // ../../x resolves from rcf/verify-reports/releases/ to rcf/x.json.
  const fresh = await packageRelease(t);
  const esc = await verify(fresh.dir, ['--release', '../../x', '--since', 'v1.0.0', '--package', '.', '--record'], env);
  const escaped = lines(gitTryPaths(fresh.dir));
  assert.ok(escaped.every((p) => p.startsWith('rcf/verify-reports/releases/') || p.startsWith('rcf/fbs/')), `with --release ../../x only release reports and spec files change: ${escaped.join(', ')}\nexit ${esc.code}\n${esc.stderr}`);
  assert.ok(!existsSync(join(fresh.dir, 'rcf', 'x.json')), 'nothing is written at rcf/x.json, where the label ../../x resolves');
});
// The changed and untracked paths (untracked listed file by file), read
// untrimmed and NUL-separated: the harness git() trims stdout, which
// would cut the leading status column of a first porcelain line.
function gitTryPaths(dir) {
  const z = (...args) => {
    const r = gitTry(dir, ...args, '-z');
    if (r.code !== 0) throw new Error(`git ${args.join(' ')} exited ${r.code}: ${r.stderr}`);
    return r.stdout.split('\0').filter(Boolean);
  };
  return [...z('diff', '--name-only', 'HEAD'), ...z('ls-files', '--others', '--exclude-standard')].join('\n');
}

// ---------------------------------------------------------------- US-20103

test('AC-20103-1: with rcf/verify-catalog.json and a local server, verify run --url <server> --fbs FBS-001 --mode deterministic (with the flags 0.36.x requires) still runs as an ad hoc probe with its 0.36.x output and exit codes and leaves every rcf/fbs/ file byte-identical', async (t) => {
  const dir = await project(t, { name: 'catalog' });
  writeJson(dir, 'rcf/verify-catalog.json', { catalogVersion: 1, probes: { 'AC-101-1': { path: '/health', expectStatus: 200 } } });
  writeText(dir, '.gitignore', 'node_modules/\n');
  initRepo(dir);
  commit(dir, 'fixture: base');
  const bytes = fbsBytes(dir);
  const out = join(scratch(t, 'rcf-h-adhoc-'), 'report.json');
  const adhoc = (o, url) => verify(dir, ['--repo', '.', '--url', url, '--fbs', 'FBS-001', '--mode', 'deterministic', '--profile', 'local-dev', '--provision-mode', 'skip', '--out', o]);
  const r = await adhoc(out, URL_);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  errHas(r, 'Verify mode: deterministic (model-free, in-process; a dispatched worker can run this)');
  errHas(r, `[rcf-verify] verdict PASS [correctness] -> ${out}`);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).verdict, 'PASS');
  const down = await adhoc(`${out}.down`, 'http://127.0.0.1:9');
  assert.equal(down.code, 4, `an unreachable target fails the probe with the 0.36.x exit 4\n${down.stdout}${down.stderr}`);
  assert.deepEqual(fbsBytes(dir), bytes, 'every rcf/fbs/ file is byte-identical');
  assert.equal(porcelain(dir), '', 'git status unchanged');
});

test('AC-20103-2: --record with --mode deterministic or --mode agentScreenshotCritique exits 2 "[error] usage release Verify runs the bound E2E tests; --mode probes are ad hoc only" and runs nothing', async (t) => {
  const { dir, log } = await passFixture(t);
  for (const mode of ['deterministic', 'agentScreenshotCritique']) {
    const spawned = spawnLog(scratch(t, 'rcf-h-spawn-'));
    const r = await verify(dir, releaseArgs(['--record', '--mode', mode]), spawned.env);
    assert.equal(r.code, 2, `${mode}\n${r.stdout}${r.stderr}`);
    errHas(r, '[error] usage release Verify runs the bound E2E tests; --mode probes are ad hoc only');
    assert.deepEqual(ranNames(log), [], `${mode}: no case ran`);
    assert.deepEqual(readSpawnLog(spawned.file).filter((x) => commandName(x) !== 'git'), [], `${mode}: nothing but git is spawned`);
    assert.equal(porcelain(dir), '', `${mode}: nothing written`);
  }
});

test('AC-20103-3: the PASS fixture of the release story has no catalog and no probe field and still records verified, and a spawn seam over that run records no agent CLI', async (t) => {
  const { dir } = await passFixture(t);
  assert.ok(!existsSync(join(dir, 'rcf', 'verify-catalog.json')), 'given: no rcf/verify-catalog.json');
  const stories = readdirSync(join(dir, 'rcf', 'user-stories')).map((f) => readJson(dir, `rcf/user-stories/${f}`));
  assert.ok(stories.every((s) => s.acceptanceCriteria.every((a) => !('probe' in a))), 'given: no criterion carries a probe');
  const spawned = spawnLog(scratch(t, 'rcf-h-spawn-'));
  const r = await verify(dir, releaseArgs(['--record']), spawned.env);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(status(dir, 'FBS-001'), 'verified');
  const names = readSpawnLog(spawned.file).map(commandName);
  assert.ok(names.length > 0, 'the seam recorded the run');
  assert.deepEqual(names.filter((n) => ['claude', 'codex', 'gemini'].includes(n)), [], `no agent CLI is spawned: ${[...new Set(names)].join(', ')}`);
});
