// FBS-244 (US-19905): rcf audit test-strength over Python sources. A
// symbol-level .py Code Node (a def, a class, or Class.method) is read
// through the host's python3 with the standard library ast module only
// and mutated with the JavaScript operator set (stubToThrow, noOp,
// callRemoval), so the TestStrengthReport v1 shape is unchanged; python3
// absent or below 3.9 blocks the criterion with a detail naming python3
// and the floor.
//
// Criteria: AC-19905-1 to AC-19905-3 and AC-19905-5 (a claimed .py file
// python3 cannot parse is a named BLOCKED, never a pass), all external;
// the parse case is also bound to AC-19901-10. Each test drives
// bin/rcf.js audit test-strength as a child process over a scratch copy
// of the committed fixture test/fixtures/py-strength/ (a small Python
// project beside one JavaScript module, whose node:test tests run the
// Python through python3 as a child process; no npm dependencies, no
// keychain, no network, no secrets), laid over the project the bin's own
// rcf init makes. The test writes the Code Node records and the bound
// test cases its criterion's Given names into the copy (a fixture's
// rcf/code-nodes/ is production class, so none is committed) and
// commits it to git. Every run gets a PATH of one scratch directory of
// its own: git, sh and node linked from the host, and python3 linked to
// the host's interpreter (its sys.executable), left out, or one of the
// committed shims (one reports 3.8.18, one prints nothing and exits 1
// on --version). A test that needs the host's python3 fails where the
// host has none; nothing is skipped. A mutant that does not parse fails
// its bound tests and reads killed, so the cases where a mutant must
// survive (an unexercised method, a call site no bound test reaches, a
// file with non-ASCII text and CRLF line endings) are the ones that
// show each splice leaves the module importable.
// Red at the round's DEFINE head: every symbol-level .py Code Node
// blocks its criterion with the detail "<file>:1:1: unsupported file
// type .py", exit 5. None of these tests resolves a Code Node through
// rcf define validate. Imports: Node builtins and test/_harness/ only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { delimiter, join, relative, sep } from 'node:path';

import { PACKAGE_ROOT, rcf } from '../_harness/spawn.js';
import { commit, gitTry, initRepo, s7, showAt } from '../_harness/git.js';
import { bindTests, criterion, editFbs, editStory, project, scratch, writeJson, writeText } from '../_harness/fixture.js';
import { json } from '../_harness/capture.js';

const FIXTURE = join(PACKAGE_ROOT, 'test', 'fixtures', 'py-strength');
const SHIM_38 = join(FIXTURE, 'shims', 'python3-3.8', 'python3');
const SHIM_NO_VERSION = join(FIXTURE, 'shims', 'python3-no-version', 'python3');

const PATHS_TESTS = ['canonical collapses repeated slashes and drops a trailing slash', 'warm remembers the canonical form of every path'];
const CONFIG_TESTS = ['lookup returns the value of a key', 'from_text reads a JSON object', 'fetch returns the value of a key from the event loop'];
const RECORD_TEST = 'record runs without an error';
const REPORT_TEST = 'summarise counts every word it is given';
const SLUG_TEST = 'slug joins the lower-cased words with hyphens';
const bindAll = (acId, file, names) => names.map((name) => [acId, file, name]);

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

// The fixture in git at H: the rcf init project (US-101, FBS-001) with
// the fixture's files over it (its shims/ left out) and then `files`
// (path -> text) over those, US-101 holding `acs` (FBS-001 scoping them
// at inProgress), Code Nodes [[path, acIds]] and bound tests
// [[acId, file, name]].
async function pyProject(t, { acs, nodes, bind, files = {} }) {
  const dir = await project(t, { name: 'py' });
  cpSync(FIXTURE, dir, { recursive: true, filter: (p) => relative(FIXTURE, p).split(sep)[0] !== 'shims' });
  for (const [rel, text] of Object.entries(files)) writeText(dir, rel, text);
  editStory(dir, 'US-101', (us) => { us.acceptanceCriteria = acs.map((id) => criterion(id, `${id} holds for the fixture project`)); });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = acs; f.executionStatus = 'inProgress'; });
  codeNodes(dir, nodes);
  bindTests(dir, bind.map(([acId, file, name]) => ({ acId, pointer: `${file}::${name}` })), { realTests: false });
  initRepo(dir);
  const H = commit(dir, 'fixture: base');
  return { dir, H };
}

// The first directory on the inherited PATH holding tool.
function onPath(tool) {
  const dir = (process.env.PATH ?? '').split(delimiter).filter(Boolean).find((d) => existsSync(join(d, tool)));
  assert.ok(dir, `the host has ${tool} on PATH: this test needs it and fails without it (nothing is skipped)`);
  return join(dir, tool);
}

