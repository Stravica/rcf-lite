// FBS-237 (US-20001, US-20002, US-20003): rcf build finalise writes
// complete from the last round's REVIEW, TEST and test-strength verdicts,
// never reads a verify report and never writes verified; rcf build mark
// refuses complete.
//
// Criteria: 19, all external (US-20001 9, US-20002 5, US-20003 5).
// Every test is a node:test todo case ("FBS-237 round DEFINE", GR-35): it
// runs and is red until FBS-237's round DEFINE drops the marker and BUILD
// turns it green. Each drives bin/rcf.js (or the packed artefact) as a
// child process over a fixture project made by its own rcf init and
// committed to git: the base chain on main, then a branch carrying the
// round's DEFINE:, BUILD:, REVIEW: and TEST: commits. Verdict files are
// well-formed ReviewVerdict, TestVerdict and TestStrengthReport records
// keyed to the right heads (GR-38): a review.json's head is its REVIEW:
// commit's parent H; a test.json's head is H, or its own parent M for a
// FAIL recorded after a TEST PASS; a --merge-suite BaseSuiteRecord names
// the merge head M. Spawn clauses read RCF_SPAWN_LOG (GR-46). Imports:
// Node builtins and test/_harness/ only (GR-40).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { lines, rcf } from '../_harness/spawn.js';
import { commit, git, initRepo, porcelain, s7, sha } from '../_harness/git.js';
import { baseSuiteRecord, bindTests, criterion, editFbs, editStory, project, readJson, readText, reviewVerdict, scratch, testStrengthReport, testVerdict, verdictPath, writeJson, writeText } from '../_harness/fixture.js';
import { commandName, readSpawnLog, spawnLog } from '../_harness/capture.js';

const TODO = { todo: 'FBS-237 round DEFINE' };
const BOTH = ['AC-101-1', 'AC-101-2'];
const NAMES = { 'AC-101-1': 'first behaviour holds', 'AC-101-2': 'second behaviour holds', 'AC-101-3': 'third behaviour holds' };
const SYMBOL = { 'AC-101-1': 'first', 'AC-101-2': 'second', 'AC-101-3': 'third' };
const pointer = (acId) => `test/rcf/a.test.js::${NAMES[acId]}`;
const RETIRED = 'finalise no longer reads a verify report; Finalise writes complete from the recorded REVIEW, TEST and test-strength verdicts (rcf guidance build-cycle)';

// ------------------------------------------------------------- fixtures

// The base chain on main: US-101 with `acs` (each flagged external unless
// `flags` says otherwise), specs { id: { acIds, status } }, every criterion
// bound to a resolving test. Then branch feature. Returns { dir, base }.
async function baseChain(t, { acs = BOTH, specs = { 'FBS-001': { acIds: BOTH, status: 'notStarted' } }, flags = {} } = {}) {
  const dir = await project(t, { name: 'fin' });
  editStory(dir, 'US-101', (us) => {
    us.acceptanceCriteria = acs.map((id) => criterion(id, `[happy] ${NAMES[id]}`, { given: 'a fixture project', when: 'the fixture runs', then: `${NAMES[id]}`, verification: flags[id] ?? 'external' }));
  });
  const one = readJson(dir, 'rcf/fbs/fbs-001.json');
  for (const [id, s] of Object.entries(specs)) {
    const n = Number(id.slice(4));
    editFbs(dir, id, (f) => ({ ...(f ?? { ...one, fbsId: id, buildOrder: n, title: `${id} fixture`, summary: `${id} scopes ${s.acIds.join(', ')}.` }), acIds: s.acIds, executionStatus: s.status }));
  }
  bindTests(dir, acs.map((acId) => ({ acId, pointer: pointer(acId) })));
  writeText(dir, '.gitignore', 'node_modules/\n');
  initRepo(dir);
  const base = commit(dir, 'fixture: base chain');
  git(dir, 'switch', '-q', '-c', 'feature');
  return { dir, base };
}

// The round's DEFINE: commit: marks FBS-001 `status` when given and edits
// its summary (chain status, never a criterion), plus any `edit`.
function defineCommit(dir, { status, edit, subject = 'DEFINE: round' } = {}) {
  editFbs(dir, 'FBS-001', (f) => { if (status) f.executionStatus = status; f.summary = `${f.summary} Round opened.`; });
  if (edit) edit(dir);
  return commit(dir, subject);
}

// A BUILD: commit: src/x.js and one symbol-level Code Node per criterion in `cn`.
function buildCommit(dir, { cn = BOTH, subject = 'BUILD: code', trailers = [], files = {} } = {}) {
  const out = { 'src/x.js': `export function first() { return 1; }\nexport function second() { return 2; }\nexport function third() { return 3; }\n// ${subject}\n`, ...files };
  for (const acId of cn) {
    const n = acId.slice(-1);
    out[`rcf/code-nodes/cn-00${n}.json`] = {
      cnId: `CN-00${n}`, path: `src/x.js#${SYMBOL[acId]}`, title: `fixture node for ${acId}`, description: `Fixture Code Node implementing ${acId}.`,
      implementsAcIds: [acId], dependencies: [], version: '0.1.0', status: 'draft', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    };
  }
  return commit(dir, subject, out, { trailers });
}

