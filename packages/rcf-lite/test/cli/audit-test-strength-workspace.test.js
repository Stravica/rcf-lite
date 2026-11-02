// FBS-242 amend round (round E; US-19903, US-19904): rcf audit
// test-strength over workspace packages. A working copy links each
// workspace package's node_modules keeping each link's own target, and a
// bound test runs at its package directory (the nearest directory at HEAD
// from the test file up to the rcf project root holding a package.json,
// else the rcf project root) with <file> relative to it, whatever its
// runner kind; a runners entry may pin "cwd": "project", and any other
// cwd value is a malformed config; a bare tsx in a nodeTest argv resolves
// through its package's node_modules/.bin; the backstop covers every
// linked node_modules, naming a path relative to the rcf project root;
// and the help keeps its backstop sentence.
//
// Criteria: 8, all external. Each test drives bin/rcf.js audit
// test-strength (or --help) as a child process over a scratch copy of a
// committed fixture world under test/fixtures/round-e/ (ws-two, the
// pnpm layout: package dependencies not hoisted, a workspace package
// link, a cwd-relative path; ws-sibling, an rcf project beside a sibling
// package; ws-kinds, one package per runner kind), laid over the project
// the bin's own rcf init makes. The test writes the installed layout
// (links and stand-in packages under node_modules, gitignored, as the
// round D tests write node_modules/rootpkg), the rcf/test-strength.json
// and the Code Node records its criterion's Given names, and commits the
// world to git; ws-kinds installs apps/web's devDependencies with npm ci,
// as the round D tests install theirs. Before each audit the bound tests
// are run in place at their package directory, so a red audit is the
// audit's. Every run passes PATH from toolPath(['node', 'sh']), node's
// directory first, and no node_modules/.bin. Red at the round E DEFINE
// head: 0.39.0 links only the node_modules of the rcf project and its
// ancestors and runs every bound test at the rcf project root. Imports:
// Node builtins and test/_harness/ only (GR-40).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, renameSync, symlinkSync } from 'node:fs';
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
// apps/api/node_modules/.bin. Nothing of ms or @ws/lib at the root.
function pnpmLayout(dir) {
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
  writeText(dir, 'apps/api/node_modules/.bin/tsx', [
    '#!/usr/bin/env node',
    '// A stand-in for tsx: the fixture tests are plain JavaScript, so node runs them with the same arguments.',
    "const { spawnSync } = require('node:child_process');",
    "const r = spawnSync(process.execPath, process.argv.slice(2), { stdio: 'inherit' });",
    'process.exit(r.status === null ? 1 : r.status);',
    '',
  ].join('\n'));
  chmodSync(join(dir, 'apps', 'api', 'node_modules', '.bin', 'tsx'), 0o755);
}

// ws-two in git at H: the rcf init project with the world laid over it,
// the pnpm layout written, and the chain.
async function wsTwo(t, spec) {
  const dir = await project(t, { name: 'ws' });
  cpSync(join(WORLDS, 'ws-two'), dir, { recursive: true });
  pnpmLayout(dir);
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

