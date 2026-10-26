// FBS-234 (US-19701, US-19702, US-19703): rounds. REVIEW and TEST
// verdict records (rcf build verdict review | test) and round order in
// the separation audit.
//
// Criteria: 25, all external. Every test is a node:test todo case
// ("FBS-234 round DEFINE", GR-35): it runs and is red until FBS-234's
// round DEFINE drops the marker and BUILD turns it green. Each drives
// bin/rcf.js (or the packed artefact) as a child process: the verdict
// verbs over a fixture project made by its own rcf init and committed to
// git, the audit over fixture git repositories. Verdict files are
// well-formed ReviewVerdict, TestVerdict and TestStrengthReport records
// keyed to the right heads (GR-38): a review.json's head is its REVIEW:
// commit's parent; a test.json's head is that reviewed head, or its own
// parent for the FAIL recorded after a TEST PASS (AC-19702-6,
// AC-19703-5). The timing test prints the host facts (GR-45); spawn
// clauses read RCF_SPAWN_LOG (GR-46). Imports: Node builtins and
// test/_harness/ only (GR-40).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { rcf } from '../_harness/spawn.js';
import { commit, git, gitTry, initRepo, s7, s12, sha } from '../_harness/git.js';
import { bindTests, criterion, editFbs, editStory, project, readJson, readText, reviewVerdict, scratch, testStrengthReport, testVerdict, verdictPath, writeJson, writeText } from '../_harness/fixture.js';
import { commandName, hostFacts, readSpawnLog, spawnLog, writeTap } from '../_harness/capture.js';

const MONO = '(stage order is monotonic within a round)';

// ------------------------------------------------------------ verdict verbs

const NAMES = { 'AC-101-1': 'first behaviour holds', 'AC-101-2': 'second behaviour holds', 'AC-101-3': 'third behaviour holds' };
const pointer = (acId) => `test/rcf/a.test.js::${NAMES[acId]}`;

// A fixture project in git: US-101 with `acs`, FBS-001 scoping them at
// `status`, each criterion bound to a resolving test; committed on main,
// then branch feature with one "BUILD: code" commit H. Returns { dir, H }.
async function verdictProject(t, { acs = ['AC-101-1', 'AC-101-2'], status = 'inProgress', fbs002 = false } = {}) {
  const dir = await project(t, { name: 'verdict' });
  editStory(dir, 'US-101', (us) => { us.acceptanceCriteria = acs.map((id) => criterion(id, `[happy] ${NAMES[id]}`)); });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = acs; f.executionStatus = status; });
  if (fbs002) {
    const one = readJson(dir, 'rcf/fbs/fbs-001.json');
    editFbs(dir, 'FBS-002', () => ({ ...one, fbsId: 'FBS-002', buildOrder: 2, title: 'FBS-002 fixture', summary: 'FBS-002 scopes AC-101-2.', acIds: ['AC-101-2'] }));
  }
  bindTests(dir, acs.map((acId) => ({ acId, pointer: pointer(acId) })));
  writeText(dir, '.gitignore', 'node_modules/\n');
  initRepo(dir);
  commit(dir, 'fixture: base chain');
  git(dir, 'switch', '-q', '-c', 'feature');
  const H = commit(dir, 'BUILD: code', { 'src/x.js': 'export const x = 1;\n' });
  return { dir, H };
}

const verdictFiles = (dir) => {
  const root = join(dir, 'rcf', 'verdicts');
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true }).filter((p) => String(p).endsWith('.json')).map(String).sort();
};
const review = (dir, args, env) => rcf(['build', 'verdict', 'review', ...args], { cwd: dir, env });
const testVerb = (dir, args, env) => rcf(['build', 'verdict', 'test', ...args], { cwd: dir, env });
const errLine = (r, line) => r.stderr.split('\n').includes(line);
// Every path git status lists, untracked files one by one.
const statusPaths = (dir) => gitTry(dir, 'status', '--porcelain', '-uall').stdout.split('\n').filter(Boolean).map((l) => l.slice(3));

// A REVIEW: commit adding a review.json for the current HEAD (H).
function reviewCommit(dir, opts = {}, subject = 'REVIEW: verdict') {
  const H = sha(dir);
  return { H, R: commit(dir, subject, { [verdictPath(H, 'review.json')]: reviewVerdict(H, { touchedAcIds: ['AC-101-1', 'AC-101-2'], ...opts }) }) };
}

// A TAP file outside the fixture tree.
function tap(t, tests, opts) {
  return writeTap(join(scratch(t, 'rcf-h-tap-'), 'suite.tap'), tests, opts);
}
const boundTests = (acs = ['AC-101-1', 'AC-101-2']) => acs.map((a) => ({ name: NAMES[a] }));
const filler = (n, from = 1) => Array.from({ length: n }, (_, i) => ({ name: `other test ${from + i}` }));

// ---------------------------------------------------------------- US-19701

