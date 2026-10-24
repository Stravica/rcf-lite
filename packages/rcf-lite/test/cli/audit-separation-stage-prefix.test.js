// FBS-233 (US-19601, US-19602, US-19603, US-19604): the stage-prefix
// separation audit: per-stage file classes, hygiene tests, declared
// generators, judged merges, Hand: mixed retired.
//
// Criteria: 30, all external. Every test is a node:test todo case
// ("FBS-233 round DEFINE", GR-35): it runs and is red until FBS-233's
// round DEFINE drops the marker and BUILD turns it green. Each drives
// bin/rcf.js (or the packed artefact) as a child process against a
// fixture git repository built in a scratch directory; verdict files in a
// fixture are well-formed ReviewVerdict and TestVerdict records keyed to
// the right heads, or absent (GR-38). Timing tests print the host facts
// (GR-45); spawn clauses read RCF_SPAWN_LOG (GR-46). Imports: Node
// builtins and test/_harness/ only (GR-40).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { rcf } from '../_harness/spawn.js';
import { commit, fastImport, git, initRepo, porcelain, s7, sha } from '../_harness/git.js';
import { bindTests, project, reviewVerdict, scratch, testVerdict, verdictPath, writeText } from '../_harness/fixture.js';
import { commandName, hostFacts, json, readSpawnLog, spawnLog } from '../_harness/capture.js';

const TODO = { todo: 'FBS-233 round DEFINE' };
const USE = 'use DEFINE:, BUILD:, REVIEW:, TEST: or FINALISE:';

// A fixture repository: main with one base commit, work on branch
// feature. Returns { dir, base }.
function repo(t, files = { 'README.md': '# fixture\n' }) {
  const dir = join(scratch(t, 'rcf-h-sep-'), 'repo');
  initRepo(dir);
  const base = commit(dir, 'base', files);
  git(dir, 'switch', '-q', '-c', 'feature');
  return { dir, base };
}

const sep = (dir, args = [], env = {}) => rcf(['audit', 'separation', ...args], { cwd: dir, env });
const one = (stdout) => stdout.replace(/\n$/, '');
const passLine = (n, base, head, counts) => `separation: PASS ${n} commits (base ${s7(base)}, head ${s7(head)}): ${counts}`;
const failLine = (k, n, base, head, items) => `separation: FAIL ${k} of ${n} commits (base ${s7(base)}, head ${s7(head)}): ${items.join('; ')}`;

