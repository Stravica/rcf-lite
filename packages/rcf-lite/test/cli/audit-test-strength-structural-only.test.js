// FBS-247 (US-19907): rcf audit test-strength --structural-only <acIds>
// judges a named criterion's structural layer and its unmutated bound
// tests, runs no mutant for it, and records it blocked with the flag as
// the reason; a structural failure is never hidden, a red or timed-out
// unmutated run still ends the run, a malformed flag is a usage error,
// the help names the flag, and light Finalise accepts the record.
//
// Criteria: 6, all external, proof level full. Each test drives
// bin/rcf.js audit test-strength (and, for AC-19907-6, bin/rcf.js build
// finalise) as a child process over a fixture project made by the bin's
// own rcf init, committed to git, holding a small app (bin/app.js,
// src/greet.js, src/greeter.js), its own shared harness, rcf/
// test-strength.json, Code Node records and bound test cases, in the
// shape of audit-test-strength-skipped.test.js. Every run that reaches
// the bound tests passes PATH from toolPath(['node']). Imports: Node
// builtins and test/_harness/ only.
//
// "No mutant" (AC-19907-1) is proved by counting runs: the structural-only
// criterion's one bound test appends a line to the file named by the
// fixture's RCF_FIXTURE_RUNS environment entry (a scratch file outside
// the project, which the audit's runs inherit) each time it runs. Its
// Code Node is a class of four methods no test reaches, so every mutant
// of it would survive and each mutant run would add a line: exactly one
// line is the unmutated run and no mutant run. The same class gives the
// criterion at least eight generated mutants, more than the run's
// --max-mutants 6 alone, while the judged criteria hold at most six.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { lines, rcf, toolPath } from '../_harness/spawn.js';
import { commit, git, initRepo, s7, sha } from '../_harness/git.js';
import { bindTests, criterion, editFbs, editStory, project, readJson, reviewVerdict, scratch, testVerdict, verdictPath, writeJson, writeText } from '../_harness/fixture.js';

const CONFIG = { entry: [{ kind: 'bin', path: 'bin/app.js' }], harness: ['test/_harness/**'] };
const L = (...ls) => `${ls.join('\n')}\n`;
const q = JSON.stringify;
const FLAG = '--structural-only';

// The fixture's own harness: spawns the entry; its own timeout keeps a
// hung mutant from outliving the run.
const HARNESS = L(
  "import { spawnSync } from 'node:child_process';",
  "import { fileURLToPath } from 'node:url';",
  "const bin = fileURLToPath(new URL('../../bin/app.js', import.meta.url));",
  'export function app(...args) {',
  "  const r = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', timeout: 20000 });",
  '  return { code: r.status, stdout: r.stdout };',
  '}',
);
const GREET = L(
  'export function greet(name, out) {',
  '  out.push(`hello ${name}`);',
  "  return out.join(' ');",
  '}',
);
// Four methods: twelve generated mutants (stubToThrow, noOp, callRemoval
// each), none reached by a bound test.
const GREETER = L(
  'export class Greeter {',
  "  hello(name) { return 'hello ' + name; }",
  "  bye(name) { return 'bye ' + name; }",
  "  wave(name) { return 'wave ' + name; }",
  "  nod(name) { return 'nod ' + name; }",
  '}',
);
// A class with nothing to mutate.
const EMPTY = L('export class Empty {}');
const GREET_BIN = L(
  "import { greet } from '../src/greet.js';",
  "process.stdout.write(greet(process.argv[2] ?? 'world', []) + '\\n');",
);
// A bound test file: tests [{ name, body }], each an async node:test case;
// `imports` are extra import lines.
const testFile = (tests, imports = []) => L(
  "import { test } from 'node:test';",
  "import assert from 'node:assert';",
  "import { app } from '../_harness/run.js';",
  ...imports,
  ...tests.flatMap(({ name, body }) => [`test(${q(name)}, async () => {`, ...body.map((b) => `  ${b}`), '});']),
);
const GREETS_BODY = ["const r = app('ann');", 'assert.strictEqual(r.code, 0);', "assert.strictEqual(r.stdout, 'hello ann\\n');"];
// AC-101-1's bound test: one line in RCF_FIXTURE_RUNS per run, then green.
const COUNTS = { name: 'AC-101-1 greets and counts its run', body: ["appendFileSync(process.env.RCF_FIXTURE_RUNS, 'run\\n');", ...GREETS_BODY] };
const COUNTS_FILE = testFile([COUNTS], ["import { appendFileSync } from 'node:fs';"]);
const GREETS = { name: 'AC-101-2 greets', body: GREETS_BODY };
// Only the exit code: its noOp and callRemoval mutants of greet survive.
const EXITS = { name: 'AC-101-3 exits 0', body: ["assert.strictEqual(app('ann').code, 0);"] };
const BASE = {
  'bin/app.js': GREET_BIN,
  'src/greet.js': GREET,
  'src/greeter.js': GREETER,
  'test/_harness/run.js': HARNESS,
};