// The host's Python interpreter itself, as it names itself (a launcher
// such as a version manager's shim resolves to the interpreter it runs).
function hostPython() {
  const exe = execFileSync(onPath('python3'), ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  assert.ok(exe !== '' && existsSync(exe), `python3 names its interpreter: ${JSON.stringify(exe)}`);
  return exe;
}

// A PATH of one scratch directory: git, sh and node linked from the
// host, and python3 as given: 'host' (linked to the host's interpreter),
// a shim script (copied in, executable) or null (no python3 at all).
function binPath(t, python3) {
  const dir = join(scratch(t, 'rcf-h-bin-'), 'bin');
  mkdirSync(dir);
  symlinkSync(onPath('git'), join(dir, 'git'));
  symlinkSync(onPath('sh'), join(dir, 'sh'));
  symlinkSync(process.execPath, join(dir, 'node'));
  if (python3 === 'host') symlinkSync(hostPython(), join(dir, 'python3'));
  else if (python3) {
    copyFileSync(python3, join(dir, 'python3'));
    chmodSync(join(dir, 'python3'), 0o755);
  }
  return dir;
}

// The python3 on that PATH is 3.9 or later (the criterion's Given).
function atFloor(bin) {
  const v = execFileSync(join(bin, 'python3'), ['--version'], { encoding: 'utf8' }).trim();
  const m = /^Python (\d+)\.(\d+)\./.exec(v);
  assert.ok(m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 9)), `the host's python3 is 3.9 or later: ${v}`);
}

// Every file under dir but .git, path -> sha256.
function snapshot(dir) {
  const files = {};
  const walk = (rel) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (r === '.git') continue;
      if (e.isDirectory()) walk(r);
      else files[r] = createHash('sha256').update(readFileSync(join(dir, r))).digest('hex');
    }
  };
  walk('');
  return files;
}

