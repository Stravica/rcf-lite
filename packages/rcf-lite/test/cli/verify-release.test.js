// FBS-238 (US-20101, US-20102, US-20103): the release Verify. rcf verify
// run --release --since runs only the bound e2e cases of the live
// external criteria of the specs changed since the release, plus the
// declared core-journey smoke suites, against a URL or a package
// installed cold, and with --record writes the ReleaseVerifyReport and
// verified; the catalog and agent probes stay optional ad hoc runs.
//
// Criteria: 14, all external (US-20101 7, US-20102 4, US-20103 3).
// Every test is a node:test todo case ("FBS-238 round DEFINE", GR-35): it
// runs and is red until FBS-238's round DEFINE drops the marker and BUILD
// turns it green. Each drives bin/rcf.js (or the packed artefact) as a
// child process over a fixture project made by its own rcf init,
// committed to git and tagged v1.0.0 at the release commit R. The target
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
import { commit, git, initRepo, porcelain, sha } from '../_harness/git.js';
import { project, readJson, readText, scratch, writeJson, writeText } from '../_harness/fixture.js';
import { commandName, hostFacts, readSpawnLog, spawnLog } from '../_harness/capture.js';

const TODO = { todo: 'FBS-238 round DEFINE' };
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

test('AC-20101-1: with FBS-001 changed after v1.0.0 and FBS-002 unchanged, verify run --release 1.1.0 --since v1.0.0 --url <server> --record exits 0, prints the pass, PASS and recorded lines, writes FBS-001 verified and a ReleaseVerifyReport v1 whose perAc holds AC-101-1 only', TODO, async (t) => {
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

test('AC-20101-2: a failing e2e case of AC-101-1 exits 4 with the fail and FAIL lines, records verdict FAIL with verifiedFbsIds [] and leaves FBS-001 complete; a failing smoke writes no verified; two in-scope specs with one failing record verifiedFbsIds ["FBS-001"]', TODO, async (t) => {
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

test('AC-20101-3: testOnly-only, unit-bound, inProgress, unflagged and already-verified specs in scope take their listed outcomes, and a notStarted spec or a spec changed only by a flag, a supersession field or its FBS record is not in scope', TODO, async (t) => {
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

test('AC-20101-4: --record without --release or --since exits 2 with the usage line, --record with no rcf/release-verify.json exits 2 naming the missing smoke, a dirty tree exits 4 with the dirty line, and none writes a file', TODO, async (t) => {
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

test('AC-20101-5: without --record the PASS fixture run writes no status and nothing under rcf/verify-reports/releases/, leaving every rcf/fbs/ file byte-identical and git status unchanged, and with --out <file> outside the tree only that file appears', TODO, async (t) => {
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

test('AC-20101-6: over 150 specs and 800 criteria with 12 changed specs holding 40 external criteria bound by one e2e case of about 1 second each, the release Verify runs exactly those 40 cases plus the smoke suite and adds at most 10 seconds of overhead over the case durations', TODO, async (t) => {
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

test('AC-20101-7: --since naming a missing ref, a tree or a blob exits 2 "[error] usage --since <ref> does not resolve to a commit", a commit that is not an ancestor of HEAD exits 2 "[error] usage --since <ref> is not an ancestor of HEAD", and none writes a file', TODO, async (t) => {
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
const NPM_PATH = () => toolPath(['npm']);
function commonDir(a, b) {
  const x = a.split('/');
  const y = b.split('/');
  const out = [];
  for (let i = 0; i < Math.min(x.length, y.length) && x[i] === y[i]; i++) out.push(x[i]);
  return out.join('/');
}
const TMPS = () => [tmpdir(), realpathSync(tmpdir())];
const underTmp = (p) => TMPS().some((d) => p.startsWith(`${d}/`)) && !TMPS().includes(p);

test('AC-20102-1: a cold --package . release Verify runs the bound test with HOME and the npm cache inside the run scratch directory under the OS temp directory, a fresh cache, no FIXTURE_LEAK, and records target kind package with name, version, sha256 and cold true', TODO, async (t) => {
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

test('AC-20102-2: --offline in release mode exits 2 "[error] usage --offline cannot install cold", two targets or none exit 2 "[error] usage give exactly one target: --url, --artefact or --package", and an artefact whose dependency resolves nowhere exits 1 naming the install command and writes no report', TODO, async (t) => {
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
  // An artefact whose dependency resolves nowhere: a file: dependency on a missing directory.
  const src = join(scratch(t, 'rcf-h-badpkg-'), 'pkg');
  writeJson(src, 'package.json', { name: 'fixture-broken', version: '1.1.0', dependencies: { 'fixture-missing': 'file:../does-not-exist' } });
  const packed = run('npm', ['pack', '--pack-destination', tgzDir], { cwd: src, env });
  assert.equal(packed.code, 0, `npm pack\n${packed.stderr}`);
  const tgz = join(tgzDir, packed.stdout.trim().split('\n').pop());
  const bad = await verify(dir, [...base, '--artefact', tgz, '--record'], env);
  assert.equal(bad.code, 1, `${bad.stdout}${bad.stderr}`);
  assert.ok(lines(bad.stderr).some((l) => l.includes('install') && l.includes(tgz)), `stderr names the install command for ${tgz}\n${bad.stderr}`);
  assert.ok(!existsSync(join(dir, REPORT)), 'no report is written');
});

test('AC-20102-3: a user npmrc at the caller HOME setting an unreachable registry is ignored by the cold release Verify, which installs and runs with the default registry configuration', TODO, async (t) => {
  const { dir, observed } = await packageRelease(t);
  const home = scratch(t, 'rcf-h-home-');
  writeText(home, '.npmrc', 'registry=http://127.0.0.1:9/\n');
  const r = await verify(dir, ['--release', '1.1.0', '--since', 'v1.0.0', '--package', '.', '--record'], { PATH: NPM_PATH(), HOME: home });
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const o = JSON.parse(readFileSync(observed, 'utf8'));
  assert.equal(o.registry, 'https://registry.npmjs.org/', 'the run sees the default registry, not the caller npmrc');
  assert.notEqual(o.home, home);
});

test('AC-20102-4: a cold release Verify writes in the project only under rcf/verify-reports/releases/ and rcf/fbs/ (with --record), leaves no tarball, node_modules or lockfile change, and removes its scratch directory', TODO, async (t) => {
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
});
function gitTryPaths(dir) {
  return git(dir, 'status', '--porcelain', '-uall').split('\n').filter(Boolean).map((l) => l.slice(3)).join('\n');
}

// ---------------------------------------------------------------- US-20103

test('AC-20103-1: with rcf/verify-catalog.json and a local server, verify run --url <server> --fbs FBS-001 --mode deterministic (with the flags 0.36.x requires) still runs as an ad hoc probe with its 0.36.x output and exit codes and leaves every rcf/fbs/ file byte-identical', TODO, async (t) => {
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

test('AC-20103-2: --record with --mode deterministic or --mode agentScreenshotCritique exits 2 "[error] usage release Verify runs the bound E2E tests; --mode probes are ad hoc only" and runs nothing', TODO, async (t) => {
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

test('AC-20103-3: the PASS fixture of the release story has no catalog and no probe field and still records verified, and a spawn seam over that run records no agent CLI', TODO, async (t) => {
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