function codeNodes(dir, nodes) {
  nodes.forEach(([path, acIds], i) => {
    const n = String(i + 1).padStart(3, '0');
    writeJson(dir, `rcf/code-nodes/cn-${n}.json`, {
      cnId: `CN-${n}`, path, title: `fixture node ${path}`, description: `Fixture Code Node on ${path}.`,
      implementsAcIds: acIds, dependencies: [], version: '0.1.0', status: 'draft',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    });
  });
}

// A fixture project in git at H on main: US-101 with `acs` (FBS-001
// scoping them at inProgress), `files` over BASE, rcf/test-strength.json,
// Code Nodes [[path, acIds]] and bound tests [[acId, file, name]] in bound order.
async function strengthProject(t, { acs, files, nodes, bind }) {
  const dir = await project(t, { name: 'strength' });
  editStory(dir, 'US-101', (us) => { us.acceptanceCriteria = acs.map((id) => criterion(id, `${id} holds for the fixture app`)); });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = acs; f.executionStatus = 'inProgress'; });
  for (const [rel, text] of Object.entries({ ...BASE, ...files })) writeText(dir, rel, text);
  writeText(dir, 'rcf/test-strength.json', `${q(CONFIG, null, 2)}\n`);
  codeNodes(dir, nodes);
  bindTests(dir, bind.map(([acId, file, name]) => ({ acId, pointer: `${file}::${name}` })), { realTests: false });
  writeText(dir, '.gitignore', 'node_modules/\n');
  initRepo(dir);
  const H = commit(dir, 'fixture: base');
  return { dir, H };
}

// A REVIEW: commit adding a MERGE/PASS review.json for the current HEAD.
function reviewed(dir, touchedAcIds) {
  const H = sha(dir);
  commit(dir, 'REVIEW: verdict', { [verdictPath(H, 'review.json')]: reviewVerdict(H, { touchedAcIds }) });
  return H;
}

// A scratch runs file outside the project: its env entry and its line count.
function runsFile(t) {
  const file = join(scratch(t, 'rcf-h-runs-'), 'runs.log');
  return { env: { RCF_FIXTURE_RUNS: file }, count: () => (existsSync(file) ? lines(readFileSync(file, 'utf8')).length : 0) };
}

