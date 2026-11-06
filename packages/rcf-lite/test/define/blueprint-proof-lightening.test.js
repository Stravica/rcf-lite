// Round G (US-19905): the blueprint lightening path and the idempotent
// retry (the stage-keeper's rulings 49 and 47, the gate's F-1). A
// blueprint version replacement (rcf define blueprint add of the same
// slug at a new version) that lightens an existing criterion's proof
// (absent or full to journey or external, and journey to external) is
// refused, exit 2, unless the command carries a non-empty --reason; with
// one, it writes the same resolved decision rcf define update writes
// (blocks the criterion id, answer the reason verbatim, question "Lighten
// <ac> proof from <from> to <to>?") to rcf/define/decisions-ledger.json.
// A first application at any level stays direct. A retry of the same
// reasoned lightening, after a crash between the ledger write and the
// story write, adds no second decision.
//
// Criteria here: AC-19905-27 to AC-19905-30, each external. Each drives
// bin/rcf.js against a fixture project made by its own rcf init; the
// blueprint source sits in its own scratch directory. Imports: Node
// builtins and test/_harness/ only (GR-40), so the file also loads in the
// packed-artefact run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { lines, rcf } from '../_harness/spawn.js';
import { criterion, editStory, project, readJson, readText, scratch, writeJson } from '../_harness/fixture.js';

const BP_US = 'rcf/user-stories/spa-us-101.json';
const US = 'rcf/user-stories/us-101.json';
const MANIFEST = 'rcf/manifest.json';
const LEDGER = 'rcf/define/decisions-ledger.json';
const REFUSAL = (acId, from, to) => `[error] blueprint add: refusing to lighten ${acId} proof from ${from} to ${to} without a reason (pass --reason <text>, non-empty)`;
const REASON = 'the release Verify proves it';

const textOrNull = (dir, rel) => (existsSync(join(dir, rel)) ? readText(dir, rel) : null);
const acOf = (dir, rel, id) => readJson(dir, rel).acceptanceCriteria.find((a) => a.id === id);

async function run(dir, args, code = 0) {
  const r = await rcf(args, { cwd: dir });
  assert.equal(r.code, code, `${args.join(' ')} exits ${code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  return r;
}

async function decisions(dir) {
  return JSON.parse((await run(dir, ['define', 'ledger', 'decisions', 'list', '--json'])).stdout).decisions;
}

// A blueprint source outside the project: slug spa at `version`,
// contributing spa-REQ-001 and spa-US-101 whose criteria AC-999-1.. carry
// the proofs given (undefined for none).
function blueprint(t, version, proofs) {
  const dir = join(scratch(t, 'rcf-h-bp-'), `spa-${version}`);
  mkdirSync(join(dir, 'contributions'), { recursive: true });
  writeJson(dir, 'blueprint.json', {
    slug: 'spa', version,
    contributions: [
      { kind: 'req', id: 'spa-REQ-001', path: 'spa-req-001.json' },
      { kind: 'us', id: 'spa-US-101', path: 'spa-us-101.json' },
    ],
  });
  writeJson(dir, 'contributions/spa-req-001.json', {
    reqId: 'spa-REQ-001', prdId: 'PRD-001', title: 'A requirement', description: 'A description', category: 'functional',
    priority: 'must', domain: 'ui', version: '0.1.0', status: 'draft', createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  });
  writeJson(dir, 'contributions/spa-us-101.json', {
    usId: 'spa-US-101', prdId: 'PRD-001', reqId: 'spa-REQ-001', version: '0.1.0', status: 'draft',
    title: 'US', asA: 'a', iWant: 'b', soThat: 'c',
    acceptanceCriteria: proofs.map((proof, i) => criterion(`AC-999-${i + 1}`, `[happy] blueprint criterion ${i + 1}`, proof ? { proof } : {})),
    tacIds: [], createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  });
  return dir;
}

const add = (source, extra = []) => ['define', 'blueprint', 'add', source, ...extra];

// The refusal: exit 2, the one stated stderr line, and the story, the
// manifest and the decisions ledger byte-identical.
async function assertRefused(dir, args, { acId, from, to }) {
  const before = [BP_US, MANIFEST, LEDGER].map((rel) => textOrNull(dir, rel));
  const r = await rcf(args, { cwd: dir });
  const line = REFUSAL(acId, from, to);
  assert.equal(r.code, 2, `${args.join(' ')} exits 2\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.ok(lines(r.stderr).includes(line), `stderr carries "${line}"\n${r.stderr}`);
  assert.deepEqual([BP_US, MANIFEST, LEDGER].map((rel) => textOrNull(dir, rel)), before, 'the story, the manifest and the decisions ledger are byte-identical');
}

// Every file under rcf/ but the decisions ledger, by path: the tree a
// crash after the ledger write leaves, restored by restore().
function snapshot(dir) {
  const out = new Map();
  const walk = (abs) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const p = join(abs, e.name);
      if (e.isDirectory()) walk(p);
      else if (relative(dir, p) !== LEDGER) out.set(relative(dir, p), readFileSync(p));
    }
  };
  walk(join(dir, 'rcf'));
  return out;
}
function restore(dir, snap) {
  for (const rel of snapshot(dir).keys()) if (!snap.has(rel)) rmSync(join(dir, rel));
  for (const [rel, bytes] of snap) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), bytes);
  }
}

