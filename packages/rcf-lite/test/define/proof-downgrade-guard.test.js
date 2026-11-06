// Round G (US-19905): the proof downgrade guard (the stage-keeper's rulings
// 40 to 43, the gate's F-1). rcf define update refuses to lighten an
// existing criterion's proof (absent or full to journey or external, and
// journey to external) unless the command carries a non-empty --reason,
// and records that reason in the decisions ledger
// (rcf/define/decisions-ledger.json), which define ledger decisions list
// reads back. Creating a criterion at any level, and tightening, stay
// direct.
//
// Criteria here: AC-19905-17 to AC-19905-22, each external. Each drives
// bin/rcf.js against a fixture project made by its own rcf init. Imports:
// Node builtins and test/_harness/ only (GR-40), so the file also loads in
// the packed-artefact run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { rcf } from '../_harness/spawn.js';
import { editStory, project, readJson, readText, scratch, writeJson } from '../_harness/fixture.js';

const US = 'rcf/user-stories/us-101.json';
const LEDGER = 'rcf/define/decisions-ledger.json';
const REFUSAL = (acId, from, to) => `[error] usage update: refusing to lighten ${acId} proof from ${from} to ${to} without a reason (pass --reason <text>, non-empty)`;
const acOf = (dir, id) => readJson(dir, US).acceptanceCriteria.find((a) => a.id === id);

// Given US-101 carries authored criteria (never the lone init seed, which
// create ac replaces), each with the extra fields given.
function authored(dir, ...extras) {
  editStory(dir, 'US-101', (us) => {
    us.acceptanceCriteria = extras.map((extra, i) => ({
      id: `AC-101-${i + 1}`, description: `[happy] authored criterion ${i + 1}`, testable: true, ...extra,
    }));
  });
}

async function decisions(dir) {
  const r = await rcf(['define', 'ledger', 'decisions', 'list', '--json'], { cwd: dir });
  assert.equal(r.code, 0, `define ledger decisions list --json exits 0\n${r.stdout}${r.stderr}`);
  return JSON.parse(r.stdout).decisions;
}

// The refusal: exit 2, the one stated stderr line, us-101.json
// byte-identical, and the decisions ledger not written.
async function assertRefused(dir, args, { acId, from, to }) {
  const bytes = readText(dir, US);
  const ledgerBefore = existsSync(join(dir, LEDGER)) ? readText(dir, LEDGER) : null;
  const r = await rcf(args, { cwd: dir });
  const line = REFUSAL(acId, from, to);
  assert.equal(r.code, 2, `${args.join(' ')} exits 2\n${r.stdout}${r.stderr}`);
  assert.ok(r.stderr.split('\n').includes(line), `${args.join(' ')}: stderr carries "${line}"\n${r.stderr}`);
  assert.equal(readText(dir, US), bytes, `${args.join(' ')}: us-101.json is byte-identical`);
  const ledgerAfter = existsSync(join(dir, LEDGER)) ? readText(dir, LEDGER) : null;
  assert.equal(ledgerAfter, ledgerBefore, `${args.join(' ')}: the decisions ledger is not written`);
}

test('AC-19905-17: rcf define update <ac> --set proof=external or proof=journey on a criterion whose proof is absent (full), the init seed included, without --reason exits 2 with the refusal line naming the criterion and the levels, and writes nothing', async (t) => {
  const seed = await project(t, { name: 'guard-seed' });
  await assertRefused(seed, ['define', 'update', 'AC-101-1', '--set', 'proof=external'], { acId: 'AC-101-1', from: 'full', to: 'external' });

  const dir = await project(t, { name: 'guard-set' });
  authored(dir, {});
  await assertRefused(dir, ['define', 'update', 'AC-101-1', '--set', 'proof=external'], { acId: 'AC-101-1', from: 'full', to: 'external' });
  await assertRefused(dir, ['define', 'update', 'AC-101-1', '--set', 'proof=journey'], { acId: 'AC-101-1', from: 'full', to: 'journey' });
  assert.equal(acOf(dir, 'AC-101-1').proof, undefined, 'AC-101-1 still carries no proof');
});

test('AC-19905-18: journey to external without --reason, and full to journey with an empty or whitespace-only --reason, exit 2 with the refusal line and write nothing', async (t) => {
  const dir = await project(t, { name: 'guard-journey' });
  authored(dir, { proof: 'journey' }, { proof: 'full' });
  await assertRefused(dir, ['define', 'update', 'AC-101-1', '--set', 'proof=external'], { acId: 'AC-101-1', from: 'journey', to: 'external' });
  await assertRefused(dir, ['define', 'update', 'AC-101-2', '--set', 'proof=journey', '--reason', ''], { acId: 'AC-101-2', from: 'full', to: 'journey' });
  await assertRefused(dir, ['define', 'update', 'AC-101-2', '--set', 'proof=journey', '--reason', '   '], { acId: 'AC-101-2', from: 'full', to: 'journey' });
  assert.equal(acOf(dir, 'AC-101-1').proof, 'journey');
  assert.equal(acOf(dir, 'AC-101-2').proof, 'full');
});