const strength = (dir, args = [], env = {}) => rcf(['audit', 'test-strength', ...args], { cwd: dir, env: { PATH: toolPath(['node']), ...env }, timeout: 600_000 });
const crit = (report, acId) => report.criteria.find((c) => c.acId === acId);
const show = (r) => `exit ${r.code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
const resultLine = (r) => lines(r.stdout).some((l) => /^test-strength: (PASS|FAIL|BLOCKED) /.test(l));
// What rcf build finalise prints for a blocked row: "<reason>: <detail>".
const finaliseReason = (row) => [row.reason, row.detail].filter((v) => typeof v === 'string' && v).join(': ');
// Every mutant count of totals equals the sum over the rows, so a blocked row contributes zero.
function countsFromRows(report) {
  const rows = report.criteria.flatMap((c) => c.mutants ?? []);
  const n = (res) => rows.filter((m) => m.result === res).length;
  return { mutants: rows.length, killed: n('killed'), survived: n('survived'), timeout: n('timeout'), notApplicable: n('notApplicable') };
}
// AC-101-1's row: blocked by the flag, no mutant row, its own reason code.
function flagBlocked(rep) {
  const e = crit(rep, 'AC-101-1');
  assert.ok(e, `the record names AC-101-1\n${q(rep)}`);
  assert.equal(e.result, 'blocked', `AC-101-1 is blocked\n${q(e)}`);
  assert.equal(e.blocked, true, q(e));
  assert.deepEqual(e.mutants, [], `a structural-only criterion has no mutant rows\n${q(e)}`);
  assert.equal(typeof e.reason, 'string', `the row carries a reason code\n${q(e)}`);
  assert.ok(e.reason.length > 0, q(e));
  assert.notEqual(e.reason, 'TEST_STRENGTH_UNSUPPORTED', `the flag's reason code is its own, not TEST_STRENGTH_UNSUPPORTED\n${q(e)}`);
  assert.ok(finaliseReason(e).includes(FLAG), `its reason and detail name the flag ${FLAG}\n${q(e)}`);
  return e;
}

const SO_FILE = 'test/rcf/so.test.js';
// AC-101-1 structural-only over the Greeter class, AC-101-2 (and AC-101-3) judged over greet.
async function soProject(t, acs) {
  const bind = [['AC-101-1', SO_FILE, COUNTS.name], ['AC-101-2', 'test/rcf/a.test.js', GREETS.name], ['AC-101-3', 'test/rcf/c.test.js', EXITS.name]];
  return strengthProject(t, {
    acs,
    files: { [SO_FILE]: COUNTS_FILE, 'test/rcf/a.test.js': testFile([GREETS]), 'test/rcf/c.test.js': testFile([EXITS]) },
    nodes: [['src/greeter.js#Greeter', ['AC-101-1']], ['src/greet.js#greet', acs.filter((id) => id !== 'AC-101-1')]],
    bind: bind.filter(([acId]) => acs.includes(acId)),
  });
}

// ---------------------------------------------------------------- US-19907

