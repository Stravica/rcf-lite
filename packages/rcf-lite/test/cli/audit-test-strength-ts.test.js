// FBS-242 (US-19904): rcf audit test-strength over TypeScript (RC-46, round
// D): bound tests under tsx node:test, vitest and @playwright/test, each
// run through its declared runner and judged from that runner's report;
// Code Nodes in .ts, .tsx and .vue files; what stays unreadable recorded
// per criterion as BLOCKED (stage-keeper ruling Q2 (a)).
//
// Criteria: 7, all external. Each test drives bin/rcf.js audit
// test-strength as a child process over a scratch copy of a committed
// fixture project under test/fixtures/rc-46/ (the discovery study's
// appendix A1 projects, a-tsx-node-test to d-tsx-vue, and two synthetic
// packs minted on rcf-lite 0.38.0), laid over the project the bin's own
// rcf init makes. The test writes the rcf/test-strength.json and the Code
// Node records its criterion's Given names into the copy (a fixture's
// rcf/code-nodes/ is production class, so none is committed), installs
// the fixture's own devDependencies (tsx, vitest, @playwright/test, vue,
// @vitejs/plugin-vue, pinned in its package.json and package-lock.json)
// with npm ci, and commits it to git. No spec opens a browser: the
// Playwright specs use no browser fixture. Every run passes PATH from
// toolPath(['node']), as FBS-236's tests do, with node's directory first.
// Red at the round's DEFINE head: 0.38.0 refuses every .ts, .tsx and
// .vue path with "is not a supported source (JavaScript ESM or
// CommonJS)", exit 2, before any file is read. Imports: Node builtins
// and test/_harness/ only (GR-40).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { delimiter, join, relative, sep } from 'node:path';

import { PACKAGE_ROOT, lines, rcf, run, toolPath } from '../_harness/spawn.js';
import { commit, git, initRepo, s7, s12 } from '../_harness/git.js';
import { bindTests, criterion, editFbs, editStory, project, readJson, reviewVerdict, scratch, testVerdict, verdictPath, writeJson, writeText } from '../_harness/fixture.js';
import { json } from '../_harness/capture.js';

const FIXTURES = join(PACKAGE_ROOT, 'test', 'fixtures', 'rc-46');
const q = JSON.stringify;
const TS_CONFIG = { entry: [{ kind: 'module', path: 'src/index.ts' }], harness: ['test/_harness/**'] };
const TSX_ARGV = ['node_modules/.bin/tsx', '--test', '--test-reporter=tap', '--test-name-pattern', '<name>', '<file>'];

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

// Copy a committed fixture project into dir, leaving out its variants/
// (an overlay a test lays on by name) and any node_modules.
function copyFixture(name, dir, variant) {
  const root = join(FIXTURES, name);
  cpSync(root, dir, {
    recursive: true,
    filter: (p) => {
      const parts = relative(root, p).split(sep);
      return parts[0] !== 'variants' && !parts.includes('node_modules');
    },
  });
  if (variant) cpSync(join(root, 'variants', variant), dir, { recursive: true });
}

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

const configText = (config) => `${q(config, null, 2)}\n`;

// A fixture project in git at H: the rcf init project (US-101, FBS-001)
// with the fixture's files over it, US-101 holding `acs` (FBS-001 scoping
// them at inProgress), rcf/test-strength.json `config`, Code Nodes
// [[path, acIds]] and bound tests [[acId, file, name]].
async function tsProject(t, name, {
  variant, acs = ['AC-101-1'], config = TS_CONFIG, nodes = [], bind = [], deps = true,
} = {}) {
  const dir = await project(t, { name: 'ts' });
  copyFixture(name, dir, variant);
  editStory(dir, 'US-101', (us) => { us.acceptanceCriteria = acs.map((id) => criterion(id, `${id} holds for the fixture project`)); });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = acs; f.executionStatus = 'inProgress'; });
  writeText(dir, 'rcf/test-strength.json', configText(config));
  codeNodes(dir, nodes);
  bindTests(dir, bind.map(([acId, file, title]) => ({ acId, pointer: `${file}::${title}` })), { realTests: false });
  writeText(dir, '.gitignore', 'node_modules/\n');
  if (deps) install(t, dir);
  initRepo(dir);
  const H = commit(dir, 'fixture: base');
  return { dir, H };
}

// A synthetic pack in git at H: its own chain as minted on 0.38.0, with
// rcf/test-strength.json `config` and the Code Nodes its README lists.
async function packProject(t, name, { config, nodes }) {
  const dir = join(scratch(t, 'rcf-h-pack-'), 'project');
  copyFixture(name, dir);
  writeText(dir, 'rcf/test-strength.json', configText(config));
  codeNodes(dir, nodes);
  install(t, dir);
  initRepo(dir);
  const H = commit(dir, 'fixture: base');
  return { dir, H };
}

// A new head with rcf/test-strength.json replaced by `config`.
const reconfigure = (dir, config) => commit(dir, 'fixture: runner', { 'rcf/test-strength.json': configText(config) });