test('AC-19701-1: rcf build verdict review --code MERGE --adequacy PASS --by "reviewer and codex" at a clean HEAD exits 0, prints "verdict: review MERGE/PASS at <H7> written to rcf/verdicts/<H12>/review.json" and writes a ReviewVerdict v1 for H without committing', async (t) => {
  const { dir, H } = await verdictProject(t);
  const r = await review(dir, ['--fbs', 'FBS-001', '--acs', 'AC-101-1,AC-101-2', '--code', 'MERGE', '--adequacy', 'PASS', '--by', 'reviewer and codex']);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(r.stdout.replace(/\n$/, ''), `verdict: review MERGE/PASS at ${s7(H)} written to rcf/verdicts/${s12(H)}/review.json`);
  const v = JSON.parse(readText(dir, verdictPath(H, 'review.json')));
  assert.equal(v.verdictVersion, 1);
  assert.equal(v.stage, 'review');
  assert.equal(v.head, H);
  assert.deepEqual(v.fbsIds, ['FBS-001']);
  assert.deepEqual(v.touchedAcIds, ['AC-101-1', 'AC-101-2']);
  assert.equal(v.code, 'MERGE');
  assert.equal(v.adequacy, 'PASS');
  assert.deepEqual(v.findings, []);
  assert.equal(v.recordedBy, 'reviewer and codex');
  assert.ok(!Number.isNaN(Date.parse(v.recordedAt)), 'recordedAt is an ISO time');
  assert.equal(sha(dir), H, 'no commit is made');
});

test('AC-19701-2: --adequacy FINDINGS with a spec and a build --finding records adequacy FINDINGS and findings F-1 (spec, AC-101-1) and F-2 (build, acId null)', async (t) => {
  // FBS-001 at complete: --acs names one of its two criteria (AC-19701-6).
  const { dir, H } = await verdictProject(t, { status: 'complete' });
  const r = await review(dir, ['--fbs', 'FBS-001', '--acs', 'AC-101-1', '--code', 'MERGE', '--adequacy', 'FINDINGS',
    '--finding', 'spec:AC-101-1:the then clause names no exit code', '--finding', 'build:-:the CHANGELOG line is missing']);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const v = JSON.parse(readText(dir, verdictPath(H, 'review.json')));
  assert.equal(v.adequacy, 'FINDINGS');
  assert.deepEqual(v.findings, [
    { id: 'F-1', locus: 'spec', acId: 'AC-101-1', text: 'the then clause names no exit code' },
    { id: 'F-2', locus: 'build', acId: null, text: 'the CHANGELOG line is missing' },
  ]);
});

test('AC-19701-3: FINDINGS with no --finding exits 2, a malformed --finding exits 2 naming the <spec|build>:<AC id|->:<text> form, an unscoped --acs exits 3 with the brokenReference line, and none writes a verdict file', async (t) => {
  // FBS-001 at complete, as in AC-19701-2: --acs naming a subset is not refused for that reason.
  const { dir } = await verdictProject(t, { status: 'complete' });
  const a = await review(dir, ['--fbs', 'FBS-001', '--acs', 'AC-101-1', '--code', 'FINDINGS', '--adequacy', 'PASS']);
  assert.equal(a.code, 2);
  assert.ok(errLine(a, '[error] usage FINDINGS needs at least one --finding'), a.stderr);
  const b = await review(dir, ['--fbs', 'FBS-001', '--acs', 'AC-101-1', '--code', 'FINDINGS', '--adequacy', 'PASS', '--finding', 'maybe:AC-101-1:x']);
  assert.equal(b.code, 2);
  assert.ok(b.stderr.includes('<spec|build>:<AC id|->:<text>'), `stderr names the expected form\n${b.stderr}`);
  const c = await review(dir, ['--fbs', 'FBS-001', '--acs', 'AC-999-1', '--code', 'MERGE', '--adequacy', 'PASS']);
  assert.equal(c.code, 3);
  assert.ok(errLine(c, '[error] brokenReference AC-999-1 is not scoped by FBS-001'), c.stderr);
  assert.deepEqual(verdictFiles(dir), [], 'no file appears under rcf/verdicts/');
});

test('AC-19701-4: a dirty tree refuses with exit 4 "verdict refused: working tree is dirty; a verdict names a committed head", and a second review for the same head refuses with exit 4 leaving the first file byte-identical', async (t) => {
  const { dir, H } = await verdictProject(t);
  writeText(dir, 'src/x.js', 'export const x = 2;\n');
  const d = await review(dir, ['--fbs', 'FBS-001', '--acs', 'AC-101-1,AC-101-2', '--code', 'MERGE', '--adequacy', 'PASS']);
  assert.equal(d.code, 4);
  assert.ok(errLine(d, 'verdict refused: working tree is dirty; a verdict names a committed head'), d.stderr);
  git(dir, 'checkout', '--', 'src/x.js');
  const first = await review(dir, ['--fbs', 'FBS-001', '--acs', 'AC-101-1,AC-101-2', '--code', 'MERGE', '--adequacy', 'PASS']);
  assert.equal(first.code, 0, `${first.stdout}${first.stderr}`);
  const bytes = readText(dir, verdictPath(H, 'review.json'));
  const second = await review(dir, ['--fbs', 'FBS-001', '--acs', 'AC-101-1,AC-101-2', '--code', 'MERGE', '--adequacy', 'FINDINGS', '--finding', 'build:-:x']);
  assert.equal(second.code, 4);
  assert.ok(errLine(second, `verdict refused: a review verdict for ${s7(H)} already exists at rcf/verdicts/${s12(H)}/review.json`), second.stderr);
  assert.equal(readText(dir, verdictPath(H, 'review.json')), bytes, 'the existing file is byte-identical');
});