// The five-commit PASS branch of AC-19601-1 (one commit per stage, a
// passed review.json and a PASS test.json keyed to the reviewed head).
function fiveStageBranch(dir) {
  const d = commit(dir, 'DEFINE: criteria', { 'test/x.test.js': "test('x', () => {});\n", 'rcf/user-stories/us-1.json': '{"id":"US-1"}\n' });
  const h = commit(dir, 'BUILD: code', { 'src/x.js': 'export const x = 1;\n', 'rcf/code-nodes/cn-1.json': '{"cnId":"CN-1"}\n', 'test/hygiene/x.test.js': "test('h', () => {});\n" });
  const r = commit(dir, 'REVIEW: verdict', { [verdictPath(h, 'review.json')]: reviewVerdict(h) });
  const tt = commit(dir, 'TEST: verdict', { [verdictPath(h, 'test.json')]: testVerdict(h), 'rcf/verify-reports/FBS-001/a.json': '{"verdict":"PASS"}\n' });
  const f = commit(dir, 'FINALISE: status', { 'rcf/fbs/fbs-001.json': '{"fbsId":"FBS-001","executionStatus":"complete"}\n', 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" });
  return { d, h, r, t: tt, f };
}

// ---------------------------------------------------------------- US-19601

test('AC-19601-1: rcf audit separation over a DEFINE:, BUILD:, REVIEW:, TEST: and FINALISE: branch exits 0 and prints exactly "separation: PASS 5 commits (base <b7>, head <h7>): DEFINE 1, BUILD 1, REVIEW 1, TEST 1, FINALISE 1, merges 0, transition 0"', TODO, async (t) => {
  const { dir, base } = repo(t);
  const { f } = fiveStageBranch(dir);
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(one(r.stdout), passLine(5, base, f, 'DEFINE 1, BUILD 1, REVIEW 1, TEST 1, FINALISE 1, merges 0, transition 0'));
});

test('AC-19601-2: a "BUILD: add test" commit touching test/x.test.js exits 4 with "separation: FAIL 1 of 1 commits (base <b7>, head <h7>): <s7> BUILD: touches test/x.test.js (class rcfTest, owned by DEFINE)"', TODO, async (t) => {
  const { dir, base } = repo(t);
  const c = commit(dir, 'BUILD: add test', { 'test/x.test.js': "test('x', () => {});\n" });
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.equal(one(r.stdout), failLine(1, 1, base, c, [`${s7(c)} BUILD: touches test/x.test.js (class rcfTest, owned by DEFINE)`]));
});

test('AC-19601-3: a commit with no stage prefix exits 4 with "<s7> no stage prefix" as its only item, also when it touches only Markdown outside rcf/', TODO, async (t) => {
  const { dir, base } = repo(t);
  commit(dir, 'DEFINE: criteria', { 'rcf/user-stories/us-1.json': '{"id":"US-1"}\n' });
  const c = commit(dir, 'fix things', { 'src/x.js': 'export const x = 2;\n' });
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.equal(one(r.stdout), failLine(1, 2, base, c, [`${s7(c)} no stage prefix`]));

  const md = repo(t);
  const m = commit(md.dir, 'update notes', { 'notes.md': '# notes\n' });
  const r2 = await sep(md.dir, ['--base', md.base]);
  assert.equal(r2.code, 4, `${r2.stdout}${r2.stderr}`);
  assert.equal(one(r2.stdout), failLine(1, 1, md.base, m, [`${s7(m)} no stage prefix`]));
});

test('AC-19601-4: seven malformed prefixes each fail with "<s7> malformed stage prefix \\"<first token>\\"; use DEFINE:, BUILD:, REVIEW:, TEST: or FINALISE:" and exit 4', TODO, async (t) => {
  const { dir, base } = repo(t);
  const subjects = ['define: x', 'Define: x', 'DEFINE:x', 'DEFINE - x', '[DEFINE] x', 'DEFINE(FBS-1): x', 'VERIFY: x'];
  const tokens = ['define:', 'Define:', 'DEFINE:x', 'DEFINE', '[DEFINE]', 'DEFINE(FBS-1):', 'VERIFY:'];
  const shas = subjects.map((s, i) => commit(dir, s, { 'rcf/user-stories/us-1.json': `{"id":"US-1","n":${i}}\n` }));
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  const items = shas.map((c, i) => `${s7(c)} malformed stage prefix "${tokens[i]}"; ${USE}`);
  assert.equal(one(r.stdout), failLine(7, 7, base, shas.at(-1), items), 'the FAIL line carries one item per commit, in range order');
});

test('AC-19601-5: a bad --base ref exits 2 "separation: bad ref <ref>", outside a git repository exits 1 "separation: not a git repository", a shallow clone exits 2 with the shallow line, each with nothing on stdout', TODO, async (t) => {
  const { dir } = repo(t);
  commit(dir, 'DEFINE: criteria', { 'rcf/user-stories/us-1.json': '{"id":"US-1"}\n' });
  const bad = await sep(dir, ['--base', 'no-such-ref']);
  assert.equal(bad.code, 2);
  assert.ok(bad.stderr.split('\n').includes('separation: bad ref no-such-ref'), bad.stderr);
  assert.equal(bad.stdout, '');

  const outside = scratch(t, 'rcf-h-nogit-');
  const nr = await sep(outside, []);
  assert.equal(nr.code, 1);
  assert.ok(nr.stderr.split('\n').includes('separation: not a git repository'), nr.stderr);
  assert.equal(nr.stdout, '');

  git(dir, 'switch', '-q', 'main');
  commit(dir, 'main moves', { 'main.txt': 'm\n' });
  const shallow = join(scratch(t, 'rcf-h-shallow-'), 'clone');
  git(dir, 'clone', '-q', '--depth', '1', '--no-single-branch', `file://${dir}`, shallow);
  git(shallow, 'switch', '-q', 'feature');
  const sh = await sep(shallow, ['--base', 'origin/main']);
  assert.equal(sh.code, 2, `${sh.stdout}${sh.stderr}`);
  assert.ok(sh.stderr.split('\n').includes('separation: shallow repository, the history from origin/main is missing (fetch with full depth)'), sh.stderr);
  assert.equal(sh.stdout, '');
});

const ROW_KEYS = ['sha', 'subject', 'merge', 'stage', 'role', 'handTrailer', 'classes', 'generators', 'verdict', 'reason', 'paths'];

test('AC-19601-6: --json over the five-commit branch plus a clean "FINALISE: merge main" prints six SeparationRow v2 objects in range order with exactly the v2 keys; the BUILD row is builder with production and hygieneTest; the merge row reads merge true, stage FINALISE, paths []', TODO, async (t) => {
  const { dir, base } = repo(t);
  const s = fiveStageBranch(dir);
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'main moves', { 'main.txt': 'm\n' });
  git(dir, 'switch', '-q', 'feature');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'FINALISE: merge main', 'main');
  const m = sha(dir);
  const r = await sep(dir, ['--base', base, '--json']);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const rows = json(r.stdout);
  assert.ok(Array.isArray(rows));
  assert.deepEqual(rows.map((x) => x.sha), [s.d, s.h, s.r, s.t, s.f, m], 'six rows in range order');
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), [...ROW_KEYS].sort(), `row ${row.subject} carries exactly the v2 keys`);
  const build = rows[1];
  assert.equal(build.stage, 'BUILD');
  assert.equal(build.role, 'builder');
  assert.ok(build.classes.includes('production') && build.classes.includes('hygieneTest'), JSON.stringify(build.classes));
  const merge = rows[5];
  assert.equal(merge.merge, true);
  assert.equal(merge.stage, 'FINALISE');
  assert.deepEqual(merge.paths, []);
});