// node's directory ahead of git's: a host whose git directory also holds
// an older node (one lane host's /usr/bin/node is v20, which strips no
// types) must not shadow the node the runner names.
const nodeFirst = () => { const [gitDir, ...rest] = toolPath(['node']).split(delimiter); return [...rest, gitDir].join(delimiter); };
const strength = (dir, args = []) => rcf(['audit', 'test-strength', ...args], { cwd: dir, env: { PATH: nodeFirst() }, timeout: 900_000 });
const out = (r) => r.stdout.replace(/\n$/, '');
const shown = (r) => `exit ${r.code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
const passLine = (h, n, k, total, timeout = 0, na = 0) => `test-strength: PASS ${n} criteria at ${s7(h)}: structural ${n}/${n}, mutants killed ${k}/${total} (timeout ${timeout}, notApplicable ${na})`;
const passAny = (h) => new RegExp(`^test-strength: PASS 1 criteria at ${s7(h)}: structural 1/1, mutants killed (\\d+)/\\1 \\(timeout \\d+, notApplicable \\d+\\)$`);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unmutatedRed = (pointer) => new RegExp(`^test-strength: the unmutated run is red for AC-101-1: ${escape(pointer)} fails under runner (.+); no mutant was run$`);
const noResultLine = (r) => assert.ok(!lines(r.stdout).some((l) => /^test-strength: (PASS|FAIL) /.test(l)), `neither the PASS line nor a FAIL line\n${shown(r)}`);
const crit = (report, acId) => report.criteria.find((c) => c.acId === acId);
const ops = (report, symbol) => crit(report, 'AC-101-1').mutants.filter((m) => m.symbol === symbol).map((m) => m.operator).sort();

// ---------------------------------------------------------------- US-19904

test('AC-19904-1: a .ts project with entry src/index.ts and no runner, AC-101-1 bound to test/totals.test.ts::sums the line items (node:test in one describe, importing ../src/index.ts) and claiming src/totals.ts#sumTotals, exits 0 with "test-strength: PASS 1 criteria at <h7>: structural 1/1, mutants killed 2/2 (timeout 0, notApplicable 1)", and likewise under a tsx runners entry and through a NodeNext .js specifier', async (t) => {
  const a = await tsProject(t, 'a-tsx-node-test', {
    nodes: [['src/totals.ts#sumTotals', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/totals.test.ts', 'sums the line items']],
  });
  const none = await strength(a.dir, ['--acs', 'AC-101-1']);
  assert.equal(none.code, 0, `no runner declared: exit 0\n${shown(none)}`);
  assert.equal(out(none), passLine(a.H, 1, 2, 2, 0, 1), shown(none));

  const H2 = reconfigure(a.dir, { ...TS_CONFIG, runners: [{ files: ['test/**'], kind: 'nodeTest', argv: TSX_ARGV }] });
  const tsx = await strength(a.dir, ['--acs', 'AC-101-1']);
  assert.equal(tsx.code, 0, `a tsx runners entry: exit 0\n${shown(tsx)}`);
  assert.equal(out(tsx), passLine(H2, 1, 2, 2, 0, 1), shown(tsx));

  // A downstream report's finding 5: tests import src/intervals.ts as ../../../../src/intervals.js.
  const pack = await packProject(t, 'pack-tsx-node-test', {
    config: { entry: [{ kind: 'module', path: 'src/intervals.ts' }], harness: ['tests/rcf/helpers/**'], runners: [{ files: ['tests/**'], kind: 'nodeTest', argv: TSX_ARGV }] },
    nodes: [['src/intervals.ts#overlaps', ['AC-101-1']], ['src/intervals.ts#mergeIntervals', ['AC-101-2']], ['src/intervals.ts#assertInterval', ['AC-101-2']]],
  });
  const js = await strength(pack.dir, ['--acs', 'AC-101-1']);
  assert.equal(js.code, 0, `a NodeNext .js specifier resolves to the .ts entry: exit 0\n${shown(js)}`);
  assert.equal(out(js), passLine(pack.H, 1, 2, 2, 0, 1), shown(js));
});

test('AC-19904-2: a vitest runners entry with AC-101-1 bound to test/cart.test.ts::cart > applies a percentage discount, importing ../src/index and claiming src/cart.ts#applyDiscount, exits 0, structural 1/1, both body mutants killed; a pointer naming a vitest describe title matches as a prefix of the title path and passes the same way', async (t) => {
  const b = await tsProject(t, 'b-vitest', {
    config: { ...TS_CONFIG, runners: [{ files: ['test/**'], kind: 'vitest' }] },
    nodes: [['src/cart.ts#applyDiscount', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/cart.test.ts', 'cart > applies a percentage discount']],
  });
  const r = await strength(b.dir, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 0, `the vitest title path is run and judged from vitest's report: exit 0\n${shown(r)}`);
  assert.equal(out(r), passLine(b.H, 1, 2, 2, 0, 1), `structural 1/1, stubToThrow and noOp killed, callRemoval notApplicable\n${shown(r)}`);

  // The vitest pack binds AC-101-1 to its describe title (stage-keeper ruling on describe-title pointers).
  const pack = await packProject(t, 'pack-vitest-playwright', {
    config: {
      entry: [{ kind: 'module', path: 'src/slug.ts' }, { kind: 'bin', path: 'src/preview-server.ts' }], harness: ['tests/rcf/helpers/**'],
      runners: [{ files: ['tests/rcf/unit/**'], kind: 'vitest' }, { files: ['tests/rcf/ui/**'], kind: 'playwright' }],
    },
    nodes: [['src/slug.ts#slugify', ['AC-101-1', 'AC-101-2']], ['src/slug.ts#isSlug', ['AC-101-1']], ['src/preview-server.ts#renderPreviewPage', ['AC-101-2']]],
  });
  const d = await strength(pack.dir, ['--acs', 'AC-101-1']);
  assert.equal(d.code, 0, `a describe-title pointer is run when a leaf under it ran: exit 0\n${shown(d)}`);
  assert.match(out(d), passAny(pack.H), `the PASS line, structural 1/1, every applicable mutant killed\n${shown(d)}`);
});

