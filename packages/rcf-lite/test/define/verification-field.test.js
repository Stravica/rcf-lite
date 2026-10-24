// FBS-232 (US-19501, US-19502): the rcf-schemas verification field
// (external | testOnly) and the rcf-lite pin move.
//
// Criteria: 9 in the slice; 7 tested here, 4 external (AC-19501-1 to
// AC-19501-4) and 3 testOnly (AC-19501-6, AC-19502-1, AC-19502-2).
// AC-19501-5 and AC-19501-7 are not written: each compares this
// repository's state "before the pin move" (git history the required CI
// test job, a depth-1 checkout, does not have), returned as a question to
// the stage-keeper and left unbound so the gap stays visible.
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

import { BIN, rcf } from '../_harness/spawn.js';
import { checkoutPackage, checkoutRoot, project, readJson, readText, scratch, writeJson } from '../_harness/fixture.js';

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
