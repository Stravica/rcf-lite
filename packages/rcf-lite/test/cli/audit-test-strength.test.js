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
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { lines, rcf, toolPath } from '../_harness/spawn.js';
import { commit, git, gitTry, initRepo, s7, sha } from '../_harness/git.js';
import { bindTests, criterion, editFbs, editStory, project, readJson, readText, reviewVerdict, scratch, verdictPath, writeJson, writeText } from '../_harness/fixture.js';
import { hostFacts, json } from '../_harness/capture.js';

const TODO = { todo: 'FBS-236 round DEFINE' };
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

test('AC-19901-1: over a bin entry, a harness glob and AC-101-1 bound to a test importing only node:test, node:assert and test/_harness/run.js, with a symbol-level Code Node whose mutants all fail it, rcf audit test-strength --acs AC-101-1 exits 0 with the PASS line', TODO, async (t) => {
  const { dir, H } = await strengthProject(t);
  const r = await strength(dir, ['--acs', 'AC-101-1'], nodeEnv());
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.ok([passLine(H, 1, 3, 3), passLine(H, 1, 2, 2, 0, 1)].includes(out(r)), `stdout is the PASS line (3/3, or 2/2 with notApplicable 1)\n${r.stdout}`);
  // Totals (section 8.1): totals.mutants counts notApplicable; the PASS total excludes it.
  const { totals } = json((await strength(dir, ['--acs', 'AC-101-1', '--json'], nodeEnv())).stdout);
  assert.equal(totals.mutants, 3, 'three operators on one symbol');
  assert.equal(out(r), passLine(H, 1, totals.killed, totals.mutants - totals.notApplicable, totals.timeout, totals.notApplicable), 'the PASS total is mutants less notApplicable');
});

