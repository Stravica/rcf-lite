// FBS-242 amend round (round E; US-19903, US-19904): rcf audit
// test-strength over workspace packages. A working copy links each
// workspace package's node_modules keeping each link's own target, and a
// bound test runs at its package directory (the nearest directory at HEAD
// from the test file up to the rcf project root holding a package.json,
// else the rcf project root) with <file> relative to it, whatever its
// runner kind; a runners entry may pin "cwd": "project", and any other
// cwd value is a malformed config; every node_modules/.bin from the test's
// package up to the repository root joins PATH, nearest first, ahead of
// the inherited PATH, under every runner kind and a "cwd": "project"
// entry, so a bare tsx resolves through its package's .bin under a
// nodeTest entry and through the repository root's .bin under the legacy
// runner, the package's .bin comes before the root's and the caller's, and
// vitest resolves through an ancestor's .bin; the backstop covers every
// linked node_modules, naming a path relative to the rcf project root;
// a red unmutated run names the cwd it ran at and points at "cwd":
// "project"; and the help keeps its backstop sentence.
//
// Criteria: 9, all external. Each test drives bin/rcf.js audit
// test-strength (or --help) as a child process over a scratch copy of a
// committed fixture world under test/fixtures/round-e/ (ws-two, the
// pnpm layout: package dependencies not hoisted, a workspace package
// link, a cwd-relative path; ws-sibling, an rcf project beside a sibling
// package; ws-kinds, one package per runner kind; ws-root-config, a
// vitest config at the rcf project root with its test in a nested
// package), laid over the project
// the bin's own rcf init makes. The test writes the installed layout
// (links and stand-in packages under node_modules, gitignored, as the
// round D tests write node_modules/rootpkg), the rcf/test-strength.json
// and the Code Node records its criterion's Given names, and commits the
// world to git; ws-kinds installs apps/web's devDependencies with npm ci,
// and ws-root-config its root's, as the round D tests install theirs, and
// the PATH-order test installs vitest for ws-two's root with npm ci in a
// scratch directory of its own and moves it into the root's node_modules.
// Before each audit the bound tests
// are run in place at their package directory, so a red audit is the
// audit's. Every run passes PATH from toolPath(['node', 'sh']), node's
// directory first, and no node_modules/.bin (the PATH-order test puts a
// directory holding a stand-in tsx that exits 1 ahead of it). Red at the round E DEFINE
// head: 0.39.0 links only the node_modules of the rcf project and its
// ancestors, runs every bound test at the rcf project root, and puts a
// node_modules/.bin on PATH for vitest and playwright only.
//
// Round F (the round E REVIEW notes F-1 to F-4 and F-8, and the
// stage-keeper's rulings on the first DEFINE pass, A and C): three more
// criteria, AC-19903-13 (a failing git ls-tree as the audit reads HEAD,
// the workspace packages' listing or the files at HEAD, exits 2 naming
// the command; a git stand-in first on PATH fails one listing),
// AC-19903-14 (F-9: a re-pointed link whose package entry, exports, then
// main, then index.js, is not committed at HEAD stays at the repo's own
// package with one notice line, a second form of it where the package has
// no entry, and the run proceeds with its own exit; on a run that
// proceeds the notice follows AC-19904-12's line when that line prints,
// a real tsx in the hoisted world under a long temp directory, and leads
// stderr otherwise, ahead of another criterion's withheld-column line)
// and AC-19903-15 (the help names the real path of each node_modules and
// the repository's .git), red at the round F DEFINE head until its BUILD;
// and three declared regression guards, green there: AC-19904-11's hint
// at the rcf project root ("ran at ."), and AC-19903-9 in npm's hoisted
// layout (test/fixtures/round-f/ws-hoisted, the link in the rcf project's
// own node_modules re-pointed into the copy, TAC-4155
// responsibilities[4], its entry committed so no notice prints), whose
// build-output layouts are the AC-19903-14 worlds. Criteria: 12, all
// external. Imports: Node builtins and test/_harness/ only (GR-40).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { delimiter, dirname, join, sep } from 'node:path';

import { PACKAGE_ROOT, lines, rcf, run, toolPath } from '../_harness/spawn.js';
import { commit, initRepo, s7 } from '../_harness/git.js';
import { bindTests, criterion, editFbs, editStory, project, scratch, writeJson, writeText } from '../_harness/fixture.js';
import { json } from '../_harness/capture.js';

const WORLDS = join(PACKAGE_ROOT, 'test', 'fixtures', 'round-e');
const RC46 = join(PACKAGE_ROOT, 'test', 'fixtures', 'rc-46');
const q = JSON.stringify;
const HARNESS = ['test/_harness/**'];

// node's directory ahead of git's, and sh's (as the round D tests do); no node_modules/.bin.
const nodeFirst = () => { const [gitDir, ...rest] = toolPath(['node', 'sh']).split(delimiter); return [...rest, gitDir].join(delimiter); };
const strength = (dir, args = []) => rcf(['audit', 'test-strength', ...args], { cwd: dir, env: { PATH: nodeFirst() }, timeout: 900_000 });
const out = (r) => r.stdout.replace(/\n$/, '');
const shown = (r) => `exit ${r.code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
const passLine = (h, n, k, total, timeout = 0, na = 0) => `test-strength: PASS ${n} criteria at ${s7(h)}: structural ${n}/${n}, mutants killed ${k}/${total} (timeout ${timeout}, notApplicable ${na})`;
const noUnmutatedRed = (r) => assert.ok(!lines(r.stderr).some((l) => l.startsWith('test-strength: the unmutated run is red')), `no "the unmutated run is red" line\n${shown(r)}`);
const noCannotRun = (r) => assert.ok(!lines(r.stderr).some((l) => l.startsWith('test-strength: cannot run the bound tests')), `no "cannot run the bound tests" line\n${shown(r)}`);

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

// The chain of a fixture world: US-101 holding `acs` (FBS-001 scoping
// them at inProgress), rcf/test-strength.json `config`, Code Nodes
// [[path, acIds]] and bound tests [[acId, file, name]].
function chain(dir, { acs, config, nodes, bind }) {
  editStory(dir, 'US-101', (us) => { us.acceptanceCriteria = acs.map((id) => criterion(id, `${id} holds for the fixture world`)); });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = acs; f.executionStatus = 'inProgress'; });
  writeText(dir, 'rcf/test-strength.json', `${q(config, null, 2)}\n`);
  codeNodes(dir, nodes);
  bindTests(dir, bind.map(([acId, file, title]) => ({ acId, pointer: `${file}::${title}` })), { realTests: false });
  writeText(dir, '.gitignore', 'node_modules/\n');
}

const link = (target, path) => { mkdirSync(dirname(path), { recursive: true }); symlinkSync(target, path, 'junction'); };

// What pnpm installs for ws-two, written as pnpm lays it out: ms in the
// root store only, reached from apps/api/node_modules/ms by a relative
// link; @ws/lib a relative link to apps/lib inside a real scope
// directory; a stand-in tsx (it runs node with the same arguments) in
// apps/api/node_modules/.bin, or in `tsxBin` (the repository root's
// node_modules/.bin for a root devDependency, nothing of it in apps/api);
// and a stand-in tsx that exits 1 in each directory `exitOneTsxBins`
// names (none by default). Nothing of ms or @ws/lib at the root.
function pnpmLayout(dir, { tsxBin = 'apps/api/node_modules/.bin', exitOneTsxBins = [] } = {}) {
  const store = 'node_modules/.pnpm/ms@2.1.3/node_modules/ms';
  writeText(dir, `${store}/package.json`, `${q({ name: 'ms', version: '2.1.3', main: 'index.js' }, null, 2)}\n`);
  writeText(dir, `${store}/index.js`, [
    '// A stand-in for ms 2.1.3: "<n>ms", "<n>s", "<n>m" or "<n>h" in milliseconds.',
    'const UNIT = { ms: 1, s: 1000, m: 60000, h: 3600000 };',
    'module.exports = function ms(text) {',
    '  const m = /^(\\d+)(ms|s|m|h)$/.exec(String(text));',
    '  return m ? Number(m[1]) * UNIT[m[2]] : undefined;',
    '};',
    '',
  ].join('\n'));
  link(`../../../${store}`, join(dir, 'apps', 'api', 'node_modules', 'ms'));
  link('../../../lib', join(dir, 'apps', 'api', 'node_modules', '@ws', 'lib'));
  writeText(dir, `${tsxBin}/tsx`, [
    '#!/usr/bin/env node',
    '// A stand-in for tsx: the fixture tests are plain JavaScript, so node runs them with the same arguments.',
    "const { spawnSync } = require('node:child_process');",
    "const r = spawnSync(process.execPath, process.argv.slice(2), { stdio: 'inherit' });",
    'process.exit(r.status === null ? 1 : r.status);',
    '',
  ].join('\n'));
  chmodSync(join(dir, ...tsxBin.split('/'), 'tsx'), 0o755);
  for (const bin of exitOneTsxBins) exitOneTsx(join(dir, ...bin.split('/')), `${bin}/tsx`);
}

// A stand-in tsx in `binDir` that must never be the one a run finds: it
// runs nothing and exits 1, naming itself on stderr.
function exitOneTsx(binDir, where) {
  mkdirSync(binDir, { recursive: true });
  writeText(binDir, 'tsx', [
    '#!/usr/bin/env node',
    `// A stand-in tsx that runs nothing and exits 1: ${where} is not the tsx the run must find first.`,
    `process.stderr.write(${q(`the tsx stand-in in ${where} exits 1\n`)});`,
    'process.exit(1);',
    '',
  ].join('\n'));
  chmodSync(join(binDir, 'tsx'), 0o755);
}

// ws-two in git at H: the rcf init project with the world laid over it,
// the pnpm layout written (`layout` as pnpmLayout takes it), and the chain.
async function wsTwo(t, spec, layout = {}) {
  const dir = await project(t, { name: 'ws' });
  cpSync(join(WORLDS, 'ws-two'), dir, { recursive: true });
  pnpmLayout(dir, layout);
  chain(dir, spec);
  initRepo(dir);
  const H = commit(dir, 'fixture: base');
  return { dir, H };
}

