// FBS-232 (US-19501, US-19502): the rcf-schemas verification field
// (external | testOnly) and the rcf-lite pin move.
//
// Criteria: 9 in the slice, all tested here: 4 external (AC-19501-1 to
// AC-19501-4) and 5 testOnly (AC-19501-5 to AC-19501-7, AC-19502-1,
// AC-19502-2). AC-19501-5 compares audit coverage --strict at HEAD with
// the golden FBS-232's round DEFINE records at the round's base before
// BUILD moves the pin (the stage-keeper's ruling 6 on the Part B summary's
// stops, reading c), so it reads no git history. AC-19501-7 compares this
// repository with its state before the pin move, read from a temporary
// worktree at the parent of the pin-move commit (the stage-keeper's
// ruling 2 on part B1's stops), so it needs a full-depth checkout and a
// shallow clone fails it; it is measured only with RCF_PERF=1, at TEST
// on the verifier's full clone, and is skipped otherwise, since timing
// ratios on shared CI hosts are noise.
//
// Every test is a node:test todo case ("FBS-232 round DEFINE", GR-35): it
// runs and is red until FBS-232's round DEFINE drops the marker and BUILD
// turns it green. External criteria drive bin/rcf.js (or the packed
// artefact) against a fixture project made by its own rcf init; testOnly
// criteria read this repository through RCF_CHECKOUT when it is set, else
// from this file's location (GR-34). Imports: Node builtins, js-yaml and
// test/_harness/ only (GR-40).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import yaml from 'js-yaml';

import { BIN, rcf, run } from '../_harness/spawn.js';
import { checkoutPackage, checkoutRoot, project, readJson, readText, scratch, writeJson } from '../_harness/fixture.js';
import { git, gitTry } from '../_harness/git.js';
import { hostFacts, median } from '../_harness/capture.js';
import { coverageResult } from '../_harness/goldens.js';

const TODO = { todo: 'FBS-232 round DEFINE' };

// The rcf-schemas user-story schema the artefact under test loads (its
// installed dependency, resolved from the bin), for the "given the pin
// carries verification" precondition of the external criteria.
function installedStorySchema() {
  const req = createRequire(BIN);
  return JSON.parse(readFileSync(req.resolve('@stravica-ai/rcf-schemas/schemas/user-story.schema.json'), 'utf8'));
}
function assertPinCarriesVerification() {
  const ac = installedStorySchema().$defs.acceptanceCriterion;
  assert.ok(ac.properties.verification, 'given: rcf-lite is installed with its rcf-schemas pin at the release carrying verification');
}

const story = (dir) => readJson(dir, 'rcf/user-stories/us-101.json');

test('AC-19501-1: rcf define create ac --parent US-101 --from-file with "verification": "external" exits 0, define read shows the criterion with "verification": "external", and define validate exits 0', TODO, async (t) => {
  assertPinCarriesVerification();
  const dir = await project(t, { name: 'flag-create' });
  const bodyDir = scratch(t, 'rcf-h-body-');
  writeJson(bodyDir, 'ac.json', { description: '[happy] fixture', testable: true, verification: 'external' });
  const r = await rcf(['define', 'create', 'ac', '--parent', 'US-101', '--from-file', join(bodyDir, 'ac.json')], { cwd: dir });
  assert.equal(r.code, 0, `create ac exits 0\n${r.stdout}${r.stderr}`);
  const read = await rcf(['define', 'read', 'US-101', '--field', 'acceptanceCriteria'], { cwd: dir });
  assert.equal(read.code, 0);
  const acs = JSON.parse(read.stdout);
  const created = acs.find((a) => a.description === '[happy] fixture');
  assert.ok(created, `the new criterion is listed\n${read.stdout}`);
  assert.equal(created.verification, 'external');
  const v = await rcf(['define', 'validate'], { cwd: dir });
  assert.equal(v.code, 0, `define validate exits 0\n${v.stdout}${v.stderr}`);
});

test('AC-19501-2: rcf define update AC-101-1 --set verification=testOnly exits 0, prints "AC-101-1 updated at rcf/user-stories/us-101.json", leaves the criterion text byte-identical, and define validate exits 0', TODO, async (t) => {
  assertPinCarriesVerification();
  const dir = await project(t, { name: 'flag-update' });
  const before = story(dir).acceptanceCriteria.find((a) => a.id === 'AC-101-1');
  assert.equal(before.verification, undefined, 'given: AC-101-1 carries no verification');
  const r = await rcf(['define', 'update', 'AC-101-1', '--set', 'verification=testOnly'], { cwd: dir });
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.equal(r.stdout.trim(), 'AC-101-1 updated at rcf/user-stories/us-101.json');
  const after = story(dir).acceptanceCriteria.find((a) => a.id === 'AC-101-1');
  assert.equal(after.verification, 'testOnly');
  for (const field of ['description', 'given', 'when', 'then']) {
    assert.equal(JSON.stringify(after[field]), JSON.stringify(before[field]), `${field} is byte-identical`);
  }
  const v = await rcf(['define', 'validate'], { cwd: dir });
  assert.equal(v.code, 0, `define validate exits 0\n${v.stdout}${v.stderr}`);
});