// A REVIEW: commit adding review.json for the current HEAD; returns H.
function reviewCommit(dir, opts = {}) {
  const H = sha(dir);
  commit(dir, 'REVIEW: verdict', { [verdictPath(H, 'review.json')]: reviewVerdict(H, { touchedAcIds: BOTH, ...opts }) });
  return H;
}

// A TEST: commit adding test.json (result, or none for null) and
// test-strength.json (strength, or none for null) for `head`, plus `extra` files.
function testCommit(dir, head, { result = 'PASS', strength = { passing: BOTH }, fbsIds, extra = {}, subject = 'TEST: verdict' } = {}) {
  const files = { ...extra };
  if (result) files[verdictPath(head, 'test.json')] = testVerdict(head, { result, ...(fbsIds ? { fbsIds } : {}) });
  if (strength) files[verdictPath(head, 'test-strength.json')] = testStrengthReport(head, strength);
  return commit(dir, subject, files);
}

// The happy round: DEFINE: (FBS-001 notStarted -> inProgress), BUILD: (H,
// Code Nodes for both criteria), REVIEW: MERGE/PASS at H touching both,
// TEST: PASS at H with a passing test-strength record; no verify reports.
async function happy(t, { base: baseOpts, define = { status: 'inProgress' }, build = {}, review = {}, testOpts = {} } = {}) {
  const { dir, base } = await baseChain(t, baseOpts);
  defineCommit(dir, define);
  const H = buildCommit(dir, build);
  reviewCommit(dir, review);
  const T = testCommit(dir, H, testOpts);
  return { dir, base, H, T };
}

// A commit on main touching a file the branch never touches, then a clean
// "FINALISE: merge main" on the branch; returns the merge head M.
function mergeMain(dir) {
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'chore: main moves on', { 'notes.txt': 'main moved\n' });
  git(dir, 'switch', '-q', 'feature');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'FINALISE: merge main', 'main');
  return sha(dir);
}

// A BaseSuiteRecord file outside the fixture tree.
function suiteFile(t, record) {
  const dir = scratch(t, 'rcf-h-suite-');
  writeJson(dir, 'base-suite.json', record);
  return join(dir, 'base-suite.json');
}