test('AC-19701-5: rcf build verdict review writes only rcf/verdicts/<H12>/review.json, never commits, never edits an existing verdict file and spawns only git', async (t) => {
  const { dir } = await verdictProject(t);
  // An older verdict for the base head, already committed on the branch.
  const base = git(dir, 'rev-parse', 'HEAD~1');
  commit(dir, 'REVIEW: earlier verdict', { [verdictPath(base, 'review.json')]: reviewVerdict(base) });
  const H2 = sha(dir);
  const older = readText(dir, verdictPath(base, 'review.json'));
  const log = spawnLog(scratch(t, 'rcf-h-spawn-'));
  const r = await review(dir, ['--fbs', 'FBS-001', '--acs', 'AC-101-1,AC-101-2', '--code', 'MERGE', '--adequacy', 'PASS'], log.env);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(sha(dir), H2, 'never commits');
  assert.deepEqual(statusPaths(dir), [verdictPath(H2, 'review.json')], 'git status lists the one new file only');
  assert.equal(readText(dir, verdictPath(base, 'review.json')), older, 'never edits an existing verdict file');
  const spawned = readSpawnLog(log.file);
  assert.ok(spawned.length > 0, 'the spawn seam records the run');
  assert.deepEqual([...new Set(spawned.map(commandName))], ['git'], 'only git is spawned');
});

test('AC-19701-6: at inProgress the review verdict must touch every live criterion of the spec (exit 3 "[error] brokenReference touched criteria omit AC-101-3 of FBS-001 (inProgress)", nothing written); at complete the same command writes (an amend round)', async (t) => {
  const acs = ['AC-101-1', 'AC-101-2', 'AC-101-3'];
  const ip = await verdictProject(t, { acs, status: 'inProgress' });
  const r = await review(ip.dir, ['--fbs', 'FBS-001', '--acs', 'AC-101-1,AC-101-2', '--code', 'MERGE', '--adequacy', 'PASS']);
  assert.equal(r.code, 3, `${r.stdout}${r.stderr}`);
  assert.ok(errLine(r, '[error] brokenReference touched criteria omit AC-101-3 of FBS-001 (inProgress)'), r.stderr);
  assert.deepEqual(verdictFiles(ip.dir), []);
  const done = await verdictProject(t, { acs, status: 'complete' });
  const ok = await review(done.dir, ['--fbs', 'FBS-001', '--acs', 'AC-101-1,AC-101-2', '--code', 'MERGE', '--adequacy', 'PASS']);
  assert.equal(ok.code, 0, `${ok.stdout}${ok.stderr}`);
  assert.ok(existsSync(join(done.dir, verdictPath(done.H, 'review.json'))));
});

// ---------------------------------------------------------------- US-19702

test('AC-19702-1: rcf build verdict test --result PASS over a REVIEW: MERGE/PASS head and a TAP of 12 pass, 0 fail, 1 skip, 0 todo exits 0, prints the written line and writes a TestVerdict v1 for H with the running Node version', async (t) => {
  const { dir, H } = await verdictProject(t);
  reviewCommit(dir);
  const file = tap(t, [...boundTests(), ...filler(10), { name: 'skipped one', directive: 'SKIP' }]);
  const r = await testVerb(dir, ['--fbs', 'FBS-001', '--result', 'PASS', '--tap', file, '--runtime', 'fixture app on localhost:8787']);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(r.stdout.replace(/\n$/, ''), `verdict: test PASS at ${s7(H)} (12 pass, 0 fail, 1 skip, 0 todo) written to rcf/verdicts/${s12(H)}/test.json`);
  const v = JSON.parse(readText(dir, verdictPath(H, 'test.json')));
  assert.equal(v.verdictVersion, 1);
  assert.equal(v.stage, 'test');
  assert.equal(v.head, H);
  assert.deepEqual(v.fbsIds, ['FBS-001']);
  assert.equal(v.result, 'PASS');
  assert.deepEqual({ pass: v.suite.pass, fail: v.suite.fail, skip: v.suite.skip, todo: v.suite.todo }, { pass: 12, fail: 0, skip: 1, todo: 0 });
  assert.equal(v.runtime, 'fixture app on localhost:8787');
  assert.equal(v.node, process.version);
});

test('AC-19702-2: --result PASS refuses a TAP with 2 failing and a TAP lacking the bound test of AC-101-2 (exit 4), a file with no TAP summary exits 2, and no test.json is written', async (t) => {
  const { dir, H } = await verdictProject(t);
  reviewCommit(dir);
  const failing = tap(t, [...boundTests(), { name: 'f1', ok: false }, { name: 'f2', ok: false }]);
  const a = await testVerb(dir, ['--fbs', 'FBS-001', '--result', 'PASS', '--tap', failing, '--runtime', 'fixture app']);
  assert.equal(a.code, 4);
  assert.ok(errLine(a, 'verdict refused: the TAP summary reports 2 failing; record --result FAIL'), a.stderr);
  const lacking = tap(t, [...boundTests(['AC-101-1']), ...filler(2)]);
  const b = await testVerb(dir, ['--fbs', 'FBS-001', '--result', 'PASS', '--tap', lacking, '--runtime', 'fixture app']);
  assert.equal(b.code, 4);
  assert.ok(errLine(b, `verdict refused: the TAP summary does not include bound test ${pointer('AC-101-2')} of AC-101-2`), b.stderr);
  const none = tap(t, boundTests(), { summary: false });
  const c = await testVerb(dir, ['--fbs', 'FBS-001', '--result', 'PASS', '--tap', none, '--runtime', 'fixture app']);
  assert.equal(c.code, 2);
  assert.ok(errLine(c, `[error] usage --tap ${none} carries no TAP summary`), c.stderr);
  assert.equal(existsSync(join(dir, verdictPath(H, 'test.json'))), false, 'no test.json is written');
});