test('AC-19601-7: REVIEW:, TEST: and FINALISE: commits outside their classes fail exit 4, neutral paths being open to DEFINE and BUILD only', TODO, async (t) => {
  const { dir, base } = repo(t);
  const a = commit(dir, 'REVIEW: notes', { 'docs/review.md': '# review\n' });
  const b = commit(dir, 'TEST: log', { 'test/x.test.js': "test('x', () => {});\n" });
  const c = commit(dir, 'FINALISE: tidy', { 'README.md': '# tidied\n' });
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  for (const item of [
    `${s7(a)} REVIEW: touches docs/review.md (class neutral, owned by DEFINE, BUILD)`,
    `${s7(b)} TEST: touches test/x.test.js (class rcfTest, owned by DEFINE)`,
    `${s7(c)} FINALISE: touches README.md (class neutral, owned by DEFINE, BUILD)`,
  ]) assert.ok(r.stdout.includes(item), `the FAIL line names ${item}\n${r.stdout}`);
});

test('AC-19601-8: rcf audit separation never writes, reads files only through git at commits in the range, judges --head without a checkout, and spawns only git', TODO, async (t) => {
  const { dir, base } = repo(t);
  const s = fiveStageBranch(dir);
  const extra = commit(dir, 'BUILD: add test', { 'test/y.test.js': "test('y', () => {});\n" });
  // An uncommitted edit to rcf/separation.json would reclass test/y.test.js;
  // the audit reads the file at the head commit only.
  writeText(dir, 'rcf/separation.json', `${JSON.stringify({ classes: { production: ['test/y.test.js'] } })}\n`);
  const status = porcelain(dir);
  const log = spawnLog(scratch(t, 'rcf-h-spawn-'));
  const r1 = await sep(dir, ['--base', base], log.env);
  const r2 = await sep(dir, ['--base', base]);
  assert.equal(r1.code, 4, `${r1.stdout}${r1.stderr}`);
  assert.equal(r1.stdout, r2.stdout, 'two runs print byte-identical stdout');
  assert.ok(r1.stdout.includes(`${s7(extra)} BUILD: touches test/y.test.js (class rcfTest, owned by DEFINE)`), 'the working-tree rcf/separation.json is not read');
  assert.equal(porcelain(dir), status, 'git status --porcelain is unchanged by a run');
  const atF = await sep(dir, ['--base', base, '--head', s.f]);
  assert.equal(atF.code, 0, `${atF.stdout}${atF.stderr}`);
  assert.equal(one(atF.stdout), passLine(5, base, s.f, 'DEFINE 1, BUILD 1, REVIEW 1, TEST 1, FINALISE 1, merges 0, transition 0'), '--head judges that range');
  assert.equal(sha(dir), extra, 'nothing is checked out');
  assert.equal(porcelain(dir), status);
  const spawned = readSpawnLog(log.file);
  assert.ok(spawned.length > 0, 'the spawn seam records the run');
  assert.deepEqual([...new Set(spawned.map(commandName))], ['git'], 'only git is spawned');
});

test('AC-19601-9: over 200 prefixed commits touching 20 paths each across four classes the audit finishes within 10 seconds and spawns at most 4 git processes plus one per merge', TODO, async (t) => {
  hostFacts(t);
  const { dir, base } = repo(t);
  const commits = [];
  for (let i = 0; i < 200; i++) {
    const files = {};
    for (let k = 0; k < 5; k++) {
      files[`rcf/user-stories/us-${k}.json`] = `{"n":${i}}\n`;
      files[`test/rcf/t${k}.test.js`] = `// ${i}\n`;
      files[`rcf/fbs/fbs-00${k}.json`] = `{"n":${i}}\n`;
      files[`docs/d${k}.md`] = `# ${i}\n`;
    }
    commits.push({ subject: `DEFINE: round step ${i}`, files });
  }
  fastImport(dir, commits, { branch: 'refs/heads/feature' });
  const log = spawnLog(scratch(t, 'rcf-h-spawn-'));
  const r = await sep(dir, ['--base', base], log.env);
  assert.equal(r.code, 0, `${r.stdout.slice(0, 500)}${r.stderr}`);
  assert.ok(r.stdout.startsWith('separation: PASS 200 commits'), r.stdout.slice(0, 200));
  assert.ok(r.ms <= 10_000, `finishes within 10 seconds (took ${Math.round(r.ms)} ms)`);
  const gits = readSpawnLog(log.file).filter((e) => commandName(e) === 'git');
  assert.ok(gits.length > 0, 'the spawn seam records the git processes');
  assert.ok(gits.length <= 4, `spawns no more than 4 git processes with no merge in the range (spawned ${gits.length})`);
});

