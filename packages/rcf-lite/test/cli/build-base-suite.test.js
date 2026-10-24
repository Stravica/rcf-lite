// FBS-239 (US-20201, US-20202, US-20203): the bundle backstop is the
// base suite. rcf build base-suite records BaseSuiteRecord v1; rcf build
// bundle refuses unless --base-suite names a green record for the base
// (git merge-base of HEAD with the trunk; HEAD itself on the trunk); rcf
// build bundle <fbs-id> --acs emits an amend round; the 0.36.x verified
// backstop's pieces retire with their replacement named.
//
// Criteria: 17, all external (US-20201 8, US-20202 5, US-20203 4).
// Tested here: 17. AC-20201-1's record comes from rcf build base-suite
// --command 'node --test "test/rcf/**/*.test.js"', a glob Node 24 expands
// itself (the stage-keeper's ruling 7 on the Part B summary's stops:
// base-suite gains no directory expansion, a consumer's command is
// theirs); its base-suite run puts node's directory on PATH so the
// command can start.
//
// Every test is a node:test todo case ("FBS-239 round DEFINE", GR-35): it
// runs and is red until FBS-239's round DEFINE drops the marker and BUILD
// turns it green. Each drives bin/rcf.js (or the packed artefact) as a
// child process over a fixture project made by its own rcf init and
// committed to git on main (the trunk). The fixture records the freeze
// gate's override once through the bin (rcf build bundle --next
// --override, with a green record for that commit) and commits it, so
// later --next runs face the backstop alone. Records are well-formed
// BaseSuiteRecord v1 files outside the tree keyed to the head the
// criterion names (GR-38), or made by rcf build base-suite where the
// criterion says so. The timing test prints the host facts (GR-45);
// spawn clauses read RCF_SPAWN_LOG (GR-46). Imports: Node builtins and
// test/_harness/ only (GR-40).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { lines, rcf, toolPath } from '../_harness/spawn.js';
import { commit, git, initRepo, porcelain, s7, sha } from '../_harness/git.js';
import { baseSuiteRecord, criterion, editStory, project, readJson, readText, scratch, writeJson, writeText } from '../_harness/fixture.js';
import { commandName, hostFacts, readSpawnLog, spawnLog } from '../_harness/capture.js';

const TODO = { todo: 'FBS-239 round DEFINE' };
const NOT_RECORDED = 'backstop: base suite not recorded; run rcf build base-suite --command "<suite>" --out <file> on the base and pass --base-suite <file>';
const RETIRED_FILE = '[warn] backstop: rcf/define/backstop.json is retired in 0.37.0 and ignored; the backstop is the base suite';

// ------------------------------------------------------------- fixtures

const acsOf = (us, n) => Array.from({ length: n }, (_, i) => `AC-${us.slice(3)}-${i + 1}`);