test('AC-19702-3: --result PASS refuses with no REVIEW MERGE/PASS for H (FINDINGS, or no review verdict) and when a later BUILD: commit changed src/x.js after H', async (t) => {
  const ok = () => tap(t, boundTests());
  const findings = await verdictProject(t);
  reviewCommit(findings.dir, { code: 'FINDINGS' });
  const a = await testVerb(findings.dir, ['--fbs', 'FBS-001', '--result', 'PASS', '--tap', ok(), '--runtime', 'fixture app']);
  assert.equal(a.code, 4);
  assert.ok(errLine(a, `verdict refused: no REVIEW MERGE with adequacy PASS recorded for ${s7(findings.H)}`), a.stderr);
  const none = await verdictProject(t);
  const b = await testVerb(none.dir, ['--fbs', 'FBS-001', '--result', 'PASS', '--tap', ok(), '--runtime', 'fixture app']);
  assert.equal(b.code, 4);
  assert.ok(errLine(b, `verdict refused: no REVIEW MERGE with adequacy PASS recorded for ${s7(none.H)}`), b.stderr);
  const later = await verdictProject(t);
  reviewCommit(later.dir);
  commit(later.dir, 'BUILD: fix', { 'src/x.js': 'export const x = 3;\n' });
  const c = await testVerb(later.dir, ['--fbs', 'FBS-001', '--result', 'PASS', '--tap', ok(), '--runtime', 'fixture app']);
  assert.equal(c.code, 4);
  assert.ok(errLine(c, `verdict refused: HEAD differs from the reviewed head ${s7(later.H)} outside rcf/verdicts/, rcf/verify-reports/ and FINALISE classes`), c.stderr);
});

test('AC-19702-4: one test verdict per head: a second verdict for H refuses (exit 4, file byte-identical); FAIL with --reason and 0 failing writes FAIL, FAIL with 0 failing and no --reason exits 2; a FAIL after the PASS at H names HEAD and is not refused', async (t) => {
  const passed = await verdictProject(t);
  reviewCommit(passed.dir);
  commit(passed.dir, 'TEST: verdict', { [verdictPath(passed.H, 'test.json')]: testVerdict(passed.H) });
  const bytes = readText(passed.dir, verdictPath(passed.H, 'test.json'));
  const again = await testVerb(passed.dir, ['--fbs', 'FBS-001', '--result', 'PASS', '--tap', tap(t, boundTests()), '--runtime', 'fixture app']);
  assert.equal(again.code, 4);
  assert.ok(errLine(again, `verdict refused: a test verdict for ${s7(passed.H)} already exists at rcf/verdicts/${s12(passed.H)}/test.json`), again.stderr);
  assert.equal(readText(passed.dir, verdictPath(passed.H, 'test.json')), bytes);
  const head = sha(passed.dir);
  const after = await testVerb(passed.dir, ['--fbs', 'FBS-001', '--result', 'FAIL', '--tap', tap(t, [...boundTests(), { name: 'f', ok: false }]), '--runtime', 'fixture app']);
  assert.equal(after.code, 0, `a FAIL after the PASS at H is not refused\n${after.stdout}${after.stderr}`);
  assert.equal(JSON.parse(readText(passed.dir, verdictPath(head, 'test.json'))).head, head, 'it names HEAD');

  const fresh = await verdictProject(t);
  reviewCommit(fresh.dir);
  const noReason = await testVerb(fresh.dir, ['--fbs', 'FBS-001', '--result', 'FAIL', '--tap', tap(t, boundTests()), '--runtime', 'fixture app']);
  assert.equal(noReason.code, 2, `FAIL with 0 failing and no --reason exits 2\n${noReason.stdout}${noReason.stderr}`);
  const withReason = await testVerb(fresh.dir, ['--fbs', 'FBS-001', '--result', 'FAIL', '--reason', 'the suite hangs on the packed head', '--tap', tap(t, boundTests()), '--runtime', 'fixture app']);
  assert.equal(withReason.code, 0, `${withReason.stdout}${withReason.stderr}`);
  const v = JSON.parse(readText(fresh.dir, verdictPath(fresh.H, 'test.json')));
  assert.equal(v.result, 'FAIL');
  assert.equal(v.reason, 'the suite hangs on the packed head');
});

test('AC-19702-5: rcf build verdict test never runs the suite, deploys, contacts a host, writes outside rcf/verdicts/<H12>/ or commits: the spawn seam records only git and git status lists at most the one new file', async (t) => {
  const { dir, H } = await verdictProject(t);
  const { R } = reviewCommit(dir);
  const log = spawnLog(scratch(t, 'rcf-h-spawn-'));
  const r = await testVerb(dir, ['--fbs', 'FBS-001', '--result', 'PASS', '--tap', tap(t, boundTests()), '--runtime', 'fixture app on localhost:1'], log.env);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(sha(dir), R, 'never commits');
  assert.deepEqual(statusPaths(dir), [verdictPath(H, 'test.json')], 'git status lists the one new file only');
  const spawned = readSpawnLog(log.file);
  assert.ok(spawned.length > 0, 'the spawn seam records the run');
  assert.deepEqual([...new Set(spawned.map(commandName))], ['git'], 'only git is spawned');
});