test('AC-19601-10: a "BUILD: mixed" commit with Hand: test-author touching criteria and an RCF test, then a malformed "define: x", print each cause as its own item in check order and the malformed prefix as that commit\'s only item', TODO, async (t) => {
  const { dir, base } = repo(t);
  const a = commit(dir, 'BUILD: mixed', { 'rcf/user-stories/us-1.json': '{"id":"US-1"}\n', 'test/a.test.js': "test('a', () => {});\n" }, { trailers: [['Hand', 'test-author']] });
  const b = commit(dir, 'define: x', { 'src/x.js': 'export const x = 3;\n' });
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.equal(one(r.stdout), failLine(2, 2, base, b, [
    `${s7(a)} Hand: test-author disagrees with BUILD: (role builder)`,
    `${s7(a)} BUILD: touches rcf/user-stories/us-1.json (class criteria, owned by DEFINE)`,
    `${s7(a)} BUILD: touches test/a.test.js (class rcfTest, owned by DEFINE)`,
    `${s7(b)} malformed stage prefix "define:"; ${USE}`,
  ]));
});

// ---------------------------------------------------------------- US-19602

test('AC-19602-1: a "BUILD: hygiene" commit touching src/a.js and three hygiene test paths passes, counts under BUILD and lists classes production and hygieneTest only', TODO, async (t) => {
  const { dir, base } = repo(t);
  const c = commit(dir, 'BUILD: hygiene', {
    'src/a.js': 'export const a = 1;\n', 'test/hygiene/a.test.js': "test('a', () => {});\n",
    'packages/x/test/hygiene/b.test.js': "test('b', () => {});\n", 'src/a.hygiene.test.js': "test('c', () => {});\n",
  });
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(one(r.stdout), passLine(1, base, c, 'DEFINE 0, BUILD 1, REVIEW 0, TEST 0, FINALISE 0, merges 0, transition 0'));
  const rows = json((await sep(dir, ['--base', base, '--json'])).stdout);
  assert.deepEqual([...rows[0].classes].sort(), ['hygieneTest', 'production']);
});

test('AC-19602-2: a "DEFINE: tests" commit touching test/hygiene/a.test.js exits 4 with "<s7> DEFINE: touches test/hygiene/a.test.js (class hygieneTest, owned by BUILD)"', TODO, async (t) => {
  const { dir, base } = repo(t);
  const c = commit(dir, 'DEFINE: tests', { 'test/hygiene/a.test.js': "test('a', () => {});\n" });
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.ok(r.stdout.includes(`${s7(c)} DEFINE: touches test/hygiene/a.test.js (class hygieneTest, owned by BUILD)`), r.stdout);
});

test('AC-19602-3: audit coverage --strict reports AC-101-1 bound only to a hygiene test uncovered with "hygiene test, outside the RCF suite: test/hygiene/a.test.js" and exits 4; bound to test/rcf/a.test.js it is covered and exits 0', TODO, async (t) => {
  const dir = await project(t, { name: 'hygiene-cov' });
  bindTests(dir, [{ acId: 'AC-101-1', pointer: 'test/hygiene/a.test.js::passes' }]);
  const r = await rcf(['audit', 'coverage', '--strict'], { cwd: dir });
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  const row = r.stdout.split('\n').find((l) => /\bAC-101-1\s/.test(l)) ?? '';
  assert.match(row, /AC-101-1\s+no\b/, 'AC-101-1 is reported uncovered');
  assert.ok(row.includes('hygiene test, outside the RCF suite: test/hygiene/a.test.js'), `its row names the hygiene test\n${row}`);

  const rcfDir = await project(t, { name: 'rcf-cov' });
  bindTests(rcfDir, [{ acId: 'AC-101-1', pointer: 'test/rcf/a.test.js::passes' }]);
  const ok = await rcf(['audit', 'coverage', '--strict'], { cwd: rcfDir });
  assert.equal(ok.code, 0, `${ok.stdout}${ok.stderr}`);
  assert.match(ok.stdout.split('\n').find((l) => /\bAC-101-1\s/.test(l)) ?? '', /AC-101-1\s+yes\b/);
});

test('AC-19602-4: define validate over a hygiene-bound chain exits 0 with exactly one "[warn] TC-<id> points into a hygiene test" line, and no hygiene test counts toward coverage in table, json or mermaid', TODO, async (t) => {
  const dir = await project(t, { name: 'hygiene-validate' });
  const ts = bindTests(dir, [{ acId: 'AC-101-1', pointer: 'test/hygiene/a.test.js::passes' }]);
  const tcId = ts.testCases[0].id;
  const v = await rcf(['define', 'validate'], { cwd: dir });
  assert.equal(v.code, 0, `a hygiene binding is never a validation error\n${v.stdout}${v.stderr}`);
  const warn = `[warn] ${tcId} points into a hygiene test (test/hygiene/a.test.js); hygiene tests are outside the RCF suite and never count as coverage`;
  assert.deepEqual(v.stderr.split('\n').filter((l) => l.includes('hygiene')), [warn], 'stderr carries exactly that one line');
  const table = await rcf(['audit', 'coverage', '--mode', 'shallow-any'], { cwd: dir });
  assert.doesNotMatch(table.stdout.split('\n').find((l) => /\bAC-101-1\s/.test(l)) ?? '', /AC-101-1\s+yes\b/, 'table never counts it');
  const j = json((await rcf(['audit', 'coverage', '--mode', 'shallow-any', '--format', 'json'], { cwd: dir })).stdout);
  assert.equal(j.requirements[0].acs.find((a) => a.id === 'AC-101-1').covered, false, 'json never counts it');
  assert.equal(j.totals.covered, 0);
  const mmd = await rcf(['audit', 'coverage', '--mode', 'shallow-any', '--format', 'mermaid'], { cwd: dir });
  assert.ok(!mmd.stdout.includes(`AC-101-1 -.-> ${tcId}`), `mermaid draws no covering edge to the hygiene test\n${mmd.stdout}`);
});