// A chain on main: stories { 'US-101': n } with n criteria each, specs
// { id: { us, acIds, status } }, every criterion bound to a passing test
// and given a Code Node. Then the freeze gate's override recorded and
// committed. Returns { dir, A (the chain commit), B (HEAD on main) }.
async function queue(t, { stories = { 'US-101': 2, 'US-102': 1 }, specs, extra } = {}) {
  const dir = await project(t, { name: 'bs' });
  const us0 = readJson(dir, 'rcf/user-stories/us-101.json');
  const fbs0 = readJson(dir, 'rcf/fbs/fbs-001.json');
  const all = specs ?? { 'FBS-001': { us: 'US-101', acIds: acsOf('US-101', stories['US-101']), status: 'complete' }, 'FBS-002': { us: 'US-102', acIds: acsOf('US-102', 1), status: 'notStarted' } };
  let ts = 1;
  let cn = 1;
  for (const [us, n] of Object.entries(stories)) {
    const ids = acsOf(us, n);
    writeJson(dir, `rcf/user-stories/${us.toLowerCase()}.json`, { ...us0, usId: us, title: `${us} fixture story`, acceptanceCriteria: ids.map((id) => criterion(id, `[happy] ${id} holds`, { verification: 'external' })), tags: [] });
    const file = `test/rcf/${us.toLowerCase()}.test.js`;
    writeText(dir, file, `import { test } from 'node:test';\n${ids.map((id) => `test('${id} holds', () => {});`).join('\n')}\n`);
    const tsId = `TS-${String(ts++).padStart(3, '0')}`;
    writeJson(dir, `rcf/test-suites/${tsId.toLowerCase()}.json`, {
      id: tsId, usId: us, status: 'draft', title: `${us} fixture suite`, purpose: 'fixture', testLevel: 'e2e', acIds: ids,
      testCases: ids.map((id) => ({ id: `TC-${tsId.slice(3)}-${id.toLowerCase()}`, acId: id, description: `${id} holds`, status: 'pending', testPointer: `${file}::${id} holds` })),
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    });
    for (const id of ids) {
      const cnId = `CN-${String(cn).padStart(3, '0')}`;
      writeJson(dir, `rcf/code-nodes/${cnId.toLowerCase()}.json`, {
        cnId, path: `src/x.js#f${cn}`, title: `fixture node for ${id}`, description: `Fixture Code Node implementing ${id}.`,
        implementsAcIds: [id], dependencies: [], version: '0.1.0', status: 'draft', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      });
      cn += 1;
    }
  }
  writeText(dir, 'src/x.js', `${Array.from({ length: cn - 1 }, (_, i) => `export function f${i + 1}() { return ${i + 1}; }`).join('\n')}\n`);
  for (const [id, s] of Object.entries(all)) {
    writeJson(dir, `rcf/fbs/${id.toLowerCase()}.json`, { ...fbs0, fbsId: id, buildOrder: Number(id.slice(4)), title: `${id} fixture`, summary: `${id} scopes ${s.us}.`, acIds: s.acIds, executionStatus: s.status });
  }
  if (extra) extra(dir);
  writeText(dir, '.gitignore', 'node_modules/\n');
  initRepo(dir);
  const A = commit(dir, 'fixture: base chain');
  // The freeze gate is not under test: record its override once, with a green record for A.
  await rcf(['build', 'bundle', '--next', '--override', 'fixture: the freeze gate is not under test', '--base-suite', record(t, baseSuiteRecord(A))], { cwd: dir });
  if (porcelain(dir).trim()) commit(dir, 'DEFINE: freeze override');
  return { dir, A, B: sha(dir) };
}

