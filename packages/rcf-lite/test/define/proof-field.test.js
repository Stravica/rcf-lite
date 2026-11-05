// Round G (US-19905): the writer carries acceptanceCriterion.proof (the
// stage-keeper's ruling 10) and refuses a value outside full, journey and
// external (ruling 5), the verification-field.test.js shape (FBS-232).
//
// Criteria here: AC-19905-10 and AC-19905-11, both external. Each drives
// bin/rcf.js against a fixture project made by its own rcf init. Both are
// red until the rcf-schemas pin carries acceptanceCriterion.proof: at
// 0.10.0 the field of any value is refused as an additional property, so
// AC-19905-11 asserts the enum line only the new schema produces (it
// names the allowed values), never the bare refusal. The schema version
// is read from no string: the Given reads the installed schema (the
// AC-19501-6 shape). Imports: Node builtins and test/_harness/ only
// (GR-40), so the file also loads in the packed-artefact run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { BIN, rcf } from '../_harness/spawn.js';
import { editStory, project, readJson, readText, scratch, writeJson } from '../_harness/fixture.js';

function assertPinCarriesProof() {
  const req = createRequire(BIN);
  const schema = JSON.parse(readFileSync(req.resolve('@stravica-ai/rcf-schemas/schemas/user-story.schema.json'), 'utf8'));
  assert.ok(schema.$defs.acceptanceCriterion.properties.proof, 'given: rcf-lite is installed with its rcf-schemas pin at the release carrying proof');
}
const story = (dir) => readJson(dir, 'rcf/user-stories/us-101.json');
const acOf = (dir, id) => story(dir).acceptanceCriteria.find((a) => a.id === id);
const PROOF_LINE = (acId) => `[error] validation ${acId} proof must be equal to one of the allowed values (allowed: full, journey, external)`;

test('AC-19905-10: rcf define create ac --from-file with "proof": "journey" writes it and define read shows it; rcf define update <ac> --set proof=external sets it; a later --set verification=testOnly preserves proof external; and define validate exits 0', async (t) => {
  assertPinCarriesProof();
  const dir = await project(t, { name: 'proof-writer' });
  // Given AC-101-1 is an authored criterion, not the init seed: create ac
  // replaces a lone seed (the writer's seeded-phantom rule), so the update
  // half must act on a criterion the create leaves in place (ruling 33).
  editStory(dir, 'US-101', (us) => {
    us.acceptanceCriteria[0].description = '[happy] an authored criterion the update half acts on';
  });
  const bodyDir = scratch(t, 'rcf-h-body-');
  writeJson(bodyDir, 'ac.json', { description: '[happy] proof fixture', testable: true, verification: 'external', proof: 'journey' });
  const c = await rcf(['define', 'create', 'ac', '--parent', 'US-101', '--from-file', join(bodyDir, 'ac.json')], { cwd: dir });
  assert.equal(c.code, 0, `create ac exits 0\n${c.stdout}${c.stderr}`);
  const read = await rcf(['define', 'read', 'US-101', '--field', 'acceptanceCriteria'], { cwd: dir });
  assert.equal(read.code, 0, `${read.stdout}${read.stderr}`);
  const created = JSON.parse(read.stdout).find((a) => a.description === '[happy] proof fixture');
  assert.ok(created, `the new criterion is listed\n${read.stdout}`);
  assert.equal(created.proof, 'journey', 'define read shows proof journey');
  assert.notEqual(created.id, 'AC-101-1', 'the create makes a new criterion beside the authored AC-101-1');

  const u = await rcf(['define', 'update', 'AC-101-1', '--set', 'proof=external'], { cwd: dir });
  assert.equal(u.code, 0, `${u.stdout}${u.stderr}`);
  assert.equal(u.stdout.trim(), 'AC-101-1 updated at rcf/user-stories/us-101.json');
  assert.equal(acOf(dir, 'AC-101-1').proof, 'external');
  const later = await rcf(['define', 'update', 'AC-101-1', '--set', 'verification=testOnly'], { cwd: dir });
  assert.equal(later.code, 0, `${later.stdout}${later.stderr}`);
  assert.equal(acOf(dir, 'AC-101-1').verification, 'testOnly');
  assert.equal(acOf(dir, 'AC-101-1').proof, 'external', 'a later --set of another field preserves proof');
  assert.equal(acOf(dir, created.id).proof, 'journey', 'the created criterion keeps proof journey');
  const v = await rcf(['define', 'validate'], { cwd: dir });
  assert.equal(v.code, 0, `define validate exits 0\n${v.stdout}${v.stderr}`);
});

test('AC-19905-11: proof light through rcf define update --set and through a create ac body exits 3 with the line "[error] validation <ac> proof must be equal to one of the allowed values (allowed: full, journey, external)" naming the criterion, and leaves us-101.json byte-identical', async (t) => {
  assertPinCarriesProof();
  const dir = await project(t, { name: 'proof-bad' });
  const bytes = readText(dir, 'rcf/user-stories/us-101.json');
  const r = await rcf(['define', 'update', 'AC-101-1', '--set', 'proof=light'], { cwd: dir });
  assert.equal(r.code, 3, `${r.stdout}${r.stderr}`);
  assert.ok(r.stderr.split('\n').includes(PROOF_LINE('AC-101-1')), `stderr carries "${PROOF_LINE('AC-101-1')}"\n${r.stderr}`);
  assert.equal(readText(dir, 'rcf/user-stories/us-101.json'), bytes, 'us-101.json is byte-identical');

  const bodyDir = scratch(t, 'rcf-h-body-');
  writeJson(bodyDir, 'allowed.json', { description: '[happy] proof fixture', testable: true, verification: 'external', proof: 'full' });
  const dry = await rcf(['define', 'create', 'ac', '--parent', 'US-101', '--from-file', join(bodyDir, 'allowed.json'), '--dry-run'], { cwd: dir });
  const createdId = /would create (AC-\d+-\d+) /.exec(dry.stdout)?.[1];
  assert.ok(createdId, `the dry run names the criterion a create makes\n${dry.stdout}${dry.stderr}`);
  writeJson(bodyDir, 'ac.json', { description: '[happy] proof fixture', testable: true, verification: 'external', proof: 'light' });
  const c = await rcf(['define', 'create', 'ac', '--parent', 'US-101', '--from-file', join(bodyDir, 'ac.json')], { cwd: dir });
  assert.equal(c.code, 3, `${c.stdout}${c.stderr}`);
  assert.ok(c.stderr.split('\n').includes(PROOF_LINE(createdId)), `create: stderr carries "${PROOF_LINE(createdId)}"\n${c.stderr}`);
  assert.equal(readText(dir, 'rcf/user-stories/us-101.json'), bytes, 'us-101.json is byte-identical after the refused create');
});