// A bound test run in place, as its package's own test script runs it:
// node --test at `cwd` (the package directory), every test passing.
function inPlace(cwd, file, { argv = [process.execPath, '--test', file], env = {} } = {}) {
  const r = run(argv[0], argv.slice(1), { cwd, env: { PATH: nodeFirst(), ...env } });
  assert.equal(r.code, 0, `the fixture world is valid: ${argv.slice(1).join(' ')} passes in place at ${cwd}\n${r.stdout}${r.stderr}`);
  return r;
}

const ENTRY_TWO = [{ kind: 'module', path: 'apps/api/src/index.js' }, { kind: 'module', path: 'apps/lib/src/index.js' }];
const API_TEST = 'apps/api/test/api.test.mjs';

// ---------------------------------------------------------------- US-19903

test('AC-19903-8: a bound test in a workspace package resolves a dependency installed only in its package', async (t) => {
  const w = await wsTwo(t, {
    acs: ['AC-101-1'],
    config: { entry: ENTRY_TWO, harness: HARNESS },
    nodes: [['apps/api/src/index.js#toMs', ['AC-101-1']]],
    bind: [['AC-101-1', API_TEST, 'C1 toMs reads a duration through ms']],
  });
  assert.ok(!existsSync(join(w.dir, 'node_modules', 'ms')) && existsSync(join(w.dir, 'apps', 'api', 'node_modules', 'ms', 'package.json')), 'ms is installed in apps/api/node_modules only, nothing of it at the root');
  inPlace(join(w.dir, 'apps', 'api'), 'test/api.test.mjs');
  const r = await strength(w.dir, ['--acs', 'AC-101-1']);
  noUnmutatedRed(r);
  assert.equal(r.code, 0, `the unmutated run is green and every mutant is killed: exit 0\n${shown(r)}`);
  assert.equal(out(r), passLine(w.H, 1, 2, 2, 0, 1), shown(r));
});

test('AC-19903-9: a workspace sibling imported by name resolves inside the working copy', async (t) => {
  const w = await wsTwo(t, {
    acs: ['AC-101-1'],
    config: { entry: ENTRY_TWO, harness: HARNESS },
    nodes: [['apps/lib/src/index.js#greet', ['AC-101-1']]],
    bind: [['AC-101-1', API_TEST, 'C3 greet comes from the workspace library']],
  });
  inPlace(join(w.dir, 'apps', 'api'), 'test/api.test.mjs');
  const r = await strength(w.dir, ['--acs', 'AC-101-1', '--json']);
  noUnmutatedRed(r);
  assert.equal(r.code, 0, `each mutant of apps/lib/src/index.js#greet is applied in the working copy's apps/lib and killed: exit 0\n${shown(r)}`);
  const mutants = json(r.stdout).criteria.find((c) => c.acId === 'AC-101-1').mutants.filter((m) => m.result !== 'notApplicable');
  assert.ok(mutants.length > 0, `greet has mutants\n${r.stdout}`);
  for (const m of mutants) assert.equal(m.result, 'killed', `${m.symbol} ${m.operator}: killed, never survived\n${r.stdout}`);
  const line = await strength(w.dir, ['--acs', 'AC-101-1']);
  assert.equal(out(line), passLine(w.H, 1, 2, 2, 0, 1), shown(line));
});

test('AC-19903-10: a bound test runs at its package directory, and a test with no package.json between it and the rcf project root runs at the rcf project root', async (t) => {
  const w = await wsTwo(t, {
    acs: ['AC-101-1', 'AC-101-2'],
    config: { entry: ENTRY_TWO, harness: HARNESS },
    nodes: [['apps/api/src/index.js#readPort', ['AC-101-1']], ['apps/api/src/index.js#readRootPort', ['AC-101-2']]],
    bind: [['AC-101-1', API_TEST, 'C2 readPort reads the package fixture'], ['AC-101-2', 'test/root.test.mjs', 'R0 readRootPort reads from the rcf project root']],
  });
  inPlace(join(w.dir, 'apps', 'api'), 'test/api.test.mjs');
  inPlace(w.dir, 'test/root.test.mjs');
  const pkg = await strength(w.dir, ['--acs', 'AC-101-1']);
  noUnmutatedRed(pkg);
  assert.equal(pkg.code, 0, `the apps/api test runs at apps/api with its file relative to it: exit 0\n${shown(pkg)}`);
  assert.equal(out(pkg), passLine(w.H, 1, 2, 2, 0, 1), shown(pkg));
  const root = await strength(w.dir, ['--acs', 'AC-101-2']);
  assert.equal(root.code, 0, `the test under test/ runs at the rcf project root: exit 0\n${shown(root)}`);
  assert.equal(out(root), passLine(w.H, 1, 2, 2, 0, 1), shown(root));
});

// The fixture's own devDependencies, from its lockfile, into its
// node_modules (gitignored): npm's temp files stay in the test's scratch.
function install(t, dir) {
  const tmp = join(scratch(t, 'rcf-h-npm-'), 'tmp');
  mkdirSync(tmp, { recursive: true });
  const r = run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'], {
    cwd: dir, env: { PATH: toolPath(['node', 'npm', 'sh']), TMPDIR: tmp, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }, timeout: 600_000,
  });
  assert.equal(r.code, 0, `npm ci in the fixture copy\n${r.stdout}${r.stderr}`);
}

test('AC-19903-10: every runner kind runs a bound test at its package directory: a vitest and a playwright runners entry and the legacy runner, each reading a fixture relative to its package, exit 0 with the PASS line', async (t) => {
  const dir = await project(t, { name: 'kinds' });
  cpSync(join(WORLDS, 'ws-kinds'), dir, { recursive: true });
  const web = join(dir, 'apps', 'web');
  for (const f of ['package.json', 'package-lock.json', 'playwright.config.ts', 'src']) cpSync(join(RC46, 'c-playwright', f), join(web, f), { recursive: true });
  const title = 'title > slugs the title of the package fixture';
  chain(dir, {
    acs: ['AC-101-1', 'AC-101-2', 'AC-101-3'],
    config: {
      entry: [{ kind: 'module', path: 'apps/web/src/index.ts' }, { kind: 'module', path: 'apps/js/src/index.js' }],
      harness: HARNESS,
      runners: [{ files: ['apps/web/test/**'], kind: 'vitest' }, { files: ['apps/web/e2e/**'], kind: 'playwright' }],
      runner: ['node', '--test', '--test-name-pattern', '<name>', '<file>'],
    },
    nodes: [['apps/web/src/slug.ts#slugify', ['AC-101-1', 'AC-101-2']], ['apps/js/src/index.js#readPort', ['AC-101-3']]],
    bind: [
      ['AC-101-1', 'apps/web/test/title.test.ts', title],
      ['AC-101-2', 'apps/web/e2e/title.spec.ts', title],
      ['AC-101-3', 'apps/js/test/port.test.mjs', 'P1 readPort reads the package fixture'],
    ],
  });
  install(t, web);
  initRepo(dir);
  const H = commit(dir, 'fixture: base');
  // vitest and Playwright keep caches under TMPDIR (playwright-transform-cache-<uid>): the test's own scratch holds them.
  const tmp = scratch(t, 'rcf-h-tmp-');
  inPlace(web, 'test/title.test.ts', { argv: [join(web, 'node_modules', '.bin', 'vitest'), 'run', 'test/title.test.ts'], env: { TMPDIR: tmp } });
  inPlace(web, 'e2e/title.spec.ts', { argv: [join(web, 'node_modules', '.bin', 'playwright'), 'test', 'e2e/title.spec.ts'], env: { TMPDIR: tmp } });
  inPlace(join(dir, 'apps', 'js'), 'test/port.test.mjs');
  const r = await strength(dir, ['--acs', 'AC-101-1,AC-101-2,AC-101-3']);
  noCannotRun(r);
  noUnmutatedRed(r);
  assert.equal(r.code, 0, `each kind's bound test runs at its package directory: exit 0\n${shown(r)}`);
  assert.equal(out(r), passLine(H, 3, 6, 6, 0, 3), shown(r));
});

