// FBS-236 (US-19901, US-19902, US-19903): rcf audit test-strength, the
// structural check and the v1 mutation proof over the Code Node symbols
// of touched criteria, and its record for Finalise.
//
// Criteria: 21, all external. Every test is a node:test todo case
// ("FBS-236 round DEFINE", GR-35): it runs and is red until FBS-236's
// round DEFINE drops the marker and BUILD turns it green. Each drives
// bin/rcf.js audit test-strength as a child process over a fixture
// project made by the bin's own rcf init, committed to git, holding a
// small app (bin/app.js, src/), its own shared harness, rcf/
// test-strength.json, Code Node records and bound test cases. Every run
// that reaches the mutants passes PATH from toolPath(['node']) (the
// stage-keeper's ruling C2 on the independent check). Markers
// written by fixture modules on import show what ran. Verdict files are
// well-formed records keyed to their heads (GR-38); the timing test
// prints the host facts (GR-45). Imports: Node builtins and
// test/_harness/ only (GR-40).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { BIN, baseEnv, lines, rcf, toolPath } from '../_harness/spawn.js';
import { commit, git, gitTry, initRepo, s7, sha } from '../_harness/git.js';
import { bindTests, criterion, editFbs, editStory, project, readJson, readText, reviewVerdict, scratch, verdictPath, writeJson, writeText } from '../_harness/fixture.js';
import { hostFacts, json } from '../_harness/capture.js';

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
// A bound test file: imports, then tests [{ name, body }].
const testFile = (tests, { imports = [], top = [] } = {}) => L(
  "import { test } from 'node:test';",
  "import assert from 'node:assert';",
  "import { app } from '../_harness/run.js';",
  ...imports,
  ...top,
  ...tests.flatMap(({ name, body }) => [`test(${q(name)}, () => {`, ...body.map((b) => `  ${b}`), '});']),
);
const GREETS = { name: 'AC-101-1 greets', body: ["const r = app('ann');", 'assert.strictEqual(r.code, 0);', "assert.strictEqual(r.stdout, 'hello ann\\n');"] };
const BASE = {
  'bin/app.js': GREET_BIN,
  'src/greet.js': GREET,
  'src/x.js': 'export const x = 1;\n',
  'test/_harness/run.js': HARNESS,
  'test/rcf/a.test.js': testFile([GREETS]),
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
// at inProgress), `files` over BASE (null drops a file), rcf/
// test-strength.json (an object, a raw string, or null for none), Code
// Nodes [[path, acIds]] and bound tests [[acId, file, name]].
async function strengthProject(t, {
  acs = ['AC-101-1'], files = {}, config = CONFIG,
  nodes = [['src/greet.js#greet', ['AC-101-1']]],
  bind = [['AC-101-1', 'test/rcf/a.test.js', GREETS.name]],
} = {}) {
  const dir = await project(t, { name: 'strength' });
  editStory(dir, 'US-101', (us) => { us.acceptanceCriteria = acs.map((id) => criterion(id, `${id} holds for the fixture app`)); });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = acs; f.executionStatus = 'inProgress'; });
  for (const [rel, text] of Object.entries({ ...BASE, ...files })) if (text !== null) writeText(dir, rel, text);
  if (config !== null) writeText(dir, 'rcf/test-strength.json', typeof config === 'string' ? config : `${q(config, null, 2)}\n`);
  codeNodes(dir, nodes);
  bindTests(dir, bind.map(([acId, file, name]) => ({ acId, pointer: `${file}::${name}` })), { realTests: false });
  writeText(dir, '.gitignore', 'node_modules/\n');
  initRepo(dir);
  const H = commit(dir, 'fixture: base');
  return { dir, H };
}

const strength = (dir, args = [], env = {}) => rcf(['audit', 'test-strength', ...args], { cwd: dir, env, timeout: 600_000 });
// A run that reaches the mutants starts the bound test files under
// node --test, so it gets git's and node's directories on PATH, as the
// AC-20201-1 test does (the stage-keeper's ruling C2 on the independent
// check); a run that ends before any mutant keeps the harness PATH.
const nodeEnv = () => ({ PATH: toolPath(['node']) });
const out = (r) => r.stdout.replace(/\n$/, '');
const passLine = (h, n, k, total, timeout = 0, na = 0) => `test-strength: PASS ${n} criteria at ${s7(h)}: structural ${n}/${n}, mutants killed ${k}/${total} (timeout ${timeout}, notApplicable ${na})`;
const failLine = (h, k, n, items) => `test-strength: FAIL ${k} of ${n} criteria at ${s7(h)}: ${items.join('; ')}`;
const has = (r, item) => assert.ok(r.stdout.includes(item), `stdout names ${item}\n${r.stdout}${r.stderr}`);
const crit = (report, acId) => report.criteria.find((c) => c.acId === acId);
const markerSrc = (file) => `import { writeFileSync as __mark } from 'node:fs';\n__mark(${q(file)}, 'ran');\n`;
const statusPaths = (dir) => gitTry(dir, 'status', '--porcelain', '-uall').stdout.split('\n').filter(Boolean).map((l) => l.slice(3));
// A REVIEW: commit adding a MERGE/PASS review.json for the current HEAD.
function reviewed(dir, touchedAcIds = ['AC-101-1']) {
  const H = sha(dir);
  commit(dir, 'REVIEW: verdict', { [verdictPath(H, 'review.json')]: reviewVerdict(H, { touchedAcIds }) });
  return H;
}

// ---------------------------------------------------------------- US-19901

test('AC-19901-1: over a bin entry, a harness glob and AC-101-1 bound to a test importing only node:test, node:assert and test/_harness/run.js, with a symbol-level Code Node whose mutants all fail it, rcf audit test-strength --acs AC-101-1 exits 0 with the PASS line', async (t) => {
  const { dir, H } = await strengthProject(t);
  const r = await strength(dir, ['--acs', 'AC-101-1'], nodeEnv());
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.ok([passLine(H, 1, 3, 3), passLine(H, 1, 2, 2, 0, 1)].includes(out(r)), `stdout is the PASS line (3/3, or 2/2 with notApplicable 1)\n${r.stdout}`);
  // Totals (section 8.1): totals.mutants counts notApplicable; the PASS total excludes it.
  const { totals } = json((await strength(dir, ['--acs', 'AC-101-1', '--json'], nodeEnv())).stdout);
  assert.equal(totals.mutants, 3, 'three operators on one symbol');
  assert.equal(out(r), passLine(H, 1, totals.killed, totals.mutants - totals.notApplicable, totals.timeout, totals.notApplicable), 'the PASS total is mutants less notApplicable');
});