test('AC-19501-3: a verification value outside external and testOnly exits 3 with an "[error] validation" line naming the criterion and the field, and leaves us-101.json byte-identical, for update --set verification=manual and for a create ac body carrying "deployed"', TODO, async (t) => {
  assertPinCarriesVerification();
  const dir = await project(t, { name: 'flag-bad' });
  const bytes = readText(dir, 'rcf/user-stories/us-101.json');
  const r = await rcf(['define', 'update', 'AC-101-1', '--set', 'verification=manual'], { cwd: dir });
  assert.equal(r.code, 3, `${r.stdout}${r.stderr}`);
  const line = r.stderr.split('\n').find((l) => l.startsWith('[error] validation'));
  assert.ok(line, `stderr carries a line beginning "[error] validation"\n${r.stderr}`);
  assert.ok(line.includes('AC-101-1') && line.includes('verification'), `the line names AC-101-1 and the field verification: ${line}`);
  assert.equal(readText(dir, 'rcf/user-stories/us-101.json'), bytes, 'us-101.json is byte-identical');

  const bodyDir = scratch(t, 'rcf-h-body-');
  writeJson(bodyDir, 'ac.json', { description: '[happy] fixture', testable: true, verification: 'deployed' });
  const c = await rcf(['define', 'create', 'ac', '--parent', 'US-101', '--from-file', join(bodyDir, 'ac.json')], { cwd: dir });
  assert.equal(c.code, 3, `${c.stdout}${c.stderr}`);
  const cline = c.stderr.split('\n').find((l) => l.startsWith('[error] validation'));
  assert.ok(cline && cline.includes('verification'), `create: an "[error] validation" line names the field verification\n${c.stderr}`);
  assert.equal(readText(dir, 'rcf/user-stories/us-101.json'), bytes, 'us-101.json is byte-identical after the refused create');
});

test('AC-19501-4: after the pin move rcf define validate over a fixture whose criteria carry no verification exits 0 with no "[error]" line naming verification (the field stays optional at schema level)', TODO, async (t) => {
  assertPinCarriesVerification();
  const dir = await project(t, { name: 'flag-optional' });
  assert.ok(story(dir).acceptanceCriteria.every((a) => !('verification' in a)), 'given: no criterion carries verification');
  const v = await rcf(['define', 'validate'], { cwd: dir });
  assert.equal(v.code, 0, `${v.stdout}${v.stderr}`);
  const out = `${v.stdout}\n${v.stderr}`;
  assert.equal(out.split('\n').filter((l) => l.includes('[error]') && l.includes('verification')).length, 0, 'no "[error]" line names verification');
});

// "Before the pin move" (the stage-keeper's ruling 1 on part B1's stops):
// the pin-move commit is the newest first-parent commit that changes the
// @stravica-ai/rcf-schemas dependency in packages/rcf-lite/package.json,
// and the state before it is a temporary worktree at its first parent with
// that tree's own dependencies installed. A shallow clone fails, never skips.
const PKG_JSON = 'packages/rcf-lite/package.json';
const PIN = '@stravica-ai/rcf-schemas';
const PERF = process.env.RCF_PERF === '1';