const finalise = (dir, extra = [], env = {}, id = 'FBS-001') => rcf(['build', 'finalise', id, '--ci-run', 'run-7', ...extra], { cwd: dir, env });
const completeLine = (head, H, n = 2, id = 'FBS-001') => `finalise: ${id} complete at ${s7(head)} (reviewed ${s7(H)}, ci run-7, touched ${n} criteria)`;
const out = (r) => r.stdout.replace(/\n$/, '');
const errHas = (r, line) => assert.ok(lines(r.stderr).includes(line), `stderr carries "${line}"\nexit ${r.code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
const fbsText = (dir, id = 'FBS-001') => readText(dir, `rcf/fbs/${id.toLowerCase()}.json`);
const status = (dir, id = 'FBS-001') => readJson(dir, `rcf/fbs/${id.toLowerCase()}.json`).executionStatus;

// Refusal with exit `code` and stderr `line`, leaving FBS files and git status as they were.
async function refuses(dir, extra, code, line, { ids = ['FBS-001'], env } = {}) {
  const before = { st: porcelain(dir), fbs: ids.map((id) => fbsText(dir, id)) };
  const r = await finalise(dir, extra, env);
  assert.equal(r.code, code, `exit ${code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  errHas(r, line);
  assert.deepEqual(ids.map((id) => fbsText(dir, id)), before.fbs, 'the spec files are byte-identical');
  assert.equal(porcelain(dir), before.st, 'git status --porcelain is unchanged');
  return r;
}

// A VerifyReport v1 fixture for H (verdict PASS or FAIL).
function verifyReport(H, verdict) {
  return {
    reportVersion: 1, fbsId: 'FBS-001', headSha: H,
    target: { kind: 'package', packageRef: 'fixture-app-1.0.0.tgz', name: 'fixture-app', version: '1.0.0', sha256: '0'.repeat(64), servedSha: null },
    mode: 'deterministic', hand: 'verifier', verifierId: 'fixture-verifier', startedAt: '2026-10-24T00:00:00.000Z', finishedAt: '2026-10-24T00:00:05.000Z',
    rcfLiteVersion: '0.36.1', profile: 'packagedArtefact', method: 'suiteAsProbe',
    install: { command: 'npm install fixture-app-1.0.0.tgz', exitCode: 0, logPath: `rcf/verify-reports/FBS-001/${H.slice(0, 12)}/install.log`, registry: 'default' },
    suites: [{ testSuite: 'TS-001', file: 'test/rcf/a.test.js', tests: 2, pass: verdict === 'PASS' ? 2 : 1, fail: verdict === 'PASS' ? 0 : 1, skipped: 0, todos: 0, outputPath: `rcf/verify-reports/FBS-001/${H.slice(0, 12)}/TS-001.tap` }],
    verdict, verdictAuthority: 'ship',
    runStats: { counts: { verified: verdict === 'PASS' ? 2 : 1, failed: verdict === 'PASS' ? 0 : 1, skipped: 0, critiqueOnly: 0, total: 2 } },
    perAc: BOTH.map((acId, i) => ({ acId, result: verdict === 'PASS' || i === 0 ? 'pass' : 'fail', evidence: { testSuite: 'TS-001', file: 'test/rcf/a.test.js', tests: [], notRun: [] } })),
  };
}
const reportPath = (H) => `rcf/verify-reports/FBS-001/${H.slice(0, 12)}.json`;

// ---------------------------------------------------------------- US-20001

test('AC-20001-1: over DEFINE:, BUILD:, REVIEW: MERGE/PASS at H touching both criteria and TEST: PASS with a passing test-strength record at H, and no rcf/verify-reports/, finalise FBS-001 --ci-run run-7 exits 0 with the complete line, writes executionStatus complete and changes nothing else in the tree', TODO, async (t) => {
  const { dir, H, T } = await happy(t);
  assert.ok(!existsSync(join(dir, 'rcf', 'verify-reports')), 'given: no rcf/verify-reports/ directory at all');
  const r = await finalise(dir);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(out(r), completeLine(T, H));
  assert.equal(status(dir), 'complete');
  assert.deepEqual(lines(porcelain(dir)).map((l) => l.slice(3)), ['rcf/fbs/fbs-001.json'], 'only rcf/fbs/fbs-001.json changes');
});

test('AC-20001-2: with no REVIEW: commit finalise exits 4 "finalise refused: no REVIEW verdict for FBS-001 on the branch", and with a ReviewVerdict MERGE/FINDINGS it exits 4 "finalise refused: REVIEW at <H7> is MERGE/FINDINGS; a failed verdict closes the round"', TODO, async (t) => {
  const a = await baseChain(t);
  defineCommit(a.dir, { status: 'inProgress' });
  const H = buildCommit(a.dir);
  testCommit(a.dir, H);
  await refuses(a.dir, [], 4, 'finalise refused: no REVIEW verdict for FBS-001 on the branch');

  const b = await happy(t, { review: { adequacy: 'FINDINGS' } });
  await refuses(b.dir, [], 4, `finalise refused: REVIEW at ${s7(b.H)} is MERGE/FINDINGS; a failed verdict closes the round`);
});

test('AC-20001-3: with the TEST: commit absent finalise exits 4 "no TEST verdict at <H7>", with a TestVerdict FAIL at H "TEST at <H7> is FAIL", and with a TEST PASS at H then a FAIL TestVerdict at the later head M "TEST at <M7> is FAIL; a failed verdict closes the round"', TODO, async (t) => {
  const a = await baseChain(t);
  defineCommit(a.dir, { status: 'inProgress' });
  const H = buildCommit(a.dir);
  reviewCommit(a.dir);
  await refuses(a.dir, [], 4, `finalise refused: no TEST verdict at ${s7(H)}`);

  const b = await happy(t, { testOpts: { result: 'FAIL' } });
  await refuses(b.dir, [], 4, `finalise refused: TEST at ${s7(b.H)} is FAIL`);

  // Section 8.1 (finalise-refuses-post-pass-fail): the FAIL after a PASS is keyed to its own parent M.
  const c = await happy(t);
  const M = c.T;
  commit(c.dir, 'TEST: verdict after merge head', { [verdictPath(M, 'test.json')]: testVerdict(M, { result: 'FAIL' }) });
  await refuses(c.dir, [], 4, `finalise refused: TEST at ${s7(M)} is FAIL; a failed verdict closes the round`);
});

test('AC-20001-4: a BUILD: late fix or a DEFINE: amend after the TEST: commit refuses with exit 4 "finalise refused: REVIEW reopened by <s7> <STAGE>: after the reviewed head <H7>", while a FINALISE: lockfile commit and a clean FINALISE: merge of main (with a green --merge-suite at the merge head) do not refuse', TODO, async (t) => {
  const a = await happy(t);
  const late = commit(a.dir, 'BUILD: late fix', { 'src/x.js': 'export function first() { return 11; }\nexport function second() { return 2; }\nexport function third() { return 3; }\n' });
  await refuses(a.dir, [], 4, `finalise refused: REVIEW reopened by ${s7(late)} BUILD: after the reviewed head ${s7(a.H)}`);

  const b = await happy(t);
  editStory(b.dir, 'US-101', (us) => { us.description = `${us.description} Amended.`; });
  const amend = commit(b.dir, 'DEFINE: amend');
  await refuses(b.dir, [], 4, `finalise refused: REVIEW reopened by ${s7(amend)} DEFINE: after the reviewed head ${s7(b.H)}`);

  const c = await happy(t);
  const lock = commit(c.dir, 'FINALISE: lockfile', { 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" });
  const rc = await finalise(c.dir);
  assert.equal(rc.code, 0, `a FINALISE: lockfile commit does not refuse\n${rc.stdout}${rc.stderr}`);
  assert.equal(out(rc), completeLine(lock, c.H));

  const d = await happy(t);
  const M = mergeMain(d.dir);
  const rd = await finalise(d.dir, ['--merge-suite', suiteFile(t, baseSuiteRecord(M))]);
  assert.equal(rd.code, 0, `a clean FINALISE: merge of main does not refuse\n${rd.stdout}${rd.stderr}`);
  assert.equal(out(rd), completeLine(M, d.H));
});

test('AC-20001-5: run again at the same head or after a FINALISE: status commit, finalise exits 0 with "finalise: FBS-001 complete (unchanged)" and a byte-identical spec file, and after an earlier round closed by REVIEW FINDINGS it judges only the last round and exits 0', TODO, async (t) => {
  const a = await happy(t);
  const first = await finalise(a.dir);
  assert.equal(first.code, 0, `${first.stdout}${first.stderr}`);
  const bytes = fbsText(a.dir);
  const again = await finalise(a.dir);
  assert.equal(again.code, 0, `${again.stdout}${again.stderr}`);
  assert.equal(out(again), 'finalise: FBS-001 complete (unchanged)');
  assert.equal(fbsText(a.dir), bytes, 'byte-identical at the same head');
  commit(a.dir, 'FINALISE: status');
  const after = await finalise(a.dir);
  assert.equal(after.code, 0, `${after.stdout}${after.stderr}`);
  assert.equal(out(after), 'finalise: FBS-001 complete (unchanged)');
  assert.equal(fbsText(a.dir), bytes, 'byte-identical after a further FINALISE: commit');

  // Two rounds: REVIEW FINDINGS at H1 closes the first; the second passes at H2.
  const { dir } = await baseChain(t);
  defineCommit(dir, { status: 'inProgress' });
  buildCommit(dir);
  reviewCommit(dir, { adequacy: 'FINDINGS' });
  defineCommit(dir, { subject: 'DEFINE: next round' });
  const H2 = buildCommit(dir, { subject: 'BUILD: fix' });
  reviewCommit(dir);
  const T2 = testCommit(dir, H2);
  const r = await finalise(dir);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(out(r), completeLine(T2, H2));
});

test('AC-20001-6: after a clean FINALISE: merge main, finalise with --merge-suite naming a green record at the merge head exits 0 with the info line, and a two-spec round finalised spec by spec writes complete on the named spec only', TODO, async (t) => {
  const a = await happy(t);
  const M = mergeMain(a.dir);
  const r = await finalise(a.dir, ['--merge-suite', suiteFile(t, baseSuiteRecord(M))]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  errHas(r, `[info] finalise: merge from main after the reviewed head; base suite green at ${s7(M)} is the suite evidence, ci run-7 on ${s7(M)}`);
  assert.equal(status(a.dir), 'complete');

  const specs = { 'FBS-001': { acIds: ['AC-101-1'], status: 'notStarted' }, 'FBS-002': { acIds: ['AC-101-2'], status: 'notStarted' } };
  const { dir } = await baseChain(t, { specs });
  defineCommit(dir, { status: 'inProgress', edit: (d) => editFbs(d, 'FBS-002', (f) => { f.executionStatus = 'inProgress'; }) });
  const H = buildCommit(dir);
  reviewCommit(dir, { fbsIds: ['FBS-001', 'FBS-002'] });
  testCommit(dir, H, { fbsIds: ['FBS-001', 'FBS-002'] });
  const one = await finalise(dir);
  assert.equal(one.code, 0, `${one.stdout}${one.stderr}`);
  assert.deepEqual([status(dir, 'FBS-001'), status(dir, 'FBS-002')], ['complete', 'inProgress'], 'finalising FBS-001 writes complete on FBS-001 only');
  const two = await finalise(dir, [], {}, 'FBS-002');
  assert.equal(two.code, 0, `${two.stdout}${two.stderr}`);
  assert.deepEqual([status(dir, 'FBS-001'), status(dir, 'FBS-002')], ['complete', 'complete'], 'finalising FBS-002 writes complete on FBS-002');
});

test('AC-20001-7: on every refusal finalise leaves rcf/fbs/<fbs-id>.json byte-identical and git status --porcelain unchanged, and never writes complete on any spec other than the one named', TODO, async (t) => {
  const specs = { 'FBS-001': { acIds: BOTH, status: 'notStarted' }, 'FBS-002': { acIds: ['AC-101-2'], status: 'inProgress' } };
  const ids = ['FBS-001', 'FBS-002'];
  const cases = [
    ['no REVIEW verdict', async () => { const { dir } = await baseChain(t, { specs }); defineCommit(dir, { status: 'inProgress' }); testCommit(dir, buildCommit(dir)); return [dir, []]; }],
    ['REVIEW FINDINGS', async () => [(await happy(t, { base: { specs }, review: { adequacy: 'FINDINGS' } })).dir, []]],
    ['no TEST verdict', async () => { const { dir } = await baseChain(t, { specs }); defineCommit(dir, { status: 'inProgress' }); buildCommit(dir); reviewCommit(dir); return [dir, []]; }],
    ['TEST FAIL', async () => [(await happy(t, { base: { specs }, testOpts: { result: 'FAIL' } })).dir, []]],
    ['notStarted', async () => [(await happy(t, { base: { specs }, define: {} })).dir, []]],
    ['REVIEW reopened', async () => { const { dir } = await happy(t, { base: { specs } }); commit(dir, 'BUILD: late fix', { 'src/late.js': 'export const late = 1;\n' }); return [dir, []]; }],
    ['merge without --merge-suite', async () => { const { dir } = await happy(t, { base: { specs } }); mergeMain(dir); return [dir, []]; }],
    ['no test-strength record', async () => [(await happy(t, { base: { specs }, testOpts: { strength: null } })).dir, []]],
    ['missing Code Node', async () => [(await happy(t, { base: { specs }, build: { cn: ['AC-101-1'] } })).dir, []]],
    ['separation FAIL', async () => [(await happy(t, { base: { specs }, build: { trailers: [['Hand', 'mixed']] } })).dir, []]],
    ['no --ci-run', async () => [(await happy(t, { base: { specs } })).dir, null]],
  ];
  for (const [label, make] of cases) {
    const [dir, extra] = await make();
    const before = { st: porcelain(dir), fbs: ids.map((id) => fbsText(dir, id)) };
    const r = extra === null ? await rcf(['build', 'finalise', 'FBS-001'], { cwd: dir }) : await finalise(dir, extra);
    assert.ok(r.code === 3 || r.code === 4, `${label}: refused (exit 3 or 4), got ${r.code}\n${r.stdout}${r.stderr}`);
    assert.deepEqual(ids.map((id) => fbsText(dir, id)), before.fbs, `${label}: every spec file is byte-identical`);
    assert.equal(porcelain(dir), before.st, `${label}: git status --porcelain is unchanged`);
  }
  // A success writes complete on the named spec only.
  const { dir } = await happy(t, { base: { specs } });
  const other = fbsText(dir, 'FBS-002');
  const ok = await finalise(dir);
  assert.equal(ok.code, 0, `${ok.stdout}${ok.stderr}`);
  assert.equal(fbsText(dir, 'FBS-002'), other, 'FBS-002 is byte-identical after finalising FBS-001');
});

test('AC-20001-8: after a clean FINALISE: merge main at M, finalise refuses with exit 4 without --merge-suite, with a record whose head is not M, and with a red record at M, each with its line and a byte-identical spec file, while a FINALISE: status commit with no merge needs no --merge-suite', TODO, async (t) => {
  const a = await happy(t);
  const M = mergeMain(a.dir);
  await refuses(a.dir, [], 4, `finalise refused: merge from main after the reviewed head; pass --merge-suite <a green base-suite record at ${s7(M)}>`);
  await refuses(a.dir, ['--merge-suite', suiteFile(t, baseSuiteRecord(a.H))], 4, `finalise refused: base suite recorded at ${s7(a.H)}, merge head is ${s7(M)}`);
  await refuses(a.dir, ['--merge-suite', suiteFile(t, baseSuiteRecord(M, { exitCode: 1 }))], 4, `finalise refused: base suite red at ${s7(M)}; the verifier records TEST FAIL at the merge head`);

  const b = await happy(t);
  editFbs(b.dir, 'FBS-001', (f) => { f.summary = `${f.summary} Status noted.`; });
  const S = commit(b.dir, 'FINALISE: status');
  const r = await finalise(b.dir);
  assert.equal(r.code, 0, `a FINALISE: status commit with no merge needs no --merge-suite\n${r.stdout}${r.stderr}`);
  assert.equal(out(r), completeLine(S, b.H));
});

test('AC-20001-9: with FBS-001 at notStarted finalise exits 4 with the notStarted refusal line and writes nothing; at inProgress it writes complete; at complete or verified it runs as an amend round', TODO, async (t) => {
  const a = await happy(t, { define: {} });
  assert.equal(status(a.dir), 'notStarted', 'given: FBS-001 at notStarted');
  await refuses(a.dir, [], 4, "finalise refused: FBS-001 is notStarted; the round's DEFINE: marks it inProgress");

  const b = await happy(t);
  const rb = await finalise(b.dir);
  assert.equal(rb.code, 0, `${rb.stdout}${rb.stderr}`);
  assert.equal(status(b.dir), 'complete', 'at inProgress it writes complete');

  // Amend rounds (TAC-4156): at complete the complete line for the new H and a byte-identical file;
  // at verified with external criteria touched it writes complete.
  const c = await happy(t, { base: { specs: { 'FBS-001': { acIds: BOTH, status: 'complete' } } }, define: {} });
  const bytes = fbsText(c.dir);
  const rc = await finalise(c.dir);
  assert.equal(rc.code, 0, `${rc.stdout}${rc.stderr}`);
  assert.equal(out(rc), completeLine(c.T, c.H));
  assert.equal(fbsText(c.dir), bytes, 'at complete the spec file is byte-identical');

  const d = await happy(t, { base: { specs: { 'FBS-001': { acIds: BOTH, status: 'verified' } } }, define: {} });
  const rd = await finalise(d.dir);
  assert.equal(rd.code, 0, `${rd.stdout}${rd.stderr}`);
  assert.equal(out(rd), completeLine(d.T, d.H));
  assert.equal(status(d.dir), 'complete', 'at verified with external criteria touched it writes complete');
});

// ---------------------------------------------------------------- US-20002

test('AC-20002-1: with no test-strength record at H finalise exits 4 "no test-strength record at <H7>", with AC-101-2 failing "test-strength at <H7> fails for AC-101-2", and with a record covering AC-101-1 only "test-strength at <H7> omits AC-101-2"', TODO, async (t) => {
  const a = await happy(t, { testOpts: { strength: null } });
  await refuses(a.dir, [], 4, `finalise refused: no test-strength record at ${s7(a.H)}`);
  const b = await happy(t, { testOpts: { strength: { passing: ['AC-101-1'], failing: ['AC-101-2'] } } });
  await refuses(b.dir, [], 4, `finalise refused: test-strength at ${s7(b.H)} fails for AC-101-2`);
  const c = await happy(t, { testOpts: { strength: { passing: ['AC-101-1'] } } });
  await refuses(c.dir, [], 4, `finalise refused: test-strength at ${s7(c.H)} omits AC-101-2`);
});

test('AC-20002-2: when the ReviewVerdict touches only AC-101-1 but the round DEFINE: changed the then text of AC-101-2 or added a test case bound to it, finalise exits 4 "finalise refused: touched criteria omit AC-101-2 changed since <base7>"', TODO, async (t) => {
  const thenText = (d) => editStory(d, 'US-101', (us) => { us.acceptanceCriteria.find((a) => a.id === 'AC-101-2').then = 'second behaviour holds, amended'; });
  const newCase = (d) => bindTests(d, [{ acId: 'AC-101-2', pointer: 'test/rcf/b.test.js::second behaviour holds again' }], { tsId: 'TS-002' });
  for (const edit of [thenText, newCase]) {
    const a = await happy(t, { define: { status: 'inProgress', edit }, review: { touchedAcIds: ['AC-101-1'] }, testOpts: { strength: { passing: ['AC-101-1'] } } });
    await refuses(a.dir, [], 4, `finalise refused: touched criteria omit AC-101-2 changed since ${s7(a.base)}`);
  }
});

test('AC-20002-3: with no --ci-run finalise exits 4 "ci evidence missing: pass --ci-run <ref>", with AC-101-2 lacking a Code Node it exits 3 "finalise refused: missing Code Node for AC-101-2", and an untouched criterion of the spec with no Code Node does not refuse', TODO, async (t) => {
  const a = await happy(t);
  const before = fbsText(a.dir);
  const r = await rcf(['build', 'finalise', 'FBS-001'], { cwd: a.dir });
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  errHas(r, 'ci evidence missing: pass --ci-run <ref>');
  assert.equal(fbsText(a.dir), before);

  const b = await happy(t, { build: { cn: ['AC-101-1'] } });
  await refuses(b.dir, [], 3, 'finalise refused: missing Code Node for AC-101-2');

  // Slice scope: an amend round on FBS-001 (complete) touching AC-101-1 and AC-101-2; AC-101-3 untouched, no Code Node.
  const all = ['AC-101-1', 'AC-101-2', 'AC-101-3'];
  const c = await happy(t, { base: { acs: all, specs: { 'FBS-001': { acIds: all, status: 'complete' } } }, define: {} });
  const rc = await finalise(c.dir);
  assert.equal(rc.code, 0, `an untouched criterion with no Code Node does not refuse\n${rc.stdout}${rc.stderr}`);
  assert.equal(out(rc), completeLine(c.T, c.H));
});

test('AC-20002-4: an earlier BUILD: tests commit touching test/rcf/a.test.js makes finalise exit 4 "finalise refused: separation FAIL: <s7> BUILD: touches test/rcf/a.test.js (class rcfTest, owned by DEFINE)", and a Hand: mixed commit refuses the same way with the retired-mixed item', TODO, async (t) => {
  const { dir } = await baseChain(t);
  defineCommit(dir, { status: 'inProgress' });
  const bad = commit(dir, 'BUILD: tests', { 'test/rcf/a.test.js': `${readText(dir, 'test/rcf/a.test.js')}// touched by BUILD\n` });
  const H = buildCommit(dir);
  reviewCommit(dir);
  testCommit(dir, H);
  await refuses(dir, [], 4, `finalise refused: separation FAIL: ${s7(bad)} BUILD: touches test/rcf/a.test.js (class rcfTest, owned by DEFINE)`);

  const b = await happy(t, { build: { trailers: [['Hand', 'mixed'], ['Separation-Reason', 'fixture exception']] } });
  const r = await refuses(b.dir, [], 4, `finalise refused: separation FAIL: ${s7(b.H)} Hand: mixed is retired; commit chores as FINALISE: within its file classes`);
  assert.ok(!r.stdout.includes('complete'), 'no separation exception is accepted');
});

test('AC-20002-5: over the happy run a spawn seam (RCF_SPAWN_LOG) records only git: finalise never re-runs the suite, test strength or the separation audit as a child process', TODO, async (t) => {
  const { dir } = await happy(t);
  const log = spawnLog(scratch(t, 'rcf-h-spawn-'));
  const r = await finalise(dir, [], log.env);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const spawned = readSpawnLog(log.file);
  assert.ok(spawned.length > 0, 'the seam recorded the git calls');
  assert.deepEqual([...new Set(spawned.map(commandName))], ['git'], `only git is spawned: ${JSON.stringify(spawned.slice(0, 5))}`);
});

// ---------------------------------------------------------------- US-20003

test('AC-20003-1: each retired flag (--report, --max-report-age 7, --mode deterministic, --url http://localhost:8787, --allow-pre-merge) makes finalise exit 2 with the no-verify-report line, spawn nothing and write nothing', TODO, async (t) => {
  const { dir } = await happy(t);
  const flags = [['--report', 'rcf/verify-reports/FBS-001/report.json'], ['--max-report-age', '7'], ['--mode', 'deterministic'], ['--url', 'http://localhost:8787'], ['--allow-pre-merge']];
  for (const flag of flags) {
    const log = spawnLog(scratch(t, 'rcf-h-spawn-'));
    const before = { st: porcelain(dir), fbs: fbsText(dir) };
    const r = await finalise(dir, flag, log.env);
    assert.equal(r.code, 2, `${flag[0]}: exit 2\n${r.stdout}${r.stderr}`);
    errHas(r, RETIRED);
    assert.deepEqual(readSpawnLog(log.file), [], `${flag[0]}: spawns nothing`);
    assert.equal(fbsText(dir), before.fbs, `${flag[0]}: writes nothing`);
    assert.equal(porcelain(dir), before.st, `${flag[0]}: git status unchanged`);
  }
});

test('AC-20003-2: a committed FAIL or malformed VerifyReport under rcf/verify-reports/FBS-001/ leaves finalise output as without it (exit 0, the complete line), and a PASS report never stands in for a missing TEST verdict', TODO, async (t) => {
  const plain = await happy(t);
  const p = await finalise(plain.dir);
  assert.equal(p.code, 0, `${p.stdout}${p.stderr}`);
  for (const make of [(H) => verifyReport(H, 'FAIL'), () => '{ "reportVersion": 1, "verdict": \n']) {
    const { dir } = await baseChain(t);
    defineCommit(dir, { status: 'inProgress' });
    const H = buildCommit(dir);
    reviewCommit(dir);
    const T = testCommit(dir, H, { extra: { [reportPath(H)]: make(H) } });
    const r = await finalise(dir);
    assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
    assert.equal(out(r), completeLine(T, H), 'the same complete line as without the report');
    assert.equal(r.stderr, p.stderr, 'the same stderr as without the report');
    assert.equal(status(dir), 'complete');
  }
  // TEST-less: the round's TEST: commit carries only a PASS report.
  const { dir } = await baseChain(t);
  defineCommit(dir, { status: 'inProgress' });
  const H = buildCommit(dir);
  reviewCommit(dir);
  testCommit(dir, H, { result: null, strength: null, extra: { [reportPath(H)]: verifyReport(H, 'PASS') }, subject: 'TEST: evidence' });
  await refuses(dir, [], 4, `finalise refused: no TEST verdict at ${s7(H)}`);
});

test('AC-20003-3: rcf build mark FBS-001 complete at inProgress exits 4 "mark refused: complete is written only by rcf build finalise from the recorded verdicts" leaving the file byte-identical, mark inProgress from notStarted still works, and every backward mark exits 4', TODO, async (t) => {
  const dir = await project(t, { name: 'mark' });
  const mark = (to) => rcf(['build', 'mark', 'FBS-001', to], { cwd: dir });
  const set = (s) => editFbs(dir, 'FBS-001', (f) => { f.executionStatus = s; });

  set('inProgress');
  let bytes = fbsText(dir);
  const c = await mark('complete');
  assert.equal(c.code, 4, `${c.stdout}${c.stderr}`);
  errHas(c, 'mark refused: complete is written only by rcf build finalise from the recorded verdicts');
  assert.equal(fbsText(dir), bytes, 'byte-identical after the refused complete');

  set('notStarted');
  const fwd = await mark('inProgress');
  assert.equal(fwd.code, 0, `${fwd.stdout}${fwd.stderr}`);
  assert.equal(status(dir), 'inProgress', 'inProgress from notStarted still works');

  // Section 8.1 (mark-forward-only): backward marks exit 4.
  for (const [from, to] of [['complete', 'inProgress'], ['inProgress', 'notStarted']]) {
    set(from);
    bytes = fbsText(dir);
    const r = await mark(to);
    assert.equal(r.code, 4, `${from} to ${to} is refused with exit 4\n${r.stdout}${r.stderr}`);
    assert.equal(fbsText(dir), bytes, `${from} to ${to}: byte-identical`);
  }
});

test('AC-20003-4: an amend round on FBS-001 at verified whose ReviewVerdict touches only testOnly criteria exits 0 with "finalise: FBS-001 verified (unchanged: touched criteria are testOnly)" and no write, and with an external criterion touched it writes complete', TODO, async (t) => {
  const base = { flags: { 'AC-101-1': 'testOnly', 'AC-101-2': 'external' }, specs: { 'FBS-001': { acIds: BOTH, status: 'verified' } } };
  const a = await happy(t, { base, define: {}, review: { touchedAcIds: ['AC-101-1'] }, testOpts: { strength: { passing: ['AC-101-1'] } } });
  const st = porcelain(a.dir);
  const bytes = fbsText(a.dir);
  const r = await finalise(a.dir);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(out(r), 'finalise: FBS-001 verified (unchanged: touched criteria are testOnly)');
  assert.equal(fbsText(a.dir), bytes, 'no write');
  assert.equal(porcelain(a.dir), st, 'git status unchanged');

  const b = await happy(t, { base, define: {} });
  const rb = await finalise(b.dir);
  assert.equal(rb.code, 0, `${rb.stdout}${rb.stderr}`);
  assert.equal(out(rb), completeLine(b.T, b.H));
  assert.equal(status(b.dir), 'complete');
});

test('AC-20003-5: across the fixtures of US-20003 no finalise run writes executionStatus verified on a spec that was not verified before it, in any mode or flag combination', TODO, async (t) => {
  const runs = [];
  const fixtures = [
    ['inProgress round', () => happy(t)],
    ['amend at complete', () => happy(t, { base: { specs: { 'FBS-001': { acIds: BOTH, status: 'complete' } } }, define: {} })],
    ['amend at verified, external touched', () => happy(t, { base: { specs: { 'FBS-001': { acIds: BOTH, status: 'verified' } } }, define: {} })],
    ['FAIL report committed', async () => { const { dir } = await baseChain(t); defineCommit(dir, { status: 'inProgress' }); const H = buildCommit(dir); reviewCommit(dir); testCommit(dir, H, { extra: { [reportPath(H)]: verifyReport(H, 'FAIL') } }); return { dir }; }],
  ];
  const flagSets = [[], ['--mode', 'deterministic'], ['--report', 'rcf/verify-reports/FBS-001/report.json'], ['--acknowledge-verified-override']];
  for (const [label, make] of fixtures) {
    for (const flags of flagSets) {
      const { dir } = await make();
      const before = status(dir);
      const r = await finalise(dir, flags);
      const after = status(dir);
      runs.push(`${label} ${flags.join(' ') || '(no flag)'}: ${before} -> ${after} (exit ${r.code})`);
      if (label === 'inProgress round' && flags.length === 0) {
        assert.equal(r.code, 0, `given: the inProgress round finalises (the writer runs)\n${r.stdout}${r.stderr}`);
        assert.equal(after, 'complete', 'given: the inProgress round writes complete');
      }
      assert.ok(!(after === 'verified' && before !== 'verified'), `${label} ${flags.join(' ')}: finalise never writes verified (${before} -> ${after})`);
    }
  }
  t.diagnostic(runs.join('\n'));
});