test('AC-19901-2: a bound test also importing src/store.js exits 4 with "test-strength: FAIL 1 of 1 criteria at <h7>: AC-101-1 imports src/store.js (not the app entry or the harness)"', async (t) => {
  const { dir, H } = await strengthProject(t, { files: { 'src/store.js': 'export const store = new Map();\n', 'test/rcf/a.test.js': testFile([GREETS], { imports: ["import '../../src/store.js';"] }) } });
  const r = await strength(dir, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.equal(out(r), failLine(H, 1, 1, ['AC-101-1 imports src/store.js (not the app entry or the harness)']));
});

test('AC-19901-3: mock.module("../../src/mailer.js") with edge ["node:https"] exits 4 with "AC-101-1 mocks ../../src/mailer.js (not a declared edge)"; mock.module("node:https") in the same test is not a finding', async (t) => {
  const mocking = { name: GREETS.name, body: ["mock.module('../../src/mailer.js', { namedExports: { send: () => {} } });", "mock.module('node:https', { namedExports: {} });", ...GREETS.body] };
  const { dir } = await strengthProject(t, {
    config: { ...CONFIG, edge: ['node:https'] },
    files: { 'src/mailer.js': 'export function send() {}\n', 'test/rcf/a.test.js': testFile([mocking], { imports: ["import { mock } from 'node:test';"] }) },
  });
  const r = await strength(dir, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  has(r, 'AC-101-1 mocks ../../src/mailer.js (not a declared edge)');
  assert.ok(!r.stdout.includes('mocks node:https'), `a declared edge is not a finding\n${r.stdout}`);
});

test('AC-19901-4: a Code Node src/notify.js#makeNotifier written makeNotifier({ sender = consoleSender } = {}) exits 4 with "AC-101-1 silent default sender in src/notify.js#makeNotifier"; a parameter named sender with no default is not a finding', async (t) => {
  const notify = (param) => L(
    'const consoleSender = { send: (m) => console.log(m) };',
    `export function makeNotifier(${param}) {`,
    '  return { notify: (m) => (sender ?? consoleSender).send(m) };',
    '}',
  );
  const silent = await strengthProject(t, { files: { 'src/notify.js': notify('{ sender = consoleSender } = {}') }, nodes: [['src/notify.js#makeNotifier', ['AC-101-1']]] });
  const r = await strength(silent.dir, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  has(r, 'AC-101-1 silent default sender in src/notify.js#makeNotifier');
  const plain = await strengthProject(t, { files: { 'src/notify.js': notify('{ sender } = {}') }, nodes: [['src/notify.js#makeNotifier', ['AC-101-1']]] });
  const p = await strength(plain.dir, ['--acs', 'AC-101-1'], nodeEnv());
  assert.ok(!p.stdout.includes('silent default'), `a parameter with no default is not a finding\n${p.stdout}${p.stderr}`);
});

test('AC-19901-5: no rcf/test-strength.json exits 2 with "test-strength: no rcf/test-strength.json; declare entry and harness"; no scope and no REVIEW verdict exits 2 with the no-scope line; --acs AC-999-1 exits 2 naming AC-999-1', async (t) => {
  const none = await strengthProject(t, { config: null });
  const a = await strength(none.dir, ['--acs', 'AC-101-1']);
  assert.equal(a.code, 2, `${a.stdout}${a.stderr}`);
  assert.ok(lines(a.stderr).includes('test-strength: no rcf/test-strength.json; declare entry and harness'), a.stderr);
  const { dir } = await strengthProject(t);
  const b = await strength(dir, []);
  assert.equal(b.code, 2, `${b.stdout}${b.stderr}`);
  assert.ok(lines(b.stderr).includes('test-strength: no scope; pass --acs or --fbs, or record a REVIEW verdict'), b.stderr);
  const c = await strength(dir, ['--acs', 'AC-999-1']);
  assert.equal(c.code, 2, `${c.stdout}${c.stderr}`);
  assert.match(c.stderr, /AC-999-1/, 'stderr names AC-999-1');
});

test('AC-19901-6: the structural check never executes a test, the entry or a product module: a bound test that throws on import still yields its import finding, reported with no mutant run', async (t) => {
  const marks = scratch(t, 'rcf-h-marks-');
  const m = { test: join(marks, 'test'), entry: join(marks, 'entry'), store: join(marks, 'store') };
  const { dir, H } = await strengthProject(t, {
    files: {
      'bin/app.js': markerSrc(m.entry) + GREET_BIN,
      'src/store.js': `${markerSrc(m.store)}export const store = new Map();\n`,
      'test/rcf/a.test.js': testFile([GREETS], {
        imports: ["import '../../src/store.js';", "import { writeFileSync } from 'node:fs';"],
        top: [`writeFileSync(${q(m.test)}, 'ran');`, "throw new Error('this test file throws on import');"],
      }),
    },
  });
  const r = await strength(dir, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.equal(out(r), failLine(H, 1, 1, ['AC-101-1 imports src/store.js (not the app entry or the harness)']));
  for (const [what, file] of Object.entries(m)) assert.equal(existsSync(file), false, `the ${what} never ran`);
  const j = await strength(dir, ['--acs', 'AC-101-1', '--json']);
  const report = json(j.stdout);
  assert.deepEqual(crit(report, 'AC-101-1').mutants, [], 'no mutant is run');
  assert.equal(report.totals.mutants, 0);
});

test('AC-19901-7: with --acs AC-101-1,AC-101-2 where AC-101-1 imports src/store.js and AC-101-2 passes, the structural check runs for both, mutants for AC-101-2 only, exit 4 names the imports finding, and --json lists mutants for AC-101-2 and none for AC-101-1', async (t) => {
  const second = { name: 'AC-101-2 greets', body: GREETS.body };
  const { dir } = await strengthProject(t, {
    acs: ['AC-101-1', 'AC-101-2'],
    files: {
      'src/store.js': 'export const store = new Map();\n',
      'test/rcf/a.test.js': testFile([GREETS], { imports: ["import '../../src/store.js';"] }),
      'test/rcf/b.test.js': testFile([second]),
    },
    nodes: [['src/greet.js#greet', ['AC-101-1', 'AC-101-2']]],
    bind: [['AC-101-1', 'test/rcf/a.test.js', GREETS.name], ['AC-101-2', 'test/rcf/b.test.js', second.name]],
  });
  const r = await strength(dir, ['--acs', 'AC-101-1,AC-101-2'], nodeEnv());
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  has(r, 'AC-101-1 imports src/store.js (not the app entry or the harness)');
  const report = json((await strength(dir, ['--acs', 'AC-101-1,AC-101-2', '--json'], nodeEnv())).stdout);
  assert.equal(crit(report, 'AC-101-1').structural.result, 'fail');
  assert.equal(crit(report, 'AC-101-2').structural.result, 'pass');
  assert.deepEqual(crit(report, 'AC-101-1').mutants, [], 'no mutant for AC-101-1');
  assert.ok(crit(report, 'AC-101-2').mutants.length > 0, 'mutants for AC-101-2');
});

// AC-19901-9 succeeds the retired AC-19901-8 (round D, RC-46; the
// stage-keeper's retire-and-succeed ruling): a file the audit cannot read
// is BLOCKED per criterion (stage-keeper ruling Q2 (a)), never a
// whole-run exit 2.
test('AC-19901-9: a bound test file test/rcf/a.test.py, or a symbol-level Code Node on src/x.py, makes AC-101-1 BLOCKED (result "blocked", reason "TEST_STRENGTH_UNSUPPORTED", detail naming the file) while AC-101-2 is still judged, exit 5; a malformed runners entry exits 2; .js, .mjs and .cjs files are read', async (t) => {
  const PY_TEST = 'def test_greets():\n    assert True\n';
  const blocked = (report, file) => {
    const c = crit(report, 'AC-101-1');
    assert.equal(c.result, 'blocked', JSON.stringify(c));
    assert.equal(c.reason, 'TEST_STRENGTH_UNSUPPORTED', JSON.stringify(c));
    // Ruling Q6: the detail is <file>:<line>:<col>: <construct> (one unreadable file here).
    const esc = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(c.detail, new RegExp(`^${esc}:\\d+:\\d+: \\S.*$`), `detail is "<file>:<line>:<col>: <construct>" for ${file}\n${JSON.stringify(c)}`);
    assert.equal(crit(report, 'AC-101-2').result, 'pass', `the run continues for AC-101-2\n${JSON.stringify(report)}`);
  };
  const acs = ['AC-101-1', 'AC-101-2'];
  const pyTest = await strengthProject(t, {
    acs,
    files: { 'test/rcf/a.test.py': PY_TEST },
    nodes: [['src/greet.js#greet', acs]],
    bind: [['AC-101-1', 'test/rcf/a.test.py', 'test_greets'], ['AC-101-2', 'test/rcf/a.test.js', GREETS.name]],
  });
  const a = await strength(pyTest.dir, ['--acs', 'AC-101-1,AC-101-2', '--json'], nodeEnv());
  assert.equal(a.code, 5, `a blocked criterion beside a passing one: exit 5\n${a.stdout}${a.stderr}`);
  assert.doesNotMatch(a.stderr, /not a supported source/);
  blocked(json(a.stdout), 'test/rcf/a.test.py');

  const pyNode = await strengthProject(t, {
    acs,
    files: { 'src/x.py': 'def run():\n    return 1\n' },
    nodes: [['src/x.py#run', ['AC-101-1']], ['src/greet.js#greet', acs]],
    bind: [['AC-101-1', 'test/rcf/a.test.js', GREETS.name], ['AC-101-2', 'test/rcf/a.test.js', GREETS.name]],
  });
  const b = await strength(pyNode.dir, ['--acs', 'AC-101-1,AC-101-2', '--json'], nodeEnv());
  assert.equal(b.code, 5, `a blocked criterion beside a passing one: exit 5\n${b.stdout}${b.stderr}`);
  assert.doesNotMatch(b.stderr, /not a supported source/);
  blocked(json(b.stdout), 'src/x.py');

  // The stage-keeper's ruling 1 on the DEFINE's questions: a blocked and a
  // failing criterion together, the fail verdict and its exit code win and
  // the FAIL line still counts and lists the blocked criterion.
  const mixed = await strengthProject(t, {
    acs,
    files: { 'test/rcf/a.test.py': PY_TEST, 'src/store.js': 'export const store = new Map();\n', 'test/rcf/a.test.js': testFile([GREETS], { imports: ["import '../../src/store.js';"] }) },
    nodes: [['src/greet.js#greet', acs]],
    bind: [['AC-101-1', 'test/rcf/a.test.py', 'test_greets'], ['AC-101-2', 'test/rcf/a.test.js', GREETS.name]],
  });
  const f = await strength(mixed.dir, ['--acs', 'AC-101-1,AC-101-2'], nodeEnv());
  assert.equal(f.code, 4, `a failing criterion beside a blocked one: the fail exit 4\n${f.stdout}${f.stderr}`);
  assert.doesNotMatch(f.stderr, /not a supported source/);
  // The stage-keeper's ruling Q2 on the pre-freeze gate's questions: the exact
  // FAIL line, its blocked tail ", blocked <m>: <id> (<file>)"; <n> the criteria in scope (ruling F7).
  const failBlocked = new RegExp(`^test-strength: FAIL 1 of 2 criteria at ${s7(mixed.H)}: AC-101-2 imports src/store\\.js \\(not the app entry or the harness\\), blocked 1: AC-101-1 \\(test/rcf/a\\.test\\.py\\)$`);
  assert.ok(lines(f.stdout).some((l) => failBlocked.test(l)), `the FAIL line names AC-101-2's finding and ends ", blocked 1: AC-101-1 (test/rcf/a.test.py)"\n${f.stdout}${f.stderr}`);

  // The audit's own inputs unreadable stay a whole-run exit 2.
  const badRunner = await strengthProject(t, { config: { ...CONFIG, runners: [{ files: ['test/**'], kind: 'jest' }] } });
  const m = await strength(badRunner.dir, ['--acs', 'AC-101-1'], nodeEnv());
  assert.equal(m.code, 2, `a runners entry of no known kind: exit 2\n${m.stdout}${m.stderr}`);
  assert.ok(lines(m.stderr).some((l) => l.startsWith('test-strength: malformed rcf/test-strength.json')), m.stderr);

  const mjs = await strengthProject(t, {
    files: {
      'src/greet.mjs': GREET,
      'src/legacy.cjs': L('function triple(o) {', '  o.push(3);', '  return o;', '}', 'module.exports = { triple };'),
      'bin/app.js': L("import { createRequire } from 'node:module';", "import { greet } from '../src/greet.mjs';", "const { triple } = createRequire(import.meta.url)('../src/legacy.cjs');", "process.stdout.write(greet(process.argv[2] ?? 'world', []) + ' ' + triple([]).join('') + '\\n');"),
      'test/rcf/a.test.mjs': testFile([{ name: GREETS.name, body: ["const r = app('ann');", 'assert.strictEqual(r.code, 0);', "assert.strictEqual(r.stdout, 'hello ann 3\\n');"] }]),
    },
    nodes: [['src/greet.mjs#greet', ['AC-101-1']], ['src/legacy.cjs#triple', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/rcf/a.test.mjs', GREETS.name]],
  });
  const c = await strength(mjs.dir, ['--acs', 'AC-101-1'], nodeEnv());
  assert.notEqual(c.code, 2, `.mjs and .cjs sources are read\n${c.stdout}${c.stderr}`);
  assert.doesNotMatch(c.stderr, /not a supported source/);

  // The stage-keeper's ruling F5 on the whole-plan pass's findings: a .jsx file
  // is read through the JSX scanner, never blocked for being JSX (by shape, as the .mjs run).
  const jsx = await strengthProject(t, {
    files: { 'src/label.jsx': L('export function label(n) {', '  return <b>{n}</b>;', '}') },
    nodes: [['src/greet.js#greet', ['AC-101-1']], ['src/label.jsx#label', ['AC-101-1']]],
  });
  const x = await strength(jsx.dir, ['--acs', 'AC-101-1', '--json'], nodeEnv());
  assert.notEqual(x.code, 2, `a .jsx Code Node is read\n${x.stdout}${x.stderr}`);
  assert.doesNotMatch(x.stderr, /not a supported source/);
  assert.notEqual(crit(json(x.stdout), 'AC-101-1').result, 'blocked', `a .jsx file is never blocked for being JSX\n${x.stdout}`);

  // The stage-keeper's rulings F7 and F12 on the whole-plan pass's findings: two
  // blocked criteria, one blocked by two files, beside a passing one. The scope
  // is passed in descending order, so the ascending order on the line is the audit's.
  const many = await strengthProject(t, {
    acs: ['AC-101-1', 'AC-101-2', 'AC-101-3'],
    files: { 'test/rcf/a.test.py': PY_TEST, 'test/rcf/b.test.py': PY_TEST, 'test/rcf/c.test.py': PY_TEST },
    nodes: [['src/greet.js#greet', ['AC-101-1', 'AC-101-2', 'AC-101-3']]],
    bind: [['AC-101-1', 'test/rcf/a.test.py', 'test_greets'], ['AC-101-1', 'test/rcf/c.test.py', 'test_greets'], ['AC-101-2', 'test/rcf/b.test.py', 'test_greets'], ['AC-101-3', 'test/rcf/a.test.js', GREETS.name]],
  });
  const scope = ['--acs', 'AC-101-3,AC-101-2,AC-101-1'];
  const g = await strength(many.dir, scope, nodeEnv());
  assert.equal(g.code, 5, `two blocked criteria beside a passing one: exit 5\n${g.stdout}${g.stderr}`);
  const rep = json((await strength(many.dir, [...scope, '--json'], nodeEnv())).stdout);
  assert.equal(rep.result, 'blocked', JSON.stringify(rep));
  assert.equal(rep.totals.criteria, 3, `totals.criteria counts the blocked criteria\n${JSON.stringify(rep.totals)}`);
  assert.equal(rep.totals.blocked, 2, JSON.stringify(rep.totals));
  assert.equal(rep.totals.structuralPassed, 1, JSON.stringify(rep.totals));
  for (const id of ['AC-101-1', 'AC-101-2']) {
    const e = crit(rep, id);
    assert.equal(e.result, 'blocked', JSON.stringify(e));
    assert.equal(e.blocked, true, JSON.stringify(e));
    assert.deepEqual(e.mutants, [], JSON.stringify(e));
    assert.deepEqual(e.structural, { checked: false }, JSON.stringify(e));
  }
  assert.match(crit(rep, 'AC-101-1').detail, /^test\/rcf\/a\.test\.py:\d+:\d+: [^;]+; test\/rcf\/c\.test\.py:\d+:\d+: [^;]+$/, `each file's first construct in bound order, joined by "; "\n${JSON.stringify(crit(rep, 'AC-101-1'))}`);
  assert.equal(crit(rep, 'AC-101-3').result, 'pass', JSON.stringify(rep));
  const { killed, timeout, mutants, notApplicable } = rep.totals;
  const twoFiles = '(?:test/rcf/a\\.test\\.py and test/rcf/c\\.test\\.py|test/rcf/c\\.test\\.py and test/rcf/a\\.test\\.py)';
  const manyLine = new RegExp(`^test-strength: BLOCKED 3 criteria at ${s7(many.H)}: structural 1/1, mutants killed ${killed + timeout}/${mutants - notApplicable} \\(timeout ${timeout}, notApplicable ${notApplicable}, blocked 2\\): AC-101-1 \\(${twoFiles}\\), AC-101-2 \\(test/rcf/b\\.test\\.py\\)$`);
  assert.ok(lines(g.stdout).some((l) => manyLine.test(l)), `the BLOCKED line: ids ascending, ", " between ids, " and " between one id's files, the F7 counts\n${g.stdout}${g.stderr}`);
});

// ---------------------------------------------------------------- US-19902

const AUDIT = L('export function writeAudit(log) {', "  log.push('audited');", '}');
const AUDIT_BIN = L("import { writeAudit } from '../src/audit.js';", 'writeAudit([]);', "process.stdout.write('done\\n');");
const EXITS = { name: 'AC-101-1 exits 0', body: ['assert.strictEqual(app().code, 0);'] };
const vacuous = (t, extra = {}) => strengthProject(t, {
  files: { 'src/audit.js': AUDIT, 'bin/app.js': AUDIT_BIN, 'test/rcf/a.test.js': testFile([EXITS]) },
  nodes: [['src/audit.js#writeAudit', ['AC-101-1']]], bind: [['AC-101-1', 'test/rcf/a.test.js', EXITS.name]], ...extra,
});

test('AC-19902-1: a bound test asserting only that the CLI exits 0 over src/audit.js#writeAudit, called once per run and never asserted, exits 4 with "AC-101-1 vacuous: noOp on src/audit.js#writeAudit survived 1 bound tests" and the same for callRemoval, and --json lists those mutants survived', async (t) => {
  const { dir } = await vacuous(t);
  const r = await strength(dir, ['--acs', 'AC-101-1'], nodeEnv());
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  for (const op of ['noOp', 'callRemoval']) has(r, `AC-101-1 vacuous: ${op} on src/audit.js#writeAudit survived 1 bound tests`);
  const report = json((await strength(dir, ['--acs', 'AC-101-1', '--json'], nodeEnv())).stdout);
  const ms = crit(report, 'AC-101-1').mutants;
  for (const op of ['noOp', 'callRemoval']) {
    assert.equal(ms.find((x) => x.operator === op && x.symbol === 'src/audit.js#writeAudit')?.result, 'survived', `${op} survived`);
  }
});

test('AC-19902-2: AC-101-2 with no Code Node, AC-101-3 with only a file-level Code Node src/x.js and AC-101-4 with no bound test exit 4 with "AC-101-2 no Code Node", "AC-101-3 no symbol-level Code Node" and "AC-101-4 unbound"', async (t) => {
  const n = (id) => ({ name: `${id} greets`, body: GREETS.body });
  const { dir } = await strengthProject(t, {
    acs: ['AC-101-1', 'AC-101-2', 'AC-101-3', 'AC-101-4'],
    files: { 'test/rcf/a.test.js': testFile([GREETS, n('AC-101-2'), n('AC-101-3')]) },
    nodes: [['src/greet.js#greet', ['AC-101-1', 'AC-101-4']], ['src/x.js', ['AC-101-3']]],
    bind: [['AC-101-1', 'test/rcf/a.test.js', GREETS.name], ['AC-101-2', 'test/rcf/a.test.js', 'AC-101-2 greets'], ['AC-101-3', 'test/rcf/a.test.js', 'AC-101-3 greets']],
  });
  const r = await strength(dir, ['--acs', 'AC-101-2,AC-101-3,AC-101-4']);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  for (const item of ['AC-101-2 no Code Node', 'AC-101-3 no symbol-level Code Node', 'AC-101-4 unbound']) has(r, item);
});

test('AC-19902-3: a no-op mutant that hangs its bound test past --mutant-timeout 5 is recorded "timeout" and counted as killed, and a symbol with no statement-level call site records callRemoval "notApplicable" while the criterion passes', async (t) => {
  const { dir, H } = await strengthProject(t, {
    files: {
      'src/wait.js': L('export function ready() {', '  return true;', '}'),
      'bin/app.js': L("import { ready } from '../src/wait.js';", 'while (!ready()) { /* wait */ }', "process.stdout.write('ready\\n');"),
      'test/rcf/a.test.js': testFile([{ name: 'AC-101-1 is ready', body: ["assert.strictEqual(app().stdout, 'ready\\n');"] }]),
    },
    nodes: [['src/wait.js#ready', ['AC-101-1']]], bind: [['AC-101-1', 'test/rcf/a.test.js', 'AC-101-1 is ready']],
  });
  const r = await strength(dir, ['--acs', 'AC-101-1', '--mutant-timeout', '5'], nodeEnv());
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(out(r), passLine(H, 1, 2, 2, 1, 1));
  const report = json((await strength(dir, ['--acs', 'AC-101-1', '--mutant-timeout', '5', '--json'], nodeEnv())).stdout);
  const by = Object.fromEntries(crit(report, 'AC-101-1').mutants.map((x) => [x.operator, x.result]));
  assert.deepEqual(by, { stubToThrow: 'killed', noOp: 'timeout', callRemoval: 'notApplicable' });
});

test('AC-19902-4: with no --acs the scope is the touched AC-101-1 of the REVIEW verdict only: mutants touch only its symbols, git status and the hash of every tracked file are unchanged, and git worktree list shows only the main worktree', async (t) => {
  const other = { name: 'AC-101-2 greets', body: GREETS.body };
  const { dir } = await strengthProject(t, {
    acs: ['AC-101-1', 'AC-101-2'],
    files: { 'src/other.js': L('export function other(o) {', "  o.push('other');", '  return o;', '}'), 'test/rcf/a.test.js': testFile([GREETS, other]) },
    nodes: [['src/greet.js#greet', ['AC-101-1']], ['src/other.js#other', ['AC-101-2']]],
    bind: [['AC-101-1', 'test/rcf/a.test.js', GREETS.name], ['AC-101-2', 'test/rcf/a.test.js', other.name]],
  });
  reviewed(dir, ['AC-101-1']);
  const hashes = () => Object.fromEntries(git(dir, 'ls-files').split('\n').map((p) => [p, createHash('sha256').update(readFileSync(join(dir, p))).digest('hex')]));
  const before = { status: gitTry(dir, 'status', '--porcelain').stdout, hashes: hashes() };
  const r = await strength(dir, ['--json'], nodeEnv());
  assert.ok([0, 4].includes(r.code), `${r.stdout}${r.stderr}`);
  const report = json(r.stdout);
  assert.deepEqual(report.criteria.map((c) => c.acId), ['AC-101-1']);
  assert.deepEqual([...new Set(report.criteria.flatMap((c) => c.mutants.map((x) => x.symbol)))], ['src/greet.js#greet'], 'mutants only on the touched criterion\'s symbols');
  assert.equal(gitTry(dir, 'status', '--porcelain').stdout, before.status, 'git status is unchanged');
  assert.deepEqual(hashes(), before.hashes, 'every tracked file is unchanged');
  const worktrees = git(dir, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree '));
  assert.equal(worktrees.length, 1, `only the main worktree is registered\n${worktrees.join('\n')}`);
});

test('AC-19902-5: a scope of 240 mutants exits 2 before running any test with "test-strength: 240 mutants exceed --max-mutants 200; narrow the scope"; with --max-mutants 300 it runs', async (t) => {
  const marks = scratch(t, 'rcf-h-marks-');
  const ran = join(marks, 'test');
  const fns = Array.from({ length: 80 }, (_, i) => L(`export function f${i}(o) {`, `  o.push(${i});`, '  return o;', '}')).join('');
  const { dir } = await strengthProject(t, {
    files: { 'src/many.js': fns, 'test/rcf/a.test.js': testFile([GREETS], { imports: ["import { writeFileSync } from 'node:fs';"], top: [`writeFileSync(${q(ran)}, 'ran');`] }) },
    nodes: Array.from({ length: 80 }, (_, i) => [`src/many.js#f${i}`, ['AC-101-1']]),
  });
  const r = await strength(dir, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 2, `${r.stdout}${r.stderr}`);
  assert.ok(lines(r.stderr).includes('test-strength: 240 mutants exceed --max-mutants 200; narrow the scope'), r.stderr);
  assert.equal(existsSync(ran), false, 'no test ran');
  const more = await strength(dir, ['--acs', 'AC-101-1', '--max-mutants', '300', '--json'], nodeEnv());
  assert.notEqual(more.code, 2, `${more.stdout.slice(0, 500)}${more.stderr}`);
  assert.equal(json(more.stdout).totals.mutants, 240);
});

test('AC-19902-6: a round touching 8 criteria with 2 symbol-level Code Nodes each (48 mutants) and bound files of about 2 seconds finishes with --jobs 4 within 5 minutes, runs only those 8 files, and the json totals report mutants 48 and wallMs', async (t) => {
  hostFacts(t);
  const marks = scratch(t, 'rcf-h-marks-');
  const log = join(marks, 'ran.log');
  const files = {
    'bin/app.js': L(...Array.from({ length: 8 }, (_, i) => `import * as c${i + 1} from '../src/c${i + 1}.js';`), 'const m = { c1, c2, c3, c4, c5, c6, c7, c8 }[`c${process.argv[2]}`];', "process.stdout.write(m.first([]) + m.second([]) + '\\n');"),
    'test/rcf/other.test.js': testFile([{ name: 'not bound', body: ['assert.ok(true);'] }], { imports: ["import { appendFileSync } from 'node:fs';"], top: [`appendFileSync(${q(log)}, 'other\\n');`] }),
  };
  const nodes = [];
  const bind = [];
  const acs = [];
  for (let k = 1; k <= 8; k++) {
    const ac = `AC-101-${k}`;
    acs.push(ac);
    files[`src/c${k}.js`] = L('export function first(o) {', "  o.push('f');", "  return o.join('');", '}', 'export function second(o) {', "  o.push('s');", "  return o.join('');", '}');
    files[`test/rcf/c${k}.test.js`] = testFile([{ name: `${ac} runs`, body: ['await new Promise((r) => setTimeout(r, 1800));', `const r = app('${k}');`, "assert.strictEqual(r.stdout, 'fs\\n');"] }], { imports: ["import { appendFileSync } from 'node:fs';"], top: [`appendFileSync(${q(log)}, 'c${k}\\n');`] })
      .replace(`test(${q(`${ac} runs`)}, () => {`, `test(${q(`${ac} runs`)}, async () => {`);
    nodes.push([`src/c${k}.js#first`, [ac]], [`src/c${k}.js#second`, [ac]]);
    bind.push([ac, `test/rcf/c${k}.test.js`, `${ac} runs`]);
  }
  const { dir } = await strengthProject(t, { acs, files, nodes, bind });
  const r = await strength(dir, ['--acs', acs.join(','), '--jobs', '4', '--json'], nodeEnv());
  assert.ok([0, 4].includes(r.code), `${r.stdout.slice(0, 800)}${r.stderr}`);
  assert.ok(r.ms <= 300_000, `finishes within 5 minutes (took ${Math.round(r.ms / 1000)} s)`);
  const report = json(r.stdout);
  assert.equal(report.totals.mutants, 48);
  assert.equal(typeof report.wallMs, 'number');
  const ran = existsSync(log) ? new Set(readFileSync(log, 'utf8').split('\n').filter(Boolean)) : new Set();
  assert.ok(!ran.has('other'), 'the unbound test file never ran (never the whole suite)');
  assert.deepEqual([...ran].sort(), acs.map((_, i) => `c${i + 1}`).sort(), 'only the 8 bound files ran');
});

test('AC-19902-7: a class symbol expands to its methods (three operators each), a function-valued initialiser is mutated like a function, and a numeric constant, an object literal and a re-export fail "no mutable symbol <path#symbol>"', async (t) => {
  const { dir } = await strengthProject(t, {
    files: {
      'src/a.js': L(
        'export class Store {',
        '  add(items, x) {',
        '    items.push(x);',
        '    return items.length;',
        '  }',
        '  list(items) {',
        '    return items.slice();',
        '  }',
        '}',
        'export const LIMIT = 10;',
        'export const api = { version: 1 };',
        "export const f = (o) => { o.push('f'); return o; };",
      ),
      'src/run.js': L('export function run(o) {', "  o.push('run');", '  return o;', '}'),
      'src/index.js': "export { run } from './run.js';\n",
      'bin/app.js': L("import { Store, f } from '../src/a.js';", "import { run } from '../src/index.js';", 'const s = new Store();', 'const items = [];', "s.add(items, 'a');", "process.stdout.write(`${s.list(items).join('')} ${f([]).join('')} ${run([]).join('')}\\n`);"),
      'test/rcf/a.test.js': testFile([{ name: GREETS.name, body: ["assert.strictEqual(app().stdout, 'a f run\\n');"] }]),
    },
    nodes: ['src/a.js#Store', 'src/a.js#LIMIT', 'src/a.js#api', 'src/index.js#run', 'src/a.js#f'].map((p) => [p, ['AC-101-1']]),
  });
  const r = await strength(dir, ['--acs', 'AC-101-1'], nodeEnv());
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  for (const p of ['src/a.js#LIMIT', 'src/a.js#api', 'src/index.js#run']) has(r, `AC-101-1 no mutable symbol ${p}`);
  const ms = crit(json((await strength(dir, ['--acs', 'AC-101-1', '--json'], nodeEnv())).stdout), 'AC-101-1').mutants;
  const store = ms.filter((x) => x.symbol.startsWith('src/a.js#Store'));
  assert.equal(store.length, 6, 'three operators on each of the two methods');
  for (const op of ['stubToThrow', 'noOp', 'callRemoval']) assert.equal(store.filter((x) => x.operator === op).length, 2, `${op} once per method`);
  assert.deepEqual(ms.filter((x) => x.symbol === 'src/a.js#f').map((x) => x.operator).sort(), ['callRemoval', 'noOp', 'stubToThrow'], 'the arrow function is mutated like a function');
});

test('AC-19902-8: a file-level Code Node docs/x.md is blanked in the scratch worktree (fileBlank): a bound test reading it goes red, giving the PASS line with killed 1/1; a bound test that never reads it exits 4 "AC-101-5 vacuous: fileBlank on docs/x.md survived 1 bound tests"', async (t) => {
  const reads = { name: 'AC-101-5 reads the doc', body: ["assert.ok(readFileSync(new URL('../../docs/x.md', import.meta.url), 'utf8').split('\\n').includes('x'));"] };
  const ignores = { name: 'AC-101-5 reads the doc', body: ['assert.strictEqual(1 + 1, 2);'] };
  for (const [label, body, code] of [['reads', reads, 0], ['ignores', ignores, 4]]) {
    const { dir, H } = await strengthProject(t, {
      acs: ['AC-101-5'],
      files: { 'docs/x.md': 'x\n', 'test/rcf/a.test.js': testFile([body], { imports: ["import { readFileSync } from 'node:fs';"] }) },
      nodes: [['docs/x.md', ['AC-101-5']]], bind: [['AC-101-5', 'test/rcf/a.test.js', body.name]],
    });
    const r = await strength(dir, ['--acs', 'AC-101-5'], nodeEnv());
    assert.equal(r.code, code, `${label}\n${r.stdout}${r.stderr}`);
    if (code === 0) {
      assert.equal(out(r), passLine(H, 1, 1, 1));
      const ms = crit(json((await strength(dir, ['--acs', 'AC-101-5', '--json'], nodeEnv())).stdout), 'AC-101-5').mutants;
      assert.deepEqual(ms.map((x) => ({ symbol: x.symbol, operator: x.operator, result: x.result })), [{ symbol: 'docs/x.md', operator: 'fileBlank', result: 'killed' }]);
      assert.equal(readText(dir, 'docs/x.md'), 'x\n', 'the working tree copy is untouched');
    } else {
      assert.equal(out(r), failLine(H, 1, 1, ['AC-101-5 vacuous: fileBlank on docs/x.md survived 1 bound tests']));
    }
  }
});

// RC-45 (the stage-keeper): a bound test red before any mutant would kill
// every mutant, a false PASS, so the bound tests run once unmutated first.
const unmutatedRed = (pointer, runner) => `test-strength: the unmutated run is red for AC-101-1: ${pointer} fails under runner ${runner.join(' ')}; no mutant was run`;
const runsIn = (log) => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0);
const noResultLine = (r) => assert.ok(!lines(r.stdout).some((l) => /^test-strength: (PASS|FAIL) /.test(l)), `neither the PASS line nor a FAIL line\n${r.stdout}${r.stderr}`);

test('AC-19902-9: a declared runner that fails on every bound test makes rcf audit test-strength --acs AC-101-1 exit 2 naming the runner and the bound test, with no mutant run and neither the PASS line nor a FAIL line', async (t) => {
  const log = join(scratch(t, 'rcf-h-marks-'), 'runner.log');
  const runner = ['node', 'tools/runner.mjs', log, '<file>'];
  const { dir } = await strengthProject(t, {
    config: { ...CONFIG, runner },
    files: { 'tools/runner.mjs': L("import { appendFileSync } from 'node:fs';", "appendFileSync(process.argv[2], 'ran\\n');", 'process.exit(3);') },
  });
  const r = await strength(dir, ['--acs', 'AC-101-1'], nodeEnv());
  assert.equal(r.code, 2, `the unmutated run is red: exit 2\n${r.stdout}${r.stderr}`);
  assert.ok(lines(r.stderr).includes(unmutatedRed(`test/rcf/a.test.js::${GREETS.name}`, runner)), `stderr names the runner and the bound test\n${r.stderr}`);
  noResultLine(r);
  assert.equal(runsIn(log), 1, 'the runner ran once, unmutated, and no mutant ran');
});

test('AC-19902-9: a bound test red unmutated for want of an environment variable the runner does not set makes rcf audit test-strength --acs AC-101-1 exit 2 naming the default runner and the bound test, with no mutant run and neither result line', async (t) => {
  const log = join(scratch(t, 'rcf-h-marks-'), 'test.log');
  const needsEnv = { name: GREETS.name, body: [`appendFileSync(${q(log)}, 'ran\\n');`, "assert.strictEqual(process.env.FIXTURE_NEEDED, 'yes');", ...GREETS.body] };
  const { dir } = await strengthProject(t, {
    files: { 'test/rcf/a.test.js': testFile([needsEnv], { imports: ["import { appendFileSync } from 'node:fs';"] }) },
  });
  const r = await strength(dir, ['--acs', 'AC-101-1'], nodeEnv());
  assert.equal(r.code, 2, `the unmutated run is red: exit 2\n${r.stdout}${r.stderr}`);
  // The stage-keeper's ruling 3 on the DEFINE's questions: the nodeTest
  // default argv carries the TAP reporter; its exact form is matched by shape.
  const red = lines(r.stderr).map((l) => l.match(/^test-strength: the unmutated run is red for AC-101-1: (.+) fails under runner (.+); no mutant was run$/)).find((m) => m && m[1] === `test/rcf/a.test.js::${GREETS.name}`);
  assert.ok(red, `stderr names the default runner and the bound test\n${r.stderr}`);
  const argv = red[2].split(' ');
  for (const word of ['node', '--test', '--test-name-pattern', '<name>', '<file>']) assert.ok(argv.includes(word), `the default runner carries ${word}\n${red[0]}`);
  assert.ok(argv.includes('--test-reporter=tap') || argv.some((w, i) => w === '--test-reporter' && argv[i + 1] === 'tap'), `the default runner carries the TAP reporter\n${red[0]}`);
  noResultLine(r);
  assert.equal(runsIn(log), 1, 'the bound test ran once, unmutated, and no mutant ran');
});

// ---------------------------------------------------------------- US-19903

const REPORT_KEYS = ['version', 'head', 'scope', 'criteria', 'result', 'totals', 'wallMs', 'node'];
const TOTAL_KEYS = ['criteria', 'structuralPassed', 'mutants', 'killed', 'survived', 'timeout', 'notApplicable', 'blocked'];

test('AC-19903-1: at a REVIEW: commit for H touching AC-101-1, a passing --record exits 0 and writes rcf/verdicts/<H12>/test-strength.json as TestStrengthReport v1 (head H, scope reviewVerdict, criteria [AC-101-1]); a FAIL run with --record writes the report too and exits 4', async (t) => {
  const passing = await strengthProject(t);
  const H = reviewed(passing.dir);
  const r = await strength(passing.dir, ['--record'], nodeEnv());
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const rep = readJson(passing.dir, verdictPath(H, 'test-strength.json'));
  assert.deepEqual(Object.keys(rep).sort(), [...REPORT_KEYS].sort());
  assert.equal(rep.version, 1);
  assert.equal(rep.head, H);
  assert.equal(rep.scope, 'reviewVerdict');
  assert.deepEqual(rep.criteria.map((c) => c.acId), ['AC-101-1']);
  assert.equal(rep.result, 'pass');
  assert.deepEqual(Object.keys(rep.totals).sort(), [...TOTAL_KEYS].sort());
  // The stage-keeper's ruling Q1 on the pre-freeze gate's questions: totals.blocked is present on every report, 0 when none.
  assert.equal(rep.totals.blocked, 0, `totals.blocked is 0 when no criterion is blocked\n${JSON.stringify(rep.totals)}`);
  assert.equal(typeof rep.wallMs, 'number');
  assert.equal(rep.node, process.version);

  const failing = await vacuous(t);
  const F = reviewed(failing.dir);
  const f = await strength(failing.dir, ['--record'], nodeEnv());
  assert.equal(f.code, 4, `${f.stdout}${f.stderr}`);
  assert.equal(readJson(failing.dir, verdictPath(F, 'test-strength.json')).result, 'fail');
});

test('AC-19903-2: --record refuses a dirty tree (exit 4) and a BUILD: change to src/x.js after H (exit 4), needs a REVIEW verdict reachable from HEAD (exit 2, with or without --acs or --fbs), writes no file when refused, and accepts a FINALISE: commit inside FINALISE classes after H', async (t) => {
  const noReport = (dir) => statusPaths(dir).filter((p) => p.endsWith('test-strength.json'));
  {
    const { dir } = await strengthProject(t);
    reviewed(dir);
    writeText(dir, 'src/x.js', 'export const x = 2;\n');
    const r = await strength(dir, ['--record']);
    assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
    assert.ok(lines(r.stderr).includes('test-strength: refused: working tree is dirty; a record names a committed head'), r.stderr);
    assert.deepEqual(noReport(dir), []);
  }
  {
    const { dir } = await strengthProject(t);
    const H = reviewed(dir);
    commit(dir, 'BUILD: change x', { 'src/x.js': 'export const x = 3;\n' });
    const r = await strength(dir, ['--record']);
    assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
    assert.ok(lines(r.stderr).includes(`test-strength: refused: HEAD differs from the reviewed head ${s7(H)} outside rcf/verdicts/, rcf/verify-reports/ and FINALISE classes`), r.stderr);
    assert.deepEqual(noReport(dir), []);
  }
  {
    const { dir } = await strengthProject(t);
    for (const args of [['--record'], ['--record', '--acs', 'AC-101-1'], ['--record', '--fbs', 'FBS-001']]) {
      const r = await strength(dir, args);
      assert.equal(r.code, 2, `${args.join(' ')}\n${r.stdout}${r.stderr}`);
      assert.ok(lines(r.stderr).includes('test-strength: --record needs a REVIEW verdict reachable from HEAD'), `${args.join(' ')}\n${r.stderr}`);
    }
    assert.deepEqual(noReport(dir), []);
  }
  {
    const { dir } = await strengthProject(t);
    const H = reviewed(dir);
    editFbs(dir, 'FBS-001', (f) => { f.executionStatus = 'complete'; });
    commit(dir, 'FINALISE: status');
    const r = await strength(dir, ['--record'], nodeEnv());
    assert.equal(r.code, 0, `a FINALISE: commit inside its classes does not refuse\n${r.stdout}${r.stderr}`);
    assert.ok(existsSync(join(dir, verdictPath(H, 'test-strength.json'))));
  }
});

test('AC-19903-3: a Worker-style app (entry worker src/index.js, harness test/harness/**, edge undici) passes the structural check through test/harness/worker.js; a bound test importing src/routes/pay.js fails with "imports src/routes/pay.js (not the app entry or the harness)"', async (t) => {
  const config = { entry: [{ kind: 'worker', path: 'src/index.js' }], harness: ['test/harness/**'], edge: ['undici'] };
  const worker = {
    'bin/app.js': null,
    'test/_harness/run.js': null,
    'src/routes/pay.js': L('export async function pay(env) {', "  const res = await env.OUT.fetch('https://pay.example/charge');", '  return res.text();', '}'),
    'src/index.js': L("import { pay } from './routes/pay.js';", 'export default {', '  async fetch(request, env) {', '    return new Response(await pay(env));', '  },', '};'),
    'test/harness/worker.js': L("import worker from '../../src/index.js';", 'export async function call(path) {', "  const env = { OUT: { fetch: async () => new Response('paid') } };", '  const res = await worker.fetch(new Request(`https://app.example${path}`), env);', '  return res.text();', '}'),
  };
  const viaHarness = L("import { test } from 'node:test';", "import assert from 'node:assert';", "import { call } from '../harness/worker.js';", "test('AC-101-1 pays', async () => {", "  assert.strictEqual(await call('/pay'), 'paid');", '});');
  const direct = L("import { test } from 'node:test';", "import assert from 'node:assert';", "import { pay } from '../../src/routes/pay.js';", "test('AC-101-1 pays', async () => {", "  assert.strictEqual(await pay({ OUT: { fetch: async () => new Response('paid') } }), 'paid');", '});');
  const common = { config, nodes: [['src/routes/pay.js#pay', ['AC-101-1']]], bind: [['AC-101-1', 'test/rcf/a.test.js', 'AC-101-1 pays']] };
  const good = await strengthProject(t, { ...common, files: { ...worker, 'test/rcf/a.test.js': viaHarness } });
  const r = await strength(good.dir, ['--acs', 'AC-101-1', '--json'], nodeEnv());
  assert.notEqual(r.code, 2, `${r.stdout}${r.stderr}`);
  assert.equal(crit(json(r.stdout), 'AC-101-1').structural.result, 'pass', 'the structural check passes');
  const bad = await strengthProject(t, { ...common, files: { ...worker, 'test/rcf/a.test.js': direct } });
  const b = await strength(bad.dir, ['--acs', 'AC-101-1']);
  assert.equal(b.code, 4, `${b.stdout}${b.stderr}`);
  has(b, 'AC-101-1 imports src/routes/pay.js (not the app entry or the harness)');
});

test('AC-19903-4: a library (entry module src/index.js) passes the structural check for a test importing the package by its own name or ../src/index.js, and fails it with the imports finding for ../src/internal.js', async (t) => {
  const lib = {
    'bin/app.js': null,
    'test/_harness/run.js': null,
    'test/rcf/a.test.js': null,
    'package.json': `${q({ name: 'fixture-lib', version: '1.0.0', type: 'module', private: true, exports: { '.': './src/index.js' } }, null, 2)}\n`,
    'src/internal.js': L('export function double(n) {', '  return n * 2;', '}'),
    'src/index.js': L("import { double } from './internal.js';", 'export function quadruple(n) {', '  return double(double(n));', '}'),
  };
  const testOf = (spec, name = 'quadruple') => L("import { test } from 'node:test';", "import assert from 'node:assert';", `import { ${name} } from ${q(spec)};`, "test('AC-101-1 computes', () => {", `  assert.strictEqual(${name}(1), ${name === 'quadruple' ? 4 : 2});`, '});');
  const make = (spec, name) => strengthProject(t, {
    config: { entry: [{ kind: 'module', path: 'src/index.js' }], harness: ['test/harness/**'] },
    files: { ...lib, 'test/lib.test.js': testOf(spec, name) },
    nodes: [['src/index.js#quadruple', ['AC-101-1']]], bind: [['AC-101-1', 'test/lib.test.js', 'AC-101-1 computes']],
  });
  for (const spec of ['fixture-lib', '../src/index.js']) {
    const { dir } = await make(spec);
    const r = await strength(dir, ['--acs', 'AC-101-1', '--json'], nodeEnv());
    assert.notEqual(r.code, 2, `${spec}\n${r.stdout}${r.stderr}`);
    assert.equal(crit(json(r.stdout), 'AC-101-1').structural.result, 'pass', `${spec} is the entry`);
  }
  const { dir } = await make('../src/internal.js', 'double');
  const r = await strength(dir, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  has(r, 'AC-101-1 imports src/internal.js (not the app entry or the harness)');
});

test('AC-19903-5: rcf audit test-strength never deploys, opens no network connection of its own and writes nothing outside rcf/verdicts/<H12>/, with or without --record; a malformed rcf/test-strength.json exits 2 naming the field and runs no test', async (t) => {
  const marks = scratch(t, 'rcf-h-marks-');
  const deployed = join(marks, 'deployed');
  const netLog = join(marks, 'net.log');
  const ran = join(marks, 'test');
  const preload = join(marks, 'net-log.mjs');
  writeText(marks, 'net-log.mjs', L(
    "import net from 'node:net';",
    "import { appendFileSync } from 'node:fs';",
    'const connect = net.Socket.prototype.connect;',
    'net.Socket.prototype.connect = function (...args) {',
    `  appendFileSync(${q(netLog)}, JSON.stringify(args[0] ?? null) + '\\n');`,
    '  return connect.apply(this, args);',
    '};',
  ));
  const env = { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` };
  const pkg = `${q({ name: 'fixture-app', version: '1.0.0', type: 'module', private: true, scripts: { deploy: 'node deploy.js' } }, null, 2)}\n`;
  const deploy = L("import { writeFileSync } from 'node:fs';", `writeFileSync(${q(deployed)}, 'deployed');`);
  const { dir, H } = await strengthProject(t, { files: { 'package.json': pkg, 'deploy.js': deploy } });
  const plain = await strength(dir, ['--acs', 'AC-101-1'], { ...env, ...nodeEnv() });
  assert.equal(plain.code, 0, `${plain.stdout}${plain.stderr}`);
  assert.deepEqual(statusPaths(dir), [], 'without --record nothing is written');
  reviewed(dir);
  const rec = await strength(dir, ['--record'], { ...env, ...nodeEnv() });
  assert.equal(rec.code, 0, `${rec.stdout}${rec.stderr}`);
  assert.deepEqual(statusPaths(dir), [verdictPath(H, 'test-strength.json')], 'with --record only the record is written');
  assert.equal(existsSync(deployed), false, 'nothing is deployed');
  assert.equal(existsSync(netLog) ? readFileSync(netLog, 'utf8') : '', '', 'no network connection is opened');

  const marked = testFile([GREETS], { imports: ["import { writeFileSync } from 'node:fs';"], top: [`writeFileSync(${q(ran)}, 'ran');`] });
  for (const [config, field] of [['{ not json\n', 'rcf/test-strength.json'], [{ entry: [{ kind: 'lambda', path: 'bin/app.js' }], harness: ['test/_harness/**'] }, 'kind'], [{ entry: [{ kind: 'bin', path: 'bin/app.js' }], harness: [] }, 'harness']]) {
    const bad = await strengthProject(t, { config, files: { 'test/rcf/a.test.js': marked } });
    const r = await strength(bad.dir, ['--acs', 'AC-101-1']);
    assert.equal(r.code, 2, `${field}\n${r.stdout}${r.stderr}`);
    assert.ok(r.stderr.includes(field), `stderr names ${field}\n${r.stderr}`);
    assert.equal(existsSync(ran), false, `${field}: no test ran`);
  }
});

// ------------------------------------------- round D fix DEFINE (F-2, F-3, F-5)
// The review verdict at 1bee2f8c (FINDINGS/FINDINGS) and the stage-keeper's
// rulings on it: AC-19901-9's position past line 1 and its unreadable entry.

// F-2 (the reviewer's own, test locus) and F-3 (ruled D3): the detail
// places the first unreadable construct where it is, never at 1:1.
test('AC-19901-9: the detail places the first unreadable construct of a symbol-level .ts Code Node at its own line and column past line 1: invalid TypeScript syntax on line 3, and a parameter property the strip view refuses on line 3, exit 5', async (t) => {
  const acs = ['AC-101-1', 'AC-101-2'];
  const { dir } = await strengthProject(t, {
    acs,
    files: {
      // "  const b = ;": the expression node expects sits at column 13 of line 3.
      'src/a.ts': L('export function run(n: number): number {', '  const a = n;', '  const b = ;', '  return a;', '}'),
      // "  constructor(override y: number) { super(); }": the parameter property spans columns 15 to 32 of line 3.
      'src/b.ts': L('class Base {}', 'export class C extends Base {', '  constructor(override y: number) { super(); }', '}', 'export function run(n: number): number {', '  return n;', '}'),
    },
    nodes: [['src/a.ts#run', ['AC-101-1']], ['src/b.ts#run', ['AC-101-2']]],
    bind: [['AC-101-1', 'test/rcf/a.test.js', GREETS.name], ['AC-101-2', 'test/rcf/a.test.js', GREETS.name]],
  });
  const r = await strength(dir, ['--acs', 'AC-101-1,AC-101-2', '--json'], nodeEnv());
  const report = json(r.stdout);
  const detail = (acId) => {
    const c = crit(report, acId);
    assert.equal(c?.result, 'blocked', `${acId} is BLOCKED\n${r.stdout}${r.stderr}`);
    assert.equal(c.reason, 'TEST_STRENGTH_UNSUPPORTED', q(c));
    return c.detail;
  };
  const a = detail('AC-101-1');
  assert.match(a, /^src\/a\.ts:3:13: \S.*$/, `the first unreadable construct of src/a.ts is at 3:13, where node places the syntax error\n${a}`);
  const b = detail('AC-101-2');
  const m = /^src\/b\.ts:(\d+):(\d+): non-erasable TypeScript syntax \(.+\)$/.exec(b);
  assert.ok(m, `detail is "<file>:<line>:<col>: non-erasable TypeScript syntax (<construct>)"\n${b}`);
  assert.equal(Number(m[1]), 3, `the refused parameter property sits on line 3\n${b}`);
  assert.ok(Number(m[2]) >= 15 && Number(m[2]) <= 32, `the column lies in the refused parameter property, columns 15 to 32\n${b}`);
  assert.equal(r.code, 5, `blocked criteria only: exit 5\n${r.stdout}${r.stderr}`);
});

// F-2: an entry point the strip view cannot parse is the audit's own input unreadable.
test('AC-19901-9: an entry point the strip view cannot parse (rcf/test-strength.json entry src/index.ts holding an enum on line 2) exits 2 with a stderr line starting "test-strength: entry point unreadable" and the detail', async (t) => {
  const { dir } = await strengthProject(t, {
    config: { entry: [{ kind: 'module', path: 'src/index.ts' }], harness: ['test/_harness/**'] },
    files: { 'src/index.ts': L('export const one = 1;', 'export enum Mode { A }') },
  });
  const r = await strength(dir, ['--acs', 'AC-101-1'], nodeEnv());
  const line = lines(r.stderr).find((l) => l.startsWith('test-strength: entry point unreadable'));
  assert.ok(line, `stderr carries "test-strength: entry point unreadable"\n${r.stdout}${r.stderr}`);
  assert.match(line, /^test-strength: entry point unreadable: src\/index\.ts:2:\d+: non-erasable TypeScript syntax \([^)]*enum[^)]*\)$/, `the line carries the detail "<file>:<line>:<col>: non-erasable TypeScript syntax (<construct>)"\n${line}`);
  assert.equal(r.code, 2, `the audit's own input unreadable: exit 2\n${r.stdout}${r.stderr}`);
});

// F-2 and F-5 (ruled D4): an entry point of an extension the views cannot read.
test('AC-19901-9: an entry point of an extension the views cannot read (rcf/test-strength.json entry bin/app.py) exits 2 with a stderr line starting "test-strength: entry point unreadable" and the detail naming the file', async (t) => {
  const { dir } = await strengthProject(t, {
    config: { entry: [{ kind: 'bin', path: 'bin/app.py' }], harness: ['test/_harness/**'] },
    files: { 'bin/app.py': 'print("hello")\n' },
  });
  const r = await strength(dir, ['--acs', 'AC-101-1'], nodeEnv());
  const line = lines(r.stderr).find((l) => l.startsWith('test-strength: entry point unreadable'));
  assert.ok(line, `stderr carries "test-strength: entry point unreadable" for the .py entry\n${r.stdout}${r.stderr}`);
  assert.match(line, /^test-strength: entry point unreadable: bin\/app\.py:\d+:\d+: \S.*$/, `the line carries the detail "<file>:<line>:<col>: <construct>"\n${line}`);
  assert.equal(r.code, 2, `the audit's own input unreadable: exit 2\n${r.stdout}${r.stderr}`);
});

// ------------------------------------------- round D fix round 2 (R-1)
// The re-review verdict at 150ab8ea (FINDINGS/FINDINGS): R-1, its F-1, the
// first round's F-3 not closed where node's diagnostic carries a line and
// no caret line under it (an unclosed brace). Rewritten in the redesign
// DEFINE to its successor (the stage-keeper's ruling 3 on the design
// review): when the input ends inside a construct, the detail places it
// where the innermost construct still open opens.
test('AC-19901-9: an entry point the strip view cannot parse whose input ends inside a construct (src/index.ts with the brace of if (a) { left open) exits 2 with "test-strength: entry point unreadable" and a detail at the innermost brace still open at the end of input, 3:10, never 1:1 or the end of the file', async (t) => {
  const { dir } = await strengthProject(t, {
    config: { entry: [{ kind: 'module', path: 'src/index.ts' }], harness: ['test/_harness/**'] },
    files: { 'src/index.ts': L('export function run(n: number): number {', '  const a = n;', '  if (a) {', '    return a;') },
  });
  const r = await strength(dir, ['--acs', 'AC-101-1'], nodeEnv());
  const line = lines(r.stderr).find((l) => l.startsWith('test-strength: entry point unreadable: '));
  assert.ok(line, `stderr carries "test-strength: entry point unreadable: "\n${r.stdout}${r.stderr}`);
  const m = /^test-strength: entry point unreadable: src\/index\.ts:(\d+):(\d+): invalid TypeScript syntax \(.+\)$/.exec(line);
  assert.ok(m, `the line carries the detail "<file>:<line>:<col>: invalid TypeScript syntax (...)"\n${line}`);
  // "  if (a) {": the brace still open at the end of input is column 10 of line 3.
  assert.equal(`${m[1]}:${m[2]}`, '3:10', `the detail places the innermost brace still open at the end of input, 3:10\n${line}`);
  assert.equal(r.code, 2, `the audit's own input unreadable: exit 2\n${r.stdout}${r.stderr}`);
});

// ------------------------------------------- round D redesign (W's F-1, positions)
// The second re-review verdict at 09e409f8 (FINDINGS/PASS): W's F-1, the
// repeat-bug watch on position mapping, and its notes F-3 (the column
// unit) and F-4 (the column at the end of input), after the stage-keeper's
// design review and rulings 1 and 3: <line> counts CRLF, a lone CR and LF;
// <col> counts UTF-16 code units; at the end of input, where the innermost
// construct still open opens. Each case holds one symbol-level .ts Code
// Node file the strip view refuses, so the criterion is BLOCKED and its
// detail is read.
async function blockedDetailOf(t, text, file = 'src/a.ts') {
  const { dir } = await strengthProject(t, { files: { [file]: text }, nodes: [[`${file}#run`, ['AC-101-1']]] });
  const r = await strength(dir, ['--acs', 'AC-101-1', '--json'], nodeEnv());
  const c = crit(json(r.stdout), 'AC-101-1');
  assert.equal(c?.result, 'blocked', `AC-101-1 is BLOCKED\n${r.stdout}${r.stderr}`);
  assert.equal(c.reason, 'TEST_STRENGTH_UNSUPPORTED', q(c));
  assert.equal(r.code, 5, `blocked criteria only: exit 5\n${r.stdout}${r.stderr}`);
  return c.detail;
}
const placedAt = (detail, at, why) => assert.ok(detail.startsWith(`${at}: `) && /^\S+:\d+:\d+: \S/.test(detail), `${why}: the detail starts "${at}: "\n${detail}`);

// P-R2: U+2705 (node prints it two columns wide) is one UTF-16 unit.
test('AC-19901-9: a syntax error after a character node prints two columns wide is placed at its column: src/a.ts holding a string literal of U+2705 then const b = ;, the gap at 1:33, exit 5', async (t) => {
  const detail = await blockedDetailOf(t, "export const s = '✅'; const b = ;\n");
  placedAt(detail, 'src/a.ts:1:33', 'the expression node expects, after U+2705 counted one UTF-16 unit, sits at 1:33');
});

// P-R3: a combining mark (node prints it with no width) counts one unit.
test('AC-19901-9: a syntax error after a combining mark is placed at its column: src/a.ts holding a string literal of U+0E01 U+0E31 then const b = ;, the gap at 1:34, exit 5', async (t) => {
  const detail = await blockedDetailOf(t, "export const s = 'กั'; const b = ;\n");
  placedAt(detail, 'src/a.ts:1:34', 'the combining mark U+0E31 counts one unit, so the gap sits at 1:34');
});

// P-R4: a lone CR is a line break.
test('AC-19901-9: a file whose lines end in a lone CR places the error on its line and column: src/a.ts of three CR-ended lines, the gap of the tab-indented const b = ; at 3:12, exit 5', async (t) => {
  const detail = await blockedDetailOf(t, 'export const a = 1;\rexport const c = 2;\r\tconst b = ;\r');
  placedAt(detail, 'src/a.ts:3:12', 'a lone CR ends a line and the tab counts one unit, so the gap sits at 3:12');
});

// P-R5: one test, three inputs, one assertion each.
test('AC-19901-9: a byte order mark, a form feed and a vertical tab count one column each: the gap of const b = ; at 1:19 after a byte order mark, 1:31 after a form feed and 1:31 after a vertical tab, exit 5', async (t) => {
  placedAt(await blockedDetailOf(t, '﻿export const b = ;\n'), 'src/a.ts:1:19', 'a byte order mark counts one unit');
  placedAt(await blockedDetailOf(t, 'export const a = 1;\fconst b = ;\n'), 'src/a.ts:1:31', 'a form feed counts one unit and is no line break');
  placedAt(await blockedDetailOf(t, 'export const a = 1;\vconst b = ;\n'), 'src/a.ts:1:31', 'a vertical tab counts one unit and is no line break');
});

// P-R7: the end of input inside a template literal.
test('AC-19901-9: an unterminated template literal is placed where it opens: src/a.ts whose line 2 opens a template literal never closed, 2:18, exit 5', async (t) => {
  const detail = await blockedDetailOf(t, 'export const a = 1;\nexport const t = `abc ${a}\nmore\n');
  placedAt(detail, 'src/a.ts:2:18', 'the template literal still open at the end of input opens at 2:18');
});

// P-R8: the end of input inside a block comment.
test('AC-19901-9: an unterminated block comment is placed where it opens: src/a.ts whose line 2 opens a block comment never closed, 2:1, exit 5', async (t) => {
  const detail = await blockedDetailOf(t, 'export const a = 1;\n/* open\nmore\n');
  placedAt(detail, 'src/a.ts:2:1', 'the block comment still open at the end of input opens at 2:1');
});

// ------------------------------------------- round D redesign (F-10, F-14)
// The first verdict's F-10 (a signal leaves the scratch and no runner
// group is killed) and F-14 (a scratch that cannot be removed is labelled
// a worktree), joined to this round by the stage-keeper's ruling 10. The
// audit makes its scratch under its own TMPDIR (runner.js mkdtemp of
// tmpdir()), so each case gives the audit a TMPDIR of its own to read.

// Restore write permission under dir, so the case's scratch can be removed.
function writable(dir) {
  if (!existsSync(dir)) return;
  chmodSync(dir, 0o755);
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) writable(join(dir, e.name));
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn, ms) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 100)); return fn(); };

test('AC-19903-7: on SIGINT or SIGTERM while a bound test runs, rcf audit test-strength kills the process group of the bound test run, removes its scratch directory with its working copies, leaves no entry in .git/worktrees of the project and exits 130 for SIGINT and 143 for SIGTERM', async (t) => {
  for (const [signal, want] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    const side = scratch(t, 'rcf-h-sig-');
    const tmp = join(side, 'tmp');
    mkdirSync(tmp);
    const pidFile = join(side, 'pid');
    // The bound test writes its pid, then waits: the signal lands while it runs.
    const waiting = testFile([GREETS], { imports: ["import { writeFileSync } from 'node:fs';"], top: [`writeFileSync(${q(pidFile)}, String(process.pid));`, 'await new Promise((r) => setTimeout(r, 60_000));'] });
    const { dir } = await strengthProject(t, { files: { 'test/rcf/a.test.js': waiting } });
    const child = spawn(process.execPath, [BIN, 'audit', 'test-strength', '--acs', 'AC-101-1'], { cwd: dir, env: baseEnv({ ...nodeEnv(), TMPDIR: tmp }), stdio: 'ignore' });
    const exited = new Promise((res) => child.on('exit', (code, sig) => res({ code, sig })));
    let pid = 0;
    t.after(() => { if (pid && alive(pid)) process.kill(pid, 'SIGKILL'); });
    try {
      assert.ok(await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '', 120_000), `${signal}: the bound test started`);
      pid = Number(readFileSync(pidFile, 'utf8'));
      assert.notDeepEqual(readdirSync(tmp), [], `${signal}: while the run is on, the audit's scratch sits in its TMPDIR`);
      child.kill(signal);
      const { code, sig } = await exited;
      assert.equal(code, want, `${signal}: exit ${want} (got code ${code}, signal ${sig})`);
      assert.deepEqual(readdirSync(tmp), [], `${signal}: the audit's scratch directory, its working copies within it, is removed`);
      const worktrees = join(dir, '.git', 'worktrees');
      assert.deepEqual(existsSync(worktrees) ? readdirSync(worktrees) : [], [], `${signal}: no entry is left in the project's .git/worktrees`);
      assert.equal(await until(() => !alive(pid), 10_000), true, `${signal}: the bound test run's process (pid ${pid}) is killed with its group`);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
      writable(tmp);
    }
  }
});

test('AC-19903-5: a scratch directory that cannot be removed is named in one stderr line "[warn] test-strength: scratch directory <dir> could not be removed" (a bound test leaving a directory it made read-only in its TMPDIR, the scratch of the audit)', async (t) => {
  const side = scratch(t, 'rcf-h-locked-');
  const tmp = join(side, 'tmp');
  mkdirSync(tmp);
  // The bound test's TMPDIR is the audit's scratch: it leaves a directory there whose entries cannot be removed.
  const locking = testFile([GREETS], {
    imports: ["import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';", "import { tmpdir } from 'node:os';", "import { join } from 'node:path';"],
    top: ["mkdirSync(join(tmpdir(), 'locked', 'in'), { recursive: true });", "writeFileSync(join(tmpdir(), 'locked', 'in', 'f.txt'), 'x');", "chmodSync(join(tmpdir(), 'locked'), 0o555);"],
  });
  const { dir } = await strengthProject(t, { files: { 'test/rcf/a.test.js': locking } });
  try {
    const r = await strength(dir, ['--acs', 'AC-101-1'], { ...nodeEnv(), TMPDIR: tmp });
    const warns = lines(r.stderr).filter((l) => l.startsWith('[warn] test-strength: scratch'));
    assert.ok(warns.length > 0, `a scratch directory that cannot be removed is named on stderr\n${r.stdout}${r.stderr}`);
    for (const w of warns) {
      const m = /^\[warn\] test-strength: scratch directory (.+) could not be removed$/.exec(w);
      assert.ok(m, `the line reads "[warn] test-strength: scratch directory <dir> could not be removed"\n${w}`);
      assert.ok(existsSync(m[1]) && m[1].startsWith(tmp), `the line names the audit's scratch directory, left in its TMPDIR\n${w}`);
    }
    assert.equal(new Set(warns).size, warns.length, `each scratch directory is named in one line\n${r.stderr}`);
  } finally {
    writable(tmp);
  }
});

// ------------------------------------------- round D fix round 3 (re-Review 3's F-1 and F-2, positions)
// The re-Review 3 verdict at 5a880f2f (FINDINGS/FINDINGS) and the
// stage-keeper's rulings on it: node is the oracle. Where node's strip-mode
// error carries a caret, the detail places the refusal at node's line and
// the caret's column; where it names a line and no column (the input ends
// with nothing open), at that line, column 1 (F-2's sentence in
// AC-19901-9). Each input is written as escapes, and each position is the
// one node v24.14.0 gives for it. Each case reads the detail of a
// symbol-level .ts Code Node file on line 1, then on line 2 after an LF
// line and after a CRLF line, and the same detail through the entry point
// src/intervals.ts ("entry point unreadable", exit 2).
async function entryDetailOf(t, text, file = 'src/intervals.ts') {
  const { dir } = await strengthProject(t, { config: { entry: [{ kind: 'module', path: file }], harness: ['test/_harness/**'] }, files: { [file]: text } });
  const r = await strength(dir, ['--acs', 'AC-101-1'], nodeEnv());
  const line = lines(r.stderr).find((l) => l.startsWith('test-strength: entry point unreadable: '));
  assert.ok(line, `stderr carries "test-strength: entry point unreadable: "\n${r.stdout}${r.stderr}`);
  assert.equal(r.code, 2, `the audit's own input unreadable: exit 2\n${r.stdout}${r.stderr}`);
  return line.slice('test-strength: entry point unreadable: '.length);
}
const syntaxAt = (detail, at, why) => assert.ok(detail.startsWith(`${at}: invalid TypeScript syntax (`), `${why}: the detail starts "${at}: invalid TypeScript syntax ("\n${detail}`);
async function placedWhereNodePlaces(t, text, col, why) {
  syntaxAt(await blockedDetailOf(t, text), `src/a.ts:1:${col}`, why);
  syntaxAt(await blockedDetailOf(t, `export const z = 0;\n${text}\n`), `src/a.ts:2:${col}`, `${why}, on line 2 after an LF line`);
  syntaxAt(await blockedDetailOf(t, `export const z = 0;\r\n${text}\r\n`), `src/a.ts:2:${col}`, `${why}, on line 2 after a CRLF line`);
  syntaxAt(await entryDetailOf(t, text), `src/intervals.ts:1:${col}`, `${why}, in the entry point`);
}

// F-1 (A-POS-6a): node refuses U+0301 as a token start, its caret at index 17.
test('AC-19901-9: a combining mark starting a token is placed where node places its refusal: src/a.ts holding export const a = U+0301; at 1:18 (2:18 after an LF or a CRLF line), and the entry point src/intervals.ts at 1:18, exit 5 and exit 2', async (t) => {
  await placedWhereNodePlaces(t, 'export const a = \u0301;', 18, 'node places the unexpected U+0301 at column 18');
});

// F-1 (A-POS-6b): a lone U+200D, node's caret at index 20.
test('AC-19901-9: a lone zero width joiner is placed where node places its refusal: src/a.ts holding export const a = 1; U+200D const b = 2; at 1:21 (2:21 after an LF or a CRLF line), and the entry point src/intervals.ts at 1:21, exit 5 and exit 2', async (t) => {
  await placedWhereNodePlaces(t, 'export const a = 1; \u200d const b = 2;', 21, 'node places the unexpected U+200D at column 21');
});

// F-1 (A-POS-6c): U+0663 starting a token, node's caret at index 17.
test('AC-19901-9: an Arabic-Indic digit starting a token is placed where node places its refusal: src/a.ts holding export const a = U+0663; at 1:18 (2:18 after an LF or a CRLF line), and the entry point src/intervals.ts at 1:18, exit 5 and exit 2', async (t) => {
  await placedWhereNodePlaces(t, 'export const a = \u0663;', 18, 'node places the unexpected U+0663 at column 18');
});

// F-1 (A-POS-6h): node's message quotes the non-ASCII label, its caret at index 3.
test('AC-19901-9: a refusal whose message quotes a non-ASCII identifier is placed where node places it: src/a.ts holding U+00FC: U+00FC: while (true) break; (the label declared twice) at 1:4 (2:4 after an LF or a CRLF line), and the entry point src/intervals.ts at 1:4, exit 5 and exit 2', async (t) => {
  await placedWhereNodePlaces(t, '\u00fc: \u00fc: while (true) break;', 4, 'node places the second label U+00FC at column 4');
});

// F-2 (A-POS-6f), a declared guard: node names line 2 and no column.
test('AC-19901-9: when node names a line and no column, the input ending after an operator with nothing open, the refusal is placed at that line, column 1: src/a.ts ending in export const b = on line 2 at 2:1 (with CRLF line ends too, and on line 3 at 3:1), and the entry point src/intervals.ts at 2:1, exit 5 and exit 2', async (t) => {
  syntaxAt(await blockedDetailOf(t, 'export const a = 1;\nexport const b =\n'), 'src/a.ts:2:1', 'node names line 2 and no column');
  syntaxAt(await blockedDetailOf(t, 'export const a = 1;\r\nexport const b =\r\n'), 'src/a.ts:2:1', 'node names line 2 and no column, CRLF line ends');
  syntaxAt(await blockedDetailOf(t, 'export const z = 0;\nexport const a = 1;\nexport const b =\n'), 'src/a.ts:3:1', 'node names line 3 and no column');
  syntaxAt(await entryDetailOf(t, 'export const a = 1;\nexport const b =\n'), 'src/intervals.ts:2:1', 'node names line 2 and no column, in the entry point');
});

// F-2 (A-POS-6g), a declared guard: node names line 1 and no column.
test('AC-19901-9: when node names a line and no column, the input ending after an operator with no line break, the refusal is placed at that line, column 1: src/a.ts holding export const a = 1 + at 1:1, and on line 2 at 2:1, exit 5', async (t) => {
  syntaxAt(await blockedDetailOf(t, 'export const a = 1 +'), 'src/a.ts:1:1', 'node names line 1 and no column');
  syntaxAt(await blockedDetailOf(t, 'export const z = 0;\nexport const a = 1 +'), 'src/a.ts:2:1', 'node names line 2 and no column');
});

// ------------------------------------------- round D fix round 3 (re-Review 3's F-5 and F-7)
// F-7, the re-Review 3 verdict's F-7, and F-7's sentence in AC-19903-5: on
// an error exit (here the mutant run failing on a mutated file it cannot
// restore, the "cannot run the bound tests" path) the audit still runs the
// backstop and the warn line, and names the scratch it leaves.
test('AC-19903-5: on an error exit the audit still runs the backstop and the warn line: a bound test writing escape.txt in the project, leaving a read-only directory in its scratch and making src/greet.js of its working copy read-only, so the mutant run cannot restore it, exits 2 with "test-strength: a bound test run wrote <path> in the project" naming escape.txt and a "[warn] test-strength: scratch directory <dir> could not be removed" line for each scratch left', async (t) => {
  const side = scratch(t, 'rcf-h-errexit-');
  const tmp = join(side, 'tmp');
  mkdirSync(tmp);
  const { dir } = await strengthProject(t);
  const escaped = join(dir, 'escape.txt');
  const failing = testFile([GREETS], {
    imports: ["import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';", "import { tmpdir } from 'node:os';", "import { join } from 'node:path';"],
    top: [
      `writeFileSync(${q(escaped)}, 'e');`,
      "mkdirSync(join(tmpdir(), 'locked', 'in'), { recursive: true });",
      "writeFileSync(join(tmpdir(), 'locked', 'in', 'f.txt'), 'x');",
      "chmodSync(join(tmpdir(), 'locked'), 0o555);",
      "chmodSync('src/greet.js', 0o444);",
    ],
  });
  commit(dir, 'fixture: a bound test the mutant run cannot recover from', { 'test/rcf/a.test.js': failing });
  try {
    const r = await strength(dir, ['--acs', 'AC-101-1'], { ...nodeEnv(), TMPDIR: tmp });
    assert.equal(r.code, 2, `an error exit: exit 2\n${r.stdout}${r.stderr}`);
    const wrote = lines(r.stderr).map((l) => /^test-strength: a bound test run wrote (.+) in the project$/.exec(l)).find(Boolean);
    assert.ok(wrote, `the backstop runs on the error exit: stderr carries "test-strength: a bound test run wrote <path> in the project"\n${r.stdout}${r.stderr}`);
    assert.ok(wrote[1].endsWith('escape.txt'), `the line names escape.txt\n${wrote[0]}`);
    const named = lines(r.stderr).filter((l) => l.startsWith('[warn] test-strength: scratch')).map((w) => {
      const m = /^\[warn\] test-strength: scratch directory (.+) could not be removed$/.exec(w);
      assert.ok(m, `the line reads "[warn] test-strength: scratch directory <dir> could not be removed"\n${w}`);
      return m[1];
    });
    const left = readdirSync(tmp).map((e) => join(tmp, e)).sort();
    assert.notDeepEqual(left, [], `the bound test leaves the audit's scratch in its TMPDIR\n${r.stderr}`);
    assert.deepEqual([...named].sort(), left, `the error exit names each scratch directory left in its TMPDIR, each in one line\n${r.stdout}${r.stderr}`);
    // F-7 (a), the re-Review 4 verdict's F-7: the cannot-run line names the scratch path the run used.
    const cannot = lines(r.stderr).filter((l) => l.startsWith('test-strength: cannot run the bound tests'));
    assert.equal(cannot.length, 1, `one stderr line starts "test-strength: cannot run the bound tests"\n${r.stdout}${r.stderr}`);
    assert.ok(named.some((d) => cannot[0].includes(` ${d}: `)), `the cannot-run line names the scratch directory the run used, the one a warn line names\n${cannot[0]}\n${named.join('\n')}`);
  } finally {
    writable(tmp);
  }
});

// F-5, the re-Review 3 verdict's F-5: the parts of AC-19903-7 the signal
// case above leaves unasserted, as A-CACHE-5 ran them. Each bound test run
// starts a child process of its own (in its process group) and records
// both pids and its working directory; with --jobs 2 the signal lands while
// two mutant runs are live, in two working copies.
function gitTree(dir) {
  const seen = new Map();
  const walk = (rel) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) { seen.set(`${p}/`, 'dir'); walk(p); } else seen.set(p, createHash('sha256').update(readFileSync(join(dir, p))).digest('hex'));
    }
  };
  walk('.git');
  return seen;
}
test('AC-19903-7: on SIGINT or SIGTERM while two bound test runs are live under --jobs 2, rcf audit test-strength kills every process in the process group of each bound test run, a child process each test started included, removes its scratch directory with both working copies, leaves every path of the .git of the project as it was, and exits 130 for SIGINT and 143 for SIGTERM', async (t) => {
  for (const [signal, want] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    const side = scratch(t, 'rcf-h-sig2-');
    const tmp = join(side, 'tmp');
    mkdirSync(tmp);
    const runsFile = join(side, 'runs');
    // Each run appends "<its pid> <its child's pid> <its working directory>", then waits 20 s.
    const waiting = testFile([GREETS], {
      imports: ["import { appendFileSync } from 'node:fs';", "import { spawn } from 'node:child_process';"],
      top: [
        "const kid = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300_000)'], { stdio: 'ignore' });",
        `appendFileSync(${q(runsFile)}, \`\${process.pid} \${kid.pid} \${process.cwd()}\\n\`);`,
        'await new Promise((r) => setTimeout(r, 20_000));',
        'kid.kill();',
      ],
    });
    const { dir } = await strengthProject(t, { files: { 'test/rcf/a.test.js': waiting } });
    const gitBefore = gitTree(dir);
    const runs = () => (existsSync(runsFile) ? readFileSync(runsFile, 'utf8') : '').split('\n').filter(Boolean).map((l) => {
      const [pid, kid, ...cwd] = l.split(' ');
      return { pid: Number(pid), kid: Number(kid), cwd: cwd.join(' ') };
    });
    let seen = [];
    const reap = () => { for (const r of [...seen, ...runs()]) for (const p of [r.pid, r.kid]) if (p && alive(p)) process.kill(p, 'SIGKILL'); };
    t.after(reap);
    const child = spawn(process.execPath, [BIN, 'audit', 'test-strength', '--acs', 'AC-101-1', '--jobs', '2'], { cwd: dir, env: baseEnv({ ...nodeEnv(), TMPDIR: tmp }), stdio: 'ignore' });
    const exited = new Promise((res) => child.on('exit', (code, sig) => res({ code, sig })));
    try {
      // The first run is the unmutated run (one working copy); the mutant runs follow, two at once.
      const live = () => runs().slice(1).filter((r) => alive(r.pid) && alive(r.kid));
      assert.ok(await until(() => live().length >= 2, 150_000), `${signal}: two mutant runs are live at once under --jobs 2\n${q(runs())}`);
      const both = live();
      assert.equal(new Set(both.map((r) => r.cwd)).size, 2, `${signal}: the two live runs sit in two working copies\n${q(both)}`);
      for (const r of both) assert.ok(r.cwd.startsWith(realpathSync(tmp)), `${signal}: each working copy sits in the audit's scratch, in its TMPDIR\n${r.cwd}`);
      child.kill(signal);
      const { code, sig } = await exited;
      seen = runs();
      assert.equal(code, want, `${signal}: exit ${want} (got code ${code}, signal ${sig})`);
      for (const r of seen) {
        assert.equal(await until(() => !alive(r.pid) && !alive(r.kid), 10_000), true, `${signal}: every process of the group is killed: the bound test run ${r.pid} and its child ${r.kid}`);
      }
      assert.deepEqual(readdirSync(tmp), [], `${signal}: the audit's scratch directory, both working copies within it, is removed`);
      assert.deepEqual(gitTree(dir), gitBefore, `${signal}: no path of the project's .git is new, changed or deleted`);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      reap();
      writable(tmp);
    }
  }
});