test('AC-19602-5: rcf/separation.json declaring hygieneTest ["spec/unit/**"] makes a "DEFINE: spec" commit on spec/unit/b.js fail with "(class hygieneTest, owned by BUILD)" while the "BUILD: unit" commit on spec/unit/a.js passes', TODO, async (t) => {
  const { dir, base } = repo(t);
  commit(dir, 'DEFINE: config', { 'rcf/separation.json': { classes: { hygieneTest: ['spec/unit/**'] } } });
  const d = commit(dir, 'DEFINE: spec', { 'spec/unit/b.js': 'b\n' });
  const b = commit(dir, 'BUILD: unit', { 'spec/unit/a.js': 'a\n' });
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.equal(one(r.stdout), failLine(1, 3, base, b, [`${s7(d)} DEFINE: touches spec/unit/b.js (class hygieneTest, owned by BUILD)`]), 'only the DEFINE commit is named');
});

// ---------------------------------------------------------------- US-19603

test('AC-19603-1: a "FINALISE: release 1.1.0" commit touching chain status, the lockfile, CHANGELOG.md, releases/releases.yaml and only the package.json version line passes under FINALISE with classes chainStatus, lockfile, release and versionField', TODO, async (t) => {
  const pkg = (v) => `${JSON.stringify({ name: 'fixture', version: v, dependencies: { a: '1.0.0' } }, null, 2)}\n`;
  const { dir, base } = repo(t, { 'package.json': pkg('1.0.0'), 'CHANGELOG.md': '# Changelog\n', 'releases/releases.yaml': 'releases: []\n', 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n", 'rcf/fbs/fbs-001.json': '{}\n' });
  const c = commit(dir, 'FINALISE: release 1.1.0', {
    'rcf/fbs/fbs-001.json': '{"executionStatus":"complete"}\n', 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n# 1.1.0\n",
    'CHANGELOG.md': '# Changelog\n\n## 1.1.0\n', 'releases/releases.yaml': 'releases:\n  - version: "1.1.0"\n', 'package.json': pkg('1.1.0'),
  });
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(one(r.stdout), passLine(1, base, c, 'DEFINE 0, BUILD 0, REVIEW 0, TEST 0, FINALISE 1, merges 0, transition 0'));
  const row = json((await sep(dir, ['--base', base, '--json'])).stdout)[0];
  assert.deepEqual([...row.classes].sort(), ['chainStatus', 'lockfile', 'release', 'versionField']);
});

test('AC-19603-2: FINALISE: commits changing a package.json dependency line, touching src/a.js or touching docs/x.md fail exit 4 with their three items', TODO, async (t) => {
  const pkg = (dep) => `${JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { a: dep } }, null, 2)}\n`;
  const { dir, base } = repo(t, { 'package.json': pkg('1.0.0'), 'src/a.js': 'a\n' });
  const a = commit(dir, 'FINALISE: deps', { 'package.json': pkg('2.0.0') });
  const b = commit(dir, 'FINALISE: fix', { 'src/a.js': 'a2\n' });
  const c = commit(dir, 'FINALISE: notes', { 'docs/x.md': '# x\n' });
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  for (const item of [
    `${s7(a)} FINALISE: changes package.json beyond its "version" line (class production, owned by BUILD)`,
    `${s7(b)} FINALISE: touches src/a.js (class production, owned by BUILD)`,
    `${s7(c)} FINALISE: touches docs/x.md (class neutral, owned by DEFINE, BUILD)`,
  ]) assert.ok(r.stdout.includes(item), `the FAIL line names ${item}\n${r.stdout}`);
});

const GENERATOR = { id: 'queue-goldens', command: 'node bin/rcf.js build queue --format json > test/build/fixtures/queue.json', outputs: ['test/build/fixtures/queue.md', 'test/build/fixtures/queue.json'], checkedBy: 'test/build/queue.test.js' };

function generatorRepo(t, generator = GENERATOR) {
  const r = repo(t);
  commit(r.dir, 'DEFINE: declare the generator', { 'rcf/separation.json': { generators: [generator] }, 'test/build/queue.test.js': "test('queue golden', () => {});\n" });
  return r;
}

test('AC-19603-3: a "FINALISE: regenerate queue goldens" commit with "Generated-By: queue-goldens" touching a declared output and rcf/fbs/ passes with classes ["chainStatus", "generatorOutput"] and generators ["queue-goldens"]', TODO, async (t) => {
  const { dir, base } = generatorRepo(t);
  const c = commit(dir, 'FINALISE: regenerate queue goldens', { 'test/build/fixtures/queue.json': '[]\n', 'rcf/fbs/fbs-001.json': '{"executionStatus":"complete"}\n' }, { trailers: [['Generated-By', 'queue-goldens']] });
  const r = await sep(dir, ['--base', base, '--json']);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const row = json(r.stdout).find((x) => x.sha === c);
  assert.deepEqual(row.classes, ['chainStatus', 'generatorOutput']);
  assert.deepEqual(row.generators, ['queue-goldens']);
});

test('AC-19603-4: a declared output with no Generated-By, an undeclared Generated-By id, and a Generated-By commit touching a path outside its outputs each fail exit 4 with their items', TODO, async (t) => {
  const { dir, base } = generatorRepo(t);
  const a = commit(dir, 'FINALISE: goldens', { 'test/build/fixtures/queue.json': '[1]\n' });
  const b = commit(dir, 'FINALISE: baseline', { 'rcf/fbs/fbs-001.json': '{"n":1}\n' }, { trailers: [['Generated-By', 'view-baseline']] });
  const c = commit(dir, 'FINALISE: goldens again', { 'test/view/fixtures/phase-3-6-static.html': '<html></html>\n' }, { trailers: [['Generated-By', 'queue-goldens']] });
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  for (const item of [
    `${s7(a)} FINALISE: touches test/build/fixtures/queue.json (class rcfTest, owned by DEFINE)`,
    `${s7(b)} Generated-By: view-baseline is not declared in rcf/separation.json`,
    `${s7(c)} FINALISE: touches test/view/fixtures/phase-3-6-static.html (class rcfTest, owned by DEFINE)`,
  ]) assert.ok(r.stdout.includes(item), `the FAIL line names ${item}\n${r.stdout}`);
});

test('AC-19603-5: a generator lacking checkedBy, with outputs [], or naming a checkedBy file absent at the head exits 2 with its malformed rcf/separation.json line and prints no PASS or FAIL line', TODO, async (t) => {
  const { checkedBy, ...noCheckedBy } = GENERATOR;
  void checkedBy;
  const cases = [
    [noCheckedBy, () => 'separation: malformed rcf/separation.json: generators[0].checkedBy is required'],
    [{ ...GENERATOR, outputs: [] }, () => 'separation: malformed rcf/separation.json: generators[0].outputs must list at least one glob'],
    [{ ...GENERATOR, checkedBy: 'test/build/missing.test.js' }, (h) => `separation: malformed rcf/separation.json: generators[0].checkedBy test/build/missing.test.js does not exist at ${s7(h)}`],
  ];
  for (const [generator, expected] of cases) {
    const { dir, base } = repo(t);
    const h = commit(dir, 'DEFINE: declare the generator', { 'rcf/separation.json': { generators: [generator] }, 'test/build/queue.test.js': "test('q', () => {});\n" });
    const r = await sep(dir, ['--base', base]);
    assert.equal(r.code, 2, `${r.stdout}${r.stderr}`);
    assert.ok(r.stderr.split('\n').includes(expected(h)), `stderr carries ${expected(h)}\n${r.stderr}`);
    assert.doesNotMatch(r.stdout, /separation: (PASS|FAIL)/);
  }
});

test('AC-19603-6: a clean "FINALISE: merge main" and a "FINALISE: merge main again" whose only combined-diff path is pnpm-lock.yaml pass, read merge true and stage FINALISE, the second lists paths ["pnpm-lock.yaml"], and the PASS line counts merges 2', TODO, async (t) => {
  const { dir, base } = repo(t, { 'README.md': '# fixture\n', 'pnpm-lock.yaml': 'v1\n' });
  commit(dir, 'BUILD: code', { 'src/x.js': 'x\n', 'pnpm-lock.yaml': 'feature\n' });
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'main moves', { 'main.txt': 'm\n' });
  git(dir, 'switch', '-q', 'feature');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'FINALISE: merge main', 'main');
  const m1 = sha(dir);
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'main changes the lockfile', { 'pnpm-lock.yaml': 'main\n' });
  git(dir, 'switch', '-q', 'feature');
  try { git(dir, 'merge', '--no-ff', '-m', 'FINALISE: merge main again', 'main'); } catch { /* the lockfile conflicts, as the fixture intends */ }
  writeText(dir, 'pnpm-lock.yaml', 'resolved\n');
  git(dir, 'add', 'pnpm-lock.yaml');
  git(dir, 'commit', '-q', '--no-edit');
  const m2 = sha(dir);
  const r = await sep(dir, ['--base', base, '--json']);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const rows = json(r.stdout);
  const r1 = rows.find((x) => x.sha === m1);
  const r2 = rows.find((x) => x.sha === m2);
  assert.ok(r1 && r2, 'both merges are rows of the range');
  for (const row of [r1, r2]) { assert.equal(row.merge, true); assert.equal(row.stage, 'FINALISE'); }
  assert.deepEqual(r2.paths, ['pnpm-lock.yaml']);
  const plain = await sep(dir, ['--base', base]);
  assert.match(plain.stdout, /, merges 2, /, plain.stdout);
});