test('AC-19907-1: --structural-only AC-101-1 runs its bound test once unmutated and no mutant, records it blocked with a reason naming the flag and a code of its own while AC-101-2 is judged, exit 5 with the BLOCKED line and the record naming both, its mutants outside --max-mutants; with AC-101-3 whose mutant survives, exit 4 and the record names all three', async (t) => {
  // Two criteria: AC-101-1 structural-only, AC-101-2 judged by mutation.
  const acs = ['AC-101-1', 'AC-101-2'];
  const two = await soProject(t, acs);
  const H = reviewed(two.dir, acs);
  const runs = runsFile(t);
  const r = await strength(two.dir, ['--acs', acs.join(','), FLAG, 'AC-101-1', '--max-mutants', '6', '--record'], runs.env);
  assert.ok(!lines(r.stderr).some((l) => l.includes('exceed --max-mutants')), `AC-101-1's generated mutants do not count toward --max-mutants\n${show(r)}`);
  assert.equal(r.code, 5, `a structural-only criterion is blocked beside a passing one: exit 5\n${show(r)}`);
  assert.equal(runs.count(), 1, `AC-101-1's bound test ran exactly once, the unmutated run, and under no mutant\n${show(r)}`);
  const path = verdictPath(H, 'test-strength.json');
  assert.ok(existsSync(join(two.dir, path)), `--record writes ${path}\n${show(r)}`);
  const rep = readJson(two.dir, path);
  assert.equal(rep.head, H);
  assert.deepEqual(rep.criteria.map((c) => c.acId).sort(), acs, `the record names both criteria\n${q(rep)}`);
  flagBlocked(rep);
  const judged = crit(rep, 'AC-101-2');
  assert.equal(judged.result, 'pass', `AC-101-2 is judged by mutation as today\n${q(rep)}`);
  assert.ok(judged.mutants.some((m) => m.result === 'killed'), `AC-101-2's mutants ran and were killed\n${q(judged)}`);
  assert.equal(rep.result, 'blocked', q(rep));
  assert.equal(rep.totals.blocked, 1, q(rep.totals));
  const counts = countsFromRows(rep);
  for (const k of Object.keys(counts)) assert.equal(rep.totals[k], counts[k], `totals.${k} counts AC-101-2's mutants only\n${q(rep)}`);
  const { killed, timeout, mutants, notApplicable } = rep.totals;
  const blockedLine = `test-strength: BLOCKED 2 criteria at ${s7(H)}: structural 1/1, mutants killed ${killed + timeout}/${mutants - notApplicable} (timeout ${timeout}, notApplicable ${notApplicable}, blocked 1): AC-101-1 (${SO_FILE})`;
  assert.ok(lines(r.stdout).includes(blockedLine), `stdout is the BLOCKED line AC-19904-7 rules\n${blockedLine}\n${show(r)}`);

  // Three criteria: AC-101-3's noOp and callRemoval mutants survive; the fail exit wins.
  const acs3 = ['AC-101-1', 'AC-101-2', 'AC-101-3'];
  const three = await soProject(t, acs3);
  const H3 = reviewed(three.dir, acs3);
  const runs3 = runsFile(t);
  const f = await strength(three.dir, ['--acs', acs3.join(','), FLAG, 'AC-101-1', '--max-mutants', '6', '--record'], runs3.env);
  assert.equal(f.code, 4, `a failing criterion beside the structural-only one: exit 4\n${show(f)}`);
  assert.equal(runs3.count(), 1, `AC-101-1's bound test ran exactly once\n${show(f)}`);
  const failLine = new RegExp(`^test-strength: FAIL 1 of 3 criteria at ${s7(H3)}: AC-101-3 vacuous: .+ on src/greet\\.js#greet survived 1 bound tests, blocked 1: AC-101-1 \\(test/rcf/so\\.test\\.js\\)$`);
  assert.ok(lines(f.stdout).some((l) => failLine.test(l)), `the FAIL line names AC-101-3's finding and ends ", blocked 1: AC-101-1 (${SO_FILE})"\n${show(f)}`);
  const path3 = verdictPath(H3, 'test-strength.json');
  assert.ok(existsSync(join(three.dir, path3)), `--record writes ${path3}\n${show(f)}`);
  const rep3 = readJson(three.dir, path3);
  assert.deepEqual(rep3.criteria.map((c) => c.acId).sort(), acs3, `the record names all three criteria\n${q(rep3)}`);
  flagBlocked(rep3);
  assert.equal(crit(rep3, 'AC-101-2').result, 'pass', q(rep3));
  assert.equal(crit(rep3, 'AC-101-3').result, 'fail', q(rep3));
  assert.equal(rep3.result, 'fail', q(rep3));
  assert.equal(rep3.totals.blocked, 1, q(rep3.totals));
});