// ------------------------------------------- round D fix round 4 (re-Review 4's F-1, the tie rule)
// F-1, the re-Review 4 verdict's F-1 (the X-POS-22 family), and the tie
// set of the stage-keeper's design decision after re-Review 4: a
// zero-width character (U+200B or U+FEFF, which node's renderer prints
// with no width) just before the token node refuses ties several offsets
// at node's caret, and the refusal is placed at the refused token, where
// node places it, never at node's caret plus 1. A placed refusal is never
// the withheld degraded state: no stderr line starts "test-strength:
// column for ". Each input is written as escapes; each position is the
// one node v24.14.0 gives for it (the refused token's UTF-16 column).
const WITHHELD = 'test-strength: column for ';
async function placedUnwithheld(t, text, at, why, file = 'src/a.ts') {
  const { dir } = await strengthProject(t, { files: { [file]: text }, nodes: [[`${file}#run`, ['AC-101-1']]] });
  const r = await strength(dir, ['--acs', 'AC-101-1', '--json'], nodeEnv());
  const c = crit(json(r.stdout), 'AC-101-1');
  assert.equal(c?.result, 'blocked', `AC-101-1 is BLOCKED\n${r.stdout}${r.stderr}`);
  syntaxAt(c.detail, `${file}:${at}`, why);
  assert.deepEqual(lines(r.stderr).filter((l) => l.startsWith(WITHHELD)), [], `${why}: node places the refusal, so no stderr line reads "${WITHHELD}..."\n${r.stderr}`);
  assert.equal(r.code, 5, `blocked criteria only: exit 5\n${r.stdout}${r.stderr}`);
}
async function entryUnwithheld(t, text, at, why) {
  const { dir } = await strengthProject(t, { config: { entry: [{ kind: 'module', path: 'src/intervals.ts' }], harness: ['test/_harness/**'] }, files: { 'src/intervals.ts': text } });
  const r = await strength(dir, ['--acs', 'AC-101-1'], nodeEnv());
  const line = lines(r.stderr).find((l) => l.startsWith('test-strength: entry point unreadable: '));
  assert.ok(line, `stderr carries "test-strength: entry point unreadable: "\n${r.stdout}${r.stderr}`);
  syntaxAt(line.slice('test-strength: entry point unreadable: '.length), `src/intervals.ts:${at}`, `${why}, in the entry point`);
  assert.deepEqual(lines(r.stderr).filter((l) => l.startsWith(WITHHELD)), [], `${why}, in the entry point: no stderr line reads "${WITHHELD}..."\n${r.stderr}`);
  assert.equal(r.code, 2, `the audit's own input unreadable: exit 2\n${r.stdout}${r.stderr}`);
}
async function familyPlaced(t, text, at, why) {
  await placedUnwithheld(t, text, at, why);
  await entryUnwithheld(t, text, at, why);
}