function pinAt(root, rev) {
  const r = gitTry(root, 'show', `${rev}:${PKG_JSON}`);
  return r.code === 0 ? (JSON.parse(r.stdout).dependencies?.[PIN] ?? null) : null;
}
function pinMoveCommit(root) {
  assert.equal(git(root, 'rev-parse', '--is-shallow-repository'), 'false', 'shallow clone: the history before the pin move is not there (the measurement runs at TEST on the verifier\'s full clone)');
  const candidates = git(root, 'log', '--first-parent', '--format=%H', 'HEAD', '--', PKG_JSON).split('\n').filter(Boolean);
  const move = candidates.find((c) => pinAt(root, c) !== pinAt(root, `${c}^1`));
  assert.ok(move, `a first-parent commit changes the ${PIN} dependency in ${PKG_JSON}`);
  return move;
}
function worktreeAt(t, root, rev) {
  const dir = join(scratch(t, 'rcf-h-pinwt-'), 'wt');
  git(root, 'worktree', 'add', '--detach', '--quiet', dir, rev);
  t.after(() => { gitTry(root, 'worktree', 'remove', '--force', dir); gitTry(root, 'worktree', 'prune'); });
  const inst = run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline', '--ignore-scripts'], { cwd: dir, env: { PATH: process.env.PATH } });
  assert.equal(inst.code, 0, `pnpm install in the worktree at ${rev}\n${inst.stdout.slice(-1000)}${inst.stderr.slice(-1000)}`);
  return join(dir, 'packages', 'rcf-lite');
}
function assertPinIsVerificationRelease() {
  const pin = JSON.parse(readFileSync(join(checkoutPackage(), 'package.json'), 'utf8')).dependencies[PIN];
  const schema = JSON.parse(readFileSync(join(checkoutPackage(), 'node_modules', '@stravica-ai', 'rcf-schemas', 'schemas', 'user-story.schema.json'), 'utf8'));
  assert.ok(schema.$defs.acceptanceCriterion.properties.verification, `the pin ${pin} names the rcf-schemas release carrying verification`);
}
// "Before the pin move" for AC-19501-5 (the stage-keeper's ruling 6 on
// the Part B summary's stops, reading c): FBS-232's round DEFINE records
// audit coverage --strict at the round's base, before BUILD moves the pin,
// as this golden (the exit code and the sorted gap list), written from
// packages/rcf-lite with
//   node test/_harness/goldens.js coverage test/fixtures/pin-move/coverage-at-base.json
// and the test compares HEAD's run with it. No git history is read.
const PIN_MOVE_GOLDEN = 'test/fixtures/pin-move/coverage-at-base.json';

test('AC-19501-5: the rcf-schemas pin names the release carrying verification, define validate over the own chain exits 0, and audit coverage --strict exits with the same code and gap list at HEAD as the coverage golden recorded at the round base before the pin move', TODO, async () => {
  const pkg = checkoutPackage();
  const golden = join(pkg, PIN_MOVE_GOLDEN);
  assert.ok(existsSync(golden), `FBS-232's round DEFINE records the coverage golden at the round's base: ${PIN_MOVE_GOLDEN} is absent (node test/_harness/goldens.js coverage ${PIN_MOVE_GOLDEN})`);
  const was = JSON.parse(readFileSync(golden, 'utf8'));
  assert.ok(Number.isInteger(was.exitCode) && Array.isArray(was.gaps), `${PIN_MOVE_GOLDEN} holds { "exitCode", "gaps" }`);
  assertPinIsVerificationRelease();
  const v = await rcf(['define', 'validate'], { cwd: pkg });
  assert.equal(v.code, 0, `define validate over the own chain exits 0\n${v.stdout.slice(-1500)}${v.stderr.slice(-1500)}`);
  const now = await coverageResult(pkg);
  assert.equal(now.exitCode, was.exitCode, `audit coverage --strict exits ${now.exitCode} at HEAD and ${was.exitCode} in the golden recorded before the pin move`);
  assert.deepEqual(now.gaps, was.gaps, 'the same gap list as the golden recorded before the pin move');
});

test('AC-19501-7: define validate over the own chain at the slice head takes at most 1.25 times its run in a worktree at the parent of the pin-move commit, median of three runs each, measured at TEST with RCF_PERF=1', { todo: 'FBS-232 round DEFINE', skip: PERF ? false : 'measured at TEST by the verifier (RCF_PERF=1)' }, async (t) => {
  hostFacts(t);
  const root = checkoutRoot();
  const pkg = checkoutPackage();
  const dir = join(pkg, 'rcf', 'user-stories');
  const stories = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const criteria = stories.reduce((n, s) => n + (s.acceptanceCriteria ?? []).length, 0);
  assert.ok(stories.length >= 234 && criteria >= 827, `given: 827 or more criteria across 234 or more user stories (${criteria} across ${stories.length})`);
  const move = pinMoveCommit(root);
  const before = worktreeAt(t, root, `${move}^1`);
  const beforeMs = [];
  const afterMs = [];
  for (let i = 0; i < 3; i++) {
    const b = await rcf(['define', 'validate'], { cwd: before, bin: join(before, 'bin', 'rcf.js') });
    assert.equal(b.code, 0, `before the pin move: define validate exits 0\n${b.stderr.slice(-1000)}`);
    beforeMs.push(b.ms);
    const a = await rcf(['define', 'validate'], { cwd: pkg });
    assert.equal(a.code, 0, `after the pin move: define validate exits 0\n${a.stderr.slice(-1000)}`);
    afterMs.push(a.ms);
  }
  const ratio = median(afterMs) / median(beforeMs);
  t.diagnostic(`median after ${Math.round(median(afterMs))} ms, median before ${Math.round(median(beforeMs))} ms, ratio ${ratio.toFixed(2)}`);
  assert.ok(ratio <= 1.25, `the run after takes at most 1.25 times the run before (ratio ${ratio.toFixed(2)})`);
});