test('AC-19907-2: a criterion named in --structural-only with no Code Node, no bound test, only a file-level Code Node on a source file, a Code Node with nothing to mutate, or a structural finding is recorded as a failure with that reason, never as blocked', async (t) => {
  // One fixture, five criteria, each named in the flag, each with one structural reason.
  const shapes = [
    { acId: 'AC-101-1', reason: 'no Code Node' },
    { acId: 'AC-101-2', reason: 'unbound' },
    { acId: 'AC-101-3', reason: 'no symbol-level Code Node' },
    { acId: 'AC-101-4', reason: 'no mutable symbol src/empty.js#Empty' },
    { acId: 'AC-101-5', reason: 'imports src/greet.js (not the app entry or the harness)' },
  ];
  const acs = shapes.map((s) => s.acId);
  const greets = (acId) => ({ name: `${acId} greets`, body: GREETS_BODY });
  const imports = { name: 'AC-101-5 greets through greet', body: ["assert.strictEqual(greet('ann', []), 'hello ann');"] };
  const { dir } = await strengthProject(t, {
    acs,
    files: {
      'src/empty.js': EMPTY,
      'test/rcf/a.test.js': testFile([greets('AC-101-1'), greets('AC-101-3'), greets('AC-101-4')]),
      'test/rcf/e.test.js': testFile([imports], ["import { greet } from '../../src/greet.js';"]),
    },
    nodes: [['src/greet.js#greet', ['AC-101-2', 'AC-101-5']], ['src/greet.js', ['AC-101-3']], ['src/empty.js#Empty', ['AC-101-4']]],
    bind: [
      ['AC-101-1', 'test/rcf/a.test.js', greets('AC-101-1').name],
      ['AC-101-3', 'test/rcf/a.test.js', greets('AC-101-3').name],
      ['AC-101-4', 'test/rcf/a.test.js', greets('AC-101-4').name],
      ['AC-101-5', 'test/rcf/e.test.js', imports.name],
    ],
  });
  const H = reviewed(dir, acs);
  const r = await strength(dir, ['--acs', acs.join(','), FLAG, acs.join(','), '--record']);
  assert.equal(r.code, 4, `every structural failure stays a failure: exit 4\n${show(r)}`);
  const fail = lines(r.stdout).find((l) => l.startsWith(`test-strength: FAIL 5 of 5 criteria at ${s7(H)}: `));
  assert.ok(fail, `stdout is the FAIL line over all five criteria\n${show(r)}`);
  for (const { acId, reason } of shapes) assert.ok(fail.includes(`${acId} ${reason}`), `the FAIL line names "${acId} ${reason}"\n${fail}`);
  assert.ok(!fail.includes(', blocked '), `no criterion is blocked\n${fail}`);
  const path = verdictPath(H, 'test-strength.json');
  assert.ok(existsSync(join(dir, path)), `--record writes ${path}\n${show(r)}`);
  const rep = readJson(dir, path);
  for (const { acId } of shapes) {
    const e = crit(rep, acId);
    assert.equal(e?.result, 'fail', `${acId} is recorded as a failure\n${q(e)}`);
    assert.notEqual(e.blocked, true, `${acId} is not blocked\n${q(e)}`);
  }
  assert.equal(rep.result, 'fail', q(rep));
  assert.equal(rep.totals.blocked, 0, q(rep.totals));
});