// X-POS-22: const t = 1 + U+200B U+200B; node's caret at index 14, the refused ; at 1:17.
test('AC-19901-9: two zero width spaces before the token node refuses after a binary operator are no column: src/a.ts holding const t = 1 + U+200B U+200B; places the refused ; at 1:17 with no withheld column line, exit 5, and the entry point src/intervals.ts at 1:17, exit 2', async (t) => {
  await familyPlaced(t, 'const t = 1 + ​​;', '1:17', 'node refuses the ; at column 17');
});

// X-POS-22h: const total = cost * U+200B; node's caret at index 21, the refused ; at 1:23.
test('AC-19901-9: a zero width space before the token node refuses after * is no column: src/a.ts holding const total = cost * U+200B; places the refused ; at 1:23 with no withheld column line, exit 5, and the entry point src/intervals.ts at 1:23, exit 2', async (t) => {
  await familyPlaced(t, 'const total = cost * ​;', '1:23', 'node refuses the ; at column 23');
});

// X-POS-22i: const okay = lefts || U+FEFF; node's caret at index 22, the refused ; at 1:24.
test('AC-19901-9: a byte order mark before the token node refuses after || is no column: src/a.ts holding const okay = lefts || U+FEFF; places the refused ; at 1:24 with no withheld column line, exit 5, and the entry point src/intervals.ts at 1:24, exit 2', async (t) => {
  await familyPlaced(t, 'const okay = lefts || ﻿;', '1:24', 'node refuses the ; at column 24');
});