test('AC-19603-7: a FINALISE: merge whose resolution edits src/a.js and an unprefixed merge commit fail exit 4 with the merge-resolution item and "<s7> no stage prefix"', TODO, async (t) => {
  const { dir, base } = repo(t, { 'README.md': '# fixture\n', 'src/a.js': 'a\n' });
  commit(dir, 'BUILD: code', { 'src/a.js': 'feature\n' });
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'main edits a', { 'src/a.js': 'main\n' });
  git(dir, 'switch', '-q', 'feature');
  try { git(dir, 'merge', '--no-ff', '-m', 'FINALISE: merge main', 'main'); } catch { /* conflict expected */ }
  writeText(dir, 'src/a.js', 'resolved by hand\n');
  git(dir, 'add', 'src/a.js');
  git(dir, 'commit', '-q', '--no-edit');
  const m1 = sha(dir);
  assert.equal(git(dir, 'log', '-1', '--format=%s'), 'FINALISE: merge main');
  git(dir, 'switch', '-q', 'main');
  commit(dir, 'main moves', { 'main.txt': 'm\n' });
  git(dir, 'switch', '-q', 'feature');
  git(dir, 'merge', '-q', '--no-ff', '-m', "Merge branch 'main' into feature", 'main');
  const m2 = sha(dir);
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  for (const item of [
    `${s7(m1)} FINALISE: merge resolution touches src/a.js (class production); a merge that needs a code fix is not committed in FINALISE: record TEST FAIL and merge main in the next round`,
    `${s7(m2)} no stage prefix`,
  ]) assert.ok(r.stdout.includes(item), `the FAIL line names ${item}\n${r.stdout}`);
});