// The usage model of the budget for the timeout shape (the role rule on a
// criterion about a budget): --mutant-timeout <n> is one deadline for all
// of a criterion's bound tests together, each run under node --test in its
// own process (about 0.1 to 0.5 s of start-up on a CI runner). Typical
// profile: the red shape's bound tests of about 0.2 s each under the
// default budget of 120 s. Heavy profile: AC-101-1's one bound test waits
// 8 s under a budget of 3 s, so it is killed at the deadline with 5 s of
// margin whatever the host's start-up. Assumes a host where one node
// --test start takes under 3 s.
test('AC-19907-3: a red or timed-out unmutated bound test of a criterion named in --structural-only ends the run with exit 2, nothing recorded and the existing red or timeout line', async (t) => {
  const acs = ['AC-101-1', 'AC-101-2'];
  const shape = async (soTest) => {
    const p = await strengthProject(t, {
      acs,
      files: { [SO_FILE]: testFile([soTest]), 'test/rcf/a.test.js': testFile([GREETS]) },
      nodes: [['src/greeter.js#Greeter', ['AC-101-1']], ['src/greet.js#greet', ['AC-101-2']]],
      bind: [['AC-101-2', 'test/rcf/a.test.js', GREETS.name], ['AC-101-1', SO_FILE, soTest.name]],
    });
    return { ...p, H: reviewed(p.dir, acs), pointer: `${SO_FILE}::${soTest.name}` };
  };
  const nothingRecorded = (dir, H, r) => {
    const path = verdictPath(H, 'test-strength.json');
    assert.ok(!existsSync(join(dir, path)), `nothing is recorded: no ${path}\n${show(r)}`);
    assert.ok(!resultLine(r), `no result line\n${show(r)}`);
  };

  // Red: AC-101-1's bound test fails unmutated.
  const red = await shape({ name: 'AC-101-1 greets bob', body: ["assert.strictEqual(app('ann').stdout, 'hello bob\\n');"] });
  const rr = await strength(red.dir, ['--acs', acs.join(','), FLAG, 'AC-101-1', '--record']);
  assert.equal(rr.code, 2, `a red unmutated run: exit 2\n${show(rr)}`);
  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const redLine = new RegExp(`^test-strength: the unmutated run is red for AC-101-1: ${esc(red.pointer)} fails under runner .+; no mutant was run$`);
  assert.ok(lines(rr.stderr).some((l) => redLine.test(l)), `stderr reads "test-strength: the unmutated run is red for AC-101-1: ${red.pointer} fails under runner <argv>; no mutant was run"\n${show(rr)}`);
  nothingRecorded(red.dir, red.H, rr);

  // Timeout: AC-101-1's bound test outlasts the budget.
  const slow = await shape({ name: 'AC-101-1 waits', body: ['await new Promise((done) => setTimeout(done, 8000));', ...GREETS_BODY] });
  const rt = await strength(slow.dir, ['--acs', acs.join(','), FLAG, 'AC-101-1', '--mutant-timeout', '3', '--record']);
  assert.equal(rt.code, 2, `a timed-out unmutated run: exit 2\n${show(rt)}`);
  const line = lines(rt.stderr).find((l) => l.includes('timed out'));
  assert.ok(line, `one stderr line holds "timed out"\n${show(rt)}`);
  for (const w of ['test-strength: the unmutated run for AC-101-1 timed out', '3 s', '--mutant-timeout', slow.pointer, "all of a criterion's bound tests together", 'no mutant was run']) {
    assert.ok(line.includes(w), `the timeout line holds ${q(w)}\n${line}`);
  }
  assert.ok(!lines(rt.stderr).some((l) => l.includes('fails under runner')), `no stderr line reads "fails under runner"\n${rt.stderr}`);
  nothingRecorded(slow.dir, slow.H, rt);
});

test('AC-19907-4: an id in --structural-only that is not in --acs, or the flag with no id, exits 2 with one stderr line naming the id and the flag, and records nothing', async (t) => {
  const acs = ['AC-101-1', 'AC-101-2'];
  const { dir } = await soProject(t, acs);
  const H = reviewed(dir, acs);
  const path = verdictPath(H, 'test-strength.json');
  const shapes = [
    { shape: 'an id outside --acs', args: ['--acs', 'AC-101-2', '--record', FLAG, 'AC-101-1'], names: [FLAG, 'AC-101-1'] },
    { shape: 'the flag with no id', args: ['--acs', acs.join(','), '--record', FLAG], names: [FLAG] },
    { shape: 'the flag with an empty value', args: ['--acs', acs.join(','), '--record', `${FLAG}=`], names: [FLAG] },
  ];
  for (const { shape, args, names } of shapes) {
    const r = await strength(dir, args);
    assert.equal(r.code, 2, `${shape}: the usage exit code 2\n${show(r)}`);
    const err = lines(r.stderr);
    assert.equal(err.length, 1, `${shape}: stderr is one line\n${show(r)}`);
    for (const n of names) assert.ok(err[0].includes(n), `${shape}: the line names ${n}\n${err[0]}`);
    assert.ok(!existsSync(join(dir, path)), `${shape}: nothing is recorded: no ${path}\n${show(r)}`);
    assert.ok(!resultLine(r), `${shape}: no result line\n${show(r)}`);
  }
});