test('AC-19901-2: a bound test also importing src/store.js exits 4 with "test-strength: FAIL 1 of 1 criteria at <h7>: AC-101-1 imports src/store.js (not the app entry or the harness)"', TODO, async (t) => {
  const { dir, H } = await strengthProject(t, { files: { 'src/store.js': 'export const store = new Map();\n', 'test/rcf/a.test.js': testFile([GREETS], { imports: ["import '../../src/store.js';"] }) } });
  const r = await strength(dir, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.equal(out(r), failLine(H, 1, 1, ['AC-101-1 imports src/store.js (not the app entry or the harness)']));
});

test('AC-19901-3: mock.module("../../src/mailer.js") with edge ["node:https"] exits 4 with "AC-101-1 mocks ../../src/mailer.js (not a declared edge)"; mock.module("node:https") in the same test is not a finding', TODO, async (t) => {
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

test('AC-19901-4: a Code Node src/notify.js#makeNotifier written makeNotifier({ sender = consoleSender } = {}) exits 4 with "AC-101-1 silent default sender in src/notify.js#makeNotifier"; a parameter named sender with no default is not a finding', TODO, async (t) => {
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

test('AC-19901-5: no rcf/test-strength.json exits 2 with "test-strength: no rcf/test-strength.json; declare entry and harness"; no scope and no REVIEW verdict exits 2 with the no-scope line; --acs AC-999-1 exits 2 naming AC-999-1', TODO, async (t) => {
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

test('AC-19901-6: the structural check never executes a test, the entry or a product module: a bound test that throws on import still yields its import finding, reported with no mutant run', TODO, async (t) => {
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

test('AC-19901-7: with --acs AC-101-1,AC-101-2 where AC-101-1 imports src/store.js and AC-101-2 passes, the structural check runs for both, mutants for AC-101-2 only, exit 4 names the imports finding, and --json lists mutants for AC-101-2 and none for AC-101-1', TODO, async (t) => {
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

test('AC-19901-8: a bound test file test/rcf/a.test.ts, or a Code Node on src/x.ts, exits 2 with "test-strength: <path> is not a supported source (JavaScript ESM or CommonJS)" and runs no mutant; .js, .mjs and .cjs files are read', TODO, async (t) => {
  const marks = scratch(t, 'rcf-h-marks-');
  const entry = join(marks, 'entry');
  const marked = { 'bin/app.js': markerSrc(entry) + GREET_BIN };
  const ts = await strengthProject(t, { files: { ...marked, 'test/rcf/a.test.ts': testFile([GREETS]) }, bind: [['AC-101-1', 'test/rcf/a.test.ts', GREETS.name]] });
  const a = await strength(ts.dir, ['--acs', 'AC-101-1']);
  assert.equal(a.code, 2, `${a.stdout}${a.stderr}`);
  assert.ok(lines(a.stderr).includes('test-strength: test/rcf/a.test.ts is not a supported source (JavaScript ESM or CommonJS)'), a.stderr);
  const node = await strengthProject(t, { files: { ...marked, 'src/x.ts': 'export const x: number = 1;\n' }, nodes: [['src/x.ts', ['AC-101-1']], ['src/greet.js#greet', ['AC-101-1']]] });
  const b = await strength(node.dir, ['--acs', 'AC-101-1']);
  assert.equal(b.code, 2, `${b.stdout}${b.stderr}`);
  assert.ok(lines(b.stderr).includes('test-strength: src/x.ts is not a supported source (JavaScript ESM or CommonJS)'), b.stderr);
  assert.equal(existsSync(entry), false, 'no mutant ran');

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
});

// ---------------------------------------------------------------- US-19902

const AUDIT = L('export function writeAudit(log) {', "  log.push('audited');", '}');
const AUDIT_BIN = L("import { writeAudit } from '../src/audit.js';", 'writeAudit([]);', "process.stdout.write('done\\n');");
const EXITS = { name: 'AC-101-1 exits 0', body: ['assert.strictEqual(app().code, 0);'] };
const vacuous = (t, extra = {}) => strengthProject(t, {
  files: { 'src/audit.js': AUDIT, 'bin/app.js': AUDIT_BIN, 'test/rcf/a.test.js': testFile([EXITS]) },
  nodes: [['src/audit.js#writeAudit', ['AC-101-1']]], bind: [['AC-101-1', 'test/rcf/a.test.js', EXITS.name]], ...extra,
});

test('AC-19902-1: a bound test asserting only that the CLI exits 0 over src/audit.js#writeAudit, called once per run and never asserted, exits 4 with "AC-101-1 vacuous: noOp on src/audit.js#writeAudit survived 1 bound tests" and the same for callRemoval, and --json lists those mutants survived', TODO, async (t) => {
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

test('AC-19902-2: AC-101-2 with no Code Node, AC-101-3 with only a file-level Code Node src/x.js and AC-101-4 with no bound test exit 4 with "AC-101-2 no Code Node", "AC-101-3 no symbol-level Code Node" and "AC-101-4 unbound"', TODO, async (t) => {
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

test('AC-19902-3: a no-op mutant that hangs its bound test past --mutant-timeout 5 is recorded "timeout" and counted as killed, and a symbol with no statement-level call site records callRemoval "notApplicable" while the criterion passes', TODO, async (t) => {
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

test('AC-19902-4: with no --acs the scope is the touched AC-101-1 of the REVIEW verdict only: mutants touch only its symbols, git status and the hash of every tracked file are unchanged, and git worktree list shows only the main worktree', TODO, async (t) => {
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

test('AC-19902-5: a scope of 240 mutants exits 2 before running any test with "test-strength: 240 mutants exceed --max-mutants 200; narrow the scope"; with --max-mutants 300 it runs', TODO, async (t) => {
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

test('AC-19902-6: a round touching 8 criteria with 2 symbol-level Code Nodes each (48 mutants) and bound files of about 2 seconds finishes with --jobs 4 within 5 minutes, runs only those 8 files, and the json totals report mutants 48 and wallMs', TODO, async (t) => {
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

test('AC-19902-7: a class symbol expands to its methods (three operators each), a function-valued initialiser is mutated like a function, and a numeric constant, an object literal and a re-export fail "no mutable symbol <path#symbol>"', TODO, async (t) => {
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

test('AC-19902-8: a file-level Code Node docs/x.md is blanked in the scratch worktree (fileBlank): a bound test reading it goes red, giving the PASS line with killed 1/1; a bound test that never reads it exits 4 "AC-101-5 vacuous: fileBlank on docs/x.md survived 1 bound tests"', TODO, async (t) => {
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

// ---------------------------------------------------------------- US-19903

const REPORT_KEYS = ['version', 'head', 'scope', 'criteria', 'result', 'totals', 'wallMs', 'node'];
const TOTAL_KEYS = ['criteria', 'structuralPassed', 'mutants', 'killed', 'survived', 'timeout', 'notApplicable'];

test('AC-19903-1: at a REVIEW: commit for H touching AC-101-1, a passing --record exits 0 and writes rcf/verdicts/<H12>/test-strength.json as TestStrengthReport v1 (head H, scope reviewVerdict, criteria [AC-101-1]); a FAIL run with --record writes the report too and exits 4', TODO, async (t) => {
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
  assert.equal(typeof rep.wallMs, 'number');
  assert.equal(rep.node, process.version);

  const failing = await vacuous(t);
  const F = reviewed(failing.dir);
  const f = await strength(failing.dir, ['--record'], nodeEnv());
  assert.equal(f.code, 4, `${f.stdout}${f.stderr}`);
  assert.equal(readJson(failing.dir, verdictPath(F, 'test-strength.json')).result, 'fail');
});

test('AC-19903-2: --record refuses a dirty tree (exit 4) and a BUILD: change to src/x.js after H (exit 4), needs a REVIEW verdict reachable from HEAD (exit 2, with or without --acs or --fbs), writes no file when refused, and accepts a FINALISE: commit inside FINALISE classes after H', TODO, async (t) => {
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

test('AC-19903-3: a Worker-style app (entry worker src/index.js, harness test/harness/**, edge undici) passes the structural check through test/harness/worker.js; a bound test importing src/routes/pay.js fails with "imports src/routes/pay.js (not the app entry or the harness)"', TODO, async (t) => {
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

test('AC-19903-4: a library (entry module src/index.js) passes the structural check for a test importing the package by its own name or ../src/index.js, and fails it with the imports finding for ../src/internal.js', TODO, async (t) => {
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

test('AC-19903-5: rcf audit test-strength never deploys, opens no network connection of its own and writes nothing outside rcf/verdicts/<H12>/, with or without --record; a malformed rcf/test-strength.json exits 2 naming the field and runs no test', TODO, async (t) => {
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