test('AC-19603-8: over the passing generator fixture the audit runs no declared command and no process but git: the spawn seam records only git and a marker-writing command leaves no marker', TODO, async (t) => {
  const marker = join(scratch(t, 'rcf-h-marker-'), 'MARKER');
  const { dir, base } = generatorRepo(t, { ...GENERATOR, command: `node -e "require('node:fs').writeFileSync('${marker}', 'ran')"` });
  commit(dir, 'FINALISE: regenerate queue goldens', { 'test/build/fixtures/queue.json': '[]\n', 'rcf/fbs/fbs-001.json': '{"executionStatus":"complete"}\n' }, { trailers: [['Generated-By', 'queue-goldens']] });
  const log = spawnLog(scratch(t, 'rcf-h-spawn-'));
  const r = await sep(dir, ['--base', base], log.env);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const spawned = readSpawnLog(log.file);
  assert.ok(spawned.length > 0, 'the spawn seam records the run');
  assert.deepEqual([...new Set(spawned.map(commandName))], ['git'], 'only git is spawned');
  assert.equal(existsSync(marker), false, 'the declared command never ran');
});

// ---------------------------------------------------------------- US-19604

test('AC-19604-1: DEFINE: with Hand: test-author and BUILD: with Hand: builder and Hand-Id pass with "DEFINE 1, BUILD 1, REVIEW 0, TEST 0, FINALISE 0, merges 0, transition 2" and each --json row names its handTrailer', TODO, async (t) => {
  const { dir, base } = repo(t);
  commit(dir, 'DEFINE: criteria', { 'rcf/user-stories/us-1.json': '{"id":"US-1"}\n' }, { trailers: [['Hand', 'test-author']] });
  const b = commit(dir, 'BUILD: code', { 'src/x.js': 'x\n' }, { trailers: [['Hand', 'builder'], ['Hand-Id', 'b-1']] });
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(one(r.stdout), passLine(2, base, b, 'DEFINE 1, BUILD 1, REVIEW 0, TEST 0, FINALISE 0, merges 0, transition 2'));
  const rows = json((await sep(dir, ['--base', base, '--json'])).stdout);
  assert.deepEqual(rows.map((x) => x.handTrailer), ['test-author', 'builder']);
});

test('AC-19604-2: a "BUILD: code" commit carrying Hand: test-author exits 4 with "<s7> Hand: test-author disagrees with BUILD: (role builder)"', TODO, async (t) => {
  const { dir, base } = repo(t);
  const c = commit(dir, 'BUILD: code', { 'src/x.js': 'x\n' }, { trailers: [['Hand', 'test-author']] });
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  assert.equal(one(r.stdout), failLine(1, 1, base, c, [`${s7(c)} Hand: test-author disagrees with BUILD: (role builder)`]));
});

test('AC-19604-3: a Hand: mixed trailer fails "<s7> Hand: mixed is retired; commit chores as FINALISE: within its file classes" with or without Separation-Reason, whatever the commit touches', TODO, async (t) => {
  const { dir, base } = repo(t);
  const b = commit(dir, 'BUILD: rename', { 'src/x.js': 'x\n' }, { trailers: [['Hand', 'mixed']] });
  const f = commit(dir, 'FINALISE: chores', { 'rcf/fbs/fbs-001.json': '{}\n' }, { trailers: [['Hand', 'mixed'], ['Separation-Reason', 'release regeneration']] });
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 4, `${r.stdout}${r.stderr}`);
  for (const c of [f, b]) assert.ok(r.stdout.includes(`${s7(c)} Hand: mixed is retired; commit chores as FINALISE: within its file classes`), r.stdout);
});

