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
import { cpSync, existsSync, mkdirSync } from 'node:fs';
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
  assert.match(notRun.exec(line)[1], /vitest/, `the runner named is the vitest entry's argv\n${line}`);
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

  const r = await strength(dir, ['--record']);
  assert.equal(r.code, 5, `a blocked criterion: exit 5\n${shown(r)}`);
  const recorded = join(dir, verdictPath(H, 'test-strength.json'));
  assert.ok(existsSync(recorded), `the record is written at rcf/verdicts/${s12(H)}/\n${shown(r)}`);
  const c = crit(readJson(dir, verdictPath(H, 'test-strength.json')), 'AC-101-1');
  assert.equal(c.result, 'blocked', q(c));
  assert.equal(c.reason, 'TEST_STRENGTH_UNSUPPORTED', q(c));
  assert.ok(c.detail.includes('src/totals.ts') && c.detail.includes('non-erasable TypeScript syntax'), `detail names the file and the construct\n${q(c)}`);
  // The stage-keeper's rulings 1 and 2 on the DEFINE's questions: the BLOCKED
  // line, its open values matched by shape.
  const blockedLine = new RegExp(`^test-strength: BLOCKED 1 criteria at ${s7(H)}: structural \\d+/\\d+, mutants killed \\d+/\\d+ \\(timeout \\d+, notApplicable \\d+, blocked 1\\): (.+)$`);
  const summary = lines(r.stdout).map((l) => l.match(blockedLine)).find(Boolean);
  assert.ok(summary, `the summary line is the BLOCKED line\n${shown(r)}`);
  assert.ok(summary[1].includes('AC-101-1') && summary[1].includes('src/totals.ts'), `the BLOCKED line names AC-101-1 and its file\n${shown(r)}`);

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