test('AC-19905-27: a blueprint version replacement lightening an existing criterion (no proof to external, journey to external) without --reason, or with an empty or whitespace-only one, exits 2 with the refusal line naming the criterion and both levels, and leaves the story, the manifest and the decisions ledger byte-identical', async (t) => {
  const dir = await project(t, { name: 'bp-refuse' });
  await run(dir, add(blueprint(t, '1.0.0', [undefined, 'journey'])));
  await assertRefused(dir, add(blueprint(t, '2.0.0', ['external', 'journey'])), { acId: 'AC-999-1', from: 'full', to: 'external' });
  await assertRefused(dir, add(blueprint(t, '2.0.0', [undefined, 'external']), ['--reason', '']), { acId: 'AC-999-2', from: 'journey', to: 'external' });
  await assertRefused(dir, add(blueprint(t, '2.0.0', ['journey', 'journey']), ['--reason', '   ']), { acId: 'AC-999-1', from: 'full', to: 'journey' });
  assert.equal(acOf(dir, BP_US, 'AC-999-1').proof, undefined, 'AC-999-1 still carries no proof');
  assert.equal(acOf(dir, BP_US, 'AC-999-2').proof, 'journey');
  assert.equal(readJson(dir, MANIFEST).blueprints.find((b) => b.slug === 'spa').version, '1.0.0', 'the manifest still records 1.0.0');
});

test('AC-19905-28: the same replacement with a non-empty --reason exits 0, writes the lighter levels, and writes one resolved decision per lightened criterion (blocks the criterion id, answer the reason verbatim, question naming the criterion and both levels), read back by rcf define ledger decisions list --json', async (t) => {
  const dir = await project(t, { name: 'bp-reason' });
  await run(dir, add(blueprint(t, '1.0.0', [undefined, 'journey'])));
  await run(dir, add(blueprint(t, '2.0.0', ['external', 'external']), ['--reason', REASON]));
  assert.equal(acOf(dir, BP_US, 'AC-999-1').proof, 'external');
  assert.equal(acOf(dir, BP_US, 'AC-999-2').proof, 'external');
  const list = await decisions(dir);
  assert.deepEqual(list.map((d) => [d.blocks, d.status, d.answer, d.question]), [
    ['AC-999-1', 'resolved', REASON, 'Lighten AC-999-1 proof from full to external?'],
    ['AC-999-2', 'resolved', REASON, 'Lighten AC-999-2 proof from journey to external?'],
  ], `one resolved decision per lightened criterion\n${JSON.stringify(list, null, 2)}`);
});

test('AC-19905-29: a first application of a blueprint whose criteria are at journey or external exits 0 with no decision written, and a later replacement lightening one of them without --reason is refused (exit 2) in the same fixture', async (t) => {
  const dir = await project(t, { name: 'bp-first' });
  await run(dir, add(blueprint(t, '1.0.0', ['journey', 'external'])));
  assert.equal(acOf(dir, BP_US, 'AC-999-1').proof, 'journey');
  assert.equal(acOf(dir, BP_US, 'AC-999-2').proof, 'external');
  assert.deepEqual(await decisions(dir), [], 'a first application writes no decision');
  await assertRefused(dir, add(blueprint(t, '2.0.0', ['external', 'external'])), { acId: 'AC-999-1', from: 'journey', to: 'external' });
});

test('AC-19905-30: a retry of the same reasoned lightening after a crash between the ledger write and the story write (rcf define update --set proof=external --reason, and a blueprint replacement with --reason) exits 0, writes the level, and leaves exactly one decision for that criterion, both levels and that reason', async (t) => {
  const dir = await project(t, { name: 'retry-update' });
  editStory(dir, 'US-101', (us) => { us.acceptanceCriteria = [criterion('AC-101-1', '[happy] authored criterion 1')]; });
  const bytes = readText(dir, US);
  const args = ['define', 'update', 'AC-101-1', '--set', 'proof=external', '--reason', REASON];
  await run(dir, args);
  writeFileSync(join(dir, US), bytes);
  await run(dir, args);
  assert.equal(acOf(dir, US, 'AC-101-1').proof, 'external');
  const one = (await decisions(dir)).filter((d) => d.blocks === 'AC-101-1');
  assert.deepEqual(one.map((d) => [d.status, d.answer, d.question]), [['resolved', REASON, 'Lighten AC-101-1 proof from full to external?']],
    `exactly one decision for AC-101-1\n${JSON.stringify(one, null, 2)}`);

  const bp = await project(t, { name: 'retry-bp' });
  await run(bp, add(blueprint(t, '1.0.0', [undefined])));
  const before = snapshot(bp);
  const v2 = add(blueprint(t, '2.0.0', ['external']), ['--reason', REASON]);
  await run(bp, v2);
  restore(bp, before);
  await run(bp, v2);
  assert.equal(acOf(bp, BP_US, 'AC-999-1').proof, 'external');
  const mine = (await decisions(bp)).filter((d) => d.blocks === 'AC-999-1');
  assert.deepEqual(mine.map((d) => [d.status, d.answer, d.question]), [['resolved', REASON, 'Lighten AC-999-1 proof from full to external?']],
    `exactly one decision for AC-999-1\n${JSON.stringify(mine, null, 2)}`);
});
