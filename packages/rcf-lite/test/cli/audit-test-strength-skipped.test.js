// FBS-246 (US-19906): rcf audit test-strength over a skipped bound test,
// a budget timeout in the unmutated run, a broken bound-test pointer
// beside a skipped test, and the help's budget rule and exit codes.
//
// Criteria: 5, all external, proof level full. Each test drives
// bin/rcf.js audit test-strength as a child process over a fixture
// project made by the bin's own rcf init, committed to git, holding a
// small app (bin/app.js, src/greet.js), its own shared harness, rcf/
// test-strength.json, Code Node records and bound test cases, in the
// shape of audit-test-strength.test.js. Every run that reaches the bound
// tests passes PATH from toolPath(['node']) (the stage-keeper's ruling
// C2 on the independent check). Imports: Node builtins and test/_harness/
// only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { lines, rcf, toolPath } from '../_harness/spawn.js';
import { commit, initRepo, s7, sha } from '../_harness/git.js';
import { bindTests, criterion, editFbs, editStory, project, readJson, reviewVerdict, verdictPath, writeJson, writeText } from '../_harness/fixture.js';

const CONFIG = { entry: [{ kind: 'bin', path: 'bin/app.js' }], harness: ['test/_harness/**'] };
const L = (...ls) => `${ls.join('\n')}\n`;
const q = JSON.stringify;

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
const GREET_BIN = L(
  "import { greet } from '../src/greet.js';",
  "process.stdout.write(greet(process.argv[2] ?? 'world', []) + '\\n');",
);
// A bound test file: tests [{ name, opts, args, body }], each an async
// node:test case, `opts` its options object (a skip) and `args` its
// parameters (t, for t.skip()).
const testFile = (tests) => L(
  "import { test } from 'node:test';",
  "import assert from 'node:assert';",
  "import { app } from '../_harness/run.js';",
  ...tests.flatMap(({ name, opts, args = '', body }) => [
    `test(${q(name)}, ${opts ? `${q(opts)}, ` : ''}async (${args}) => {`, ...body.map((b) => `  ${b}`), '});',
  ]),
);
const GREETS_BODY = ["const r = app('ann');", 'assert.strictEqual(r.code, 0);', "assert.strictEqual(r.stdout, 'hello ann\\n');"];
const GREETS = { name: 'AC-101-2 greets', body: GREETS_BODY };
// Skipped by the options object: TAP "ok 1 - <name> # SKIP".
const SKIPPED = { name: 'AC-101-1 needs a target', opts: { skip: true }, body: GREETS_BODY };
// Only the exit code: its noOp and callRemoval mutants of greet survive.
const EXITS = { name: 'AC-101-3 exits 0', body: ["assert.strictEqual(app('ann').code, 0);"] };
const BASE = {
  'bin/app.js': GREET_BIN,
  'src/greet.js': GREET,
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

// A fixture project in git at H: US-101 with `acs` (FBS-001 scoping them
// at inProgress), `files` over BASE, rcf/test-strength.json, Code Nodes
// [[path, acIds]] and bound tests [[acId, file, name]] in bound order.
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

const strength = (dir, args = []) => rcf(['audit', 'test-strength', ...args], { cwd: dir, env: { PATH: toolPath(['node']) }, timeout: 600_000 });
const crit = (report, acId) => report.criteria.find((c) => c.acId === acId);
const show = (r) => `${r.stdout}${r.stderr}`;
const notRunLine = (r) => assert.ok(!lines(r.stderr).some((l) => l.includes('was not run by runner')), `no stderr line reads "was not run by runner"\n${r.stderr}`);
// What rcf build finalise prints for a blocked row: "<reason>: <detail>".
const finaliseReason = (row) => [row.reason, row.detail].filter((v) => typeof v === 'string' && v).join(': ');
// Every mutant count of totals equals the sum over the judged rows, so a blocked row contributes zero.
function countsFromRows(report) {
  const rows = report.criteria.flatMap((c) => c.mutants ?? []);
  const n = (res) => rows.filter((m) => m.result === res).length;
  return { mutants: rows.length, killed: n('killed'), survived: n('survived'), timeout: n('timeout'), notApplicable: n('notApplicable') };
}

// ---------------------------------------------------------------- US-19906

test('AC-19906-1: AC-101-1 whose only bound test is skipped is recorded blocked naming the skipped test while AC-101-2 is judged, exit 5 with the BLOCKED line and the record naming both; with AC-101-3 whose mutant survives, exit 4 and the record names all three', async (t) => {
  const skipPointer = `test/rcf/skip.test.js::${SKIPPED.name}`;
  const blockedRow = (rep) => {
    const e = crit(rep, 'AC-101-1');
    assert.ok(e, `the record names AC-101-1\n${q(rep)}`);
    assert.equal(e.result, 'blocked', `AC-101-1 is blocked\n${q(e)}`);
    assert.equal(e.blocked, true, q(e));
    assert.deepEqual(e.mutants, [], `a blocked criterion has no mutant rows\n${q(e)}`);
    assert.ok(finaliseReason(e).includes(skipPointer), `its reason and detail name the skipped test ${skipPointer}\n${q(e)}`);
  };
  const files = {
    'test/rcf/skip.test.js': testFile([SKIPPED]),
    'test/rcf/a.test.js': testFile([GREETS]),
    'test/rcf/c.test.js': testFile([EXITS]),
  };

  // Two criteria: AC-101-1 skipped, AC-101-2 passing.
  const acs = ['AC-101-1', 'AC-101-2'];
  const two = await strengthProject(t, {
    acs, files,
    nodes: [['src/greet.js#greet', acs]],
    bind: [['AC-101-1', 'test/rcf/skip.test.js', SKIPPED.name], ['AC-101-2', 'test/rcf/a.test.js', GREETS.name]],
  });
  const H = reviewed(two.dir, acs);
  const r = await strength(two.dir, ['--acs', acs.join(','), '--record']);
  assert.equal(r.code, 5, `a criterion whose only bound test is skipped is blocked beside a passing one: exit 5\n${show(r)}`);
  notRunLine(r);
  const path = verdictPath(H, 'test-strength.json');
  assert.ok(existsSync(`${two.dir}/${path}`), `--record writes ${path}\n${show(r)}`);
  const rep = readJson(two.dir, path);
  assert.equal(rep.head, H);
  assert.deepEqual(rep.criteria.map((c) => c.acId).sort(), acs, `the record names both criteria\n${q(rep)}`);
  blockedRow(rep);
  assert.equal(crit(rep, 'AC-101-2').result, 'pass', `AC-101-2 is judged as usual\n${q(rep)}`);
  assert.equal(rep.result, 'blocked', q(rep));
  assert.equal(rep.totals.blocked, 1, q(rep.totals));
  assert.equal(rep.totals.structuralPassed, 1, `the blocked criterion counts in no structuralPassed\n${q(rep.totals)}`);
  const counts = countsFromRows(rep);
  for (const k of Object.keys(counts)) assert.equal(rep.totals[k], counts[k], `totals.${k} counts AC-101-2's mutants only\n${q(rep)}`);
  const { killed, timeout, mutants, notApplicable } = rep.totals;
  const blockedLine = `test-strength: BLOCKED 2 criteria at ${s7(H)}: structural 1/1, mutants killed ${killed + timeout}/${mutants - notApplicable} (timeout ${timeout}, notApplicable ${notApplicable}, blocked 1): AC-101-1 (test/rcf/skip.test.js)`;
  assert.ok(lines(r.stdout).includes(blockedLine), `stdout is the BLOCKED line AC-19904-7 rules\n${blockedLine}\n${show(r)}`);

  // Three criteria: AC-101-3's noOp and callRemoval mutants survive; the fail exit wins.
  const acs3 = ['AC-101-1', 'AC-101-2', 'AC-101-3'];
  const three = await strengthProject(t, {
    acs: acs3, files,
    nodes: [['src/greet.js#greet', acs3]],
    bind: [['AC-101-1', 'test/rcf/skip.test.js', SKIPPED.name], ['AC-101-2', 'test/rcf/a.test.js', GREETS.name], ['AC-101-3', 'test/rcf/c.test.js', EXITS.name]],
  });
  const H3 = reviewed(three.dir, acs3);
  const f = await strength(three.dir, ['--acs', acs3.join(','), '--record']);
  assert.equal(f.code, 4, `a failing criterion beside the blocked one: exit 4\n${show(f)}`);
  notRunLine(f);
  const failLine = new RegExp(`^test-strength: FAIL 1 of 3 criteria at ${s7(H3)}: AC-101-3 vacuous: .+ on src/greet\\.js#greet survived 1 bound tests, blocked 1: AC-101-1 \\(test/rcf/skip\\.test\\.js\\)$`);
  assert.ok(lines(f.stdout).some((l) => failLine.test(l)), `the FAIL line names AC-101-3's finding and ends ", blocked 1: AC-101-1 (test/rcf/skip.test.js)"\n${show(f)}`);
  const path3 = verdictPath(H3, 'test-strength.json');
  assert.ok(existsSync(`${three.dir}/${path3}`), `--record writes ${path3}\n${show(f)}`);
  const rep3 = readJson(three.dir, path3);
  assert.deepEqual(rep3.criteria.map((c) => c.acId).sort(), acs3, `the record names all three criteria\n${q(rep3)}`);
  blockedRow(rep3);
  assert.equal(crit(rep3, 'AC-101-2').result, 'pass', q(rep3));
  assert.equal(crit(rep3, 'AC-101-3').result, 'fail', q(rep3));
  assert.equal(rep3.result, 'fail', q(rep3));
  assert.equal(rep3.totals.blocked, 1, q(rep3.totals));
});

test('AC-19906-2: AC-101-1 bound to a skipped test and a passing one is judged on the one that ran: exit 0 with the PASS line, every killed mutant names the test that ran, and the record entry names the skipped test outside its mutant rows', async (t) => {
  const skipped = { name: 'AC-101-1 needs a target', args: 't', body: ["t.skip('no target');"] };
  const greets = { name: 'AC-101-1 greets', body: GREETS_BODY };
  const skipPointer = `test/rcf/a.test.js::${skipped.name}`;
  const ranPointer = `test/rcf/a.test.js::${greets.name}`;
  const { dir } = await strengthProject(t, {
    acs: ['AC-101-1'],
    files: { 'test/rcf/a.test.js': testFile([skipped, greets]) },
    nodes: [['src/greet.js#greet', ['AC-101-1']]],
    // Bound order: the skipped test first, so each run must go on past it.
    bind: [['AC-101-1', 'test/rcf/a.test.js', skipped.name], ['AC-101-1', 'test/rcf/a.test.js', greets.name]],
  });
  const H = reviewed(dir, ['AC-101-1']);
  const r = await strength(dir, ['--acs', 'AC-101-1', '--record']);
  assert.equal(r.code, 0, `judged on the bound test that ran: exit 0\n${show(r)}`);
  notRunLine(r);
  const rep = readJson(dir, verdictPath(H, 'test-strength.json'));
  const e = crit(rep, 'AC-101-1');
  assert.equal(e?.result, 'pass', q(rep));
  const { killed, timeout, mutants, notApplicable } = rep.totals;
  assert.ok(killed > 0, `the test that ran kills mutants\n${q(rep)}`);
  assert.equal(r.stdout.replace(/\n$/, ''), `test-strength: PASS 1 criteria at ${s7(H)}: structural 1/1, mutants killed ${killed + timeout}/${mutants - notApplicable} (timeout ${timeout}, notApplicable ${notApplicable})`, show(r));
  for (const m of e.mutants) {
    assert.ok(!m.killedBy.includes(skipPointer), `no mutant names the skipped test\n${q(m)}`);
    if (m.result === 'killed') assert.deepEqual(m.killedBy, [ranPointer], `a killed mutant names the test that ran\n${q(m)}`);
  }
  const entry = { ...e };
  delete entry.mutants;
  assert.ok(q(entry).includes(skipPointer), `the entry names the skipped test ${skipPointer} outside its mutant rows\n${q(e)}`);
});

// The usage model of the budget (role rule on a criterion about a budget):
// --mutant-timeout <n> is one deadline for all of a criterion's bound
// tests together, each run under node --test in its own process (about
// 0.1 to 0.5 s of start-up on a CI runner). Typical profile: two bound
// tests of about 0.2 s each under a budget of 30 s, well inside it.
// Heavy profile: two bound tests of about 4 s each under a budget of 6 s:
// each alone fits with 2 s to spare (about 4.5 s with start-up), the two
// together overrun the budget by 2 s, so the second starts with under 2 s
// left and is killed at the deadline, and the test reached is the second.
// Assumes a host where one node --test start takes under 2 s; on a slower
// host the deadline can fall in the first test, and this test then fails
// on the test reached, not on the line.
const waiting = (name, ms) => ({ name, body: [`await new Promise((done) => setTimeout(done, ${ms}));`, ...GREETS_BODY] });
async function budgetProject(t, ms) {
  const first = waiting('AC-101-1 first waits', ms);
  const second = waiting('AC-101-1 second waits', ms);
  const p = await strengthProject(t, {
    acs: ['AC-101-1'],
    files: { 'test/rcf/a.test.js': testFile([first, second]) },
    nodes: [['src/greet.js#greet', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/rcf/a.test.js', first.name], ['AC-101-1', 'test/rcf/a.test.js', second.name]],
  });
  return { ...p, second: `test/rcf/a.test.js::${second.name}` };
}

test(`AC-19906-3: a budget kill in the unmutated run, two bound tests of about 4 s each under --mutant-timeout 6, exits 2 with one line naming "timed out", the budget, the flag, the test reached, the budget over all of a criterion's bound tests together and "no mutant was run", never "fails under runner"; under --mutant-timeout 30 the same pair of 0.2 s tests passes`, async (t) => {
  // Typical profile: the two tests fit the budget together.
  const typical = await budgetProject(t, 200);
  const ok = await strength(typical.dir, ['--acs', 'AC-101-1', '--mutant-timeout', '30']);
  assert.equal(ok.code, 0, `two short bound tests inside the budget: judged as usual, exit 0\n${show(ok)}`);
  assert.match(ok.stdout, new RegExp(`^test-strength: PASS 1 criteria at ${s7(typical.H)}: `), show(ok));

  // Heavy profile: each fits alone, the two together do not.
  const heavy = await budgetProject(t, 4000);
  const r = await strength(heavy.dir, ['--acs', 'AC-101-1', '--mutant-timeout', '6']);
  assert.equal(r.code, 2, `a budget kill in the unmutated run: exit 2 (AC-20502-5)\n${show(r)}`);
  assert.ok(!lines(r.stderr).some((l) => l.includes('fails under runner')), `no stderr line reads "fails under runner"\n${r.stderr}`);
  assert.ok(!lines(r.stdout).some((l) => /^test-strength: (PASS|FAIL|BLOCKED) /.test(l)), `no result line\n${show(r)}`);
  const words = ['timed out', '6 s', '--mutant-timeout', heavy.second, "all of a criterion's bound tests together", 'no mutant was run'];
  const line = lines(r.stderr).find((l) => l.includes('timed out'));
  assert.ok(line, `one stderr line holds "timed out"\n${r.stderr}`);
  for (const w of words) assert.ok(line.includes(w), `the timeout line holds ${q(w)}\n${line}`);
  assert.match(line, new RegExp(`(^|[^0-9.])6 s\\b`), `the budget reads "6 s"\n${line}`);
  assert.equal(lines(r.stderr).filter((l) => l.includes('timed out')).length, 1, `one timeout line\n${r.stderr}`);
});

test(`AC-19906-4: rcf audit test-strength --help and rcf help audit test-strength state in the --mutant-timeout option text that the budget covers all of a criterion's bound tests together in the unmutated run and in each mutant run, that exit 5 is a blocked criterion (an unreadable bound test or Code Node file, or bound tests that all skipped) and none fails, and that exit 2 covers a bound-test pointer that matches no test, or more than one`, async (t) => {
  // The option text: its own line and the continuation lines under it, up to the next option.
  const optionText = (help) => {
    const ls = lines(help);
    const at = ls.findIndex((l) => /^\s+--mutant-timeout <seconds>/.test(l));
    assert.ok(at >= 0, `the help lists --mutant-timeout <seconds>\n${help}`);
    const rest = ls.slice(at + 1);
    const end = rest.findIndex((l) => !/^\s{20,}\S/.test(l));
    return [ls[at], ...rest.slice(0, end < 0 ? rest.length : end)].map((l) => l.trim()).join(' ').replace(/\s+/g, ' ');
  };
  // The whole help with its line wrapping folded to single spaces: a phrase may cross a line.
  const folded = (help) => help.replace(/\s+/g, ' ');
  const dir = await project(t, { name: 'help' });
  for (const args of [['audit', 'test-strength', '--help'], ['help', 'audit', 'test-strength']]) {
    const r = await rcf(args, { cwd: dir });
    assert.equal(r.code, 0, `rcf ${args.join(' ')} exits 0\n${show(r)}`);
    const text = optionText(r.stdout);
    for (const w of ["all of a criterion's bound tests together", 'the unmutated run', 'each mutant run']) {
      assert.ok(text.includes(w), `rcf ${args.join(' ')}: the --mutant-timeout option text holds ${q(w)}\n${text}`);
    }
    const help = folded(r.stdout);
    for (const w of [
      'a criterion is blocked (an unreadable bound test or Code Node file, or bound tests that all skipped) and none fails',
      'a bound-test pointer that matches no test, or more than one',
    ]) {
      assert.ok(help.includes(w), `rcf ${args.join(' ')}: the help states the exit code sentence ${q(w)}\n${r.stdout}`);
    }
    assert.ok(!help.includes('one its runner did not run'), `rcf ${args.join(' ')}: the help no longer says "one its runner did not run"\n${r.stdout}`);
  }
});

test('AC-19906-5: AC-101-2 bound by a pointer that matches no test in its file, or matches two, beside AC-101-1 whose only bound test is skipped, still exits 2 under --record with nothing recorded and the not-run line naming that pointer, never the skipped test', async (t) => {
  const acs = ['AC-101-1', 'AC-101-2'];
  const skipPointer = `test/rcf/skip.test.js::${SKIPPED.name}`;
  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const shapes = [
    // A pointer naming a test that does not exist in its file.
    { shape: 'no match', tests: [GREETS], name: 'AC-101-2 is not in the file', tail: '' },
    // A pointer whose name matches two tests in its file.
    { shape: 'two matches', tests: [GREETS, GREETS], name: GREETS.name, tail: `: matches 2 tests in test/rcf/a.test.js: ${q(GREETS.name)}, ${q(GREETS.name)}` },
  ];
  for (const { shape, tests, name, tail } of shapes) {
    const { dir } = await strengthProject(t, {
      acs,
      files: { 'test/rcf/skip.test.js': testFile([SKIPPED]), 'test/rcf/a.test.js': testFile(tests) },
      nodes: [['src/greet.js#greet', acs]],
      // Bound order: the skipped criterion first, so the run must go on past it to the broken pointer.
      bind: [['AC-101-1', 'test/rcf/skip.test.js', SKIPPED.name], ['AC-101-2', 'test/rcf/a.test.js', name]],
    });
    const H = reviewed(dir, acs);
    const r = await strength(dir, ['--acs', acs.join(','), '--record']);
    assert.equal(r.code, 2, `${shape}: a broken bound-test pointer is a whole-run failure: exit 2 (AC-19901-10)\n${show(r)}`);
    const path = verdictPath(H, 'test-strength.json');
    assert.ok(!existsSync(`${dir}/${path}`), `${shape}: nothing is recorded: no ${path}\n${show(r)}`);
    assert.ok(!lines(r.stdout).some((l) => /^test-strength: (PASS|FAIL|BLOCKED) /.test(l)), `${shape}: no result line\n${show(r)}`);
    const pointer = `test/rcf/a.test.js::${name}`;
    const notRun = lines(r.stderr).filter((l) => l.includes('was not run by runner'));
    const line = new RegExp(`^test-strength: bound test ${esc(pointer)} was not run by runner (.+)${esc(tail)}$`);
    const hit = notRun.find((l) => line.test(l));
    assert.ok(hit, `${shape}: stderr reads "test-strength: bound test ${pointer} was not run by runner <argv>${tail}"\n${r.stderr}`);
    if (!tail) assert.ok(!hit.includes(': matches '), `${shape}: the line names no matched tests\n${hit}`);
    assert.ok(!notRun.some((l) => l.includes(skipPointer)), `${shape}: the skipped test ${skipPointer} is not named as not run\n${r.stderr}`);
  }
});
