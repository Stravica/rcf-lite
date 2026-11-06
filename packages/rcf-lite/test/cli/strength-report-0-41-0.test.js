// FBS-243 (US-20502): test strength is a recorded report that refuses
// nothing (Baz decisions 11 and 12, Dave's ruling R1 option 1). rcf build
// finalise still needs a test-strength record at the reviewed head H that
// covers every touched criterion (structure), but never refuses on the
// record's result; rcf build verdict test --result PASS is not refused by
// a failing record; a failing record no longer closes the round in the
// separation audit, whose strict round order is otherwise unchanged.
//
// Criteria: AC-20502-1 to AC-20502-4 (AC-20502-5, the audit's own exit
// codes, is bound to the existing audit tests that pin them). Each test
// drives bin/rcf.js as a child process over a fixture project made by its
// own rcf init and committed to git, or over a fixture git repository for
// the audit. Verdict files are well-formed ReviewVerdict, TestVerdict and
// TestStrengthReport records keyed to their heads. Imports: Node builtins
// and test/_harness/ only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { lines, rcf } from '../_harness/spawn.js';
import { commit, git, initRepo, porcelain, s7, sha } from '../_harness/git.js';
import { bindTests, criterion, editFbs, editStory, project, readJson, readText, reviewVerdict, scratch, testVerdict, verdictPath, writeText } from '../_harness/fixture.js';
import { writeTap } from '../_harness/capture.js';

const BOTH = ['AC-101-1', 'AC-101-2'];
const NAMES = { 'AC-101-1': 'first behaviour holds', 'AC-101-2': 'second behaviour holds' };
const SYMBOL = { 'AC-101-1': 'first', 'AC-101-2': 'second' };
const pointer = (acId) => `test/rcf/a.test.js::${NAMES[acId]}`;
const BLOCKED_DETAIL = 'test/rcf/a.test.py: not a supported source (JavaScript, TypeScript or Vue)';

// A TestStrengthReport v1 for `head`: each id of `pass` passes (its one
// mutant killed), each of `fail` fails (its mutant on src/x.js#<symbol>
// survived), each of `blocked` is BLOCKED (reason TEST_STRENGTH_UNSUPPORTED).
function strength(head, { pass = [], fail = [], blocked = [] } = {}) {
  const mutant = (acId, killed) => ({ symbol: `src/x.js#${SYMBOL[acId]}`, operator: 'noOp', result: killed ? 'killed' : 'survived', killedBy: killed ? [pointer(acId)] : [] });
  const criteria = [
    ...pass.map((acId) => ({ acId, structural: { result: 'pass', findings: [] }, mutants: [mutant(acId, true)], result: 'pass' })),
    ...fail.map((acId) => ({ acId, structural: { result: 'pass', findings: [] }, mutants: [mutant(acId, false)], result: 'fail' })),
    ...blocked.map((acId) => ({ acId, structural: { result: 'pass', findings: [] }, mutants: [], result: 'blocked', blocked: true, reason: 'TEST_STRENGTH_UNSUPPORTED', detail: BLOCKED_DETAIL })),
  ];
  return {
    version: 1, head, scope: 'reviewVerdict', criteria,
    result: fail.length ? 'fail' : (blocked.length ? 'blocked' : 'pass'),
    totals: { criteria: criteria.length, structuralPassed: criteria.length, mutants: pass.length + fail.length, killed: pass.length, survived: fail.length, timeout: 0, notApplicable: 0, blocked: blocked.length },
    wallMs: 10, node: process.version,
  };
}

// ------------------------------------------------------------- finalise