// REVIEW: (MERGE/PASS for H), TEST: (PASS at H), then a clean
// "FINALISE: merge main" at M.
function passedThenMerged(dir, H) {
  reviewCommit(dir);
  commit(dir, 'TEST: verdict', { [verdictPath(H, 'test.json')]: testVerdict(H) });
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'main moves', { 'main.txt': 'm\n' });
  git(dir, 'switch', '-q', 'feature');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'FINALISE: merge main', 'main');
  return sha(dir);
}

test('AC-19702-6: after REVIEW: MERGE/PASS, TEST: PASS at H and a clean FINALISE: merge at M, --result FAIL writes rcf/verdicts/<M12>/test.json with head M and leaves the test.json of H byte-identical; --result PASS at M refuses on the verdict of H', async (t) => {
  const { dir, H } = await verdictProject(t);
  const M = passedThenMerged(dir, H);
  const hBytes = readText(dir, verdictPath(H, 'test.json'));
  const pass = await testVerb(dir, ['--fbs', 'FBS-001', '--result', 'PASS', '--tap', tap(t, boundTests()), '--runtime', 'fixture app']);
  assert.equal(pass.code, 4);
  assert.ok(errLine(pass, `verdict refused: a test verdict for ${s7(H)} already exists at rcf/verdicts/${s12(H)}/test.json`), pass.stderr);
  const r = await testVerb(dir, ['--fbs', 'FBS-001', '--result', 'FAIL', '--tap', tap(t, [{ name: 'merge head suite', ok: false }]), '--runtime', 'fixture app']);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(r.stdout.replace(/\n$/, ''), `verdict: test FAIL at ${s7(M)} (0 pass, 1 fail, 0 skip, 0 todo) written to rcf/verdicts/${s12(M)}/test.json`);
  assert.equal(JSON.parse(readText(dir, verdictPath(M, 'test.json'))).head, M);
  assert.equal(readText(dir, verdictPath(H, 'test.json')), hBytes, "H's test.json is byte-identical");
});

test('AC-19702-7: a failing test-strength record at H refuses --result PASS (exit 4 "verdict refused: test-strength at <H7> fails for AC-101-2; record --result FAIL", nothing written), --result FAIL --reason writes FAIL, and with no record PASS is not refused for that reason', async (t) => {
  const { dir, H } = await verdictProject(t);
  reviewCommit(dir);
  commit(dir, 'TEST: strength', { [verdictPath(H, 'test-strength.json')]: testStrengthReport(H, { passing: ['AC-101-1'], failing: ['AC-101-2'] }) });
  const r = await testVerb(dir, ['--fbs', 'FBS-001', '--result', 'PASS', '--tap', tap(t, boundTests()), '--runtime', 'fixture app']);
  assert.equal(r.code, 4);
  assert.ok(errLine(r, `verdict refused: test-strength at ${s7(H)} fails for AC-101-2; record --result FAIL`), r.stderr);
  assert.equal(existsSync(join(dir, verdictPath(H, 'test.json'))), false, 'nothing is written');
  const f = await testVerb(dir, ['--fbs', 'FBS-001', '--result', 'FAIL', '--reason', 'test strength fails', '--tap', tap(t, boundTests()), '--runtime', 'fixture app']);
  assert.equal(f.code, 0, `${f.stdout}${f.stderr}`);
  assert.equal(JSON.parse(readText(dir, verdictPath(H, 'test.json'))).result, 'FAIL');
  const clean = await verdictProject(t);
  reviewCommit(clean.dir);
  const ok = await testVerb(clean.dir, ['--fbs', 'FBS-001', '--result', 'PASS', '--tap', tap(t, boundTests()), '--runtime', 'fixture app']);
  assert.equal(ok.code, 0, `with no test-strength record PASS is not refused\n${ok.stdout}${ok.stderr}`);
});

test('AC-19702-8: --fbs must equal the fbsIds of the REVIEW verdict as a set (exit 2 naming both, nothing written; FBS-002,FBS-001 writes), and the default recordedBy is "reviewer" for review and "verifier" for test', async (t) => {
  const { dir, H } = await verdictProject(t, { fbs002: true });
  const rv = await review(dir, ['--fbs', 'FBS-001,FBS-002', '--acs', 'AC-101-1,AC-101-2', '--code', 'MERGE', '--adequacy', 'PASS']);
  assert.equal(rv.code, 0, `${rv.stdout}${rv.stderr}`);
  const rj = JSON.parse(readText(dir, verdictPath(H, 'review.json')));
  assert.deepEqual(rj.fbsIds, ['FBS-001', 'FBS-002']);
  assert.equal(rj.recordedBy, 'reviewer', 'review default recordedBy');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'REVIEW: verdict');
  const a = await testVerb(dir, ['--fbs', 'FBS-001', '--result', 'PASS', '--tap', tap(t, boundTests()), '--runtime', 'fixture app']);
  assert.equal(a.code, 2);
  assert.ok(errLine(a, "[error] usage --fbs FBS-001 differs from the REVIEW verdict's fbsIds FBS-001,FBS-002"), a.stderr);
  assert.equal(existsSync(join(dir, verdictPath(H, 'test.json'))), false, 'nothing is written');
  const b = await testVerb(dir, ['--fbs', 'FBS-002,FBS-001', '--result', 'PASS', '--tap', tap(t, boundTests()), '--runtime', 'fixture app']);
  assert.equal(b.code, 0, `${b.stdout}${b.stderr}`);
  assert.equal(JSON.parse(readText(dir, verdictPath(H, 'test.json'))).recordedBy, 'verifier', 'test default recordedBy');
});