// X-POS-22j: g(1 + U+200B); node's caret at index 6, the refused ) at 1:8.
test('AC-19901-9: a zero width space before a refused closing parenthesis after + is no column: src/a.ts holding g(1 + U+200B); places the refused ) at 1:8 with no withheld column line, exit 5, and the entry point src/intervals.ts at 1:8, exit 2', async (t) => {
  await familyPlaced(t, 'g(1 + ​);', '1:8', 'node refuses the ) at column 8');
});

// X-POS-22k: line 2 after a CRLF line, const d = 9 - U+FEFF U+FEFF; node's caret at index 14, the refused ; at 2:17.
test('AC-19901-9: two byte order marks before the token node refuses after - on line 2 after a CRLF line are no column: src/a.ts holding export const z = 0; CRLF const d = 9 - U+FEFF U+FEFF; places the refused ; at 2:17 with no withheld column line, exit 5, and the entry point src/intervals.ts at 2:17, exit 2', async (t) => {
  await familyPlaced(t, 'export const z = 0;\r\nconst d = 9 - ﻿﻿;\r\n', '2:17', 'node refuses the ; at column 17 of line 2');
});

// The tie set: an operand, the operator, a space, one zero-width character, then the ; node refuses.
test('AC-19901-9: a tie after the binary operator + is placed at the refused token: src/a.ts holding const t = a + U+200B; at 1:16 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'const t = a + ​;', '1:16', 'node refuses the ; after + at column 16');
});
test('AC-19901-9: a tie after the binary operator - is placed at the refused token: src/a.ts holding const t = a - U+200B; at 1:16 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'const t = a - ​;', '1:16', 'node refuses the ; after - at column 16');
});
test('AC-19901-9: a tie after the binary operator * is placed at the refused token: src/a.ts holding const t = a * U+200B; at 1:16 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'const t = a * ​;', '1:16', 'node refuses the ; after * at column 16');
});
test('AC-19901-9: a tie after the binary operator / is placed at the refused token: src/a.ts holding const t = a / U+200B; at 1:16 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'const t = a / ​;', '1:16', 'node refuses the ; after / at column 16');
});
test('AC-19901-9: a tie after the binary operator % is placed at the refused token: src/a.ts holding const t = a % U+200B; at 1:16 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'const t = a % ​;', '1:16', 'node refuses the ; after % at column 16');
});
test('AC-19901-9: a tie after the binary operator ** is placed at the refused token: src/a.ts holding const t = a ** U+200B; at 1:17 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'const t = a ** ​;', '1:17', 'node refuses the ; after ** at column 17');
});
test('AC-19901-9: a tie after the binary operator == is placed at the refused token: src/a.ts holding const t = a == U+200B; at 1:17 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'const t = a == ​;', '1:17', 'node refuses the ; after == at column 17');
});
test('AC-19901-9: a tie after the binary operator != is placed at the refused token: src/a.ts holding const t = a != U+FEFF; at 1:17 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'const t = a != ﻿;', '1:17', 'node refuses the ; after != at column 17');
});
test('AC-19901-9: a tie after the binary operator < is placed at the refused token: src/a.ts holding const t = a < U+FEFF; at 1:16 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'const t = a < ﻿;', '1:16', 'node refuses the ; after < at column 16');
});
test('AC-19901-9: a tie after the binary operator > is placed at the refused token: src/a.ts holding const t = a > U+FEFF; at 1:16 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'const t = a > ﻿;', '1:16', 'node refuses the ; after > at column 16');
});
test('AC-19901-9: a tie after the binary operator && is placed at the refused token: src/a.ts holding const t = a && U+FEFF; at 1:17 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'const t = a && ﻿;', '1:17', 'node refuses the ; after && at column 17');
});
test('AC-19901-9: a tie after the binary operator || is placed at the refused token: src/a.ts holding const t = a || U+FEFF; at 1:17 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'const t = a || ﻿;', '1:17', 'node refuses the ; after || at column 17');
});
test('AC-19901-9: a tie after the binary operator ?? is placed at the refused token: src/a.ts holding const t = a ?? U+FEFF; at 1:17 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'const t = a ?? ﻿;', '1:17', 'node refuses the ; after ?? at column 17');
});
test('AC-19901-9: a tie after the assignment operator = is placed at the refused token: src/a.ts holding let t = 0; t = U+FEFF; at 1:17 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'let t = 0; t = ﻿;', '1:17', 'node refuses the ; after = at column 17');
});