// The base chain on main (US-101 with both criteria, FBS-001 notStarted,
// each bound to a resolving test), then a branch feature carrying the
// round: DEFINE: (FBS-001 inProgress), BUILD: (H, a symbol-level Code Node
// per criterion), REVIEW: MERGE/PASS at H touching both, TEST: PASS at H
// with the test-strength record `record` (none when null).
async function round(t, record) {
  const dir = await project(t, { name: 'fin041' });
  editStory(dir, 'US-101', (us) => {
    us.acceptanceCriteria = BOTH.map((id) => criterion(id, `[happy] ${NAMES[id]}`, { given: 'a fixture project', when: 'the fixture runs', then: NAMES[id], verification: 'external' }));
  });
  editFbs(dir, 'FBS-001', (f) => ({ ...f, acIds: BOTH, executionStatus: 'notStarted' }));
  bindTests(dir, BOTH.map((acId) => ({ acId, pointer: pointer(acId) })));
  writeText(dir, '.gitignore', 'node_modules/\n');
  initRepo(dir);
  commit(dir, 'fixture: base chain');
  git(dir, 'switch', '-q', '-c', 'feature');
  editFbs(dir, 'FBS-001', (f) => { f.executionStatus = 'inProgress'; f.summary = `${f.summary} Round opened.`; });
  commit(dir, 'DEFINE: round');
  const files = { 'src/x.js': 'export function first() { return 1; }\nexport function second() { return 2; }\n' };
  for (const acId of BOTH) {
    const n = acId.slice(-1);
    files[`rcf/code-nodes/cn-00${n}.json`] = {
      cnId: `CN-00${n}`, path: `src/x.js#${SYMBOL[acId]}`, title: `fixture node for ${acId}`, description: `Fixture Code Node implementing ${acId}.`,
      implementsAcIds: [acId], dependencies: [], version: '0.1.0', status: 'draft', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    };
  }
  const H = commit(dir, 'BUILD: code', files);
  commit(dir, 'REVIEW: verdict', { [verdictPath(H, 'review.json')]: reviewVerdict(H, { touchedAcIds: BOTH }) });
  const test = { [verdictPath(H, 'test.json')]: testVerdict(H) };
  if (record) test[verdictPath(H, 'test-strength.json')] = typeof record === 'function' ? record(H) : record;
  const T = commit(dir, 'TEST: verdict', test);
  return { dir, H, T };
}

const finalise = (dir) => rcf(['build', 'finalise', 'FBS-001', '--ci-run', 'run-7'], { cwd: dir });
const show = (r) => `exit ${r.code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
const status = (dir) => readJson(dir, 'rcf/fbs/fbs-001.json').executionStatus;
const completeLine = (head, H) => `finalise: FBS-001 complete at ${s7(head)} (reviewed ${s7(H)}, ci run-7, touched 2 criteria)`;
const strengthLines = (r, H) => lines(r.stdout).filter((l) => l.startsWith(`test-strength at ${s7(H)}: `));

test('AC-20502-1: with a test-strength record at H covering both touched criteria and a non-pass result, finalise writes complete and exits 0, printing one "test-strength at <H7>: <AC id> <fail|blocked>: <reason>; recorded, not refused" line per such criterion', async (t) => {
  // AC-101-2 fails (its mutant on src/x.js#second survived); AC-101-1 passes.
  const a = await round(t, (H) => strength(H, { pass: ['AC-101-1'], fail: ['AC-101-2'] }));
  const ra = await finalise(a.dir);
  assert.equal(ra.code, 0, `a failing test-strength record is recorded, not refused\n${show(ra)}`);
  assert.equal(status(a.dir), 'complete', 'finalise writes complete');
  assert.ok(lines(ra.stdout).includes(completeLine(a.T, a.H)), `stdout carries the complete line\n${show(ra)}`);
  const la = strengthLines(ra, a.H);
  assert.equal(la.length, 1, `one test-strength line, for AC-101-2 only\n${show(ra)}`);
  const ma = new RegExp(`^test-strength at ${s7(a.H)}: AC-101-2 fail: (.+); recorded, not refused$`).exec(la[0]);
  assert.ok(ma, `the line reads "test-strength at <H7>: AC-101-2 fail: <reason>; recorded, not refused"\n${la[0]}`);
  assert.ok(ma[1].includes('src/x.js#second'), `the reason names the survived mutant's symbol src/x.js#second\n${la[0]}`);
  assert.deepEqual(lines(porcelain(a.dir)).map((l) => l.slice(3)), ['rcf/fbs/fbs-001.json'], 'only rcf/fbs/fbs-001.json changes');

  // AC-101-1 fails and AC-101-2 is BLOCKED: two lines, in criterion order.
  const b = await round(t, (H) => strength(H, { fail: ['AC-101-1'], blocked: ['AC-101-2'] }));
  const rb = await finalise(b.dir);
  assert.equal(rb.code, 0, `a failing and a blocked criterion are recorded, not refused\n${show(rb)}`);
  assert.equal(status(b.dir), 'complete');
  const lb = strengthLines(rb, b.H);
  assert.equal(lb.length, 2, `one line per non-pass criterion\n${show(rb)}`);
  assert.match(lb[0], new RegExp(`^test-strength at ${s7(b.H)}: AC-101-1 fail: .*src/x\\.js#first.*; recorded, not refused$`));
  const mb = new RegExp(`^test-strength at ${s7(b.H)}: AC-101-2 blocked: (.+); recorded, not refused$`).exec(lb[1]);
  assert.ok(mb, `the blocked line reads "test-strength at <H7>: AC-101-2 blocked: <reason>; recorded, not refused"\n${lb[1]}`);
  assert.ok(mb[1].includes('TEST_STRENGTH_UNSUPPORTED'), `the reason carries the record's reason TEST_STRENGTH_UNSUPPORTED\n${lb[1]}`);

  // Control: an all-pass record prints no test-strength line.
  const c = await round(t, (H) => strength(H, { pass: BOTH }));
  const rc = await finalise(c.dir);
  assert.equal(rc.code, 0, show(rc));
  assert.deepEqual(strengthLines(rc, c.H), [], 'no line for a passing criterion');
});