// A BaseSuiteRecord file outside the fixture tree.
function record(t, rec, name = 'base.json') {
  const d = scratch(t, 'rcf-h-base-');
  writeText(d, name, typeof rec === 'string' ? rec : `${JSON.stringify(rec, null, 2)}\n`);
  return join(d, name);
}
// A branch off main whose HEAD is a DEFINE: commit adding a failing RCF test (section 8.1, base-is-merge-base).
function redBranch(dir) {
  git(dir, 'switch', '-q', '-c', 'feature');
  return commit(dir, 'DEFINE: a failing RCF test', { 'test/rcf/red.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('red by design', () => { assert.equal(1, 2); });\n" });
}

const bundle = (dir, args, env = {}) => rcf(['build', 'bundle', ...args], { cwd: dir, env });
const baseSuite = (dir, args, env = {}) => rcf(['build', 'base-suite', ...args], { cwd: dir, env, timeout: 300_000 });
const errHas = (r, line) => assert.ok(lines(r.stderr).includes(line), `stderr carries "${line}"\nexit ${r.code}\nstdout:\n${r.stdout.slice(0, 1500)}\nstderr:\n${r.stderr}`);
const count = (text, line) => lines(text).filter((l) => l === line).length;
const fbsBytes = (dir) => Object.fromEntries(readdirSync(join(dir, 'rcf', 'fbs')).sort().map((f) => [f, readText(dir, `rcf/fbs/${f}`)]));
const isBundleOf = (r, id) => lines(r.stdout).some((l) => l.startsWith(`# Spec bundle: ${id}`));
const acIdsIn = (text, us = '101') => [...new Set(text.match(new RegExp(`AC-${us}-\\d+`, 'g')) ?? [])].sort();

// ---------------------------------------------------------------- US-20201

// The suite command of AC-20201-1 as the criterion quotes it (ruling 7).
const GLOB_COMMAND = 'node --test "test/rcf/**/*.test.js"';

test('AC-20201-1: a record from rcf build base-suite --command node --test "test/rcf/**/*.test.js" reading green at a clean committed HEAD B makes bundle --next exit 0 with the FBS-002 bundle while FBS-001 is complete and not verified, and the same record bundles from a branch whose HEAD is a DEFINE: commit adding a failing RCF test after B', TODO, async (t) => {
  const { dir, B } = await queue(t);
  assert.equal(porcelain(dir).trim(), '', 'given: a clean committed HEAD B');
  assert.equal(readJson(dir, 'rcf/fbs/fbs-001.json').executionStatus, 'complete', 'given: FBS-001 is complete and not verified');
  assert.equal(readJson(dir, 'rcf/fbs/fbs-002.json').executionStatus, 'notStarted', 'given: FBS-002 is next actionable');
  const out = join(scratch(t, 'rcf-h-out-'), 'base.json');
  const r = await baseSuite(dir, ['--command', GLOB_COMMAND, '--out', out], { PATH: toolPath(['node']) });
  assert.equal(r.code, 0, `base-suite records the run\n${r.stdout}${r.stderr}`);
  const rec = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(rec.head, B, 'the record is made at B');
  assert.equal(rec.green, true, `the record reads green at B\n${JSON.stringify(rec)}`);
  const onTrunk = await bundle(dir, ['--next', '--base-suite', out]);
  assert.equal(onTrunk.code, 0, `${onTrunk.stdout.slice(0, 500)}${onTrunk.stderr}`);
  assert.ok(isBundleOf(onTrunk, 'FBS-002'), 'the FBS-002 bundle: a complete-not-verified spec never holds the queue');
  redBranch(dir); // HEAD a DEFINE: commit adding a failing RCF test after B; the base is the merge-base B
  const offTrunk = await bundle(dir, ['--next', '--base-suite', out]);
  assert.equal(offTrunk.code, 0, `the same green record at B bundles from the branch\n${offTrunk.stdout.slice(0, 500)}${offTrunk.stderr}`);
  assert.ok(isBundleOf(offTrunk, 'FBS-002'), 'the FBS-002 bundle from the branch');
});

test('AC-20201-2: with no --base-suite rcf build bundle --next exits 4 with the not-recorded line and emits no bundle, and a malformed record file exits 2 naming the file', TODO, async (t) => {
  const { dir } = await queue(t);
  const r = await bundle(dir, ['--next']);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  errHas(r, NOT_RECORDED);
  assert.equal(r.stdout, '', 'no bundle');
  const bad = record(t, '{ "version": 1, "head": ', 'broken.json');
  const m = await bundle(dir, ['--next', '--base-suite', bad]);
  assert.equal(m.code, 2, `${m.stdout}${m.stderr}`);
  assert.ok(m.stderr.includes(bad), `stderr names ${bad}\n${m.stderr}`);
  assert.equal(m.stdout, '', 'no bundle');
});

test('AC-20201-3: a green record made at commit A while the base (git merge-base of HEAD with the trunk) is the later commit B makes bundle --next exit 4 "backstop: base suite recorded at <A7>, base is <B7>; record it again"', TODO, async (t) => {
  const { dir, A } = await queue(t);
  const B = commit(dir, 'DEFINE: one more RCF test on the trunk', { 'test/rcf/more.test.js': "import { test } from 'node:test';\ntest('more holds', () => {});\n" });
  redBranch(dir); // HEAD off the trunk: the base is the merge-base B, not HEAD
  const r = await bundle(dir, ['--next', '--base-suite', record(t, baseSuiteRecord(A))]);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  errHas(r, `backstop: base suite recorded at ${s7(A)}, base is ${s7(B)}; record it again`);
});

test('AC-20201-4: a record at B with exitCode 1 and tap fail 3 refuses bundle --next, the explicit bundle FBS-002 and an amend bundle with exit 4 "backstop: base suite red at <B7>: exit 1, 3 failing; no Build starts until the RCF suite is green on the base"', TODO, async (t) => {
  const { dir, B } = await queue(t);
  const red = record(t, baseSuiteRecord(B, { exitCode: 1, tap: { pass: 5, fail: 3, skip: 0, todo: 0, cancelled: 0 } }));
  const line = `backstop: base suite red at ${s7(B)}: exit 1, 3 failing; no Build starts until the RCF suite is green on the base`;
  for (const args of [['--next'], ['FBS-002'], ['FBS-001', '--acs', 'AC-101-1']]) {
    const r = await bundle(dir, [...args, '--base-suite', red]);
    assert.equal(r.code, 4, `${args.join(' ')}\n${r.stdout}${r.stderr}`);
    errHas(r, line);
    assert.equal(r.stdout, '', `${args.join(' ')}: no bundle`);
  }
});

test('AC-20201-5: no flag emits a bundle on a red or missing record (--override, --strict, --format), and the backstop never reads verified: every earlier spec complete and none verified with a green record bundles', TODO, async (t) => {
  const { dir, B } = await queue(t);
  const red = record(t, baseSuiteRecord(B, { exitCode: 1 }));
  for (const flags of [['--override', 'urgent hotfix'], ['--strict'], ['--format', 'json'], ['--format', 'md']]) {
    for (const rec of [[], ['--base-suite', red]]) {
      const r = await bundle(dir, ['--next', ...flags, ...rec]);
      assert.equal(r.code, 4, `${flags.join(' ')} ${rec.length ? 'red' : 'missing'}: exit 4\n${r.stdout}${r.stderr}`);
      assert.equal(r.stdout, '', `${flags.join(' ')} ${rec.length ? 'red' : 'missing'}: no bundle`);
    }
  }
  const specs = {
    'FBS-001': { us: 'US-101', acIds: ['AC-101-1'], status: 'complete' },
    'FBS-002': { us: 'US-101', acIds: ['AC-101-2'], status: 'complete' },
    'FBS-003': { us: 'US-102', acIds: ['AC-102-1'], status: 'notStarted' },
  };
  const q = await queue(t, { specs });
  const ok = await bundle(q.dir, ['--next', '--base-suite', record(t, baseSuiteRecord(q.B))]);
  assert.equal(ok.code, 0, `${ok.stdout.slice(0, 500)}${ok.stderr}`);
  assert.ok(isBundleOf(ok, 'FBS-003'), 'the next spec is bundled while every earlier spec is complete and none verified');
});

test('AC-20201-6: rcf build base-suite refuses a dirty tree with exit 4, refuses --out rcf/base.json with exit 2, and for a command printing no TAP records tap null with green by the exit code and one warn line', TODO, async (t) => {
  const { dir, B } = await queue(t);
  writeText(dir, 'src/dirty.js', 'export const dirty = 1;\n');
  const out = join(scratch(t, 'rcf-h-out-'), 'b.json');
  const d = await baseSuite(dir, ['--command', 'node --test test/rcf/us-101.test.js', '--out', out], { PATH: toolPath(['node']) });
  assert.equal(d.code, 4, `${d.stdout}${d.stderr}`);
  errHas(d, 'base-suite refused: working tree is dirty; record the suite on a committed base');
  assert.ok(!existsSync(out), 'no record written');
  git(dir, 'clean', '-fq', 'src/dirty.js');
  const inTree = await baseSuite(dir, ['--command', 'node --test test/rcf/us-101.test.js', '--out', 'rcf/base.json'], { PATH: toolPath(['node']) });
  assert.equal(inTree.code, 2, `${inTree.stdout}${inTree.stderr}`);
  assert.ok(!existsSync(join(dir, 'rcf', 'base.json')), 'a record never lands in the chain tree');
  // A piped node --test prints the spec reporter, no TAP summary (probe b-02).
  const r = await baseSuite(dir, ['--command', 'node --test test/rcf/us-101.test.js', '--out', out], { PATH: toolPath(['node']) });
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(count(r.stderr, '[warn] base-suite: no TAP summary; green follows the exit code alone'), 1, `one warn line\n${r.stderr}`);
  const rec = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(rec.head, B);
  assert.equal(rec.tap, null);
  assert.equal(rec.exitCode, 0);
  assert.equal(rec.green, true, 'green follows the exit code alone');
});

test('AC-20201-7: with a green record for the base, bundle --next finishes within 2 seconds, starts at most one git process more than the same bundle without --base-suite, and never spawns the suite command', TODO, async (t) => {
  hostFacts(t);
  const { dir, B } = await queue(t);
  const rec = record(t, baseSuiteRecord(B, { command: 'node --test --test-reporter=tap test/rcf' }));
  const withLog = spawnLog(scratch(t, 'rcf-h-spawn-'));
  const withRec = await bundle(dir, ['--next', '--base-suite', rec], withLog.env);
  assert.equal(withRec.code, 0, `${withRec.stdout.slice(0, 500)}${withRec.stderr}`);
  const noLog = spawnLog(scratch(t, 'rcf-h-spawn-'));
  await bundle(dir, ['--next'], noLog.env);
  const withSpawns = readSpawnLog(withLog.file);
  const gitWith = withSpawns.filter((x) => commandName(x) === 'git').length;
  const gitWithout = readSpawnLog(noLog.file).filter((x) => commandName(x) === 'git').length;
  t.diagnostic(`wall ${Math.round(withRec.ms)} ms; git processes ${gitWith} with --base-suite, ${gitWithout} without`);
  assert.deepEqual(withSpawns.filter((x) => commandName(x) !== 'git'), [], 'the suite command (or anything but git) is never spawned');
  assert.ok(gitWith <= gitWithout + 1, `at most one git process more (${gitWith} against ${gitWithout})`);
  assert.ok(withRec.ms <= 2000, `within 2 seconds (${Math.round(withRec.ms)} ms)`);
});

test('AC-20201-8: with rcf/test-strength.json declaring suiteCommand, rcf build base-suite --out <file> with no --command runs it and records it as the command, and a different --command exits 2 with the usage line and writes nothing', TODO, async (t) => {
  const suiteCommand = 'node --test --test-reporter=tap test/rcf';
  const config = { entry: [{ kind: 'bin', path: 'bin/app.js' }], harness: ['test/_harness/**'], edge: [], suiteCommand };
  const { dir, B } = await queue(t, { extra: (d) => { writeJson(d, 'rcf/test-strength.json', config); writeText(d, 'bin/app.js', '#!/usr/bin/env node\n'); } });
  const out = join(scratch(t, 'rcf-h-out-'), 'b.json');
  const r = await baseSuite(dir, ['--out', out], { PATH: toolPath(['node']) });
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const rec = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(rec.command, suiteCommand, 'the declared suiteCommand is the record command');
  assert.equal(rec.head, B);
  const out2 = join(scratch(t, 'rcf-h-out-'), 'b2.json');
  const d = await baseSuite(dir, ['--command', 'node --test test/rcf/a.test.js', '--out', out2], { PATH: toolPath(['node']) });
  assert.equal(d.code, 2, `${d.stdout}${d.stderr}`);
  errHas(d, '[error] usage --command differs from rcf/test-strength.json suiteCommand');
  assert.ok(!existsSync(out2), 'writes nothing');
});

// ---------------------------------------------------------------- US-20202

const SIX = { stories: { 'US-101': 7, 'US-102': 1 } };
function sixSpecs(status = 'complete') {
  return {
    'FBS-001': { us: 'US-101', acIds: acsOf('US-101', 6), status },
    'FBS-002': { us: 'US-102', acIds: ['AC-102-1'], status: 'inProgress' },
    'FBS-003': { us: 'US-101', acIds: ['AC-101-7'], status: 'notStarted' },
  };
}
const amend = (dir, rec, acs, format) => bundle(dir, ['FBS-001', '--acs', acs.join(','), '--base-suite', rec, ...(format ? ['--format', format] : [])]);
const tcIdsFor = (dir, ids) => readJson(dir, 'rcf/test-suites/ts-001.json').testCases.filter((c) => ids.includes(c.acId)).map((c) => c.id);
const cnIdsFor = (dir, ids) => readdirSync(join(dir, 'rcf', 'code-nodes')).map((f) => readJson(dir, `rcf/code-nodes/${f}`)).filter((c) => c.implementsAcIds.some((a) => ids.includes(a))).map((c) => c.cnId);

test('AC-20202-1: bundle FBS-001 --acs AC-101-2,AC-101-5 on a complete six-criterion spec emits json with round amend and touchedAcIds listing only those two criteria with their test cases and Code Nodes, and md titled "Amend round on FBS-001: 2 criteria" whose runbook starts at DEFINE', TODO, async (t) => {
  const { dir, B } = await queue(t, { ...SIX, specs: sixSpecs() });
  const rec = record(t, baseSuiteRecord(B));
  const touched = ['AC-101-2', 'AC-101-5'];
  const j = await amend(dir, rec, touched, 'json');
  assert.equal(j.code, 0, `${j.stdout.slice(0, 800)}${j.stderr}`);
  const doc = JSON.parse(j.stdout);
  assert.equal(doc.round, 'amend');
  assert.deepEqual(doc.touchedAcIds, touched);
  assert.deepEqual(acIdsIn(j.stdout), touched, 'only the two criteria are listed');
  for (const id of [...tcIdsFor(dir, touched), ...cnIdsFor(dir, touched)]) assert.ok(j.stdout.includes(id), `the json lists ${id}`);
  const m = await amend(dir, rec, touched, 'md');
  assert.equal(m.code, 0, `${m.stdout.slice(0, 800)}${m.stderr}`);
  assert.ok(lines(m.stdout).some((l) => /^#+ Amend round on FBS-001: 2 criteria$/.test(l)), `the md title\n${m.stdout.slice(0, 400)}`);
  const ls = lines(m.stdout);
  const at = ls.findIndex((l) => /runbook/i.test(l));
  assert.ok(at >= 0, 'the md carries a runbook');
  const first = ls.slice(at + 1).map((l) => /\b(DEFINE|BUILD|REVIEW|TEST|FINALISE)\b/.exec(l)?.[1]).find(Boolean);
  assert.equal(first, 'DEFINE', 'the runbook first stage is DEFINE');
});

test('AC-20202-2: --acs on an inProgress spec exits 2, an AC the spec does not scope exits 3 with the brokenReference line, and a retired AC exits 2 naming its successor', TODO, async (t) => {
  const { dir, B } = await queue(t, { ...SIX, specs: sixSpecs(), extra: (d) => editStory(d, 'US-101', (us) => { Object.assign(us.acceptanceCriteria.find((a) => a.id === 'AC-101-6'), { supersededBy: 'AC-101-7', supersededOn: '2026-10-20', supersessionNote: 'Retired: replaced by AC-101-7.' }); }) });
  const rec = record(t, baseSuiteRecord(B));
  const a = await bundle(dir, ['FBS-002', '--acs', 'AC-102-1', '--base-suite', rec]);
  assert.equal(a.code, 2, `${a.stdout}${a.stderr}`);
  errHas(a, '[error] usage --acs scopes an amend round on a complete or verified spec');
  const b = await amend(dir, rec, ['AC-999-1']);
  assert.equal(b.code, 3, `${b.stdout}${b.stderr}`);
  errHas(b, '[error] brokenReference AC-999-1 is not scoped by FBS-001');
  const c = await amend(dir, rec, ['AC-101-6']);
  assert.equal(c.code, 2, `${c.stdout}${c.stderr}`);
  errHas(c, '[error] usage AC-101-6 is retired; amend its successor AC-101-7');
});

test('AC-20202-3: an amend bundle on a verified spec is emitted the same way, --next with --acs exits 2, and --next over only complete or verified specs prints "Next actionable: none" and never selects an amend round', TODO, async (t) => {
  const v = await queue(t, { ...SIX, specs: sixSpecs('verified') });
  const rec = record(t, baseSuiteRecord(v.B));
  const j = await amend(v.dir, rec, ['AC-101-2'], 'json');
  assert.equal(j.code, 0, `${j.stdout.slice(0, 500)}${j.stderr}`);
  assert.equal(JSON.parse(j.stdout).round, 'amend');
  const n = await bundle(v.dir, ['--next', '--acs', 'AC-101-2', '--base-suite', rec]);
  assert.equal(n.code, 2, `${n.stdout}${n.stderr}`);
  const done = await queue(t, { specs: { 'FBS-001': { us: 'US-101', acIds: ['AC-101-1'], status: 'complete' }, 'FBS-002': { us: 'US-101', acIds: ['AC-101-2'], status: 'verified' } }, stories: { 'US-101': 2 } });
  const r = await bundle(done.dir, ['--next', '--base-suite', record(t, baseSuiteRecord(done.B))]);
  assert.ok(lines(`${r.stdout}\n${r.stderr}`).includes('Next actionable: none'), `prints "Next actionable: none"\n${r.stdout}${r.stderr}`);
  assert.ok(!r.stdout.includes('Amend round'), 'no amend round is selected');
});

test('AC-20202-4: an amend bundle names no criterion of FBS-001 outside --acs in md or json and leaves every rcf/fbs/ file byte-identical', TODO, async (t) => {
  const { dir, B } = await queue(t, { ...SIX, specs: sixSpecs() });
  const rec = record(t, baseSuiteRecord(B));
  const bytes = fbsBytes(dir);
  for (const format of ['md', 'json']) {
    const r = await amend(dir, rec, ['AC-101-2', 'AC-101-5'], format);
    assert.equal(r.code, 0, `${format}\n${r.stdout.slice(0, 500)}${r.stderr}`);
    assert.deepEqual(acIdsIn(r.stdout), ['AC-101-2', 'AC-101-5'], `${format}: no other criterion of FBS-001 is named`);
  }
  assert.deepEqual(fbsBytes(dir), bytes, 'every rcf/fbs/ file is byte-identical');
  assert.equal(porcelain(dir), '', 'git status unchanged');
});

test('AC-20202-5: an amend bundle naming 8 criteria of a 152-criterion complete spec lists 8 criteria in json and is no more than 1.2 times the size of one naming 8 criteria of a 10-criterion spec', TODO, async (t) => {
  const specs = {
    'FBS-001': { us: 'US-101', acIds: acsOf('US-101', 152), status: 'complete' },
    'FBS-002': { us: 'US-102', acIds: acsOf('US-102', 10), status: 'complete' },
  };
  const { dir, B } = await queue(t, { stories: { 'US-101': 152, 'US-102': 10 }, specs });
  const rec = record(t, baseSuiteRecord(B));
  const eight = (us) => acsOf(us, 8);
  const big = await bundle(dir, ['FBS-001', '--acs', eight('US-101').join(','), '--base-suite', rec, '--format', 'json']);
  assert.equal(big.code, 0, `${big.stdout.slice(0, 500)}${big.stderr}`);
  const small = await bundle(dir, ['FBS-002', '--acs', eight('US-102').join(','), '--base-suite', rec, '--format', 'json']);
  assert.equal(small.code, 0, `${small.stdout.slice(0, 500)}${small.stderr}`);
  assert.deepEqual(acIdsIn(big.stdout), eight('US-101').sort(), 'the json lists the 8 criteria');
  const ratio = Buffer.byteLength(big.stdout) / Buffer.byteLength(small.stdout);
  t.diagnostic(`json bytes ${Buffer.byteLength(big.stdout)} against ${Buffer.byteLength(small.stdout)}, ratio ${ratio.toFixed(3)}`);
  assert.ok(ratio <= 1.2, `at most 1.2 times (ratio ${ratio.toFixed(3)})`);
});

// ---------------------------------------------------------------- US-20203

const BACKSTOP = { fromBuildOrder: 1, adoptedAt: '2026-10-19T00:00:00.000Z', adoptedBy: 'fixture@example.com', overrides: [{ reason: 'hotfix', by: 'fixture@example.com', at: '2026-10-20T00:00:00.000Z' }] };
const withBackstop = (d) => writeJson(d, 'rcf/define/backstop.json', BACKSTOP);

test('AC-20203-1: with rcf/define/backstop.json (fromBuildOrder 1) and a complete-not-verified spec above it, bundle --next with a green record exits 0, emits the bundle and carries exactly one retired-file warn line', TODO, async (t) => {
  const { dir, B } = await queue(t, { extra: withBackstop });
  const r = await bundle(dir, ['--next', '--base-suite', record(t, baseSuiteRecord(B))]);
  assert.equal(r.code, 0, `${r.stdout.slice(0, 500)}${r.stderr}`);
  assert.ok(isBundleOf(r, 'FBS-002'), 'the bundle is emitted');
  assert.equal(count(r.stderr, RETIRED_FILE), 1, `exactly one warn line\n${r.stderr}`);
});

test('AC-20203-2: rcf build backstop adopt --from FBS-001 exits 2 with the retired-adopt usage line and writes no file', TODO, async (t) => {
  const { dir } = await queue(t);
  const r = await rcf(['build', 'backstop', 'adopt', '--from', 'FBS-001'], { cwd: dir });
  assert.equal(r.code, 2, `${r.stdout}${r.stderr}`);
  errHas(r, '[error] usage backstop adopt is retired in 0.37.0; the backstop is the base suite (rcf build base-suite)');
  assert.equal(porcelain(dir), '', 'writes no file');
  assert.ok(!existsSync(join(dir, 'rcf', 'define', 'backstop.json')));
});

test('AC-20203-3: bundle --next --allow-unverified "hotfix" --base-suite <file> exits 2 with the retired-flag usage line and emits no bundle', TODO, async (t) => {
  const { dir, B } = await queue(t);
  const r = await bundle(dir, ['--next', '--allow-unverified', 'hotfix', '--base-suite', record(t, baseSuiteRecord(B))]);
  assert.equal(r.code, 2, `${r.stdout}${r.stderr}`);
  errHas(r, '[error] usage --allow-unverified is retired in 0.37.0; no override lets a Build start on a red base');
  assert.equal(r.stdout, '', 'no bundle');
});

test('AC-20203-4: across the runs of this story, an existing rcf/define/backstop.json stays byte-identical and no command creates one', TODO, async (t) => {
  const withFile = await queue(t, { extra: withBackstop });
  const bytes = readText(withFile.dir, 'rcf/define/backstop.json');
  const rec = record(t, baseSuiteRecord(withFile.B));
  const without = await queue(t);
  const rec2 = record(t, baseSuiteRecord(without.B));
  for (const [dir, r] of [[withFile.dir, rec], [without.dir, rec2]]) {
    await bundle(dir, ['--next', '--base-suite', r]);
    await rcf(['build', 'backstop', 'adopt', '--from', 'FBS-001'], { cwd: dir });
    await bundle(dir, ['--next', '--allow-unverified', 'hotfix', '--base-suite', r]);
    await bundle(dir, ['FBS-001', '--acs', 'AC-101-1', '--base-suite', r]);
  }
  assert.equal(readText(withFile.dir, 'rcf/define/backstop.json'), bytes, 'the existing file is byte-identical');
  assert.ok(!existsSync(join(without.dir, 'rcf', 'define', 'backstop.json')), 'no new backstop.json is created');
});