// The rcf project in packages/a of ws-sibling, beside packages/b, whose
// node_modules holds bpkg (gitignored, written here), in git at H.
async function wsSibling(t) {
  const made = await project(t, { name: 'sib' });
  const root = dirname(made);
  const dir = join(root, 'packages', 'a');
  mkdirSync(dirname(dir), { recursive: true });
  renameSync(made, dir);
  cpSync(join(WORLDS, 'ws-sibling'), root, { recursive: true });
  chain(dir, {
    acs: ['AC-101-1'],
    config: { entry: [{ kind: 'module', path: 'src/index.js' }], harness: HARNESS },
    nodes: [['src/index.js#double', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/write.test.mjs', 'B1 double doubles, and the run writes under the sibling package node_modules']],
  });
  writeText(root, 'packages/b/node_modules/bpkg/package.json', `${q({ name: 'bpkg', version: '1.0.0', type: 'module', main: 'index.js' }, null, 2)}\n`);
  writeText(root, 'packages/b/node_modules/bpkg/index.js', 'export const b = 1;\n');
  writeText(root, '.gitignore', 'node_modules/\n');
  initRepo(root);
  const H = commit(root, 'fixture: base');
  return { root, dir, H };
}

test('AC-19903-11: a bound test writing under a sibling package node_modules through the working copy links exits 2 with "test-strength: a bound test run wrote <path> in the project" naming it', async (t) => {
  const w = await wsSibling(t);
  const written = join(w.root, 'packages', 'b', 'node_modules', 'bpkg', 'w.txt');
  inPlace(w.dir, 'test/write.test.mjs');
  assert.ok(existsSync(written), 'in place, the bound test writes w.txt inside packages/b/node_modules/bpkg');
  const r = await strength(w.dir, ['--acs', 'AC-101-1']);
  const m = lines(r.stderr).map((l) => /^test-strength: a bound test run wrote (.+) in the project$/.exec(l)).find(Boolean);
  assert.ok(m, `stderr carries "test-strength: a bound test run wrote <path> in the project"\n${shown(r)}`);
  assert.ok(m[1].split(sep).join('/').endsWith('../b/node_modules/bpkg/w.txt'), `the line names w.txt relative to the rcf project root (packages/a): ../b/node_modules/bpkg/w.txt\n${m[0]}`);
  assert.equal(r.code, 2, `a bound test run wrote under the sibling package's node_modules: exit 2\n${shown(r)}`);
});

// The help sentence the 0.39.0 Known issue names, as src/cli/test-strength.js:70 to :77 print it at 0.39.0.
const BACKSTOP_SENTENCE = 'Nothing in the project is written outside rcf/verdicts/<H12>/: the audit compares the project tree (node_modules and every dot directory included, .git excluded) and every node_modules directory on Node\'s module resolution path above it, up to the repository root, before and after the bound tests run, and a path a bound test run wrote there exits 2 "test-strength: a bound test run wrote <path> in the project" (a path above the project named relative to it) and records nothing.';

// A declared regression guard (green at the round E DEFINE head): the
// help paragraph BUILD rewrites keeps this sentence.
test('AC-19903-12: rcf audit test-strength --help keeps the backstop sentence the 0.39.0 Known issue names', async (t) => {
  const r = await rcf(['audit', 'test-strength', '--help'], { cwd: scratch(t, 'rcf-h-help-') });
  assert.equal(r.code, 0, shown(r));
  const flat = r.stdout.split(/\s+/).filter(Boolean).join(' ');
  assert.ok(flat.includes(BACKSTOP_SENTENCE), `the help, whitespace collapsed, holds the backstop sentence\n${BACKSTOP_SENTENCE}\n---\n${r.stdout}`);
});

// Round F, F-8 (the 0.40.0 Known issue "rcf audit test-strength --help
// still describes the bound-test backstop more narrowly than the audit
// applies it: the real path of node_modules and the repository's .git are
// also checked"): the backstop paragraph names both roots
// (src/audit/test-strength/runner.js forbiddenRoots: the real location
// of each node_modules it compares, the target where node_modules is a
// symbolic link, and the repository's .git, named relative to the
// project). Red at the round F DEFINE head: the help names neither.
const BACKSTOP_ROOTS_SENTENCE = 'Each node_modules directory it compares is read at its real path (where node_modules is a symbolic link, the directory it points to), and it compares the repository\'s .git as well, a write there named relative to the project (.git/<path> at the repository root, ../.git/<path> one directory below it).';

test("AC-19903-15: rcf audit test-strength --help names the real path of each node_modules the backstop compares and the repository's .git, beside the backstop sentence", async (t) => {
  const r = await rcf(['audit', 'test-strength', '--help'], { cwd: scratch(t, 'rcf-h-help-') });
  assert.equal(r.code, 0, shown(r));
  const flat = r.stdout.split(/\s+/).filter(Boolean).join(' ');
  assert.ok(flat.includes(BACKSTOP_SENTENCE), `the help, whitespace collapsed, still holds the backstop sentence AC-19903-12 pins\n${r.stdout}`);
  assert.ok(flat.includes(BACKSTOP_ROOTS_SENTENCE), `the help, whitespace collapsed, holds the sentence naming the real path of each node_modules and the repository's .git\n${BACKSTOP_ROOTS_SENTENCE}\n---\n${r.stdout}`);
});

// Round F fix round, the owner's rulings 33 and 34 (Review 1 F-5): the
// help documented a method path form <file>#<Class>.<method> that
// `rcf define create cn` refuses by design. The help says instead that a
// class symbol expands to all its methods and that the TC pointer, not
// the Code Node, gives method precision. Red at the fix round DEFINE
// head: the help still prints the method path form.
const CLASS_SYMBOL_SENTENCE = 'a class symbol expands to all its methods; the TC pointer chooses which test runs, not which methods are mutated';

test('AC-19903-15: rcf audit test-strength --help says a class symbol expands to all its methods and the TC pointer chooses which test runs, not which methods are mutated, and prints no method path form <file>#<Class>.<method>', async (t) => {
  const r = await rcf(['audit', 'test-strength', '--help'], { cwd: scratch(t, 'rcf-h-help-') });
  assert.equal(r.code, 0, shown(r));
  const flat = r.stdout.split(/\s+/).filter(Boolean).join(' ');
  assert.ok(flat.includes(CLASS_SYMBOL_SENTENCE), `the help, whitespace collapsed, holds the class-symbol sentence\n${CLASS_SYMBOL_SENTENCE}\n---\n${r.stdout}`);
  assert.ok(!flat.includes('#<Class>.<method>'), `the help prints no method path form <file>#<Class>.<method>\n${r.stdout}`);
});

// ---------------------------------------------------------------- US-19904

// A declared regression guard (green at the round E DEFINE head, where
// every bound test runs at the rcf project root): the escape hatch keeps
// a root-relative test in a nested package green.
test('AC-19904-8: a runners entry with "cwd": "project" runs its tests at the rcf project root with a project-relative file', async (t) => {
  const file = 'apps/api/test/root.test.mjs';
  const w = await wsTwo(t, {
    acs: ['AC-101-1'],
    config: { entry: ENTRY_TWO, harness: HARNESS, runners: [{ files: [file], kind: 'nodeTest', cwd: 'project' }] },
    nodes: [['apps/api/src/index.js#readRootPort', ['AC-101-1']]],
    bind: [['AC-101-1', file, 'R1 readRootPort reads from the rcf project root']],
  });
  inPlace(w.dir, file);
  const r = await strength(w.dir, ['--acs', 'AC-101-1']);
  noUnmutatedRed(r);
  assert.equal(r.code, 0, `the bound test runs at the rcf project root with ${file}: exit 0\n${shown(r)}`);
  assert.equal(out(r), passLine(w.H, 1, 2, 2, 0, 1), shown(r));
});

// The stage-keeper's gate ruling 6: a runner whose config sits at the
// repository root with tests in nested packages pins "cwd": "project" on
// its runners entry. A declared regression guard (green at the round E
// DEFINE head, where every bound test runs at the rcf project root): the
// nested check is collected through the root vitest config alone, so a
// vitest entry with "cwd": "project" run at its package directory is red.
test('AC-19904-8: a vitest runners entry with "cwd": "project" and a vitest config at the rcf project root runs its test in a nested package, exit 0 with the PASS line', async (t) => {
  const dir = await project(t, { name: 'rootcfg' });
  cpSync(join(WORLDS, 'ws-root-config'), dir, { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) cpSync(join(RC46, 'b-vitest', f), join(dir, f));
  const file = 'apps/web/checks/title.check.mjs';
  chain(dir, {
    acs: ['AC-101-1'],
    config: { entry: [{ kind: 'module', path: 'apps/web/src/index.js' }], harness: HARNESS, runners: [{ files: ['apps/web/checks/**'], kind: 'vitest', cwd: 'project' }] },
    nodes: [['apps/web/src/index.js#slugify', ['AC-101-1']]],
    bind: [['AC-101-1', file, 'title > slugs a title']],
  });
  install(t, dir);
  initRepo(dir);
  const H = commit(dir, 'fixture: base');
  // vitest keeps caches under TMPDIR: the test's own scratch holds them.
  const tmp = scratch(t, 'rcf-h-tmp-');
  inPlace(dir, file, { argv: [join(dir, 'node_modules', '.bin', 'vitest'), 'run', file], env: { TMPDIR: tmp } });
  const r = await strength(dir, ['--acs', 'AC-101-1']);
  noCannotRun(r);
  noUnmutatedRed(r);
  assert.equal(r.code, 0, `the vitest entry runs at the rcf project root, where its config collects ${file}: exit 0\n${shown(r)}`);
  assert.equal(out(r), passLine(H, 1, 2, 2, 0, 1), shown(r));
});

test('AC-19904-9: a nodeTest runners entry whose argv starts with a bare tsx installed in the test package runs from a PATH holding no node_modules/.bin, exit 0 with the PASS line', async (t) => {
  const file = 'apps/api/test/tsx.test.mjs';
  const w = await wsTwo(t, {
    acs: ['AC-101-1'],
    config: {
      entry: ENTRY_TWO, harness: HARNESS,
      runners: [{ files: [file], kind: 'nodeTest', argv: ['tsx', '--test', '--test-reporter=tap', '--test-name-pattern', '<name>', '<file>'] }],
    },
    nodes: [['apps/api/src/index.js#clampPort', ['AC-101-1']]],
    bind: [['AC-101-1', file, 'T1 clampPort keeps a port in range']],
  });
  const api = join(w.dir, 'apps', 'api');
  assert.ok(!nodeFirst().split(delimiter).some((d) => d.split(sep).includes('node_modules')), `the audit's PATH holds no node_modules/.bin\n${nodeFirst()}`);
  inPlace(api, 'test/tsx.test.mjs', { argv: [join(api, 'node_modules', '.bin', 'tsx'), '--test', 'test/tsx.test.mjs'] });
  const r = await strength(w.dir, ['--acs', 'AC-101-1']);
  noCannotRun(r);
  assert.equal(r.code, 0, `the bare tsx resolves through apps/api/node_modules/.bin and the test runs: exit 0\n${shown(r)}`);
  assert.equal(out(r), passLine(w.H, 1, 2, 2, 0, 1), shown(r));
});

// The stage-keeper's gate ruling 2: every node_modules/.bin from the
// test's package up to the repository root joins PATH, under every runner
// kind. Red at the round E DEFINE head for its own reason: 0.39.0 puts a
// node_modules/.bin on PATH for vitest and playwright only, so a bare tsx
// under the legacy runner resolves from the caller's PATH alone.
test('AC-19904-9: the legacy runner whose argv starts with a bare tsx installed only in the repository root node_modules/.bin runs a test in apps/api from a PATH holding no node_modules/.bin, exit 0 with the PASS line', async (t) => {
  const file = 'apps/api/test/tsx.test.mjs';
  const w = await wsTwo(t, {
    acs: ['AC-101-1'],
    config: { entry: ENTRY_TWO, harness: HARNESS, runner: ['tsx', '--test', '--test-name-pattern', '<name>', '<file>'] },
    nodes: [['apps/api/src/index.js#clampPort', ['AC-101-1']]],
    bind: [['AC-101-1', file, 'T1 clampPort keeps a port in range']],
  }, { tsxBin: 'node_modules/.bin' });
  const api = join(w.dir, 'apps', 'api');
  const rootTsx = join(w.dir, 'node_modules', '.bin', 'tsx');
  assert.ok(existsSync(rootTsx) && !existsSync(join(api, 'node_modules', '.bin', 'tsx')), 'tsx is installed in the repository root node_modules/.bin only, nothing of it in apps/api');
  assert.ok(!nodeFirst().split(delimiter).some((d) => d.split(sep).includes('node_modules')), `the audit's PATH holds no node_modules/.bin\n${nodeFirst()}`);
  inPlace(api, 'test/tsx.test.mjs', { argv: [rootTsx, '--test', 'test/tsx.test.mjs'] });
  const r = await strength(w.dir, ['--acs', 'AC-101-1']);
  noCannotRun(r);
  assert.equal(r.code, 0, `the bare tsx resolves through the repository root node_modules/.bin and the test runs: exit 0\n${shown(r)}`);
  assert.equal(out(r), passLine(w.H, 1, 2, 2, 0, 1), shown(r));
});

// A real runner in the repository root's node_modules, as a root
// devDependency installs it: an rc-46 fixture's package.json and lockfile
// (b-vitest's for vitest, a-tsx-node-test's for tsx) installed with npm ci
// in a scratch directory of its own (npm's temp files in the test's
// scratch), then its node_modules entries moved into the world's
// node_modules (gitignored), its .bin entries merged into the root's .bin.
// The world's committed package.json stays its own and no lockfile is
// written in it.
function rootInstall(t, dir, fixture) {
  const at = scratch(t, 'rcf-h-root-install-');
  for (const f of ['package.json', 'package-lock.json']) cpSync(join(RC46, fixture, f), join(at, f));
  install(t, at);
  const from = join(at, 'node_modules');
  const to = join(dir, 'node_modules');
  mkdirSync(join(to, '.bin'), { recursive: true });
  for (const e of readdirSync(from)) {
    if (e === '.package-lock.json') continue;
    const names = e === '.bin' ? readdirSync(join(from, e)).map((b) => join('.bin', b)) : [e];
    for (const n of names) {
      assert.ok(!existsSync(join(to, n)), `the world's node_modules holds no ${n} before ${fixture}'s install moves in`);
      renameSync(join(from, n), join(to, n));
    }
  }
}
const rootVitest = (t, dir) => rootInstall(t, dir, 'b-vitest');

// The stage-keeper's DEFINE-3 ruling 1 (gate ruling 2's clauses no test
// pinned): every node_modules/.bin from the test's package up to the
// repository root joins PATH, nearest first, ahead of the inherited PATH,
// under every runner kind and a "cwd": "project" entry. In ws-two a
// passing stand-in tsx sits in apps/api/node_modules/.bin, a stand-in tsx
// that exits 1 in the repository root's node_modules/.bin and another in a
// directory on the caller's PATH (ahead of node's), and the real vitest in
// the root's node_modules/.bin alone. Four audits of one world: a bare tsx
// under a nodeTest runners entry, the legacy runner and a nodeTest entry
// with "cwd": "project" (each green only when apps/api's .bin comes
// first), and a vitest entry whose test sits in apps/api (green only when
// the root's .bin, an ancestor's, joins PATH). Red at the round E DEFINE
// head on its first audit: 0.39.0 puts no node_modules/.bin on PATH for a
// nodeTest entry or the legacy runner, so the caller's tsx runs and exits
// 1. A build adding only the package .bin, for nodeTest alone, is red on
// the legacy audit.
test('AC-19904-9: the PATH order: a bare tsx under a nodeTest runners entry, the legacy runner and a "cwd": "project" entry resolves to the passing tsx in apps/api/node_modules/.bin ahead of the stand-ins that exit 1 in the repository root node_modules/.bin and on the caller PATH, and a vitest entry finds vitest in the repository root node_modules/.bin alone for its test in apps/api, each audit exit 0 with the PASS line', async (t) => {
  const tsxArgv = ['tsx', '--test', '--test-reporter=tap', '--test-name-pattern', '<name>', '<file>'];
  const files = { nodeTest: 'apps/api/test/tsx.test.mjs', legacy: 'apps/api/test/tsx-legacy.test.mjs', project: 'apps/api/test/tsx-project.test.mjs', vitest: 'apps/api/test/vitest.test.mjs' };
  const acs = ['AC-101-1', 'AC-101-2', 'AC-101-3', 'AC-101-4'];
  const w = await wsTwo(t, {
    acs,
    config: {
      entry: ENTRY_TWO, harness: HARNESS,
      runners: [
        { files: [files.nodeTest], kind: 'nodeTest', argv: tsxArgv },
        { files: [files.project], kind: 'nodeTest', cwd: 'project', argv: tsxArgv },
        { files: [files.vitest], kind: 'vitest' },
      ],
      runner: ['tsx', '--test', '--test-name-pattern', '<name>', '<file>'],
    },
    nodes: [['apps/api/src/index.js#clampPort', acs]],
    bind: [
      ['AC-101-1', files.nodeTest, 'T1 clampPort keeps a port in range'],
      ['AC-101-2', files.legacy, 'L1 clampPort keeps a port in range under the legacy runner'],
      ['AC-101-3', files.project, 'P1 clampPort keeps a port in range at the rcf project root'],
      ['AC-101-4', files.vitest, 'V1 clampPort keeps a port in range'],
    ],
  }, { exitOneTsxBins: ['node_modules/.bin'] });
  rootVitest(t, w.dir);
  const caller = scratch(t, 'rcf-h-caller-');
  exitOneTsx(caller, 'the caller PATH');
  const PATH = [caller, nodeFirst()].join(delimiter);
  const api = join(w.dir, 'apps', 'api');
  const apiTsx = join(api, 'node_modules', '.bin', 'tsx');
  const rootTsx = join(w.dir, 'node_modules', '.bin', 'tsx');
  const rootVitestBin = join(w.dir, 'node_modules', '.bin', 'vitest');
  // The layout the ruling gives, before any audit.
  assert.ok(existsSync(apiTsx) && existsSync(rootTsx) && existsSync(join(caller, 'tsx')), 'a tsx sits in apps/api/node_modules/.bin, in the repository root node_modules/.bin and on the caller PATH');
  for (const tsx of [rootTsx, join(caller, 'tsx')]) assert.equal(run(tsx, ['--version'], { env: { PATH: nodeFirst() } }).code, 1, `${tsx} is a stand-in that exits 1`);
  assert.ok(existsSync(rootVitestBin) && existsSync(join(w.dir, 'node_modules', 'vitest', 'package.json')), 'vitest is installed in the repository root node_modules, its binary in the root node_modules/.bin');
  assert.ok(!existsSync(join(api, 'node_modules', 'vitest')) && !existsSync(join(api, 'node_modules', '.bin', 'vitest')), 'nothing of vitest sits in apps/api');
  assert.ok(!PATH.split(delimiter).some((d) => d.split(sep).includes('node_modules')), `the audit's PATH holds no node_modules/.bin\n${PATH}`);
  // Each bound test in place, as its package's own test script runs it (vitest's caches in the test's own scratch).
  const tmp = scratch(t, 'rcf-h-tmp-');
  inPlace(api, 'test/tsx.test.mjs', { argv: [apiTsx, '--test', 'test/tsx.test.mjs'] });
  inPlace(api, 'test/tsx-legacy.test.mjs', { argv: [apiTsx, '--test', 'test/tsx-legacy.test.mjs'] });
  inPlace(w.dir, files.project, { argv: [apiTsx, '--test', files.project] });
  inPlace(api, 'test/vitest.test.mjs', { argv: [rootVitestBin, 'run', 'test/vitest.test.mjs'], env: { TMPDIR: tmp } });
  const audits = [
    ['AC-101-1', `the nodeTest runners entry: the bare tsx resolves to apps/api/node_modules/.bin/tsx, ahead of the repository root's and the caller's`],
    ['AC-101-2', `the legacy runner: the bare tsx resolves to apps/api/node_modules/.bin/tsx, ahead of the repository root's and the caller's`],
    ['AC-101-3', `the nodeTest runners entry with "cwd": "project": the bare tsx resolves to apps/api/node_modules/.bin/tsx, ahead of the repository root's and the caller's`],
    ['AC-101-4', 'the vitest runners entry: vitest resolves through the repository root node_modules/.bin, an ancestor of apps/api'],
  ];
  for (const [acId, how] of audits) {
    const r = await rcf(['audit', 'test-strength', '--acs', acId], { cwd: w.dir, env: { PATH }, timeout: 900_000 });
    const err = lines(r.stderr);
    assert.ok(!err.some((l) => l.startsWith('test-strength: cannot run the bound tests')), `${acId}, ${how}: no "cannot run the bound tests" line\n${shown(r)}`);
    assert.ok(!err.some((l) => l.startsWith('test-strength: the unmutated run is red')), `${acId}, ${how}: no "the unmutated run is red" line\n${shown(r)}`);
    assert.equal(r.code, 0, `${acId}, ${how}: exit 0\n${shown(r)}`);
    assert.equal(out(r), passLine(w.H, 1, 2, 2, 0, 1), `${acId}, ${how}: the PASS line\n${shown(r)}`);
  }
});

// Red at the round E DEFINE head, where rcf/test-strength.json has no
// runners cwd: the field is ignored and the bound test runs green.
test('AC-19904-10: a runners entry whose "cwd" is anything other than "project" ("package", null, 1) exits 2 with a stderr line starting "test-strength: malformed rcf/test-strength.json" naming runners[<i>].cwd', async (t) => {
  const file = 'apps/api/test/root.test.mjs';
  for (const cwd of ['package', null, 1]) {
    const w = await wsTwo(t, {
      acs: ['AC-101-1'],
      config: { entry: ENTRY_TWO, harness: HARNESS, runners: [{ files: ['test/**'], kind: 'nodeTest' }, { files: [file], kind: 'nodeTest', cwd }] },
      nodes: [['apps/api/src/index.js#readRootPort', ['AC-101-1']]],
      bind: [['AC-101-1', file, 'R1 readRootPort reads from the rcf project root']],
    });
    inPlace(w.dir, file);
    const r = await strength(w.dir, ['--acs', 'AC-101-1']);
    const line = lines(r.stderr).find((l) => l.startsWith('test-strength: malformed rcf/test-strength.json'));
    assert.ok(line && line.includes('runners[1].cwd'), `"cwd": ${q(cwd)}: a stderr line starting "test-strength: malformed rcf/test-strength.json" names runners[1].cwd\n${shown(r)}`);
    assert.equal(r.code, 2, `"cwd": ${q(cwd)}: a malformed rcf/test-strength.json, exit 2\n${shown(r)}`);
  }
});


// The stage-keeper's gate addendum ruling 11: when the unmutated run is
// red, the line right after the unmutated-run line names the cwd the run
// ran at, relative to the rcf project root, and points at "cwd":
// "project"; the unmutated-run line stays exact (AC-19902-9). The world is
// AC-19904-8's without its "cwd": "project" entry. Red at the round E
// DEFINE head, where every bound test runs at the rcf project root: the
// test is green there, so the audit exits 0 and prints no red line.
const cwdHint = (file, cwd) => `test-strength: ${file} ran at ${cwd}; a test that reads paths relative to the rcf project root pins "cwd": "project" on its runners entry`;

test('AC-19904-11: a red unmutated run of a bound test in apps/api reading a path relative to the rcf project root, with no "cwd": "project" entry, exits 2 with the unmutated-run line followed by a line naming the cwd apps/api and pointing at "cwd": "project"', async (t) => {
  const file = 'apps/api/test/root.test.mjs';
  const w = await wsTwo(t, {
    acs: ['AC-101-1'],
    config: { entry: ENTRY_TWO, harness: HARNESS },
    nodes: [['apps/api/src/index.js#readRootPort', ['AC-101-1']]],
    bind: [['AC-101-1', file, 'R1 readRootPort reads from the rcf project root']],
  });
  inPlace(w.dir, file);
  const r = await strength(w.dir, ['--acs', 'AC-101-1']);
  const err = lines(r.stderr);
  const red = err.findIndex((l) => /^test-strength: the unmutated run is red for AC-101-1: (.+) fails under runner (.+); no mutant was run$/.exec(l)?.[1] === `${file}::R1 readRootPort reads from the rcf project root`);
  assert.ok(r.code === 2 && red >= 0, `run at apps/api the root-relative path is missing: exit 2 with "test-strength: the unmutated run is red for AC-101-1: ${file}::R1 ... fails under runner <argv>; no mutant was run"\n${shown(r)}`);
  assert.equal(err[red + 1], cwdHint(file, 'apps/api'), `the line right after the unmutated-run line names the cwd apps/api and points at "cwd": "project"\n${shown(r)}`);
});

// Round F, F-1 (the round E reviewer's note on AC-19904-11): a bound test
// pins the hint at the rcf project root, "ran at ." (AC-19904-11: "`.` for
// the rcf project root itself"), which no test asserted (the test above
// asserts the apps/api form only). Two audits of ws-two, each a red
// unmutated run at the rcf project root: test/package-path.test.mjs, with
// no package.json between it and the rcf project root, and
// apps/api/test/api.test.mjs under a runners entry with "cwd": "project",
// each reading the package-relative fixtures/config.json where it is
// missing. A declared regression guard, green at the round F DEFINE head
// (src/audit/test-strength/index.js :347 prints `runDir(t) || '.'`).
test('AC-19904-11: a red unmutated run at the rcf project root, of a test with no package.json between it and the rcf project root and of a test under a "cwd": "project" runners entry, is followed by a line naming the cwd "." and pointing at "cwd": "project"', async (t) => {
  const rootFile = 'test/package-path.test.mjs';
  const w = await wsTwo(t, {
    acs: ['AC-101-1', 'AC-101-2'],
    config: { entry: ENTRY_TWO, harness: HARNESS, runners: [{ files: [API_TEST], kind: 'nodeTest', cwd: 'project' }] },
    nodes: [['apps/api/src/index.js#readPort', ['AC-101-1', 'AC-101-2']]],
    bind: [['AC-101-1', rootFile, 'R2 readPort reads the package fixture from the rcf project root'], ['AC-101-2', API_TEST, 'C2 readPort reads the package fixture']],
  });
  assert.ok(!existsSync(join(w.dir, 'fixtures', 'config.json')) && existsSync(join(w.dir, 'apps', 'api', 'fixtures', 'config.json')), 'fixtures/config.json sits in apps/api only, nothing of it at the rcf project root');
  for (const [acId, file, name] of [['AC-101-1', rootFile, 'R2 readPort reads the package fixture from the rcf project root'], ['AC-101-2', API_TEST, 'C2 readPort reads the package fixture']]) {
    const r = await strength(w.dir, ['--acs', acId]);
    const err = lines(r.stderr);
    const red = err.findIndex((l) => /^test-strength: the unmutated run is red for AC-101-\d: (.+) fails under runner (.+); no mutant was run$/.exec(l)?.[1] === `${file}::${name}`);
    assert.ok(r.code === 2 && red >= 0, `${acId}: run at the rcf project root the package-relative path is missing: exit 2 with "test-strength: the unmutated run is red for ${acId}: ${file}::${name} fails under runner <argv>; no mutant was run"\n${shown(r)}`);
    assert.equal(err[red + 1], cwdHint(file, '.'), `${acId}: the line right after the unmutated-run line names the cwd "." and points at "cwd": "project"\n${shown(r)}`);
  }
});

// Round F, F-2 (the round E reviewer's note on AC-19903-11) and its
// sibling (the stage-keeper's ruling C12): a failing git ls-tree as the
// audit reads HEAD exits 2 with a named error naming the command, where
// 0.40.0 swallows it. Two listings: every package.json directory at HEAD,
// repository-wide (src/audit/test-strength/index.js :134, the audit's one
// git ls-tree with --full-tree), whose failure leaves the working copies
// linking no package's node_modules and the backstop covering none; and
// the files at HEAD (:216, git ls-tree -r --name-only HEAD), whose failure
// leaves the audit reading an empty tree. A git stand-in, first on the
// audit's PATH, fails one listing (exit 128, a "fatal:" line, as git does
// when it cannot read a tree) and hands every other git call to the real
// git (the audit runs every git call as git -c core.quotePath=false
// <args>, src/audit/separation.js runGit, and each precondition runs the
// stand-in so). The world is AC-19903-8's (ms installed in apps/api/node_modules
// only), its bound test apps/api/test/witness.test.mjs, which records each
// run in the file RCF_ROUND_F_WITNESS names; audited first without the
// stand-in (green, the witness recording the runs) so the red is the
// listing's, then with it (the witness must stay empty: no bound test
// ran). Red at the round F DEFINE head: the failure is swallowed and no
// line names it (the workspace listing: apps/api/node_modules is not
// linked and the unmutated run is red; the files listing: see the test).
const STAND_IN_FATAL = 'fatal: unable to read tree (the git stand-in of this test)';
const LISTINGS = {
  packages: {
    what: 'the repository-wide listing of every package.json directory at HEAD (git ls-tree with --full-tree)',
    match: '*" ls-tree "*" --full-tree "*',
    argv: ['-c', 'core.quotePath=false', 'ls-tree', '-r', '-z', '--name-only', '--full-tree', 'HEAD'],
    other: ['-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', 'HEAD'],
    named: (h) => `test-strength: cannot list the workspace packages at ${s7(h)}: git ls-tree failed: ${STAND_IN_FATAL}`,
  },
  files: {
    what: 'the listing of the files at HEAD (git ls-tree -r --name-only HEAD)',
    match: '*" ls-tree -r --name-only HEAD "',
    argv: ['-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', 'HEAD'],
    other: ['-c', 'core.quotePath=false', 'ls-tree', '-r', '-z', '--name-only', '--full-tree', 'HEAD'],
    named: (h) => `test-strength: cannot list the files at ${s7(h)}: git ls-tree -r --name-only HEAD failed: ${STAND_IN_FATAL}`,
  },
};
function gitStandIn(t, listing) {
  const dir = scratch(t, 'rcf-h-git-');
  const realGit = join(toolPath().split(delimiter)[0], 'git');
  writeText(dir, 'git', [
    '#!/bin/sh',
    `# A git stand-in: ${listing.what} fails as git`,
    '# does when it cannot read the tree; every other git call runs the real git.',
    'case " $* " in',
    `  ${listing.match}) echo ${q(STAND_IN_FATAL)} >&2; exit 128 ;;`,
    'esac',
    `exec ${q(realGit)} "$@"`,
    '',
  ].join('\n'));
  chmodSync(join(dir, 'git'), 0o755);
  return dir;
}

// One listing failing: the named line, no bound test run, exit 2 and no verdict line.
async function listingFails(t, listing) {
  const file = 'apps/api/test/witness.test.mjs';
  const w = await wsTwo(t, {
    acs: ['AC-101-1'],
    config: { entry: ENTRY_TWO, harness: HARNESS },
    nodes: [['apps/api/src/index.js#toMs', ['AC-101-1']]],
    bind: [['AC-101-1', file, 'W1 toMs reads a duration through ms, and each run is recorded']],
  });
  inPlace(join(w.dir, 'apps', 'api'), 'test/witness.test.mjs');
  const standIn = gitStandIn(t, listing);
  const failed = run(join(standIn, 'git'), listing.argv, { cwd: w.dir });
  assert.ok(failed.code === 128 && failed.stderr.trim() === STAND_IN_FATAL, `the stand-in fails ${listing.what}\n${failed.stdout}${failed.stderr}`);
  assert.equal(run(join(standIn, 'git'), listing.other, { cwd: w.dir }).code, 0, 'the stand-in hands the other listing to the real git');
  assert.equal(run(join(standIn, 'git'), ['rev-parse', 'HEAD'], { cwd: w.dir }).stdout.trim(), w.H, 'the stand-in hands every other git call to the real git');
  // The run witness: the bound test appends a line to it on every run.
  const witnessDir = scratch(t, 'rcf-h-witness-');
  const witness = join(witnessDir, 'ran.log');
  const control = await rcf(['audit', 'test-strength', '--acs', 'AC-101-1'], { cwd: w.dir, env: { PATH: nodeFirst(), RCF_ROUND_F_WITNESS: witness }, timeout: 900_000 });
  assert.equal(control.code, 0, `without the stand-in the audit is green: exit 0\n${shown(control)}`);
  assert.ok(existsSync(witness) && readFileSync(witness, 'utf8').length > 0, 'without the stand-in the audit runs the bound test, and the witness records it');
  writeText(witnessDir, 'ran.log', '');
  const r = await rcf(['audit', 'test-strength', '--acs', 'AC-101-1'], { cwd: w.dir, env: { PATH: [standIn, nodeFirst()].join(delimiter), RCF_ROUND_F_WITNESS: witness }, timeout: 900_000 });
  const err = lines(r.stderr);
  const named = listing.named(w.H);
  assert.ok(err.includes(named), `stderr carries "${named}"\n${shown(r)}`);
  noUnmutatedRed(r);
  assert.equal(readFileSync(witness, 'utf8'), '', `no bound test ran: the witness records no run\n${shown(r)}`);
  assert.equal(r.code, 2, `the audit's own input failed: exit 2\n${shown(r)}`);
  assert.equal(r.stdout, '', `no verdict line\n${shown(r)}`);
}

test('AC-19903-13: when git ls-tree fails as the audit lists the workspace packages, rcf audit test-strength exits 2 with "test-strength: cannot list the workspace packages at <h7>: git ls-tree failed: <its stderr>" and runs no bound test', (t) => listingFails(t, LISTINGS.packages));

test('AC-19903-13: when git ls-tree -r --name-only HEAD fails as the audit lists the files at HEAD, rcf audit test-strength exits 2 with "test-strength: cannot list the files at <h7>: git ls-tree -r --name-only HEAD failed: <its stderr>" and runs no bound test', (t) => listingFails(t, LISTINGS.files));


// ws-hoisted (round F) in git at H: the rcf init project with the world
// laid over it, npm's hoisted layout written (node_modules/@ws/lib in the
// rcf project root's own node_modules, a relative link to apps/lib, as
// npm links a workspace package; nothing in apps/api/node_modules), and
// the chain. With `lib` (F-9), apps/lib's package.json is { name, version,
// private, type "module", ...lib.pkg }; each of lib.files is written and
// committed; each of lib.built (the build, a copy of the source) is
// written in apps/lib and gitignored, so it is present in the repository
// and absent at HEAD; and lib.api, when given, replaces
// apps/api/src/index.js.
const WORLDS_F = join(PACKAGE_ROOT, 'test', 'fixtures', 'round-f');
const ENTRY_HOISTED = [{ kind: 'module', path: 'apps/lib/src/index.js' }];
const HOISTED_TEST = 'apps/api/test/greet.test.mjs';
async function wsHoisted(t, spec, { lib = null } = {}) {
  const dir = await project(t, { name: 'hoist' });
  cpSync(join(WORLDS_F, 'ws-hoisted'), dir, { recursive: true });
  link('../../apps/lib', join(dir, 'node_modules', '@ws', 'lib'));
  chain(dir, spec);
  if (lib) {
    writeText(dir, 'apps/lib/package.json', `${q({ name: '@ws/lib', version: '1.0.0', private: true, type: 'module', ...lib.pkg })}\n`);
    for (const [path, text] of Object.entries({ ...lib.files, ...lib.built })) writeText(dir, `apps/lib/${path}`, text);
    writeText(dir, '.gitignore', ['node_modules/', ...Object.keys(lib.built ?? {}).map((p) => `apps/lib/${p}`), ''].join('\n'));
    if (lib.api) writeText(dir, 'apps/api/src/index.js', lib.api);
  }
  initRepo(dir);
  const H = commit(dir, 'fixture: base');
  return { dir, H };
}

// The F-9 notice line (the stage-keeper's ruling A3, word for word) for
// the link node_modules/@ws/lib and the package apps/lib, its second form
// for a package with no entry (pass 2 ruling 2, word for word), and every
// line of either form a run printed.
const NOTICE_HEAD = "test-strength: node_modules/@ws/lib stays at the repo's own apps/lib: its entry ";
const noticeTail = (h) => ` is build output not committed at ${s7(h)}; mutants in apps/lib are not the code this test imports`;
const notice = (h, entry) => `${NOTICE_HEAD}${entry}${noticeTail(h)}`;
const noEntryNotice = (h) => `test-strength: node_modules/@ws/lib stays at the repo's own apps/lib: its package.json names no entry committed at ${s7(h)} (exports names no entry for "."); mutants in apps/lib are not the code this test imports`;
const notices = (r) => lines(r.stderr).filter((l) => l.startsWith("test-strength: node_modules/@ws/lib stays at the repo's own"));

// AC-19904-12's line (its US-19904 test's form), and the temp directories
// the notice's position on a run that proceeds turns on (pass 2 ruling 1):
// one whose own path passes 108 bytes, nested in the test's scratch, so a
// runner's Unix socket path under any scratch inside it passes the limit
// on darwin and on Linux and AC-19904-12's line prints; and a short one of
// its own under /tmp, removed after the test, under which it cannot.
const SOCKET_LIMIT = { darwin: 104, linux: 108 };
const movesLine = (tmp) => `test-strength: a runner's Unix socket path under ${tmp} would pass ${SOCKET_LIMIT[process.platform]} bytes, the limit on ${process.platform}; the scratch directory moves to a short path`;
function longTmp(t) {
  let dir = scratch(t, 'rcf-h-tmp-');
  while (dir.length <= 112) dir = join(dir, 'a-long-temp-directory');
  mkdirSync(dir, { recursive: true });
  return dir;
}
function shortTmp(t) {
  const dir = mkdtempSync('/tmp/rcf-h-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Round F, F-4 (the round E reviewer's note on AC-19903-8: TAC-4155
// responsibilities[4] read two ways for a symbolic-link entry in the
// node_modules of the rcf project and its ancestors; the stage-keeper
// accepted the builder's reading, re-pointed into the copy, and ruled a
// DEFINE sharpening, which this round's TAC-4155 text carries). The
// hoisted layout puts the workspace package link in the rcf project's own
// node_modules, not in apps/api's: only a copy that re-points that link
// to the copy's apps/lib runs a mutant of apps/lib, where a link to the
// project's own apps/lib (the other reading, 0.39.0's absolute link)
// leaves every mutant survived (exit 4). AC-19903-9's Given ("a test in
// apps/api importing @ws/lib by name (a workspace package link)") holds
// for the link wherever npm puts it. The guard moves with F-9 (the
// stage-keeper's ruling 8): the accepted reading now carries the
// exception, a link whose package entry is not committed at HEAD stays at
// the repo's own package; apps/lib's entry here, ./src/index.js, is
// committed, so the link is re-pointed and no F-9 notice prints. A
// declared regression guard, green at the round F DEFINE head
// (src/audit/test-strength/runner.js linkModules re-points a
// symbolic-link entry in every node_modules it links, the rcf project's
// and each ancestor's included, and prints no notice).
test('AC-19903-9: a workspace sibling linked by name in the rcf project root node_modules, npm hoisted layout, resolves inside the working copy: each mutant of apps/lib/src/index.js#greet is killed, exit 0 with the PASS line', async (t) => {
  const w = await wsHoisted(t, {
    acs: ['AC-101-1'],
    config: { entry: ENTRY_HOISTED, harness: HARNESS },
    nodes: [['apps/lib/src/index.js#greet', ['AC-101-1']]],
    bind: [['AC-101-1', HOISTED_TEST, 'H1 greet comes from the hoisted workspace library']],
  });
  assert.ok(existsSync(join(w.dir, 'node_modules', '@ws', 'lib', 'package.json')) && !existsSync(join(w.dir, 'apps', 'api', 'node_modules')), 'the workspace package link sits in the rcf project root node_modules, nothing in apps/api/node_modules');
  inPlace(join(w.dir, 'apps', 'api'), 'test/greet.test.mjs');
  const r = await strength(w.dir, ['--acs', 'AC-101-1', '--json']);
  noUnmutatedRed(r);
  assert.equal(r.code, 0, `each mutant of apps/lib/src/index.js#greet is applied in the working copy's apps/lib, which the re-pointed link reaches, and killed: exit 0\n${shown(r)}`);
  const mutants = json(r.stdout).criteria.find((c) => c.acId === 'AC-101-1').mutants.filter((m) => m.result !== 'notApplicable');
  assert.ok(mutants.length > 0, `greet has mutants\n${r.stdout}`);
  for (const m of mutants) assert.equal(m.result, 'killed', `${m.symbol} ${m.operator}: killed, never survived\n${r.stdout}`);
  const line = await strength(w.dir, ['--acs', 'AC-101-1']);
  assert.equal(out(line), passLine(w.H, 1, 2, 2, 0, 1), shown(line));
  assert.deepEqual(notices(line), [], `apps/lib's entry ./src/index.js is committed at HEAD: the link is re-pointed, and no notice says it stays\n${shown(line)}`);
});

// Round F, F-9 (the stage-keeper's rulings A1 to A4, C10 and C11; F-3's
// reason line is gone): 0.40.0 re-points a workspace link into the
// working copy even when the package's entry is build output the
// repository does not track (a gitignored dist/), so the copy's package
// has no entry, the import fails and the unmutated run is red, where
// 0.39.0 linked the repo's own built package and the test ran (the WESPA
// finding: apps/api-service's tests import its own source, which imports
// backend-common by name, main dist/index.js). The ruling: a re-pointed
// link whose package entry is not committed at HEAD stays at the repo's
// own package, the run proceeds, and one notice line per link per run says
// so; no exit 2, the exit code is the run's own. The package entry:
// exports (a string, or the conditional map resolved for "." in the order
// import, default, require, a nested map walked the same way; no match is
// no entry, which counts as not committed), then main, then index.js.
// ws-hoisted with lib DIST: apps/lib's main and exports name
// dist/index.js, the build present in the repository and gitignored. Bound
// to apps/api/test/welcome.test.mjs (welcome, the api's own code, imports
// @ws/lib by name), with the link kept at the repo's own apps/lib every
// mutant of welcome is killed: exit 0 and the PASS line. Bound to
// greet.test.mjs with the Code Node in apps/lib, a mutant there is not the
// code the test imports and survives: exit 4 and the FAIL line, the run's
// own. In both, a run witness shows every run loaded the repo's own
// apps/lib/dist/index.js (the kept link), so a copy given a build of its
// own does not pass. Both are runs that proceed past a green unmutated
// run, under a short temp directory (AC-19904-12's line cannot print), so
// the notice line leads stderr (pass 2 ruling 1). Red at the round F DEFINE head: the link is re-pointed into the
// copy, whose apps/lib holds no dist/, the import fails and the unmutated
// run is red (exit 2, the unmutated-run line and the "cwd": "project"
// hint).
const SRC_LIB = readFileSync(join(WORLDS_F, 'ws-hoisted', 'apps', 'lib', 'src', 'index.js'), 'utf8');
const CJS_LIB = "'use strict';\n\nexports.greet = function greet(name) {\n  return name ? `hello ${name}` : 'hello';\n};\n";
const DIST = { pkg: { main: 'dist/index.js', exports: './dist/index.js' }, built: { 'dist/index.js': SRC_LIB } };
const ENTRY_API = [{ kind: 'module', path: 'apps/api/src/index.js' }];
const WELCOME_TEST = 'apps/api/test/welcome.test.mjs';
const welcomeSpec = {
  acs: ['AC-101-1'],
  config: { entry: ENTRY_API, harness: HARNESS },
  nodes: [['apps/api/src/index.js#welcome', ['AC-101-1']]],
  bind: [['AC-101-1', WELCOME_TEST, 'H2 welcome greets through the workspace library']],
};
// The audit with the run witness set: the bound test (welcome.test.mjs or
// greet.test.mjs) appends, on every run, the real path of the file @ws/lib
// resolves to from apps/api/test. `tmp`, when given, is the audit's
// TMPDIR.
async function strengthLoaded(t, dir, args, tmp) {
  const witness = join(scratch(t, 'rcf-h-witness-'), 'loaded.log');
  const r = await rcf(['audit', 'test-strength', ...args], { cwd: dir, env: { PATH: nodeFirst(), RCF_ROUND_F_WITNESS: witness, ...(tmp ? { TMPDIR: tmp } : {}) }, timeout: 900_000 });
  return { r, loaded: existsSync(witness) ? readFileSync(witness, 'utf8').split('\n').filter(Boolean) : [] };
}
// Every run loaded the repo's own apps/lib/dist/index.js, through the kept
// link, not a build output made or copied into a working copy.
function repoOwnLoaded(w, loaded, runs) {
  const own = realpathSync(join(w.dir, 'apps', 'lib', 'dist', 'index.js'));
  assert.equal(loaded.length, runs, `the witness saw ${runs} runs, the unmutated run and each mutant's\n${loaded.join('\n')}`);
  for (const path of loaded) assert.equal(path, own, `each run loaded the repo's own ${own}, not ${path}`);
}

test("AC-19903-14: a bound test whose code imports a workspace package by name, its entry gitignored build output not committed at HEAD, runs with the link kept at the repo's own package: exit 0 with the PASS line, and one notice line naming the link, the package and the entry, leading stderr", async (t) => {
  const w = await wsHoisted(t, welcomeSpec, { lib: DIST });
  assert.ok(existsSync(join(w.dir, 'apps', 'lib', 'dist', 'index.js')), 'the build output is present in the repository');
  assert.equal(run('git', ['ls-files', 'apps/lib/dist'], { cwd: w.dir }).stdout, '', 'and not committed: apps/lib/dist/ is gitignored');
  inPlace(join(w.dir, 'apps', 'api'), 'test/welcome.test.mjs');
  // Two mutants of welcome (stubToThrow, noOp) under --jobs 2: two working copies beside the unmutated run's.
  const { r, loaded } = await strengthLoaded(t, w.dir, ['--acs', 'AC-101-1', '--jobs', '2'], shortTmp(t));
  noUnmutatedRed(r);
  assert.equal(r.code, 0, `the link stays at the repo's own apps/lib, whose dist/ the test imports, and each mutant of welcome is killed: exit 0, no exit 2\n${shown(r)}`);
  assert.equal(out(r), passLine(w.H, 1, 2, 2, 0, 1), shown(r));
  assert.deepEqual(notices(r), [notice(w.H, 'dist/index.js')], `one notice line for the one link, however many working copies the run made\n${shown(r)}`);
  assert.equal(lines(r.stderr)[0], notice(w.H, 'dist/index.js'), `a run that proceeds, with no AC-19904-12 line: the notice line leads stderr\n${shown(r)}`);
  repoOwnLoaded(w, loaded, 3);
});

test("AC-19903-14: with the link kept at the repo's own package, a mutant in that package is not the code the test imports: each mutant of apps/lib/src/index.js#greet survives, exit 4 with the FAIL line, the run's own exit, and the one notice line leading stderr", async (t) => {
  const w = await wsHoisted(t, {
    acs: ['AC-101-1'],
    config: { entry: ENTRY_HOISTED, harness: HARNESS },
    nodes: [['apps/lib/src/index.js#greet', ['AC-101-1']]],
    bind: [['AC-101-1', HOISTED_TEST, 'H1 greet comes from the hoisted workspace library']],
  }, { lib: DIST });
  inPlace(join(w.dir, 'apps', 'api'), 'test/greet.test.mjs');
  const { r, loaded } = await strengthLoaded(t, w.dir, ['--acs', 'AC-101-1'], shortTmp(t));
  noUnmutatedRed(r);
  assert.equal(r.code, 4, `the test imports the repo's own apps/lib/dist/index.js, so each mutant of the copy's apps/lib/src/index.js#greet survives: exit 4, the run's own, no exit 2\n${shown(r)}`);
  assert.equal(out(r), `test-strength: FAIL 1 of 1 criteria at ${s7(w.H)}: AC-101-1 vacuous: stubToThrow on apps/lib/src/index.js#greet survived 1 bound tests; AC-101-1 vacuous: noOp on apps/lib/src/index.js#greet survived 1 bound tests`, shown(r));
  assert.deepEqual(notices(r), [notice(w.H, 'dist/index.js')], `the one notice line says mutants in apps/lib are not the code this test imports\n${shown(r)}`);
  assert.equal(lines(r.stderr)[0], notice(w.H, 'dist/index.js'), `a run that proceeds, with no AC-19904-12 line: the notice line leads stderr\n${shown(r)}`);
  repoOwnLoaded(w, loaded, 3);
});

// Pass 2 ruling 1, "lead stderr" against the run's other lines: the DIST
// world bound to welcome.test.mjs (AC-101-1, a run that proceeds) beside
// AC-101-2, whose Code Node file apps/lib/src/odd.ts (committed) the audit
// cannot read with its position check withheld (AC-19901-9's case of an
// escape character in a string, then a refused token), so the run's
// stderr also carries that criterion's withheld-column line: under a short
// temp directory the one notice line is the first stderr line, ahead of
// the withheld-column line, and the run's own verdict stands (AC-101-2
// BLOCKED, exit 5 with the BLOCKED line). A notice printed after the run's
// other lines fails here. Red at the round F DEFINE head: the link is
// re-pointed into a copy without dist/ and the unmutated run is red (exit
// 2).
const ODD_TS = "export const s = '\u001b'; const b = 1 + ;";
const WITHHELD_ODD = "test-strength: column for apps/lib/src/odd.ts:1 is node's display column (position check withheld: node's caret does not move across the tie)";
test("AC-19903-14: on a run that proceeds with another stderr line, a criterion BLOCKED with its position check withheld, the one notice line leads stderr, ahead of the withheld-column line, and the run's own verdict stands: exit 5 with the BLOCKED line", async (t) => {
  const w = await wsHoisted(t, {
    acs: ['AC-101-1', 'AC-101-2'],
    config: { entry: ENTRY_API, harness: HARNESS },
    nodes: [['apps/api/src/index.js#welcome', ['AC-101-1']], ['apps/lib/src/odd.ts#s', ['AC-101-2']]],
    bind: [['AC-101-1', WELCOME_TEST, 'H2 welcome greets through the workspace library'], ['AC-101-2', WELCOME_TEST, 'H2 welcome greets through the workspace library']],
  }, { lib: { ...DIST, files: { 'src/odd.ts': ODD_TS } } });
  assert.equal(run('git', ['ls-files', 'apps/lib/src/odd.ts'], { cwd: w.dir }).stdout.trim(), 'apps/lib/src/odd.ts', 'the unreadable Code Node file is committed');
  inPlace(join(w.dir, 'apps', 'api'), 'test/welcome.test.mjs');
  const { r, loaded } = await strengthLoaded(t, w.dir, ['--acs', 'AC-101-1,AC-101-2'], shortTmp(t));
  noUnmutatedRed(r);
  assert.equal(r.code, 5, `AC-101-1 passes with the link kept and AC-101-2 is BLOCKED: exit 5, the run's own, no exit 2\n${shown(r)}`);
  assert.equal(out(r), `test-strength: BLOCKED 2 criteria at ${s7(w.H)}: structural 1/1, mutants killed 2/2 (timeout 0, notApplicable 1, blocked 1): AC-101-2 (apps/lib/src/odd.ts)`, shown(r));
  const err = lines(r.stderr);
  assert.deepEqual(notices(r), [notice(w.H, 'dist/index.js')], `one notice line\n${shown(r)}`);
  assert.ok(err.includes(WITHHELD_ODD), `the run's stderr carries AC-101-2's withheld-column line\n${shown(r)}`);
  assert.equal(err[0], notice(w.H, 'dist/index.js'), `a run that proceeds, with no AC-19904-12 line: the notice line leads stderr, ahead of the withheld-column line\n${shown(r)}`);
  repoOwnLoaded(w, loaded, 3);
});

// Pass 2 ruling 1: on a run that proceeds, the notice lines follow
// AC-19904-12's line when that line prints. The DIST world bound to
// welcome.test.mjs under a nodeTest runners entry whose argv starts with a
// bare tsx, the real tsx in the repository root's node_modules
// (a-tsx-node-test's package.json and lockfile, installed as rootVitest
// installs vitest), so its runner opens a Unix socket under its TMPDIR
// (AC-19904-12's Given), run under a temp directory whose own path passes
// 108 bytes: the audit exits 0 with the PASS line, AC-19904-12's line is
// the first stderr line and the one notice line the second, and each run
// loaded the repo's own apps/lib/dist/index.js. The test first shows tsx
// running welcome.test.mjs in place at apps/api under a short TMPDIR and
// failing under one inside the long temp directory, so AC-19904-12's
// condition holds. Red at the round F DEFINE head: the scratch stays under
// the long temp directory, so tsx cannot open its socket, and the link is
// re-pointed into a copy without dist/; the unmutated run is red (exit 2).
test("AC-19903-14: on a run that proceeds under a temp directory long enough that AC-19904-12's line prints, the notice line follows that line: a bare tsx runners entry over a bound test importing a workspace package whose entry is gitignored build output exits 0 with the PASS line, AC-19904-12's line first on stderr and the one notice line second", async (t) => {
  assert.ok(SOCKET_LIMIT[process.platform], `a platform with a Unix socket path limit: darwin or linux, not ${process.platform}`);
  const tsxArgv = ['tsx', '--test', '--test-reporter=tap', '--test-name-pattern', '<name>', '<file>'];
  const w = await wsHoisted(t, { ...welcomeSpec, config: { ...welcomeSpec.config, runners: [{ files: ['apps/api/test/**'], kind: 'nodeTest', argv: tsxArgv }] } }, { lib: DIST });
  rootInstall(t, w.dir, 'a-tsx-node-test');
  const api = join(w.dir, 'apps', 'api');
  const rootTsx = join(w.dir, 'node_modules', '.bin', 'tsx');
  assert.ok(existsSync(rootTsx) && !existsSync(join(api, 'node_modules')), 'tsx is installed in the repository root node_modules/.bin, nothing in apps/api/node_modules');
  assert.equal(run('git', ['status', '--porcelain'], { cwd: w.dir }).stdout, '', 'the install leaves the working tree clean: node_modules is gitignored');
  const long = longTmp(t);
  inPlace(api, 'test/welcome.test.mjs', { argv: [rootTsx, '--test', 'test/welcome.test.mjs'], env: { TMPDIR: shortTmp(t) } });
  const nested = join(long, 'rcf-ts-abcdef');
  mkdirSync(nested);
  const under = run(rootTsx, ['--test', 'test/welcome.test.mjs'], { cwd: api, env: { PATH: nodeFirst(), TMPDIR: nested } });
  assert.notEqual(under.code, 0, `tsx cannot run with TMPDIR ${nested} (${nested.length} bytes): its socket path passes the limit\n${under.stdout}${under.stderr}`);
  const { r, loaded } = await strengthLoaded(t, w.dir, ['--acs', 'AC-101-1'], long);
  noUnmutatedRed(r);
  assert.equal(r.code, 0, `the scratch moves to a short path and the link stays at the repo's own apps/lib: each mutant of welcome is killed, exit 0\n${shown(r)}`);
  assert.equal(out(r), passLine(w.H, 1, 2, 2, 0, 1), shown(r));
  const err = lines(r.stderr);
  assert.equal(err[0], movesLine(long), `AC-19904-12's line is the run's first stderr line\n${shown(r)}`);
  assert.deepEqual(notices(r), [notice(w.H, 'dist/index.js')], `one notice line\n${shown(r)}`);
  assert.equal(err[1], notice(w.H, 'dist/index.js'), `the notice line follows AC-19904-12's line\n${shown(r)}`);
  repoOwnLoaded(w, loaded, 3);
});

// C9 with A3: on a red unmutated run from another cause, the hint stays
// right after the unmutated-run line (AC-19904-11) and the notice line
// follows the hint ("the reason line becomes a notice line that follows
// the hint; nothing about the hint changes"). The DIST world bound to
// apps/api/test/root.test.mjs, which reads apps/api/package.json relative
// to the rcf project root and so is red at apps/api, its package
// directory, whichever apps/lib it loads. Red at the round F DEFINE head:
// no notice line follows the hint.
test('AC-19903-14: on a red unmutated run from another cause, a test reading a path relative to the rcf project root, the "cwd": "project" hint stays right after the unmutated-run line and the one notice line follows the hint; exit 2 from the run itself', async (t) => {
  const file = 'apps/api/test/root.test.mjs';
  const w = await wsHoisted(t, { ...welcomeSpec, bind: [['AC-101-1', file, 'H3 welcome greets the package named in apps/api/package.json, read from the rcf project root']] }, { lib: DIST });
  inPlace(w.dir, file);
  const r = await strength(w.dir, ['--acs', 'AC-101-1']);
  const err = lines(r.stderr);
  const red = err.findIndex((l) => /^test-strength: the unmutated run is red for AC-101-1: (.+) fails under runner (.+); no mutant was run$/.exec(l)?.[1] === `${file}::H3 welcome greets the package named in apps/api/package.json, read from the rcf project root`);
  assert.ok(r.code === 2 && red >= 0, `run at apps/api the root-relative path is missing: exit 2 with the unmutated-run line\n${shown(r)}`);
  assert.equal(err[red + 1], cwdHint(file, 'apps/api'), `the hint stays right after the unmutated-run line, as AC-19904-11 states it\n${shown(r)}`);
  assert.deepEqual(notices(r), [notice(w.H, 'dist/index.js')], `one notice line\n${shown(r)}`);
  assert.ok(err.indexOf(notice(w.H, 'dist/index.js')) > red + 1, `the notice line follows the hint\n${shown(r)}`);
});

// The entry rule (the stage-keeper's ruling C10), one ws-hoisted world per
// step, each bound to the welcome test: the step's entry is gitignored
// build output (the link kept, a notice naming the entry) where a later
// step names a committed file, or committed (the link re-pointed, no
// notice) where a later step names build output, so an audit reading the
// steps in another order gives another answer in at least one world. The
// run proceeds in every world: exit 0 and the PASS line. Node resolves
// each world in place the same way (conditions in Node's key order,
// "default" last as Node requires; the require world's welcome loads
// @ws/lib through createRequire, the subpath world's imports
// @ws/lib/greet). A world with no entry (no "." subpath and no matching
// condition) counts as not committed, and its notice takes the second
// form, word for word (pass 2 ruling 2). Red at the round F DEFINE head in
// every notice world: where the entry is build output the link is
// re-pointed into a copy without it and the unmutated run is red (exit
// 2); where there is no entry the run passes and nothing prints.
const NO_ENTRY = Symbol('no entry');
const API_REQUIRE = [
  "import { createRequire } from 'node:module';",
  '',
  'const require = createRequire(import.meta.url);',
  '',
  "// The api's own code: it reaches the workspace library by name through require.",
  'export function welcome(name) {',
  "  const { greet } = require('@ws/lib');",
  '  return `${greet(name)}, welcome`;',
  '}',
  '',
].join('\n');
const API_SUBPATH = [
  "import { greet } from '@ws/lib/greet';",
  '',
  "// The api's own code: it reaches the workspace library through its ./greet subpath export.",
  'export function welcome(name) {',
  '  return `${greet(name)}, welcome`;',
  '}',
  '',
].join('\n');
const ENTRY_WORLDS = [
  ['exports, a string, before main', { pkg: { exports: './dist/index.js', main: 'src/index.js' }, built: { 'dist/index.js': SRC_LIB } }, 'dist/index.js'],
  ['exports, a committed string, before main naming build output', { pkg: { exports: './src/index.js', main: 'dist/index.js' }, built: { 'dist/index.js': SRC_LIB } }, null],
  ['the "." subpath: import before default', { pkg: { exports: { '.': { import: './dist/index.js', default: './src/index.js' } } }, built: { 'dist/index.js': SRC_LIB } }, 'dist/index.js'],
  ['a condition map: default before require', { pkg: { exports: { require: './dist/index.cjs', default: './src/index.js' } }, built: { 'dist/index.cjs': CJS_LIB } }, null],
  ['a nested map walked the same way', { pkg: { exports: { '.': { import: { types: './dist/index.d.ts', default: './dist/index.js' }, default: './src/index.js' } } }, built: { 'dist/index.js': SRC_LIB } }, 'dist/index.js'],
  ['require, with no import or default condition', { pkg: { exports: { require: './dist/index.cjs' } }, built: { 'dist/index.cjs': CJS_LIB }, api: API_REQUIRE }, NO_ENTRY],
  ['the "." map: node, an active condition', { pkg: { exports: { node: './src/index.js' } } }, null],
  ['no "." subpath: no entry', { pkg: { exports: { './greet': './src/index.js' } }, api: API_SUBPATH }, NO_ENTRY],
  ['main, with no exports, before index.js', { pkg: { main: 'dist/index.js' }, files: { 'index.js': "export * from './src/index.js';\n" }, built: { 'dist/index.js': SRC_LIB } }, 'dist/index.js'],
  ['index.js, with no exports or main', { pkg: {}, built: { 'index.js': SRC_LIB } }, 'index.js'],
  ['main, committed, before index.js naming build output', { pkg: { main: 'src/index.js' }, built: { 'index.js': SRC_LIB } }, null],
];

test(`AC-19903-14: the package entry is read in the order exports (a string, or the conditional map resolved for "." by Node's rule, the first matching key in the map's own order among the active conditions for an import from Node (node, import, module-sync, default), a nested map walked the same way, no match no entry), then main, then index.js: an entry not committed at HEAD keeps the link with a notice naming it, no entry keeps it with the no-entry form of the notice, a committed one is re-pointed with none, and each run exits 0 with the PASS line`, async (t) => {
  const wrong = [];
  for (const [step, lib, entry] of ENTRY_WORLDS) {
    const w = await wsHoisted(t, welcomeSpec, { lib });
    inPlace(join(w.dir, 'apps', 'api'), 'test/welcome.test.mjs');
    const r = await strength(w.dir, ['--acs', 'AC-101-1']);
    const got = notices(r);
    let want;
    let held;
    if (entry === null) {
      want = 'no notice (the entry is committed: the link is re-pointed)';
      held = got.length === 0;
    } else if (entry === NO_ENTRY) {
      want = `one notice in its no-entry form, "${noEntryNotice(w.H)}"`;
      held = got.length === 1 && got[0] === noEntryNotice(w.H);
    } else {
      want = `one notice, "${notice(w.H, entry)}"`;
      held = got.length === 1 && got[0] === notice(w.H, entry);
    }
    if (!(held && r.code === 0 && out(r) === passLine(w.H, 1, 2, 2, 0, 1))) {
      wrong.push(`${step}, apps/lib/package.json ${q(lib.pkg)}: want exit 0, the PASS line and ${want}\n${shown(r)}`);
    }
  }
  assert.deepEqual(wrong, [], `each world's entry is read in the rule's order\n${wrong.join('\n---\n')}`);
});