// ---------------------------------------------------------------- US-19703
// Round order in rcf audit separation, over plain fixture repositories.

function repo(t) {
  const dir = join(scratch(t, 'rcf-h-round-'), 'repo');
  initRepo(dir);
  const base = commit(dir, 'base', { 'README.md': '# fixture\n' });
  git(dir, 'switch', '-q', '-c', 'feature');
  return { dir, base };
}
const sep = (dir, args = [], env = {}) => rcf(['audit', 'separation', ...args], { cwd: dir, env });
let n = 0;
const D = (dir, subject = 'DEFINE: criteria') => commit(dir, subject, { 'rcf/user-stories/us-1.json': `{"n":${++n}}\n` });
const B = (dir, subject = 'BUILD: code') => commit(dir, subject, { 'src/x.js': `export const x = ${++n};\n` });
const R = (dir, opts = {}, subject = 'REVIEW: verdict') => { const h = sha(dir); return commit(dir, subject, { [verdictPath(h, 'review.json')]: reviewVerdict(h, opts) }); };
const T = (dir, head, opts = {}, subject = 'TEST: verdict') => commit(dir, subject, { [verdictPath(head, 'test.json')]: testVerdict(head, opts) });
const F = (dir, subject = 'FINALISE: status') => commit(dir, subject, { 'rcf/fbs/fbs-001.json': `{"n":${++n}}\n` });
const passLine = (k, base, head, counts) => `separation: PASS ${k} commits (base ${s7(base)}, head ${s7(head)}): ${counts}`;
const has = (r, item) => assert.ok(r.stdout.includes(item), `the FAIL line names ${item}\n${r.stdout}`);

test('AC-19703-1: DEFINE:, BUILD:, REVIEW: (passed, for its parent H), TEST: (PASS for H) and FINALISE: (rcf/fbs/ only) pass with "DEFINE 1, BUILD 1, REVIEW 1, TEST 1, FINALISE 1, merges 0, transition 0"', async (t) => {
  const { dir, base } = repo(t);
  D(dir); const h = B(dir); R(dir); T(dir, h); const f = F(dir);
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(r.stdout.replace(/\n$/, ''), passLine(5, base, f, 'DEFINE 1, BUILD 1, REVIEW 1, TEST 1, FINALISE 1, merges 0, transition 0'));
  // Control (stage-keeper ruling 19): the same branch with the REVIEW:
  // commit's review.json naming the DEFINE: commit instead of its parent
  // H, so the pass above is judged, not given: round order refuses the
  // verdict with the code and item AC-19703-5 gives.
  const c = repo(t);
  const d = D(c.dir); const h2 = B(c.dir);
  const rc = commit(c.dir, 'REVIEW: verdict', { [verdictPath(d, 'review.json')]: reviewVerdict(d) });
  T(c.dir, h2); F(c.dir);
  const r2 = await sep(c.dir, ['--base', c.base]);
  assert.equal(r2.code, 4, `the control exits 4: a REVIEW: verdict for a head other than its parent is refused\n${r2.stdout}${r2.stderr}`);
  has(r2, `${s7(rc)} REVIEW: verdict head ${s7(d)} is not its parent ${s7(h2)}`);
});

test('AC-19703-2: a REVIEW: with code FINDINGS followed by DEFINE: starts round two, and the branch through REVIEW: MERGE/PASS and TEST: PASS exits 0', async (t) => {
  const { dir, base } = repo(t);
  D(dir); B(dir); R(dir, { code: 'FINDINGS' });
  D(dir, 'DEFINE: triage'); const h = B(dir); R(dir); T(dir, h);
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  // Control (stage-keeper ruling 8): the same branch with the first
  // REVIEW: recording MERGE/PASS, so the DEFINE: follows a passed verdict
  // and round order refuses it (AC-19703-3).
  const c = repo(t);
  D(c.dir); B(c.dir); R(c.dir);
  const d = D(c.dir, 'DEFINE: triage'); const h2 = B(c.dir); R(c.dir); T(c.dir, h2);
  const r2 = await sep(c.dir, ['--base', c.base]);
  assert.equal(r2.code, 4, `the control exits 4: a DEFINE: after a passed REVIEW: is a stage regression\n${r2.stdout}${r2.stderr}`);
  has(r2, `${s7(d)} DEFINE: after REVIEW: without a failed verdict ${MONO}`);
});

test('AC-19703-3: BUILD: after a passed REVIEW:, DEFINE: after a passed REVIEW: or a TEST: PASS, and DEFINE: after BUILD: with no verdict between each fail "<s7> <STAGE>: after <PREV>: without a failed verdict (stage order is monotonic within a round)"', async (t) => {
  {
    const { dir, base } = repo(t); D(dir); B(dir); R(dir); const c = B(dir, 'BUILD: a further change');
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 4); has(r, `${s7(c)} BUILD: after REVIEW: without a failed verdict ${MONO}`);
  }
  {
    const { dir, base } = repo(t); D(dir); B(dir); R(dir); const c = D(dir, 'DEFINE: amend');
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 4); has(r, `${s7(c)} DEFINE: after REVIEW: without a failed verdict ${MONO}`);
  }
  {
    const { dir, base } = repo(t); D(dir); const h = B(dir); R(dir); T(dir, h); const c = D(dir, 'DEFINE: amend');
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 4); has(r, `${s7(c)} DEFINE: after TEST: without a failed verdict ${MONO}`);
  }
  {
    const { dir, base } = repo(t); D(dir); B(dir); const c = D(dir, 'DEFINE: amend');
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 4); has(r, `${s7(c)} DEFINE: after BUILD: without a failed verdict ${MONO}`);
  }
});

