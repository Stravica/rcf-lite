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
// node_modules/.bin on PATH for vitest and playwright only. Imports:
// Node builtins and test/_harness/ only (GR-40).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, renameSync, symlinkSync } from 'node:fs';
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

// The real vitest in the repository root's node_modules, as a root
// devDependency installs it: rc-46 b-vitest's package.json and lockfile
// installed with npm ci in a scratch directory of its own (npm's temp
// files in the test's scratch), then its node_modules entries moved into
// the world's node_modules (gitignored), its .bin entries merged into the
// root's .bin. The world's committed package.json stays its own and no
// lockfile is written in it.
function rootVitest(t, dir) {
  const at = scratch(t, 'rcf-h-vitest-');
  for (const f of ['package.json', 'package-lock.json']) cpSync(join(RC46, 'b-vitest', f), join(at, f));
  install(t, at);
  const from = join(at, 'node_modules');
  const to = join(dir, 'node_modules');
  mkdirSync(join(to, '.bin'), { recursive: true });
  for (const e of readdirSync(from)) {
    if (e === '.package-lock.json') continue;
    const names = e === '.bin' ? readdirSync(join(from, e)).map((b) => join('.bin', b)) : [e];
    for (const n of names) {
      assert.ok(!existsSync(join(to, n)), `the world's node_modules holds no ${n} before vitest's install moves in`);
      renameSync(join(from, n), join(to, n));
    }
  }
}

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