test('AC-19501-6: the installed rcf-schemas at the new pin defines acceptanceCriterion.properties.verification as an enum of exactly ["external", "testOnly"], not required, with additionalProperties still false', TODO, () => {
  const pkg = JSON.parse(readFileSync(join(checkoutPackage(), 'package.json'), 'utf8'));
  const pin = pkg.dependencies['@stravica-ai/rcf-schemas'];
  const installed = join(checkoutPackage(), 'node_modules', '@stravica-ai', 'rcf-schemas');
  assert.equal(JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).version, pin, 'given: the installed rcf-schemas package is the pinned version');
  const schema = JSON.parse(readFileSync(join(installed, 'schemas', 'user-story.schema.json'), 'utf8'));
  const ac = schema.$defs.acceptanceCriterion;
  assert.ok(ac.properties.verification, 'acceptanceCriterion.properties.verification exists');
  assert.deepEqual(ac.properties.verification.enum, ['external', 'testOnly']);
  assert.ok(!(ac.required ?? []).includes('verification'), 'verification is not required');
  assert.equal(ac.additionalProperties, false);
});

test('AC-19502-1: the pnpm-lock.yaml importer entry for packages/rcf-lite resolves @stravica-ai/rcf-schemas to exactly the version packages/rcf-lite/package.json pins', TODO, () => {
  const pkg = JSON.parse(readFileSync(join(checkoutPackage(), 'package.json'), 'utf8'));
  const pin = pkg.dependencies['@stravica-ai/rcf-schemas'];
  const lock = yaml.load(readFileSync(join(checkoutRoot(), 'pnpm-lock.yaml'), 'utf8'));
  const entry = lock.importers?.['packages/rcf-lite']?.dependencies?.['@stravica-ai/rcf-schemas'];
  assert.ok(entry, 'the lockfile importer entry for packages/rcf-lite lists @stravica-ai/rcf-schemas');
  const resolved = String(entry.version).split('(')[0];
  assert.equal(resolved, pin, `the lockfile resolves ${resolved}, package.json pins ${pin}`);
  // The slice's pin is the rcf-schemas release carrying verification.
  const schema = JSON.parse(readFileSync(join(checkoutPackage(), 'node_modules', '@stravica-ai', 'rcf-schemas', 'schemas', 'user-story.schema.json'), 'utf8'));
  assert.ok(schema.$defs.acceptanceCriterion.properties.verification, `the pinned release ${pin} carries verification`);
});

test('AC-19502-2: every Code Node implementing a criterion of REQ-195 names a path that resolves under packages/rcf-lite/, never node_modules/ or the rcf-schemas repository', TODO, () => {
  const pkgDir = checkoutPackage();
  const storyIds = readdirSync(join(pkgDir, 'rcf', 'user-stories'))
    .map((f) => JSON.parse(readFileSync(join(pkgDir, 'rcf', 'user-stories', f), 'utf8')))
    .filter((us) => us.reqId === 'REQ-195');
  const acIds = new Set(storyIds.flatMap((us) => us.acceptanceCriteria.map((a) => a.id)));
  assert.ok(acIds.size > 0, 'REQ-195 has criteria');
  const nodes = readdirSync(join(pkgDir, 'rcf', 'code-nodes'))
    .map((f) => JSON.parse(readFileSync(join(pkgDir, 'rcf', 'code-nodes', f), 'utf8')))
    .filter((cn) => (cn.implementsAcIds ?? []).some((id) => acIds.has(id)));
  assert.ok(nodes.length > 0, 'the slice records Code Nodes for the criteria of REQ-195 (the writer and schema-loading seams)');
  for (const cn of nodes) {
    const path = cn.path.split('#')[0];
    assert.ok(!path.startsWith('node_modules/') && !path.includes('/node_modules/'), `${cn.cnId} names node_modules: ${cn.path}`);
    assert.ok(!path.includes('rcf-schemas/'), `${cn.cnId} names the rcf-schemas repository: ${cn.path}`);
    assert.ok(!path.startsWith('/') && !path.startsWith('..'), `${cn.cnId} names a path outside this repository: ${cn.path}`);
    assert.ok(existsSync(join(pkgDir, path)), `${cn.cnId} path resolves under packages/rcf-lite/: ${cn.path}`);
  }
});