test('AC-20502-2: finalise still refuses with exit 4 "finalise refused: no test-strength record at <H7>" with no record at H, and "finalise refused: test-strength at <H7> omits <ids>" when the record omits a touched criterion, a failing criterion in the same record notwithstanding', async (t) => {
  const refuses = async (dir, line) => {
    const before = { st: porcelain(dir), fbs: readText(dir, 'rcf/fbs/fbs-001.json') };
    const r = await finalise(dir);
    assert.equal(r.code, 4, show(r));
    assert.ok(lines(r.stderr).includes(line), `stderr carries "${line}"\n${show(r)}`);
    assert.equal(readText(dir, 'rcf/fbs/fbs-001.json'), before.fbs, 'the spec file is byte-identical');
    assert.equal(porcelain(dir), before.st, 'git status --porcelain is unchanged');
  };
  const a = await round(t, null);
  await refuses(a.dir, `finalise refused: no test-strength record at ${s7(a.H)}`);
  const b = await round(t, (H) => strength(H, { pass: ['AC-101-1'] }));
  await refuses(b.dir, `finalise refused: test-strength at ${s7(b.H)} omits AC-101-2`);
  // The record judges AC-101-1 fail and omits AC-101-2: the omission refuses, the result does not.
  const c = await round(t, (H) => strength(H, { fail: ['AC-101-1'] }));
  await refuses(c.dir, `finalise refused: test-strength at ${s7(c.H)} omits AC-101-2`);
});

// ------------------------------------------------------- verdict test

test('AC-20502-3: rcf build verdict test --fbs FBS-001 --result PASS --tap <file> --runtime <text> records PASS and exits 0 when the test-strength record at H has result fail', async (t) => {
  const dir = await project(t, { name: 'verdict041' });
  editStory(dir, 'US-101', (us) => { us.acceptanceCriteria = BOTH.map((id) => criterion(id, `[happy] ${NAMES[id]}`)); });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = BOTH; f.executionStatus = 'inProgress'; });
  bindTests(dir, BOTH.map((acId) => ({ acId, pointer: pointer(acId) })));
  writeText(dir, '.gitignore', 'node_modules/\n');
  initRepo(dir);
  commit(dir, 'fixture: base chain');
  git(dir, 'switch', '-q', '-c', 'feature');
  const H = commit(dir, 'BUILD: code', { 'src/x.js': 'export const x = 1;\n' });
  commit(dir, 'REVIEW: verdict', { [verdictPath(H, 'review.json')]: reviewVerdict(H, { touchedAcIds: BOTH }) });
  const record = strength(H, { pass: ['AC-101-1'], fail: ['AC-101-2'] });
  assert.equal(record.result, 'fail', 'given: the record at H has result fail');
  commit(dir, 'TEST: strength', { [verdictPath(H, 'test-strength.json')]: record });
  const tap = writeTap(join(scratch(t, 'rcf-h-tap-'), 'suite.tap'), BOTH.map((a) => ({ name: NAMES[a] })));
  const r = await rcf(['build', 'verdict', 'test', '--fbs', 'FBS-001', '--result', 'PASS', '--tap', tap, '--runtime', 'fixture app'], { cwd: dir });
  assert.equal(r.code, 0, `a failing test-strength record does not refuse a TEST PASS\n${show(r)}`);
  assert.ok(existsSync(join(dir, verdictPath(H, 'test.json'))), 'rcf/verdicts/<H12>/test.json is written');
  const v = JSON.parse(readText(dir, verdictPath(H, 'test.json')));
  assert.equal(v.result, 'PASS');
  assert.equal(v.head, H);
});