test('AC-19703-4: BUILD: right after a REVIEW: FINDINGS, and TEST: right after a TEST: FAIL, fail "<s7> <STAGE>: after a failed verdict; the next round starts at DEFINE:"', async (t) => {
  {
    const { dir, base } = repo(t); D(dir); B(dir); R(dir, { code: 'FINDINGS' }); const c = B(dir, 'BUILD: quick fix');
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 4); has(r, `${s7(c)} BUILD: after a failed verdict; the next round starts at DEFINE:`);
  }
  {
    const { dir, base } = repo(t); D(dir); const h = B(dir); R(dir); T(dir, h, { result: 'FAIL' });
    const c = commit(dir, 'TEST: rerun', { 'rcf/verify-reports/FBS-001/b.json': '{"verdict":"PASS"}\n' });
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 4); has(r, `${s7(c)} TEST: after a failed verdict; the next round starts at DEFINE:`);
  }
});

test('AC-19703-5: a review.json whose head is not the parent of its commit and a test.json whose head is not the reviewed head fail with their items; a FAIL test.json keyed to its own parent after a TEST PASS at H passes and closes the round', async (t) => {
  {
    const { dir, base } = repo(t); const d = D(dir); const h = B(dir);
    const c = commit(dir, 'REVIEW: verdict', { [verdictPath(d, 'review.json')]: reviewVerdict(d) });
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 4); has(r, `${s7(c)} REVIEW: verdict head ${s7(d)} is not its parent ${s7(h)}`);
  }
  {
    const { dir, base } = repo(t); const d = D(dir); const h = B(dir); R(dir); const c = T(dir, d);
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 4); has(r, `${s7(c)} TEST: verdict head ${s7(d)} is not the reviewed head ${s7(h)}`);
  }
  {
    const { dir, base } = repo(t); D(dir); const h = B(dir); R(dir); const tp = T(dir, h);
    T(dir, tp, { result: 'FAIL' }, 'TEST: fail after pass');
    D(dir, 'DEFINE: triage');
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 0, `the post-PASS FAIL passes and closes the round\n${r.stdout}${r.stderr}`);
  }
});

function mergeMain(dir, subject = 'FINALISE: merge main') {
  git(dir, 'switch', '-q', 'main');
  commit(dir, `main moves ${++n}`, { [`main-${n}.txt`]: 'm\n' });
  git(dir, 'switch', '-q', 'feature');
  git(dir, 'merge', '-q', '--no-ff', '-m', subject, 'main');
  return sha(dir);
}

test('AC-19703-6: REVIEW:, TEST:, FINALISE: merge and FINALISE: pass; DEFINE: or a PASS-adding TEST: after FINALISE: fail with the monotonic item; a TEST: FAIL keyed to the FINALISE: merge then DEFINE: passes (stage-keeper ruling 3)', async (t) => {
  const start = () => { const r = repo(t); const h = sha(r.dir); R(r.dir); T(r.dir, h); mergeMain(r.dir); F(r.dir); return { ...r, h }; };
  {
    const { dir, base } = start();
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  }
  {
    const { dir, base } = start(); const c = D(dir, 'DEFINE: amend');
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 4); has(r, `${s7(c)} DEFINE: after FINALISE: without a failed verdict ${MONO}`);
  }
  {
    // h already has its test.json; the rerun adds a PASS test.json keyed to its parent.
    const { dir, base } = start(); const c = T(dir, sha(dir), {}, 'TEST: rerun');
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 4); has(r, `${s7(c)} TEST: after FINALISE: without a failed verdict ${MONO}`);
  }
  {
    const { dir, base } = repo(t); const h = sha(dir); R(dir); T(dir, h); const m = mergeMain(dir);
    T(dir, m, { result: 'FAIL' }, 'TEST: merge head red'); D(dir, 'DEFINE: triage');
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 0, `the FAIL closes the round and DEFINE: starts the next\n${r.stdout}${r.stderr}`);
  }
});

test('AC-19703-7: only the verdict file a commit adds decides: a REVIEW: commit saying MERGE whose review.json records FINDINGS closes the round, and a REVIEW: commit with no review.json (even beside an uncommitted one) never opens TEST:', async (t) => {
  {
    const { dir, base } = repo(t); D(dir); B(dir); R(dir, { code: 'FINDINGS' }, 'REVIEW: MERGE, all clear'); const c = B(dir, 'BUILD: fix');
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 4); has(r, `${s7(c)} BUILD: after a failed verdict; the next round starts at DEFINE:`);
  }
  {
    const { dir, base } = repo(t); D(dir); B(dir); R(dir, { code: 'FINDINGS' }, 'REVIEW: MERGE, all clear'); D(dir, 'DEFINE: triage');
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 0, `the FINDINGS verdict closed the round\n${r.stdout}${r.stderr}`);
  }
  {
    const { dir, base } = repo(t); D(dir); const h = B(dir);
    commit(dir, 'REVIEW: MERGE', {}, { allowEmpty: true, body: 'Verdict: MERGE/PASS' });
    const c = T(dir, h);
    writeJson(dir, verdictPath(h, 'review.json'), reviewVerdict(h));
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 4); has(r, `${s7(c)} TEST: verdict with no passed REVIEW verdict in the round`);
  }
});