test('AC-19604-4: rcf audit separation --require-hand exits 2 with "[error] usage --require-hand is retired; every commit needs a stage prefix" and prints nothing on stdout', TODO, async (t) => {
  const { dir } = repo(t);
  commit(dir, 'DEFINE: criteria', { 'rcf/user-stories/us-1.json': '{"id":"US-1"}\n' });
  const r = await sep(dir, ['--require-hand']);
  assert.equal(r.code, 2);
  assert.ok(r.stderr.split('\n').includes('[error] usage --require-hand is retired; every commit needs a stage prefix'), r.stderr);
  assert.equal(r.stdout, '');
});

test('AC-19604-5: configured classes win (rcfTest on spec/**), the 0.36.x name test is read as rcfTest with a warn line, an unknown class and unparsable JSON exit 2', TODO, async (t) => {
  for (const [classes, warn] of [[{ rcfTest: ['spec/**'] }, null], [{ test: ['spec/**'] }, '[warn] separation: class test is read as rcfTest']]) {
    const { dir, base } = repo(t);
    commit(dir, 'DEFINE: config', { 'rcf/separation.json': { classes } });
    const c = commit(dir, 'BUILD: code', { 'spec/a.js': 'a\n' });
    const r = await sep(dir, ['--base', base]);
    assert.equal(r.code, 4, `${JSON.stringify(classes)}\n${r.stdout}${r.stderr}`);
    assert.ok(r.stdout.includes(`${s7(c)} BUILD: touches spec/a.js (class rcfTest, owned by DEFINE)`), r.stdout);
    if (warn) assert.ok(r.stderr.split('\n').includes(warn), r.stderr);
  }
  const bogus = repo(t);
  commit(bogus.dir, 'DEFINE: config', { 'rcf/separation.json': { classes: { bogus: ['x/**'] } } });
  const rb = await sep(bogus.dir, ['--base', bogus.base]);
  assert.equal(rb.code, 2);
  assert.ok(rb.stderr.split('\n').includes('separation: malformed rcf/separation.json: unknown class bogus'), rb.stderr);
  const broken = repo(t);
  commit(broken.dir, 'DEFINE: config', { 'rcf/separation.json': '{ not json\n' });
  const rj = await sep(broken.dir, ['--base', broken.base]);
  assert.equal(rj.code, 2);
  assert.match(rj.stderr, /rcf\/separation\.json/, 'stderr names rcf/separation.json');
});

test('AC-19604-6: no trailer turns a failing commit into a pass: "BUILD: add test" fails with its class item under no trailer, Hand: test-author or Hand: mixed with a reason, and a commit marked only by a Hand: trailer fails "no stage prefix"', TODO, async (t) => {
  for (const trailers of [[], [['Hand', 'test-author']], [['Hand', 'mixed'], ['Separation-Reason', 'needed']]]) {
    const { dir, base } = repo(t);
    const c = commit(dir, 'BUILD: add test', { 'test/x.test.js': "test('x', () => {});\n" }, { trailers });
    const r = await sep(dir, ['--base', base]);
    assert.equal(r.code, 4, `${JSON.stringify(trailers)}\n${r.stdout}${r.stderr}`);
    assert.ok(r.stdout.includes(`${s7(c)} BUILD: touches test/x.test.js (class rcfTest, owned by DEFINE)`), `${JSON.stringify(trailers)}\n${r.stdout}`);
  }
  for (const hand of ['test-author', 'builder', 'stage-keeper']) {
    const { dir, base } = repo(t);
    const c = commit(dir, 'add criteria', { 'rcf/user-stories/us-1.json': '{"id":"US-1"}\n' }, { trailers: [['Hand', hand]] });
    const r = await sep(dir, ['--base', base]);
    assert.equal(r.code, 4);
    assert.equal(one(r.stdout), failLine(1, 1, base, c, [`${s7(c)} no stage prefix`]), `Hand: ${hand} with no prefix`);
  }
});

test('AC-19604-7: a branch starting at "BUILD: code" followed by an evidence-only "TEST: evidence" with no verdict file passes on classes with "DEFINE 0, BUILD 1, REVIEW 0, TEST 1"', TODO, async (t) => {
  const { dir, base } = repo(t);
  commit(dir, 'BUILD: code', { 'src/x.js': 'x\n' });
  const c = commit(dir, 'TEST: evidence', { 'rcf/verify-reports/FBS-001/a.json': '{"verdict":"PASS"}\n' });
  const r = await sep(dir, ['--base', base]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(one(r.stdout), passLine(2, base, c, 'DEFINE 0, BUILD 1, REVIEW 0, TEST 1, FINALISE 0, merges 0, transition 0'));
});