const strength = (dir, bin, args) => rcf(['audit', 'test-strength', ...args], { cwd: dir, env: { PATH: bin }, timeout: 600_000 });
const out = (r) => r.stdout.replace(/\n$/, '');
const shown = (r) => `exit ${r.code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
const crit = (report, acId) => report.criteria.find((c) => c.acId === acId);
const triples = (c) => c.mutants.map((m) => `${m.symbol} ${m.operator} ${m.result}`).sort();
const each = (symbol, results) => Object.entries(results).map(([op, res]) => `${symbol} ${op} ${res}`);
const KILLED_ALL = { stubToThrow: 'killed', noOp: 'killed', callRemoval: 'killed' };
const NO_CALL_SITE = { stubToThrow: 'killed', noOp: 'killed', callRemoval: 'notApplicable' };
const noCrash = (r) => assert.doesNotMatch(r.stderr, /^\s+at \S/m, `no stack trace on stderr: the audit never crashes\n${shown(r)}`);
// The items of a FAIL line after its "at <h7>: " head, in sorted order.
const failItems = (r, h7) => {
  const head = `test-strength: FAIL 1 of 1 criteria at ${h7}: `;
  assert.ok(out(r).startsWith(head), `the FAIL line for one failing criterion\n${shown(r)}`);
  return out(r).slice(head.length).split('; ').sort();
};
const vacuous = (acId, n, triplesSurvived) => triplesSurvived.map(([symbol, op]) => `${acId} vacuous: ${op} on ${symbol} survived ${n} bound tests`).sort();

// A project-root module named like a standard library module (json, ast)
// that writes the marker file "<name> imported" into markers when it is
// imported: a Python started in the project root without -I imports it
// in place of the standard library's.
const shadowModule = (name, markers) => [
  `"""A project-root module named like the standard library's ${name}: importing it leaves a marker."""`,
  'import os',
  '',
  `open(os.path.join(${JSON.stringify(markers)}, ${JSON.stringify(`${name} imported`)}), "w").close()`,
  '',
].join('\n');

// src/paths.py with non-ASCII text on lines of its own before every body
// (a character outside the Basic Multilingual Plane, U+1D11E, included),
// one such comment line inside record before its body, and every line
// ending CRLF.
function pathsNonAsciiCrlf() {
  const lines = readFileSync(join(FIXTURE, 'src', 'paths.py'), 'utf8').split('\n');
  lines.splice(1, 0, '', '# Text before every body: café, über, naïve, § and \u{1D11E}, a clef outside the Basic Multilingual Plane.');
  const at = lines.indexOf('def record(log, path):');
  assert.ok(at > 0, 'src/paths.py declares def record(log, path):');
  lines.splice(at + 1, 0, '    # \u{1D11E} résumé: a comment line before the body of record.');
  return lines.join('\r\n');
}

// The SyntaxError the host's python3 raises for text: [line, column, message]
// as ast.parse reports them (1-based line and column), or null.
const SYNTAX = [
  'import ast, json, sys',
  'try:',
  '    ast.parse(sys.stdin.read(), sys.argv[1])',
  '    print("null")',
  'except SyntaxError as e:',
  '    print(json.dumps([e.lineno, e.offset, e.msg]))',
].join('\n');
const syntaxError = (file, text) => JSON.parse(execFileSync(hostPython(), ['-I', '-B', '-c', SYNTAX, file], { input: text, encoding: 'utf8' }));

// ---------------------------------------------------------------- US-19905

test('AC-19905-1: AC-101-1 claiming the top-level def src/paths.py#canonical and AC-101-2 the class src/config.py#Config, bound to node:test tests that run the Python through python3, exits 0 with "test-strength: PASS 2 criteria at <h7>: structural 2/2, mutants killed 12/12 (timeout 0, notApplicable 3)": three mutants on the def and on each method but __init__ (the classmethod and the async method included), callRemoval killed at a statement-level call site and notApplicable with none, the TestStrengthReport v1 shape unchanged, the project tree byte-identical, and a project-root json.py and ast.py that leave a marker when imported never imported (no marker afterwards); and src/config.py#Config.lookup names that one method', async (t) => {
  const bin = binPath(t, 'host');
  atFloor(bin);
  const markers = scratch(t, 'rcf-h-marker-');
  const p = await pyProject(t, {
    acs: ['AC-101-1', 'AC-101-2'],
    nodes: [['src/paths.py#canonical', ['AC-101-1']], ['src/config.py#Config', ['AC-101-2']]],
    bind: [...bindAll('AC-101-1', 'test/paths.test.mjs', PATHS_TESTS), ...bindAll('AC-101-2', 'test/config.test.mjs', CONFIG_TESTS)],
    files: { 'json.py': shadowModule('json', markers), 'ast.py': shadowModule('ast', markers) },
  });
  // The markers work: a python3 started in the project root without -I imports both.
  execFileSync(hostPython(), ['-B', '-c', 'import json, ast'], { cwd: p.dir, env: { PATH: bin } });
  assert.deepEqual(readdirSync(markers).sort(), ['ast imported', 'json imported'], 'a plain python3 in the project root imports the project-root json.py and ast.py');
  for (const f of readdirSync(markers)) rmSync(join(markers, f));
  const before = snapshot(p.dir);
  const r = await strength(p.dir, bin, ['--acs', 'AC-101-1,AC-101-2']);
  assert.equal(r.code, 0, `every Python mutant killed: exit 0\n${shown(r)}`);
  assert.equal(out(r), `test-strength: PASS 2 criteria at ${s7(p.H)}: structural 2/2, mutants killed 12/12 (timeout 0, notApplicable 3)`, shown(r));
  assert.deepEqual(snapshot(p.dir), before, 'the project tree is byte-identical after the run: every mutant was written to the working copy');
  assert.equal(gitTry(p.dir, 'status', '--porcelain', '-uall').stdout, '', 'git status is clean after the run');

  const j = await strength(p.dir, bin, ['--acs', 'AC-101-1,AC-101-2', '--json']);
  assert.equal(j.code, 0, shown(j));
  const report = json(j.stdout);
  // TestStrengthReport v1, the shape the JavaScript path writes.
  assert.deepEqual(Object.keys(report).sort(), ['criteria', 'head', 'node', 'result', 'scope', 'totals', 'version', 'wallMs'], JSON.stringify(report));
  assert.equal(report.version, 1);
  assert.equal(report.head, p.H);
  assert.equal(report.scope, 'acs');
  assert.equal(report.result, 'pass');
  assert.deepEqual(report.totals, { criteria: 2, structuralPassed: 2, mutants: 15, killed: 12, survived: 0, timeout: 0, notApplicable: 3, blocked: 0 });
  const pointers = new Map([
    ['AC-101-1', PATHS_TESTS.map((n) => `test/paths.test.mjs::${n}`)],
    ['AC-101-2', CONFIG_TESTS.map((n) => `test/config.test.mjs::${n}`)],
  ]);
  for (const c of report.criteria) {
    assert.deepEqual(Object.keys(c).sort(), ['acId', 'mutants', 'result', 'structural'], JSON.stringify(c));
    assert.deepEqual(c.structural, { result: 'pass', findings: [] }, JSON.stringify(c));
    assert.equal(c.result, 'pass', JSON.stringify(c));
    for (const m of c.mutants) {
      assert.deepEqual(Object.keys(m).sort(), ['killedBy', 'operator', 'result', 'symbol'], JSON.stringify(m));
      if (m.result === 'killed') {
        assert.ok(m.killedBy.length >= 1 && m.killedBy.every((x) => pointers.get(c.acId).includes(x)), `a killed mutant names the bound tests that went red\n${JSON.stringify(m)}`);
      } else {
        assert.deepEqual(m.killedBy, [], JSON.stringify(m));
      }
    }
  }
  // canonical is called as a statement in warm, so callRemoval scores;
  // merge is called as a statement in from_text; lookup, from_text and
  // fetch have no statement-level call site.
  assert.deepEqual(triples(crit(report, 'AC-101-1')), each('src/paths.py#canonical', KILLED_ALL).sort());
  assert.deepEqual(triples(crit(report, 'AC-101-2')), [
    ...each('src/config.py#Config.lookup', NO_CALL_SITE),
    ...each('src/config.py#Config.merge', KILLED_ALL),
    ...each('src/config.py#Config.from_text', NO_CALL_SITE),
    ...each('src/config.py#Config.fetch', NO_CALL_SITE),
  ].sort());
  assert.ok(!crit(report, 'AC-101-2').mutants.some((m) => m.symbol.includes('__init__')), 'the constructor __init__ is not a target');
  assert.deepEqual(readdirSync(markers), [], 'no marker anywhere: the structure read never imported project code (json.py, ast.py)');
  assert.deepEqual(snapshot(p.dir), before, 'the project tree is still byte-identical after the --json run');
});

test('AC-19905-2: AC-101-1 claiming src/paths.py#record, bound only to a test that shows record runs (test/record.test.mjs), where src/paths.py has non-ASCII text on lines of its own before the body (a character outside the Basic Multilingual Plane included) and CRLF line endings, leaves the noOp mutant survived (the spliced module still parses): exit 4, AC-101-1 result "fail", and the FAIL line "test-strength: FAIL 1 of 1 criteria at <h7>: AC-101-1 vacuous: noOp on src/paths.py#record survived 1 bound tests"', async (t) => {
  const bin = binPath(t, 'host');
  atFloor(bin);
  const p = await pyProject(t, {
    acs: ['AC-101-1'],
    nodes: [['src/paths.py#record', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/record.test.mjs', RECORD_TEST]],
    files: { 'src/paths.py': pathsNonAsciiCrlf() },
  });
  // The Given, as committed: CRLF on every line, the non-ASCII text present.
  const committed = showAt(p.dir, p.H, ['src/paths.py']).get('src/paths.py');
  assert.ok(committed.includes('\r\n') && !/[^\r]\n/.test(committed), 'src/paths.py is committed with CRLF on every line');
  assert.ok(committed.includes('\u{1D11E}') && committed.includes('café'), 'src/paths.py is committed with its non-ASCII text');
  const r = await strength(p.dir, bin, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 4, `a surviving mutant: the FAIL exit 4\n${shown(r)}`);
  assert.equal(out(r), `test-strength: FAIL 1 of 1 criteria at ${s7(p.H)}: AC-101-1 vacuous: noOp on src/paths.py#record survived 1 bound tests`, shown(r));
  const j = await strength(p.dir, bin, ['--acs', 'AC-101-1', '--json']);
  assert.equal(j.code, 4, shown(j));
  const c = crit(json(j.stdout), 'AC-101-1');
  assert.equal(c.result, 'fail', JSON.stringify(c));
  // stubToThrow raises, so the weak test still kills it; nothing calls record as a statement.
  assert.deepEqual(triples(c), each('src/paths.py#record', { stubToThrow: 'killed', noOp: 'survived', callRemoval: 'notApplicable' }).sort());
});