// ----------------------------------------------------- separation audit

function repo(t) {
  const dir = join(scratch(t, 'rcf-h-round041-'), 'repo');
  initRepo(dir);
  const base = commit(dir, 'base', { 'README.md': '# fixture\n' });
  git(dir, 'switch', '-q', '-c', 'feature');
  return { dir, base };
}
const sep = (dir, base) => rcf(['audit', 'separation', '--base', base], { cwd: dir });
let n = 0;
const D = (dir, subject = 'DEFINE: criteria') => commit(dir, subject, { 'rcf/user-stories/us-1.json': `{"n":${++n}}\n` });
const B = (dir, subject = 'BUILD: code') => commit(dir, subject, { 'src/x.js': `export const x = ${++n};\n` });
const R = (dir) => { const h = sha(dir); return commit(dir, 'REVIEW: verdict', { [verdictPath(h, 'review.json')]: reviewVerdict(h) }); };
const T = (dir, head) => commit(dir, 'TEST: verdict', { [verdictPath(head, 'test.json')]: testVerdict(head) });
const S = (dir, head) => commit(dir, 'TEST: strength', { [verdictPath(head, 'test-strength.json')]: strength(head, { fail: ['AC-101-1'] }) });
const F = (dir) => commit(dir, 'FINALISE: status', { 'rcf/fbs/fbs-001.json': `{"n":${++n}}\n` });

test('AC-20502-4: rcf audit separation passes a range where a TEST: commit adds a failing test-strength record and a FINALISE: commit follows, and a DEFINE: after BUILD: with no failed REVIEW or TEST verdict still fails', async (t) => {
  {
    // TEST: PASS at H, then TEST: adding a failing record for H, then FINALISE:.
    const { dir, base } = repo(t); D(dir); const h = B(dir); R(dir); T(dir, h); S(dir, h); const f = F(dir);
    const r = await sep(dir, base);
    assert.equal(r.code, 0, `a failing test-strength record does not close the round\n${show(r)}`);
    assert.equal(lines(r.stdout).at(-1), `separation: PASS 6 commits (base ${s7(base)}, head ${s7(f)}): DEFINE 1, BUILD 1, REVIEW 1, TEST 2, FINALISE 1, merges 0, transition 0`);
  }
  {
    // The failing record first, the TEST: PASS after it, then FINALISE:.
    const { dir, base } = repo(t); D(dir); const h = B(dir); R(dir); S(dir, h); T(dir, h); F(dir);
    const r = await sep(dir, base);
    assert.equal(r.code, 0, `a TEST PASS after a failing test-strength record stays in the round\n${show(r)}`);
  }
  {
    // Strict order otherwise unchanged: DEFINE: after BUILD: with no failed verdict between.
    const { dir, base } = repo(t); D(dir); B(dir); const c = D(dir, 'DEFINE: amend');
    const r = await sep(dir, base);
    assert.equal(r.code, 4, show(r));
    assert.ok(r.stdout.includes(`${s7(c)} DEFINE: after BUILD: without a failed verdict (stage order is monotonic within a round)`), show(r));
  }
});