test('AC-19905-19: rcf define update <ac> --from-file with a body lightening proof, without --reason, exits 2 with the refusal line and writes nothing', async (t) => {
  const dir = await project(t, { name: 'guard-from-file' });
  authored(dir, {}, { proof: 'journey' });
  const bodyDir = scratch(t, 'rcf-h-body-');
  writeJson(bodyDir, 'external.json', { proof: 'external' });
  await assertRefused(dir, ['define', 'update', 'AC-101-1', '--from-file', join(bodyDir, 'external.json')], { acId: 'AC-101-1', from: 'full', to: 'external' });
  await assertRefused(dir, ['define', 'update', 'AC-101-2', '--from-file', join(bodyDir, 'external.json')], { acId: 'AC-101-2', from: 'journey', to: 'external' });
});

test('AC-19905-20: rcf define update <us> --from-file rewriting acceptanceCriteria so an existing criterion is lighter, without --reason, exits 2 with the refusal line naming that criterion and writes nothing', async (t) => {
  const dir = await project(t, { name: 'guard-parent' });
  authored(dir, {}, { proof: 'full' });
  const criteria = readJson(dir, US).acceptanceCriteria;
  const bodyDir = scratch(t, 'rcf-h-body-');
  writeJson(bodyDir, 'us.json', { acceptanceCriteria: [criteria[0], { ...criteria[1], proof: 'journey' }] });
  await assertRefused(dir, ['define', 'update', 'US-101', '--from-file', join(bodyDir, 'us.json')], { acId: 'AC-101-2', from: 'full', to: 'journey' });
});

test('AC-19905-21: a lightening update with a non-empty --reason exits 0, sets the level, and records a resolved decision naming the criterion, the from and to levels and the reason, which rcf define ledger decisions list reads back', async (t) => {
  const dir = await project(t, { name: 'guard-reason' });
  authored(dir, {}, {});
  assert.deepEqual(await decisions(dir), [], 'given: the decisions ledger is empty');
  const reasonA = 'the release Verify proves it';
  const u = await rcf(['define', 'update', 'AC-101-1', '--set', 'proof=external', '--reason', reasonA], { cwd: dir });
  assert.equal(u.code, 0, `${u.stdout}${u.stderr}`);
  assert.equal(u.stdout.trim(), 'AC-101-1 updated at rcf/user-stories/us-101.json');
  assert.equal(acOf(dir, 'AC-101-1').proof, 'external');

  const bodyDir = scratch(t, 'rcf-h-body-');
  writeJson(bodyDir, 'journey.json', { proof: 'journey' });
  const reasonB = 'only the e2e journey proves this';
  const f = await rcf(['define', 'update', 'AC-101-2', '--from-file', join(bodyDir, 'journey.json'), '--reason', reasonB], { cwd: dir });
  assert.equal(f.code, 0, `${f.stdout}${f.stderr}`);
  assert.equal(acOf(dir, 'AC-101-2').proof, 'journey');

  const list = await decisions(dir);
  assert.equal(list.length, 2, `two decisions recorded\n${JSON.stringify(list, null, 2)}`);
  for (const [acId, from, to, reason] of [['AC-101-1', 'full', 'external', reasonA], ['AC-101-2', 'full', 'journey', reasonB]]) {
    const d = list.find((e) => e.blocks === acId);
    assert.ok(d, `a decision blocks ${acId}\n${JSON.stringify(list, null, 2)}`);
    assert.equal(d.status, 'resolved', `${acId}: the decision is resolved`);
    assert.equal(d.answer, reason, `${acId}: the decision's answer is the reason`);
    for (const word of [acId, from, to]) assert.ok(d.question.includes(word), `${acId}: the question names ${word}\n${d.question}`);
  }
  const v = await rcf(['define', 'validate'], { cwd: dir });
  assert.equal(v.code, 0, `define validate exits 0\n${v.stdout}${v.stderr}`);
});

test('AC-19905-22: with the guard in force, rcf define create ac at any proof level, the lone init seed replaced included, and tightening (external to journey, journey to full, full to full) exit 0 with no --reason and record no decision', async (t) => {
  // Given the guard is in force (so the direct paths are not green only
  // because no guard exists): a lightening without --reason is refused.
  const given = await project(t, { name: 'guard-given' });
  authored(given, {});
  await assertRefused(given, ['define', 'update', 'AC-101-1', '--set', 'proof=external'], { acId: 'AC-101-1', from: 'full', to: 'external' });

  const dir = await project(t, { name: 'guard-direct' });
  const bodyDir = scratch(t, 'rcf-h-body-');
  const created = [];
  for (const proof of ['external', 'journey']) {
    writeJson(bodyDir, `${proof}.json`, { description: `[happy] created at ${proof}`, testable: true, proof });
    const c = await rcf(['define', 'create', 'ac', '--parent', 'US-101', '--from-file', join(bodyDir, `${proof}.json`)], { cwd: dir });
    assert.equal(c.code, 0, `create ac at ${proof} exits 0\n${c.stdout}${c.stderr}`);
    const ac = readJson(dir, US).acceptanceCriteria.find((a) => a.description === `[happy] created at ${proof}`);
    assert.ok(ac, `the criterion created at ${proof} is in us-101.json`);
    assert.equal(ac.proof, proof);
    created.push(ac.id);
  }
  const [ext] = created;
  for (const to of ['journey', 'full', 'full']) {
    const u = await rcf(['define', 'update', ext, '--set', `proof=${to}`], { cwd: dir });
    assert.equal(u.code, 0, `tightening ${ext} to ${to} exits 0\n${u.stdout}${u.stderr}`);
    assert.equal(acOf(dir, ext).proof, to);
  }
  assert.deepEqual(await decisions(dir), [], 'no decision is recorded');
});