test('AC-19904-3: a playwright runners entry with AC-101-1 bound to e2e/slug.spec.ts::slug > slugs a title (no browser fixture) and, under a vitest entry, to test/slug.test.ts, exits 0 with each mutant of src/slug.ts#slugify killed; --help documents runners; an argv override with no reporter flag fails the unmutated run naming --reporter', async (t) => {
  const runners = [{ files: ['e2e/**'], kind: 'playwright' }, { files: ['test/**'], kind: 'vitest' }];
  const c = await tsProject(t, 'c-playwright', {
    variant: 'no-browser',
    config: { ...TS_CONFIG, runners },
    nodes: [['src/slug.ts#slugify', ['AC-101-1']]],
    bind: [['AC-101-1', 'e2e/slug.spec.ts', 'slug > slugs a title'], ['AC-101-1', 'test/slug.test.ts', 'slug > joins the words of a title with hyphens']],
  });
  const r = await strength(c.dir, ['--acs', 'AC-101-1', '--json']);
  assert.equal(r.code, 0, `each bound file runs under the first runners entry matching it: exit 0\n${shown(r)}`);
  const report = json(r.stdout);
  assert.equal(crit(report, 'AC-101-1').result, 'pass', shown(r));
  const slug = crit(report, 'AC-101-1').mutants.filter((m) => m.symbol === 'src/slug.ts#slugify' && m.result !== 'notApplicable');
  assert.ok(slug.length >= 2, `stubToThrow and noOp on src/slug.ts#slugify\n${r.stdout}`);
  for (const m of slug) assert.equal(m.result, 'killed', `${m.operator} on src/slug.ts#slugify reads killed\n${r.stdout}`);

  const help = await rcf(['audit', 'test-strength', '--help'], { cwd: c.dir });
  assert.equal(help.code, 0, shown(help));
  for (const s of ['"runners"', '"files"', '"kind"', '"argv"', '"nodeTest" | "vitest" | "playwright"', '"runner"']) {
    assert.ok(help.stdout.includes(s), `the help documents ${s} in rcf/test-strength.json\n${help.stdout}`);
  }

  const argv = ['node_modules/.bin/vitest', 'run', '<file>', '-t', '<name>'];
  reconfigure(c.dir, { ...TS_CONFIG, runners: [{ files: ['e2e/**'], kind: 'playwright' }, { files: ['test/**'], kind: 'vitest', argv }] });
  const bare = await strength(c.dir, ['--acs', 'AC-101-1']);
  const pointer = 'test/slug.test.ts::slug > joins the words of a title with hyphens';
  assert.ok(lines(bare.stderr).includes(`test-strength: the unmutated run is red for AC-101-1: ${pointer} fails under runner ${argv.join(' ')}; no mutant was run`), `an override without a reporter flag fails the unmutated run\n${shown(bare)}`);
  assert.ok(lines(bare.stderr).some((l) => l.includes('--reporter')), `a hint names the reporter flag\n${shown(bare)}`);
  assert.equal(bare.code, 2, shown(bare));
  noResultLine(bare);
});