// ------------------------------------------- round D fix round 4 (the reach rule R)
// The reach rule R, the stage-keeper's ruling after the top-down review of
// the position oracle: where code points of no display width share node's
// column, the refusal is placed at the first of them node does not pass
// over (a zero-width code point node refuses is itself the construct; one
// node passes over is not). Where node's caret does not move across the
// code points that share its column (after an escape character), or node's
// own probes of them disagree, the position check is withheld: the detail
// reads node's line and node's caret plus 1, and one stderr line names the
// reason, the documented degraded state. Each input is written as escapes;
// each position is the one node v24.14.0 gives for it, or withholds.
async function placedWithheld(t, text, at, reason, why, file = 'src/a.ts') {
  const { dir } = await strengthProject(t, { files: { [file]: text }, nodes: [[`${file}#run`, ['AC-101-1']]] });
  const r = await strength(dir, ['--acs', 'AC-101-1', '--json'], nodeEnv());
  const c = crit(json(r.stdout), 'AC-101-1');
  assert.equal(c?.result, 'blocked', `AC-101-1 is BLOCKED\n${r.stdout}${r.stderr}`);
  syntaxAt(c.detail, `${file}:${at}`, why);
  const line = `${WITHHELD}${file}:${at.split(':')[0]} is node's display column (position check withheld: ${reason})`;
  assert.deepEqual(lines(r.stderr).filter((l) => l.startsWith(WITHHELD)), [line], `${why}: exactly one stderr line reads "${line}"\n${r.stderr}`);
  assert.equal(r.code, 5, `blocked criteria only: exit 5\n${r.stdout}${r.stderr}`);
}
const CARET_STILL = "node's caret does not move across the tie";
const PROBES_DISAGREE = 'the probes disagree';