test('AC-19905-3: with no python3 on PATH, AC-101-1 claiming src/paths.py#canonical is blocked, reason TEST_STRENGTH_UNSUPPORTED, detail "src/paths.py: Python sources need python3 >= 3.9 on PATH (python3 not found)", while AC-101-2 claiming src/slug.js#slug is judged pass, exit 5 with "test-strength: BLOCKED 2 criteria at <h7>: structural 1/1, mutants killed 2/2 (timeout 0, notApplicable 1, blocked 1): AC-101-1 (src/paths.py)"; with a python3 that reports 3.8.18 the detail ends "(python3 is 3.8.18)", and with a python3 that prints nothing and exits 1 on --version "(python3 gave no version)"; the audit never crashes', async (t) => {
  const p = await pyProject(t, {
    acs: ['AC-101-1', 'AC-101-2'],
    nodes: [['src/paths.py#canonical', ['AC-101-1']], ['src/slug.js#slug', ['AC-101-2']]],
    bind: [...bindAll('AC-101-1', 'test/paths.test.mjs', PATHS_TESTS), ['AC-101-2', 'test/slug.test.mjs', SLUG_TEST]],
  });
  for (const [python3, why] of [[null, 'python3 not found'], [SHIM_38, 'python3 is 3.8.18'], [SHIM_NO_VERSION, 'python3 gave no version']]) {
    const bin = binPath(t, python3);
    assert.equal(existsSync(join(bin, 'python3')), python3 !== null, `python3 on the PATH: ${python3 ?? 'none'}`);
    if (python3 === SHIM_NO_VERSION) {
      const v = spawnSync(join(bin, 'python3'), ['--version'], { encoding: 'utf8' });
      assert.deepEqual([v.status, v.stdout, v.stderr], [1, '', ''], 'the shim gives no version: exit 1, nothing printed');
    }
    const j = await strength(p.dir, bin, ['--acs', 'AC-101-1,AC-101-2', '--json']);
    assert.equal(j.code, 5, `a blocked criterion beside a passing one: exit 5 (${why})\n${shown(j)}`);
    noCrash(j);
    const report = json(j.stdout);
    const c = crit(report, 'AC-101-1');
    assert.equal(c.result, 'blocked', JSON.stringify(c));
    assert.equal(c.reason, 'TEST_STRENGTH_UNSUPPORTED', JSON.stringify(c));
    assert.equal(c.blocked, true, JSON.stringify(c));
    assert.equal(c.detail, `src/paths.py: Python sources need python3 >= 3.9 on PATH (${why})`, JSON.stringify(c));
    assert.deepEqual(c.mutants, [], JSON.stringify(c));
    const js = crit(report, 'AC-101-2');
    assert.equal(js.result, 'pass', `the .js criterion is judged as before (${why})\n${JSON.stringify(js)}`);
    assert.deepEqual(triples(js), each('src/slug.js#slug', NO_CALL_SITE).sort());
    assert.equal(report.result, 'blocked', JSON.stringify(report));
    assert.equal(report.totals.blocked, 1, JSON.stringify(report.totals));
    const r = await strength(p.dir, bin, ['--acs', 'AC-101-1,AC-101-2']);
    assert.equal(r.code, 5, shown(r));
    noCrash(r);
    assert.equal(out(r), `test-strength: BLOCKED 2 criteria at ${s7(p.H)}: structural 1/1, mutants killed 2/2 (timeout 0, notApplicable 1, blocked 1): AC-101-1 (src/paths.py)`, shown(r));
  }
});