test('AC-19907-5: rcf audit test-strength --help and rcf help audit test-strength list --structural-only <acIds>, state that it judges the structural layer and the unmutated bound tests of the named criteria, runs no mutant for them and records each as blocked with the flag as the reason, and name it under exit 5', async (t) => {
  const folded = (text) => text.replace(/\s+/g, ' ');
  // The exit 5 entry: its own line and the lines under it, up to the next exit code.
  const exit5 = (help) => {
    const ls = lines(help);
    const at = ls.findIndex((l) => /^\s+5\s{2}/.test(l));
    assert.ok(at >= 0, `the help lists exit 5\n${help}`);
    const rest = ls.slice(at + 1);
    const end = rest.findIndex((l) => /^\s+\d+(,\s*\d+)*\s{2}/.test(l) || !l.trim());
    return folded([ls[at], ...rest.slice(0, end < 0 ? rest.length : end)].join(' '));
  };
  const dir = await project(t, { name: 'help' });
  for (const args of [['audit', 'test-strength', '--help'], ['help', 'audit', 'test-strength']]) {
    const r = await rcf(args, { cwd: dir });
    assert.equal(r.code, 0, `rcf ${args.join(' ')} exits 0\n${show(r)}`);
    assert.ok(lines(r.stdout).some((l) => /^\s+--structural-only <acIds>/.test(l)), `rcf ${args.join(' ')}: the options list --structural-only <acIds>\n${r.stdout}`);
    const help = folded(r.stdout);
    for (const w of [
      'judges the structural layer and the unmutated bound tests of the named criteria',
      'runs no mutant for them',
      'records each as blocked with the flag as the reason',
    ]) {
      assert.ok(help.includes(w), `rcf ${args.join(' ')}: the help states ${q(w)}\n${r.stdout}`);
    }
    assert.ok(exit5(r.stdout).includes(FLAG), `rcf ${args.join(' ')}: the exit 5 entry names ${FLAG}\n${exit5(r.stdout)}`);
  }
});

test('AC-19907-6: light Finalise accepts a record whose criterion --structural-only blocked, writes complete and prints "test-strength at <H7>: AC-101-1 blocked: <reason>; recorded, not refused" with the reason naming the flag', async (t) => {
  const acs = ['AC-101-1', 'AC-101-2'];
  const { dir } = await soProject(t, acs);
  git(dir, 'switch', '-q', '-c', 'feature');
  editFbs(dir, 'FBS-001', (f) => { f.summary = `${f.summary} Round opened.`; });
  commit(dir, 'DEFINE: round');
  commit(dir, 'BUILD: code', { 'src/greet.js': `${GREET}// BUILD: code\n` });
  const H = reviewed(dir, acs);
  const runs = runsFile(t);
  const a = await strength(dir, ['--acs', acs.join(','), FLAG, 'AC-101-1', '--record'], runs.env);
  assert.equal(a.code, 5, `given: the audit records AC-101-1 blocked by the flag, exit 5\n${show(a)}`);
  const path = verdictPath(H, 'test-strength.json');
  const row = flagBlocked(readJson(dir, path));
  commit(dir, 'TEST: verdict', { [verdictPath(H, 'test.json')]: testVerdict(H, { result: 'PASS' }), [path]: readJson(dir, path) });
  const T = sha(dir);

  const r = await rcf(['build', 'finalise', 'FBS-001', '--ci-run', 'run-7'], { cwd: dir });
  assert.equal(r.code, 0, `a record blocked by the flag is recorded, not refused\n${show(r)}`);
  assert.ok(lines(r.stdout).includes(`finalise: FBS-001 complete at ${s7(T)} (reviewed ${s7(H)}, ci run-7, touched 2 criteria)`), `stdout carries the complete line\n${show(r)}`);
  assert.equal(readJson(dir, 'rcf/fbs/fbs-001.json').executionStatus, 'complete', 'finalise writes complete');
  const strengthLines = lines(r.stdout).filter((l) => l.startsWith(`test-strength at ${s7(H)}: `));
  assert.deepEqual(strengthLines, [`test-strength at ${s7(H)}: AC-101-1 blocked: ${finaliseReason(row)}; recorded, not refused`], `one line, for AC-101-1, showing its reason\n${show(r)}`);
});