test('AC-19703-8: over 6 rounds (30 or more commits, every REVIEW: and TEST: adding a verdict file) the round judgement adds at most one git process per verdict commit and the run finishes within 5 seconds', async (t) => {
  hostFacts(t);
  // Control (stage-keeper ruling 19): before measuring, the same 6 rounds
  // with round 3's REVIEW: verdict naming the round's first DEFINE:
  // instead of its parent, so the budget below is measured over a round
  // judgement that runs: round order refuses that verdict with the code
  // and item AC-19703-5 gives.
  {
    const c = repo(t);
    let wrong;
    let named;
    let parent;
    for (let round = 1; round <= 6; round++) {
      const d = D(c.dir); D(c.dir, 'DEFINE: more criteria'); B(c.dir); const h = B(c.dir, 'BUILD: more code');
      if (round === 3) {
        wrong = commit(c.dir, 'REVIEW: verdict', { [verdictPath(d, 'review.json')]: reviewVerdict(d) }); named = d; parent = h;
      } else {
        R(c.dir);
      }
      T(c.dir, h, { result: round < 6 ? 'FAIL' : 'PASS' });
      if (round === 6) F(c.dir);
    }
    const r = await sep(c.dir, ['--base', c.base]);
    assert.equal(r.code, 4, `the control exits 4: the round judgement is live\n${r.stdout}${r.stderr}`);
    has(r, `${s7(wrong)} REVIEW: verdict head ${s7(named)} is not its parent ${s7(parent)}`);
  }
  const { dir, base } = repo(t);
  let verdictCommits = 0;
  let total = 0;
  for (let round = 1; round <= 6; round++) {
    D(dir); D(dir, 'DEFINE: more criteria'); B(dir); const h = B(dir, 'BUILD: more code');
    R(dir); verdictCommits++;
    T(dir, h, { result: round < 6 ? 'FAIL' : 'PASS' }); verdictCommits++;
    total += 6;
    if (round === 6) { F(dir); total++; }
  }
  assert.ok(total >= 30);
  const log = spawnLog(scratch(t, 'rcf-h-spawn-'));
  const r = await sep(dir, ['--base', base], log.env);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.ok(r.stdout.startsWith(`separation: PASS ${total} commits`), r.stdout);
  assert.ok(r.ms <= 5000, `finishes within 5 seconds (took ${Math.round(r.ms)} ms)`);
  const gits = readSpawnLog(log.file).filter((e) => commandName(e) === 'git').length;
  assert.ok(gits > 0, 'the spawn seam records the git processes');
  assert.ok(gits <= 4 + verdictCommits, `at most 4 (the per-commit judgement) plus one per verdict commit (${verdictCommits}); spawned ${gits}`);
});

test('AC-19703-9: a second "REVIEW: codex" adding a review.json after a passed REVIEW verdict fails "(one REVIEW verdict per round)"; a REVIEW: commit adding no review.json before the verdict commit passes', async (t) => {
  {
    const { dir, base } = repo(t); D(dir); B(dir); R(dir); const c = R(dir, {}, 'REVIEW: codex');
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 4); has(r, `${s7(c)} REVIEW: after a passed REVIEW verdict (one REVIEW verdict per round)`);
  }
  {
    const { dir, base } = repo(t); D(dir); B(dir); commit(dir, 'REVIEW: notes', {}, { allowEmpty: true }); R(dir);
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  }
});

test('AC-19703-10: a TEST: commit adding a PASS test.json with no REVIEW: in the range fails "<s7> TEST: verdict with no passed REVIEW verdict in the round"; one adding only rcf/verify-reports/ evidence passes as no verdict', async (t) => {
  {
    const { dir, base } = repo(t); const h = B(dir); const c = T(dir, h);
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 4); has(r, `${s7(c)} TEST: verdict with no passed REVIEW verdict in the round`);
  }
  {
    const { dir, base } = repo(t); B(dir); commit(dir, 'TEST: verdict', { 'rcf/verify-reports/FBS-001/a.json': '{"verdict":"PASS"}\n' });
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  }
});

test('AC-19703-11: a "TEST: strength" adding a failing test-strength.json closes the round: DEFINE: next passes, BUILD: next fails "<s7> BUILD: after a failed verdict; the next round starts at DEFINE:"', async (t) => {
  const start = () => {
    const r = repo(t); D(r.dir); const h = B(r.dir); R(r.dir); T(r.dir, h);
    commit(r.dir, 'TEST: strength', { [verdictPath(h, 'test-strength.json')]: testStrengthReport(h, { passing: [], failing: ['AC-101-1'] }) });
    return r;
  };
  {
    const { dir, base } = start(); D(dir, 'DEFINE: triage');
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  }
  {
    const { dir, base } = start(); const c = B(dir, 'BUILD: fix');
    const r = await sep(dir, ['--base', base]); assert.equal(r.code, 4); has(r, `${s7(c)} BUILD: after a failed verdict; the next round starts at DEFINE:`);
  }
});