test('AC-19905-1: AC-101-1 claiming src/words.py#remember_word, whose only statement-level call site is in another file (src/report.py), bound to a test that goes red when that call is removed, scores callRemoval killed, never notApplicable: exit 0 with "test-strength: PASS 1 criteria at <h7>: structural 1/1, mutants killed 3/3 (timeout 0, notApplicable 0)"', async (t) => {
  const bin = binPath(t, 'host');
  atFloor(bin);
  const p = await pyProject(t, {
    acs: ['AC-101-1'],
    nodes: [['src/words.py#remember_word', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/report.test.mjs', REPORT_TEST]],
  });
  const r = await strength(p.dir, bin, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 0, `every mutant killed: exit 0\n${shown(r)}`);
  assert.equal(out(r), `test-strength: PASS 1 criteria at ${s7(p.H)}: structural 1/1, mutants killed 3/3 (timeout 0, notApplicable 0)`, shown(r));
  const j = await strength(p.dir, bin, ['--acs', 'AC-101-1', '--json']);
  assert.equal(j.code, 0, shown(j));
  const c = crit(json(j.stdout), 'AC-101-1');
  assert.deepEqual(triples(c), each('src/words.py#remember_word', KILLED_ALL).sort(), JSON.stringify(c));
  const removal = c.mutants.find((m) => m.operator === 'callRemoval');
  assert.deepEqual(removal.killedBy, [`test/report.test.mjs::${REPORT_TEST}`], `the call site in src/report.py is mutated and its bound test goes red\n${JSON.stringify(removal)}`);
});

test('AC-19905-2: AC-101-1 claiming the class src/config.py#Config, bound only to "lookup returns the value of a key", reads fail with exit 4: lookup stubToThrow and noOp killed; merge, from_text (the decorated classmethod) and fetch (the async method) stubToThrow and noOp survived and merge callRemoval survived, each survivor named vacuous in the FAIL line (every method splice leaves the module importable)', async (t) => {
  const bin = binPath(t, 'host');
  atFloor(bin);
  const pointer = `test/config.test.mjs::${CONFIG_TESTS[0]}`;
  const p = await pyProject(t, {
    acs: ['AC-101-1'],
    nodes: [['src/config.py#Config', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/config.test.mjs', CONFIG_TESTS[0]]],
  });
  const r = await strength(p.dir, bin, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 4, `surviving mutants: the FAIL exit 4\n${shown(r)}`);
  const survivors = [
    ['src/config.py#Config.merge', 'stubToThrow'], ['src/config.py#Config.merge', 'noOp'], ['src/config.py#Config.merge', 'callRemoval'],
    ['src/config.py#Config.from_text', 'stubToThrow'], ['src/config.py#Config.from_text', 'noOp'],
    ['src/config.py#Config.fetch', 'stubToThrow'], ['src/config.py#Config.fetch', 'noOp'],
  ];
  assert.deepEqual(failItems(r, s7(p.H)), vacuous('AC-101-1', 1, survivors), shown(r));
  const j = await strength(p.dir, bin, ['--acs', 'AC-101-1', '--json']);
  assert.equal(j.code, 4, shown(j));
  const c = crit(json(j.stdout), 'AC-101-1');
  assert.equal(c.result, 'fail', JSON.stringify(c));
  assert.deepEqual(triples(c), [
    ...each('src/config.py#Config.lookup', NO_CALL_SITE),
    ...each('src/config.py#Config.merge', { stubToThrow: 'survived', noOp: 'survived', callRemoval: 'survived' }),
    ...each('src/config.py#Config.from_text', { stubToThrow: 'survived', noOp: 'survived', callRemoval: 'notApplicable' }),
    ...each('src/config.py#Config.fetch', { stubToThrow: 'survived', noOp: 'survived', callRemoval: 'notApplicable' }),
  ].sort(), JSON.stringify(c));
  for (const m of c.mutants.filter((x) => x.result === 'killed')) assert.deepEqual(m.killedBy, [pointer], JSON.stringify(m));
});

test('AC-19905-2: AC-101-1 claiming src/paths.py#canonical, bound only to "canonical collapses repeated slashes and drops a trailing slash", leaves callRemoval (the statement call in warm) survived while stubToThrow and noOp are killed: exit 4 and the FAIL line "test-strength: FAIL 1 of 1 criteria at <h7>: AC-101-1 vacuous: callRemoval on src/paths.py#canonical survived 1 bound tests"', async (t) => {
  const bin = binPath(t, 'host');
  atFloor(bin);
  const p = await pyProject(t, {
    acs: ['AC-101-1'],
    nodes: [['src/paths.py#canonical', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/paths.test.mjs', PATHS_TESTS[0]]],
  });
  const r = await strength(p.dir, bin, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 4, `a surviving callRemoval: the FAIL exit 4\n${shown(r)}`);
  assert.equal(out(r), `test-strength: FAIL 1 of 1 criteria at ${s7(p.H)}: AC-101-1 vacuous: callRemoval on src/paths.py#canonical survived 1 bound tests`, shown(r));
  const j = await strength(p.dir, bin, ['--acs', 'AC-101-1', '--json']);
  assert.equal(j.code, 4, shown(j));
  const c = crit(json(j.stdout), 'AC-101-1');
  assert.equal(c.result, 'fail', JSON.stringify(c));
  assert.deepEqual(triples(c), each('src/paths.py#canonical', { stubToThrow: 'killed', noOp: 'killed', callRemoval: 'survived' }).sort(), JSON.stringify(c));
});

// src/deco.py: two top-level defs whose first body statement is decorated
// (no docstring before it), a nested def in make and a nested class in
// build, and a test that shows
// both run and nothing more, so a make or build whose body is pass passes it.
const DECO = [
  '"""Top-level functions whose first body statement is decorated."""',
  'import dataclasses',
  'import functools',
  '',
  '',
  'def make(log, path):',
  '    @functools.lru_cache(maxsize=None)',
  '    def norm(p):',
  '        return p.strip("/")',
  '    log.append(norm(path))',
  '',
  '',
  'def build(log, name):',
  '    @dataclasses.dataclass',
  '    class Item:',
  '        name: str',
  '    log.append(Item(name).name)',
  '',
].join('\n');
// The kind and decorator count of each top-level def's first body statement.
const DECO_FIRSTS = [
  'import ast, json, sys',
  'tree = ast.parse(sys.stdin.read())',
  'print(json.dumps({n.name: [type(n.body[0]).__name__, len(getattr(n.body[0], "decorator_list", []))] for n in tree.body if isinstance(n, ast.FunctionDef)}))',
].join('\n');
const DECO_TEST_NAME = 'make and build run without an error';
const DECO_TEST = [
  "// A deliberately weak test: it shows that make and build run and nothing more.",
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { python } from './_harness/python.mjs';",
  '',
  `test(${JSON.stringify(DECO_TEST_NAME)}, () => {`,
  "  const r = python(['from deco import build, make', 'make([], \"a/\")', 'build([], \"a\")']);",
  '  assert.equal(r.code, 0, r.stderr);',
  '});',
  '',
].join('\n');

test('AC-19905-2: AC-101-1 claiming src/deco.py#make, whose first body statement is a decorated nested def, and src/deco.py#build, whose first body statement is a decorated nested class, bound only to a test that shows both run, leaves the noOp mutant on each survived (the spliced module still parses, decorators included) while stubToThrow is killed: exit 4, AC-101-1 result "fail", and the FAIL line naming both noOp survivors', async (t) => {
  const bin = binPath(t, 'host');
  atFloor(bin);
  const p = await pyProject(t, {
    acs: ['AC-101-1'],
    nodes: [['src/deco.py#make', ['AC-101-1']], ['src/deco.py#build', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/deco.test.mjs', DECO_TEST_NAME]],
    files: { 'src/deco.py': DECO, 'test/deco.test.mjs': DECO_TEST },
  });
  // The Given as written parses on the host's python3, so any mutant that does not parse is the splice's,
  // and the first body statement of make is a decorated def and of build a decorated class.
  assert.equal(syntaxError('src/deco.py', DECO), null, 'the host python3 parses src/deco.py');
  const firsts = JSON.parse(execFileSync(hostPython(), ['-I', '-B', '-c', DECO_FIRSTS], { input: DECO, encoding: 'utf8' }));
  assert.deepEqual(firsts, { make: ['FunctionDef', 1], build: ['ClassDef', 1] }, 'each target opens with a decorated nested def or class');
  const r = await strength(p.dir, bin, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 4, `surviving noOp mutants: the FAIL exit 4\n${shown(r)}`);
  assert.deepEqual(failItems(r, s7(p.H)), vacuous('AC-101-1', 1, [['src/deco.py#make', 'noOp'], ['src/deco.py#build', 'noOp']]), shown(r));
  const j = await strength(p.dir, bin, ['--acs', 'AC-101-1', '--json']);
  assert.equal(j.code, 4, shown(j));
  const c = crit(json(j.stdout), 'AC-101-1');
  assert.equal(c.result, 'fail', JSON.stringify(c));
  // stubToThrow raises, so the weak test still kills it; nothing calls make or build as a statement.
  assert.deepEqual(triples(c), [
    ...each('src/deco.py#make', { stubToThrow: 'killed', noOp: 'survived', callRemoval: 'notApplicable' }),
    ...each('src/deco.py#build', { stubToThrow: 'killed', noOp: 'survived', callRemoval: 'notApplicable' }),
  ].sort(), JSON.stringify(c));
});

// src/paren.py: a top-level def whose first body statement is a nested def
// under a fully parenthesised decorator, @(deco) (PEP 614, Python 3.9 and
// later), where ast places the decorator's expression after the paren, and
// a test that shows wrap runs and nothing more, so a wrap whose body is
// pass passes it.
const PAREN = [
  '"""A top-level function whose first body statement has a parenthesised decorator."""',
  '',
  '',
  'def deco(f):',
  '    return f',
  '',
  '',
  'def wrap(log, path):',
  '    @(deco)',
  '    def norm(p):',
  '        return p.strip("/")',
  '    log.append(norm(path))',
  '',
].join('\n');
// For wrap's first body statement: its kind, its decorator count, its
// first decorator's line as written and the character just before the
// position ast gives that decorator's expression.
const PAREN_FIRST = [
  'import ast, json, sys',
  'text = sys.stdin.read()',
  'lines = text.split("\\n")',
  'wrap = next(n for n in ast.parse(text).body if isinstance(n, ast.FunctionDef) and n.name == "wrap")',
  'first = wrap.body[0]',
  'd = first.decorator_list[0]',
  'print(json.dumps([type(first).__name__, len(first.decorator_list), lines[d.lineno - 1].strip(), lines[d.lineno - 1][d.col_offset - 1]]))',
].join('\n');
const PAREN_TEST_NAME = 'wrap runs without an error';
const PAREN_TEST = [
  "// A deliberately weak test: it shows that wrap runs and nothing more.",
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { python } from './_harness/python.mjs';",
  '',
  `test(${JSON.stringify(PAREN_TEST_NAME)}, () => {`,
  "  const r = python(['from paren import wrap', 'wrap([], \"a/\")']);",
  '  assert.equal(r.code, 0, r.stderr);',
  '});',
  '',
].join('\n');

test('AC-19905-2: AC-101-1 claiming src/paren.py#wrap, whose first body statement is a nested def under the fully parenthesised decorator @(deco) (PEP 614), bound only to a test that shows wrap runs, leaves the noOp mutant survived (the spliced module still parses, the parenthesised decorator included) while stubToThrow is killed: exit 4, AC-101-1 result "fail", and the FAIL line "test-strength: FAIL 1 of 1 criteria at <h7>: AC-101-1 vacuous: noOp on src/paren.py#wrap survived 1 bound tests"', async (t) => {
  const bin = binPath(t, 'host');
  atFloor(bin);
  const p = await pyProject(t, {
    acs: ['AC-101-1'],
    nodes: [['src/paren.py#wrap', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/paren.test.mjs', PAREN_TEST_NAME]],
    files: { 'src/paren.py': PAREN, 'test/paren.test.mjs': PAREN_TEST },
  });
  // The Given as written parses on the host's python3, so any mutant that does not parse is the splice's,
  // and wrap opens with a nested def under one decorator written @(deco), whose expression ast places after the paren.
  assert.equal(syntaxError('src/paren.py', PAREN), null, 'the host python3 parses src/paren.py');
  const first = JSON.parse(execFileSync(hostPython(), ['-I', '-B', '-c', PAREN_FIRST], { input: PAREN, encoding: 'utf8' }));
  assert.deepEqual(first, ['FunctionDef', 1, '@(deco)', '('], 'wrap opens with a nested def under the parenthesised decorator @(deco)');
  const r = await strength(p.dir, bin, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 4, `a surviving noOp mutant: the FAIL exit 4\n${shown(r)}`);
  assert.equal(out(r), `test-strength: FAIL 1 of 1 criteria at ${s7(p.H)}: AC-101-1 vacuous: noOp on src/paren.py#wrap survived 1 bound tests`, shown(r));
  const j = await strength(p.dir, bin, ['--acs', 'AC-101-1', '--json']);
  assert.equal(j.code, 4, shown(j));
  const c = crit(json(j.stdout), 'AC-101-1');
  assert.equal(c.result, 'fail', JSON.stringify(c));
  // stubToThrow raises, so the weak test still kills it; nothing calls wrap as a statement.
  assert.deepEqual(triples(c), each('src/paren.py#wrap', { stubToThrow: 'killed', noOp: 'survived', callRemoval: 'notApplicable' }).sort(), JSON.stringify(c));
});

test('AC-19905-5: AC-101-1 claiming src/broken.py#parse, a .py file the host python3 cannot parse, is blocked, reason TEST_STRENGTH_UNSUPPORTED, detail "src/broken.py:<line>:<col>: <the SyntaxError message>" from the 1-based line and column the host python3 reports, never a pass and never a guess, while AC-101-2 claiming src/slug.js#slug is judged pass: exit 5 with "test-strength: BLOCKED 2 criteria at <h7>: structural 1/1, mutants killed 2/2 (timeout 0, notApplicable 1, blocked 1): AC-101-1 (src/broken.py)"; the audit never crashes', async (t) => {
  const bin = binPath(t, 'host');
  atFloor(bin);
  const broken = [
    '"""A module the host\'s python3 cannot parse: parse never closes its call."""',
    '',
    '',
    'def parse(text):',
    '    return text.split(",",',
    '',
  ].join('\n');
  const err = syntaxError('src/broken.py', broken);
  assert.ok(Array.isArray(err) && err[0] >= 1 && err[1] >= 1 && err[2] !== '', `the host's python3 refuses src/broken.py: ${JSON.stringify(err)}`);
  const p = await pyProject(t, {
    acs: ['AC-101-1', 'AC-101-2'],
    nodes: [['src/broken.py#parse', ['AC-101-1']], ['src/slug.js#slug', ['AC-101-2']]],
    bind: [...bindAll('AC-101-1', 'test/paths.test.mjs', PATHS_TESTS), ['AC-101-2', 'test/slug.test.mjs', SLUG_TEST]],
    files: { 'src/broken.py': broken },
  });
  const j = await strength(p.dir, bin, ['--acs', 'AC-101-1,AC-101-2', '--json']);
  assert.equal(j.code, 5, `a blocked criterion beside a passing one: exit 5\n${shown(j)}`);
  noCrash(j);
  const report = json(j.stdout);
  const c = crit(report, 'AC-101-1');
  assert.equal(c.result, 'blocked', JSON.stringify(c));
  assert.equal(c.reason, 'TEST_STRENGTH_UNSUPPORTED', JSON.stringify(c));
  assert.equal(c.blocked, true, JSON.stringify(c));
  assert.equal(c.detail, `src/broken.py:${err[0]}:${err[1]}: ${err[2]}`, JSON.stringify(c));
  assert.deepEqual(c.mutants, [], JSON.stringify(c));
  const js = crit(report, 'AC-101-2');
  assert.equal(js.result, 'pass', `the .js criterion is judged as before\n${JSON.stringify(js)}`);
  assert.deepEqual(triples(js), each('src/slug.js#slug', NO_CALL_SITE).sort());
  assert.equal(report.result, 'blocked', JSON.stringify(report));
  assert.equal(report.totals.blocked, 1, JSON.stringify(report.totals));
  const r = await strength(p.dir, bin, ['--acs', 'AC-101-1,AC-101-2']);
  assert.equal(r.code, 5, shown(r));
  noCrash(r);
  assert.equal(out(r), `test-strength: BLOCKED 2 criteria at ${s7(p.H)}: structural 1/1, mutants killed 2/2 (timeout 0, notApplicable 1, blocked 1): AC-101-1 (src/broken.py)`, shown(r));
});