// The seven red cases of the ruling, in its order.
test('AC-19901-9: a combining mark at an operand position is the construct node refuses: src/a.ts holding let a = 1 + U+0301; places the refusal at 1:13 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'let a = 1 + \u0301;', '1:13', 'node refuses the combining mark at column 13');
});
test('AC-19901-9: a zero width space node passes over, then a combining mark at an operand position: src/a.ts holding let a = 1 + U+200B U+0301; places the refusal at the combining mark, 1:14, with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'let a = 1 + \u200b\u0301;', '1:14', 'node refuses the combining mark at column 14');
});
test('AC-19901-9: two combining marks after * are placed at the first: src/a.ts holding let a = 2 * U+0301 U+0301; places the refusal at 1:13 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'let a = 2 * \u0301\u0301;', '1:13', 'node refuses the first combining mark at column 13');
});
test('AC-19901-9: three zero width joiners where the probes of node disagree are withheld: src/a.ts holding export const a = 1 U+200D U+200D U+200D; reads 1:20, the caret of node plus 1, with one withheld column line naming the probes disagree, exit 5', async (t) => {
  await placedWithheld(t, 'export const a = 1 \u200d\u200d\u200d;', '1:20', PROBES_DISAGREE, 'the probes of node disagree on the three joiners');
});
test('AC-19901-9: an escape character in a string, then a refused token after an operator, is withheld: src/a.ts holding export const s = quote U+001B quote; const b = 1 + ; reads 1:19, the caret of node plus 1, with one withheld column line naming that the caret does not move across the tie, exit 5', async (t) => {
  await placedWithheld(t, "export const s = '\u001b'; const b = 1 + ;", '1:19', CARET_STILL, 'the renderer of node swallows the code points after the escape character');
});
test('AC-19901-9: an escape and an operating system command sequence in a string, then a refused token, is withheld: src/a.ts holding export const s = quote U+001B ]0;t U+0007 quote; const b = ; reads 1:19, the caret of node plus 1, with one withheld column line naming that the caret does not move across the tie, exit 5', async (t) => {
  await placedWithheld(t, "export const s = '\u001b]0;t\u0007'; const b = ;", '1:19', CARET_STILL, 'the renderer of node swallows the code points after the escape character');
});
test('AC-19901-9: an escape character in a string, then a refused token (esc-unclosed), is withheld: src/a.ts holding export const s = quote U+001B quote; const b = ; reads 1:19, the caret of node plus 1, with one withheld column line naming that the caret does not move across the tie, exit 5', async (t) => {
  await placedWithheld(t, "export const s = '\u001b'; const b = ;", '1:19', CARET_STILL, 'the renderer of node swallows the code points after the escape character');
});