test('AC-19904-4: Code Nodes src/Badge.tsx#badgeLabel, src/Counter.vue#clampStart (in <script lang="ts">) and file-level src/Counter.vue under a vitest runners entry exit 0, each symbol with three mutants and the SFC one fileBlank', async (t) => {
  const d = await tsProject(t, 'd-tsx-vue', {
    config: { ...TS_CONFIG, runners: [{ files: ['test/**'], kind: 'vitest' }] },
    nodes: [['src/Badge.tsx#badgeLabel', ['AC-101-1']], ['src/Counter.vue#clampStart', ['AC-101-1']], ['src/Counter.vue', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/badge.test.ts', 'badge > caps the label at 99+'], ['AC-101-1', 'test/counter.test.ts', 'counter > clamps the start value to ten']],
  });
  const r = await strength(d.dir, ['--acs', 'AC-101-1', '--json']);
  assert.equal(r.code, 0, `.tsx and .vue Code Nodes are read: exit 0\n${shown(r)}`);
  const report = json(r.stdout);
  assert.equal(crit(report, 'AC-101-1').result, 'pass', r.stdout);
  const three = ['callRemoval', 'noOp', 'stubToThrow'];
  assert.deepEqual(ops(report, 'src/Badge.tsx#badgeLabel'), three, `three mutants on src/Badge.tsx#badgeLabel\n${r.stdout}`);
  assert.deepEqual(ops(report, 'src/Counter.vue#clampStart'), three, `three mutants on src/Counter.vue#clampStart\n${r.stdout}`);
  assert.deepEqual(ops(report, 'src/Counter.vue'), ['fileBlank'], `one fileBlank on src/Counter.vue\n${r.stdout}`);

  // The SFC script view (ruling Q9): blocks in document order, non-script
  // content blank-padded, so clampStart declared in the last block is read.
  const two = await tsProject(t, 'd-tsx-vue', {
    variant: 'two-block',
    config: { ...TS_CONFIG, runners: [{ files: ['test/**'], kind: 'vitest' }] },
    nodes: [['src/Counter.vue#clampStart', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/counter.test.ts', 'counter > clamps the start value to ten']],
  });
  const s = await strength(two.dir, ['--acs', 'AC-101-1', '--json']);
  assert.equal(s.code, 0, `a two-block SFC declaring clampStart in its last block: exit 0\n${shown(s)}`);
  const sfc = json(s.stdout);
  assert.equal(crit(sfc, 'AC-101-1').result, 'pass', s.stdout);
  assert.deepEqual(ops(sfc, 'src/Counter.vue#clampStart'), three, `three mutants on src/Counter.vue#clampStart in the two-block SFC\n${s.stdout}`);
});

test('AC-19904-5: a vitest pointer test/cart.test.ts::cart > applies no discount, naming no test in its file, exits 2 with "test-strength: bound test <file>::<name> was not run by runner <argv>" and scores no mutant', async (t) => {
  const b = await tsProject(t, 'b-vitest', {
    config: { ...TS_CONFIG, runners: [{ files: ['test/**'], kind: 'vitest' }] },
    nodes: [['src/cart.ts#applyDiscount', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/cart.test.ts', 'cart > applies no discount']],
  });
  const r = await strength(b.dir, ['--acs', 'AC-101-1']);
  const notRun = /^test-strength: bound test test\/cart\.test\.ts::cart > applies no discount was not run by runner (.+)$/;
  const line = lines(r.stderr).find((l) => notRun.test(l));
  assert.ok(line, `stderr names the bound test the runner did not run\n${shown(r)}`);
  const runner = notRun.exec(line)[1];
  assert.match(runner, /vitest/, `the runner named is the vitest entry's argv\n${line}`);
  // The stage-keeper's rulings F1 and F2 on the whole-plan pass's findings:
  // the vitest default argv by shape, its report read from --outputFile=<report>.
  const words = runner.split(' ');
  for (const w of ['run', '<file>', '-t', '<name>', '--reporter=json']) assert.ok(words.includes(w), `the vitest default argv carries ${w}\n${line}`);
  assert.ok(words.some((w) => w.startsWith('--outputFile=')), `the vitest default argv carries --outputFile=<report>\n${line}`);
  assert.equal(r.code, 2, shown(r));
  noResultLine(r);
});

test('AC-19904-6: a .ts bound test importing vitest that matches no runners entry, with no runner, prints the unmutated-run line plus "declare a runner for <file> in rcf/test-strength.json runners" and exits 2', async (t) => {
  const b = await tsProject(t, 'b-vitest', {
    config: { ...TS_CONFIG, runners: [{ files: ['e2e/**'], kind: 'playwright' }] },
    nodes: [['src/cart.ts#applyDiscount', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/cart.test.ts', 'cart > applies a percentage discount']],
    deps: false,
  });
  const r = await strength(b.dir, ['--acs', 'AC-101-1']);
  const red = lines(r.stderr).find((l) => unmutatedRed('test/cart.test.ts::cart > applies a percentage discount').test(l));
  assert.ok(red, `the unmutated run is red under the nodeTest default\n${shown(r)}`);
  assert.match(unmutatedRed('test/cart.test.ts::cart > applies a percentage discount').exec(red)[1], /^node /, `the runner named is the nodeTest default\n${red}`);
  assert.ok(r.stderr.includes('declare a runner for test/cart.test.ts in rcf/test-strength.json runners'), `the hint names the file and the runners field\n${shown(r)}`);
  assert.equal(r.code, 2, shown(r));
  noResultLine(r);
});

test('AC-19904-7: a Code Node file holding a TypeScript enum makes the criterion BLOCKED (stage-keeper ruling Q2 (a)): the record carries result "blocked", reason "TEST_STRENGTH_UNSUPPORTED" and a detail naming the file and "non-erasable TypeScript syntax", the run exits 5, and light Finalise refuses it like a fail', async (t) => {
  // The round as the stage-keeper runs it: base on main, then on a branch
  // DEFINE: (FBS-001 inProgress), BUILD: (the enum source and its Code
  // Node, H), REVIEW: MERGE/PASS at H, the audit's --record, TEST: PASS.
  const dir = await project(t, { name: 'ts-fin' });
  copyFixture('a-tsx-node-test', dir);
  editStory(dir, 'US-101', (us) => { us.acceptanceCriteria = [criterion('AC-101-1', '[happy] the totals hold', { verification: 'external' })]; });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = ['AC-101-1']; f.executionStatus = 'notStarted'; });
  writeText(dir, 'rcf/test-strength.json', configText(TS_CONFIG));
  bindTests(dir, [{ acId: 'AC-101-1', pointer: 'test/totals.test.ts::sums the line items' }], { realTests: false });
  writeText(dir, '.gitignore', 'node_modules/\n');
  initRepo(dir);
  commit(dir, 'fixture: base chain');
  git(dir, 'switch', '-q', '-c', 'feature');
  editFbs(dir, 'FBS-001', (f) => { f.executionStatus = 'inProgress'; });
  commit(dir, 'DEFINE: round');
  cpSync(join(FIXTURES, 'a-tsx-node-test', 'variants', 'enum'), dir, { recursive: true });
  codeNodes(dir, [['src/totals.ts#sumTotals', ['AC-101-1']]]);
  const H = commit(dir, 'BUILD: code');
  commit(dir, 'REVIEW: verdict', { [verdictPath(H, 'review.json')]: reviewVerdict(H, { touchedAcIds: ['AC-101-1'] }) });

  const r = await strength(dir, ['--acs', 'AC-101-1', '--record']);
  assert.equal(r.code, 5, `a blocked criterion: exit 5\n${shown(r)}`);
  const recorded = join(dir, verdictPath(H, 'test-strength.json'));
  assert.ok(existsSync(recorded), `the record is written at rcf/verdicts/${s12(H)}/\n${shown(r)}`);
  const c = crit(readJson(dir, verdictPath(H, 'test-strength.json')), 'AC-101-1');
  assert.equal(c.result, 'blocked', q(c));
  assert.equal(c.reason, 'TEST_STRENGTH_UNSUPPORTED', q(c));
  assert.match(c.detail, /^src\/totals\.ts:\d+:\d+: non-erasable TypeScript syntax \([^)]*enum[^)]*\)$/, `detail is "<file>:<line>:<col>: non-erasable TypeScript syntax (<construct>)" naming the enum (ruling F6)\n${q(c)}`);
  // The stage-keeper's rulings Q1 and Q2 on the pre-freeze gate's questions: a
  // blocked-only report reads result blocked, totals.blocked 1 and every other
  // count 0, and the blocked criterion's structural is { checked: false }.
  const rep = readJson(dir, verdictPath(H, 'test-strength.json'));
  assert.equal(rep.result, 'blocked', `none fails and one is blocked: result blocked\n${q(rep)}`);
  assert.deepEqual(Object.keys(rep.totals).sort(), ['criteria', 'structuralPassed', 'mutants', 'killed', 'survived', 'timeout', 'notApplicable', 'blocked'].sort(), q(rep.totals));
  assert.equal(rep.totals.blocked, 1, q(rep.totals));
  for (const k of ['structuralPassed', 'mutants', 'killed', 'survived', 'timeout', 'notApplicable']) assert.equal(rep.totals[k], 0, `totals.${k} is 0\n${q(rep.totals)}`);
  assert.deepEqual(c.structural, { checked: false }, q(c));
  // The stage-keeper's ruling F8 and carry-over 14 on the whole-plan pass's
  // findings: mutants [] and blocked: true beside result; totals.criteria
  // counts the blocked criterion.
  assert.deepEqual(c.mutants, [], q(c));
  assert.equal(c.blocked, true, q(c));
  assert.equal(rep.totals.criteria, 1, q(rep.totals));
  // The stage-keeper's ruling Q2 on the pre-freeze gate's questions: the exact
  // BLOCKED line, its counts by ruling F7 (b is the criteria in scope less the blocked one).
  const blockedLine = new RegExp(`^test-strength: BLOCKED 1 criteria at ${s7(H)}: structural 0/0, mutants killed 0/0 \\(timeout 0, notApplicable 0, blocked 1\\): AC-101-1 \\(src/totals\\.ts\\)$`);
  assert.ok(lines(r.stdout).some((l) => blockedLine.test(l)), `the summary line is the BLOCKED line ending "AC-101-1 (src/totals.ts)"\n${shown(r)}`);

  commit(dir, 'TEST: verdict', { [verdictPath(H, 'test.json')]: testVerdict(H) });
  const fin = await rcf(['build', 'finalise', 'FBS-001', '--ci-run', 'run-7'], { cwd: dir });
  assert.equal(fin.code, 4, shown(fin));
  assert.ok(lines(fin.stderr).includes(`finalise refused: test-strength at ${s7(H)} fails for AC-101-1`), `light Finalise refuses the blocked criterion like a fail\n${shown(fin)}`);

  // Ruling 5: a .tsx Code Node file holding a deliberately broken JSX
  // element (a scan the JSX scanner cannot complete) is BLOCKED the same
  // way; the bound test never imports it, so it still loads.
  const jsx = await tsProject(t, 'a-tsx-node-test', {
    nodes: [['src/totals.ts#sumTotals', ['AC-101-1']], ['src/broken.tsx#Broken', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/totals.test.ts', 'sums the line items']],
    deps: false,
  });
  commit(jsx.dir, 'fixture: a broken JSX element', { 'src/broken.tsx': 'export function Broken(label: string) {\n  return <span class="badge">{label</span>;\n}\n' });
  const j = await strength(jsx.dir, ['--acs', 'AC-101-1', '--json']);
  assert.equal(j.code, 5, `a blocked criterion: exit 5\n${shown(j)}`);
  const jc = crit(json(j.stdout), 'AC-101-1');
  assert.equal(jc.result, 'blocked', q(jc));
  assert.equal(jc.reason, 'TEST_STRENGTH_UNSUPPORTED', q(jc));
  assert.match(jc.detail, /^JSX scan failed at src\/broken\.tsx:\d+:\d+: \S.*$/, `detail is "JSX scan failed at <file>:<line>:<col>: <what the scanner met>"\n${q(jc)}`);
});

// ------------------------------------------- round D fix DEFINE (F-1 to F-9)
// The review verdict at 1bee2f8c (FINDINGS/FINDINGS, F-1 to F-16) and the
// stage-keeper's rulings on it: the clauses its broken findings showed
// unasserted, each driven through bin/rcf.js as above.

const blockedDetail = (r, acId = 'AC-101-1') => {
  const c = crit(json(r.stdout), acId);
  assert.equal(c?.result, 'blocked', `${acId} is BLOCKED\n${shown(r)}`);
  assert.equal(c.reason, 'TEST_STRENGTH_UNSUPPORTED', q(c));
  return c.detail;
};
// "<file>:<line>:<col>: non-erasable TypeScript syntax (<construct>)" at
// `line` with its column inside [from, to], the refused construct's span.
const refusedAt = (detail, file, line, [from, to], construct) => {
  const m = new RegExp(`^${escape(file)}:(\\d+):(\\d+): non-erasable TypeScript syntax \\((.+)\\)$`).exec(detail);
  assert.ok(m, `detail is "<file>:<line>:<col>: non-erasable TypeScript syntax (<construct>)" (ruling F6)\n${detail}`);
  assert.equal(Number(m[1]), line, `the refused construct sits on line ${line}\n${detail}`);
  assert.ok(Number(m[2]) >= from && Number(m[2]) <= to, `the column lies in the refused construct, columns ${from} to ${to} of line ${line}\n${detail}`);
  assert.match(m[3], construct, `the construct named is the one strip mode refused\n${detail}`);
};

// F-1 (the reviewer's own, test locus): ruling Q9's src clause.
test('AC-19904-4: a .vue Code Node whose SFC holds a <script src> block makes the criterion BLOCKED, reason "TEST_STRENGTH_UNSUPPORTED", detail "<file>:<line>:<col>: <construct>" at the block, exit 5', async (t) => {
  const d = await tsProject(t, 'd-tsx-vue', {
    config: { ...TS_CONFIG, runners: [{ files: ['test/**'], kind: 'vitest' }] },
    nodes: [['src/Linked.vue#clampStart', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/counter.test.ts', 'counter > clamps the start value to ten']],
    deps: false,
  });
  commit(d.dir, 'fixture: an SFC whose script is a src block', {
    'src/Linked.vue': '<template>\n  <button class="counter">{{ start }}</button>\n</template>\n\n<script src="./clamp.ts" lang="ts"></script>\n',
    'src/clamp.ts': 'export function clampStart(n: number): number {\n  return Math.max(0, Math.min(n, 10));\n}\n',
  });
  const r = await strength(d.dir, ['--acs', 'AC-101-1', '--json']);
  const detail = blockedDetail(r);
  assert.match(detail, /^src\/Linked\.vue:5:\d+: \S.*$/, `detail is "<file>:<line>:<col>: <construct>" at the src block on line 5 (ruling Q9, the AC-19901-9 form)\n${detail}`);
  assert.equal(r.code, 5, `a blocked criterion: exit 5\n${shown(r)}`);
});

// F-1 and F-6 (ruled D6): "attributes otherwise ignored".
test('AC-19904-4: a <script data-src="x" lang="ts"> block declaring src/Counter.vue#clampStart is read (attributes other than src ignored): exit 0, three mutants on the symbol', async (t) => {
  const d = await tsProject(t, 'd-tsx-vue', {
    config: { ...TS_CONFIG, runners: [{ files: ['test/**'], kind: 'vitest' }] },
    nodes: [['src/Counter.vue#clampStart', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/counter.test.ts', 'counter > clamps the start value to ten']],
  });
  const sfc = readFileSync(join(FIXTURES, 'd-tsx-vue', 'src', 'Counter.vue'), 'utf8');
  assert.ok(sfc.startsWith('<script lang="ts">\n'), 'the fixture SFC opens with its <script lang="ts"> block');
  commit(d.dir, 'fixture: a data-src attribute', { 'src/Counter.vue': sfc.replace('<script lang="ts">', '<script data-src="x" lang="ts">') });
  const r = await strength(d.dir, ['--acs', 'AC-101-1', '--json']);
  const c = crit(json(r.stdout), 'AC-101-1');
  assert.notEqual(c?.result, 'blocked', `a data-src attribute is not a src attribute: the block is read\n${shown(r)}`);
  assert.equal(r.code, 0, `exit 0\n${shown(r)}`);
  assert.equal(c.result, 'pass', r.stdout);
  assert.deepEqual(ops(json(r.stdout), 'src/Counter.vue#clampStart'), ['callRemoval', 'noOp', 'stubToThrow'], `three mutants on src/Counter.vue#clampStart\n${r.stdout}`);
});

// F-7 (ruled C1): the detail names the construct strip mode refused, at
// its own position, never the first erasable look-alike.
test('AC-19904-7: the detail names the construct strip mode refused at its own line and column: a parameter property private y on line 3 behind a class field private x, and an enum behind a declare enum', async (t) => {
  const a = await tsProject(t, 'a-tsx-node-test', {
    acs: ['AC-101-1', 'AC-101-2'],
    nodes: [['src/ledger.ts#total', ['AC-101-1']], ['src/modes.ts#total', ['AC-101-2']]],
    bind: [['AC-101-1', 'test/totals.test.ts', 'sums the line items'], ['AC-101-2', 'test/totals.test.ts', 'sums the line items']],
    deps: false,
  });
  commit(a.dir, 'fixture: erasable look-alikes ahead of the refused constructs', {
    'src/ledger.ts': 'export class Ledger {\n  private x = 1;\n  constructor(private y: number) {}\n}\nexport function total(n: number): number {\n  return n;\n}\n',
    'src/modes.ts': 'declare enum A { X }\nexport enum B { Y }\nexport function total(n: number): number {\n  return n;\n}\n',
  });
  const r = await strength(a.dir, ['--acs', 'AC-101-1,AC-101-2', '--json']);
  // "  constructor(private y: number) {}": the parameter property spans columns 15 to 31.
  refusedAt(blockedDetail(r, 'AC-101-1'), 'src/ledger.ts', 3, [15, 31], /\by\b/);
  // "export enum B { Y }": the enum declaration spans columns 1 to 19.
  refusedAt(blockedDetail(r, 'AC-101-2'), 'src/modes.ts', 2, [1, 19], /enum\b.*\bB\b/);
  assert.equal(r.code, 5, `blocked criteria only: exit 5\n${shown(r)}`);
});

// F-4 (ruled D2, spec-rooted): the playwright describe-prefix form, the
// segments space-joined and followed by a space, so a pointer naming the
// describe "title" never selects a test of the sibling describe "titles".
test('AC-19904-3: a playwright pointer naming a describe title runs the tests of that describe through the describe-prefix form (followed by a space) and no test of a sibling describe whose title extends it, exit 0', async (t) => {
  const marker = join(scratch(t, 'rcf-h-marks-'), 'sibling');
  const c = await tsProject(t, 'c-playwright', {
    variant: 'no-browser',
    config: { ...TS_CONFIG, runners: [{ files: ['e2e/**'], kind: 'playwright' }] },
    nodes: [['src/slug.ts#slugify', ['AC-101-1']]],
    bind: [['AC-101-1', 'e2e/prefix.spec.ts', 'title']],
  });
  const H = commit(c.dir, 'fixture: a describe and its sibling', {
    'e2e/prefix.spec.ts': [
      "import { test, expect } from '@playwright/test';",
      "import { writeFileSync } from 'node:fs';",
      "import { slugify } from '../src/index';",
      '',
      "test.describe('title', () => {",
      "  test('slugs the words', () => {",
      "    expect(slugify('Hello World')).toBe('hello-world');",
      '  });',
      '});',
      '',
      "test.describe('titles', () => {",
      "  test('is a sibling describe', () => {",
      `    writeFileSync(${q(marker)}, 'ran');`,
      '  });',
      '});',
      '',
    ].join('\n'),
  });
  const r = await strength(c.dir, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 0, `a describe-title pointer under playwright: exit 0\n${shown(r)}`);
  assert.match(out(r), passAny(H), shown(r));
  assert.equal(existsSync(marker), false, `the sibling describe "titles" never ran: the describe prefix is "title" followed by a space\n${shown(r)}`);
});

// F-8 (the stage-keeper's ruling F-8a): vitest matches -t against the
// titles joined by " > ", so a bare leaf pointer runs through the leaf
// form anchored at the end and at a title boundary.
const VITEST_CART = { ...TS_CONFIG, runners: [{ files: ['test/**'], kind: 'vitest' }] };

test('AC-19904-3: a vitest pointer naming the bare leaf title of a test nested two describes deep runs that test through the leaf form anchored at a title boundary, exit 0 with the PASS line', async (t) => {
  const b = await tsProject(t, 'b-vitest', {
    config: VITEST_CART,
    nodes: [['src/cart.ts#applyDiscount', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/nested.test.ts', 'applies a percentage discount']],
  });
  const H = commit(b.dir, 'fixture: a test two describes deep', {
    'test/nested.test.ts': [
      "import { describe, it, expect } from 'vitest';",
      "import { applyDiscount } from '../src/index';",
      '',
      "describe('cart', () => {",
      "  describe('discounts', () => {",
      "    it('applies a percentage discount', () => {",
      '      expect(applyDiscount(200, 10)).toBe(180);',
      '    });',
      '  });',
      '});',
      '',
    ].join('\n'),
  });
  const r = await strength(b.dir, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 0, `a bare leaf pointer runs the test nested in cart > discounts: exit 0\n${shown(r)}`);
  assert.match(out(r), passAny(H), shown(r));
});

test('AC-19904-3: a vitest leaf pointer runs its own test and no test of the same describe whose longer title ends in the same words, exit 0 with the PASS line', async (t) => {
  const marker = join(scratch(t, 'rcf-h-marks-'), 'near-miss');
  const b = await tsProject(t, 'b-vitest', {
    config: VITEST_CART,
    nodes: [['src/cart.ts#applyDiscount', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/near.test.ts', 'applies a percentage discount']],
  });
  const H = commit(b.dir, 'fixture: a leaf and a longer title ending in it', {
    'test/near.test.ts': [
      "import { describe, it, expect } from 'vitest';",
      "import { writeFileSync } from 'node:fs';",
      "import { applyDiscount } from '../src/index';",
      '',
      "describe('cart', () => {",
      "  it('applies a percentage discount', () => {",
      '    expect(applyDiscount(200, 10)).toBe(180);',
      '  });',
      "  it('already applies a percentage discount', () => {",
      `    writeFileSync(${q(marker)}, 'ran');`,
      '  });',
      '});',
      '',
    ].join('\n'),
  });
  const r = await strength(b.dir, ['--acs', 'AC-101-1']);
  assert.equal(r.code, 0, `a leaf pointer inside a describe runs: exit 0\n${shown(r)}`);
  assert.match(out(r), passAny(H), shown(r));
  assert.equal(existsSync(marker), false, `the test "cart > already applies a percentage discount" never ran: the leaf is anchored at a title boundary\n${shown(r)}`);
});

// Every path under dir but .git/, with its type, size and mtime, so a
// new, changed or deleted path shows, ignored paths (node_modules) included.
function tree(dir) {
  const seen = new Map();
  const walk = (rel) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (p === '.git') continue;
      const s = lstatSync(join(dir, p));
      if (e.isDirectory()) { seen.set(`${p}/`, 'dir'); walk(p); } else seen.set(p, `${s.isSymbolicLink() ? 'link' : 'file'} ${s.size} ${s.mtimeMs}`);
    }
  };
  walk('');
  return seen;
}
const moved = (before, after, keep = () => false) => [...new Set([...before.keys(), ...after.keys()])].filter((p) => before.get(p) !== after.get(p) && !keep(p)).sort();

// F-9 (ruled C3, blocking until disproved): vitest keeps caches under
// node_modules, and the runner's worktrees link the project's node_modules.
test('AC-19903-5: a vitest project audited end to end, with and without --record, has no new, changed or deleted path in its project tree outside rcf/verdicts/<H12>/, node_modules included', async (t) => {
  const b = await tsProject(t, 'b-vitest', {
    config: { ...TS_CONFIG, runners: [{ files: ['test/**'], kind: 'vitest' }] },
    nodes: [['src/cart.ts#applyDiscount', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/cart.test.ts', 'cart > applies a percentage discount']],
  });
  const before = tree(b.dir);
  const plain = await strength(b.dir, ['--acs', 'AC-101-1']);
  assert.equal(plain.code, 0, `the vitest project passes: exit 0\n${shown(plain)}`);
  assert.deepEqual(moved(before, tree(b.dir)), [], `without --record no path in the project tree is new, changed or deleted\n${shown(plain)}`);

  commit(b.dir, 'REVIEW: verdict', { [verdictPath(b.H, 'review.json')]: reviewVerdict(b.H, { touchedAcIds: ['AC-101-1'] }) });
  const reviewedTree = tree(b.dir);
  const rec = await strength(b.dir, ['--acs', 'AC-101-1', '--record']);
  assert.equal(rec.code, 0, `--record at the reviewed head: exit 0\n${shown(rec)}`);
  assert.ok(existsSync(join(b.dir, verdictPath(b.H, 'test-strength.json'))), `the record is written at rcf/verdicts/${s12(b.H)}/\n${shown(rec)}`);
  const inVerdicts = (p) => p.startsWith(`rcf/verdicts/${s12(b.H)}/`);
  assert.deepEqual(moved(reviewedTree, tree(b.dir), inVerdicts), [], `with --record no path outside rcf/verdicts/${s12(b.H)}/ is new, changed or deleted\n${shown(rec)}`);
});

// ------------------------------------------- round D fix round 2 (R-3, R-4)
// The re-review verdict at 150ab8ea (FINDINGS/FINDINGS) and the
// stage-keeper's rulings on it: R-3, the re-review verdict's F-3 (the
// column counts characters of the source line, a tab as one), and R-4,
// its F-4 (the cache flags apply to every vitest invocation the audit
// makes, an argv override included).

// R-3: node prints a tab-indented source line with each tab expanded, so
// a caret read off that line lands past the construct; the column counts
// the source line's own characters and the construct keeps its name.
test('AC-19904-7: on a tab-indented line the detail places a parameter property at its column counted with a tab as one character and names it: private y on line 3 behind a tab-indented class field, 3:22, exit 5', async (t) => {
  const a = await tsProject(t, 'a-tsx-node-test', {
    nodes: [['src/ledger.ts#total', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/totals.test.ts', 'sums the line items']],
    deps: false,
  });
  commit(a.dir, 'fixture: a tab-indented class', {
    'src/ledger.ts': 'export class Ledger {\n\tprivate x = 1;\n\tconstructor(private y: number) {}\n}\nexport function total(n: number): number {\n\treturn n;\n}\n',
  });
  const r = await strength(a.dir, ['--acs', 'AC-101-1', '--json']);
  const detail = blockedDetail(r);
  // "\tconstructor(private y: number) {}": the tab is column 1, so y, where node places the parameter property, is column 22.
  const m = /^src\/ledger\.ts:(\d+):(\d+): non-erasable TypeScript syntax \((.+)\)$/.exec(detail);
  assert.ok(m, `detail is "<file>:<line>:<col>: non-erasable TypeScript syntax (<construct>)" (ruling F6)\n${detail}`);
  assert.equal(`${m[1]}:${m[2]}`, '3:22', `the parameter property y sits at 3:22, the column counted on the source line with a tab as one character\n${detail}`);
  assert.match(m[3], /\by\b/, `the construct is named as on a space-indented line: the parameter property y\n${detail}`);
  assert.equal(r.code, 5, `blocked criteria only: exit 5\n${shown(r)}`);
});

test('AC-19904-7: on a tab-indented line the detail places an enum at its column counted with a tab as one character and names it: enum B on line 2, 2:9, exit 5', async (t) => {
  const a = await tsProject(t, 'a-tsx-node-test', {
    nodes: [['src/modes.ts#total', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/totals.test.ts', 'sums the line items']],
    deps: false,
  });
  commit(a.dir, 'fixture: a tab-indented enum', {
    'src/modes.ts': 'export const x = 1;\n\texport enum B { Y }\nexport function total(n: number): number {\n\treturn n;\n}\n',
  });
  const r = await strength(a.dir, ['--acs', 'AC-101-1', '--json']);
  const detail = blockedDetail(r);
  // "\texport enum B { Y }": the tab is column 1, so enum is column 9.
  const m = /^src\/modes\.ts:(\d+):(\d+): non-erasable TypeScript syntax \((.+)\)$/.exec(detail);
  assert.ok(m, `detail is "<file>:<line>:<col>: non-erasable TypeScript syntax (<construct>)" (ruling F6)\n${detail}`);
  assert.equal(`${m[1]}:${m[2]}`, '2:9', `the enum sits at 2:9, the column counted on the source line with a tab as one character\n${detail}`);
  assert.match(m[3], /enum\b.*\bB\b/, `the construct is named as on a space-indented line: enum B\n${detail}`);
  assert.equal(r.code, 5, `blocked criteria only: exit 5\n${shown(r)}`);
});

// R-4: a vitest runners entry whose argv the project overrides (the
// default argv spelled out) still leaves the project tree as it was.
test('AC-19903-5: a vitest project whose runners entry carries its own argv, audited end to end with and without --record, has no new, changed or deleted path in its project tree outside rcf/verdicts/<H12>/, node_modules included', async (t) => {
  const b = await tsProject(t, 'b-vitest', {
    config: { ...TS_CONFIG, runners: [{ files: ['test/**'], kind: 'vitest', argv: ['vitest', 'run', '<file>', '-t', '<name>', '--reporter=json', '--outputFile=<report>'] }] },
    nodes: [['src/cart.ts#applyDiscount', ['AC-101-1']]],
    bind: [['AC-101-1', 'test/cart.test.ts', 'cart > applies a percentage discount']],
  });
  const before = tree(b.dir);
  const plain = await strength(b.dir, ['--acs', 'AC-101-1']);
  assert.equal(plain.code, 0, `the vitest project passes under its argv override: exit 0\n${shown(plain)}`);
  assert.deepEqual(moved(before, tree(b.dir)), [], `without --record no path in the project tree is new, changed or deleted\n${shown(plain)}`);

  commit(b.dir, 'REVIEW: verdict', { [verdictPath(b.H, 'review.json')]: reviewVerdict(b.H, { touchedAcIds: ['AC-101-1'] }) });
  const reviewedTree = tree(b.dir);
  const rec = await strength(b.dir, ['--acs', 'AC-101-1', '--record']);
  assert.equal(rec.code, 0, `--record at the reviewed head: exit 0\n${shown(rec)}`);
  assert.ok(existsSync(join(b.dir, verdictPath(b.H, 'test-strength.json'))), `the record is written at rcf/verdicts/${s12(b.H)}/\n${shown(rec)}`);
  const inVerdicts = (p) => p.startsWith(`rcf/verdicts/${s12(b.H)}/`);
  assert.deepEqual(moved(reviewedTree, tree(b.dir), inVerdicts), [], `with --record no path outside rcf/verdicts/${s12(b.H)}/ is new, changed or deleted\n${shown(rec)}`);
});