// The seven green guards of the ruling, in its order.
test('AC-19901-9: two combining marks node refuses are placed at the first (comb-comb): src/a.ts holding export const a = U+0301 U+0301; places the refusal at 1:18 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'export const a = \u0301\u0301;', '1:18', 'node refuses the first combining mark at column 18');
});
test('AC-19901-9: two zero width joiners node refuses are placed at the first (zwj-zwj): src/a.ts holding export const a = 1 U+200D U+200D; places the refusal at 1:20 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'export const a = 1 \u200d\u200d;', '1:20', 'node refuses the first joiner at column 20');
});
test('AC-19901-9: a byte order mark node passes over, then two combining marks: src/a.ts holding export const a = U+FEFF U+0301 U+0301; places the refusal at the first combining mark, 1:19, with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'export const a = \ufeff\u0301\u0301;', '1:19', 'node refuses the first combining mark at column 19');
});
test('AC-19901-9: two combining marks on line 2 after a CRLF line are placed at the first: src/a.ts holding export const z = 0; CRLF export const a = U+0301 U+0301; places the refusal at 2:18 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'export const z = 0;\r\nexport const a = \u0301\u0301;\r\n', '2:18', 'node refuses the first combining mark at column 18 of line 2');
});
test('AC-19901-9: two combining marks in a .vue script setup block are placed at the first, counted in the .vue file: src/a.vue holding a template line, a script setup lang ts line and export const a = U+0301 U+0301; places the refusal at 3:18 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, "<template><p/></template>\r\n<script setup lang='ts'>\r\nexport const a = \u0301\u0301;\r\n</script>\r\n", '3:18', 'node refuses the first combining mark at column 18 of line 3 of the .vue file', 'src/a.vue');
});
test('AC-19901-9: a form feed node passes over, then a zero width joiner it refuses (x-ff-zwj): src/a.ts holding let a = x U+000C U+200D; places the refusal at the joiner, 1:11, with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, 'let a = x\u000c\u200d;', '1:11', 'node refuses the joiner at column 11');
});
test('AC-19901-9: a repeated label of three Hangul jungseong fillers is placed at the second label: src/a.ts holding U+1160 U+1160 U+1160: U+1160 U+1160 U+1160: while (true) break; places the refusal at 1:6 with no withheld column line, exit 5', async (t) => {
  await placedUnwithheld(t, '\u1160\u1160\u1160: \u1160\u1160\u1160: while (true) break;', '1:6', 'node refuses the second label at column 6');
});
