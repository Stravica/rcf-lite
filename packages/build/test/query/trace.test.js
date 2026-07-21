// Unit tests for `computeTrace`. Uses a shared hand-built TreeModel
// fixture that exercises the full REQ chain plus the side-chains
// (TAC / ADR via US.tacIds; FBS via AC cross-link + BS parent).
// Spec §D8 / §D9 / §4.2.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeTrace, kindOf } from '../../src/query/trace.js';

function makeFixture() {
  const kindById = new Map();
  const byId = new Map();
  const parentByChild = new Map();
  const childrenByParent = new Map();
  const tsByAcId = new Map();
  const tcsByAcId = new Map();
  const fbsByAcId = new Map();
  const usByTacId = new Map();
  const dependentsByFbsId = new Map();

  const link = (kind, id, doc = { id }) => { kindById.set(id, kind); byId.set(id, doc); };
  const chain = (child, parent) => {
    parentByChild.set(child, parent);
    const list = childrenByParent.get(parent) ?? [];
    list.push(child);
    childrenByParent.set(parent, list);
  };
  const mapPush = (map, key, val) => { const l = map.get(key) ?? []; l.push(val); map.set(key, l); };

  // PRD-001 -> REQ-002 -> US-201 -> AC-201-1 -> TS-042 -> TC-042-happy
  link('prd', 'PRD-001');
  link('req', 'REQ-002', { reqId: 'REQ-002', prdId: 'PRD-001' });
  link('userStory', 'US-201', {
    usId: 'US-201', reqId: 'REQ-002', tacIds: ['TAC-005'],
    acceptanceCriteria: [{ id: 'AC-201-1' }, { id: 'AC-201-2' }],
  });
  chain('REQ-002', 'PRD-001');
  chain('US-201', 'REQ-002');
  // Inline AC parent
  parentByChild.set('AC-201-1', 'US-201');
  parentByChild.set('AC-201-2', 'US-201');
  link('testSuite', 'TS-042', {
    id: 'TS-042', usId: 'US-201', acIds: ['AC-201-1'],
    testCases: [{ id: 'TC-042-happy', acId: 'AC-201-1' }],
  });
  chain('TS-042', 'US-201');
  // Inline TC parent
  parentByChild.set('TC-042-happy', 'TS-042');
  mapPush(tsByAcId, 'AC-201-1', 'TS-042');
  mapPush(tcsByAcId, 'AC-201-1', { tsId: 'TS-042', tcId: 'TC-042-happy' });

  // Side chain: TAD-001 -> TAC-005; US-201 references TAC-005.
  link('tad', 'TAD-001');
  link('tac', 'TAC-005', { tacId: 'TAC-005', tadId: 'TAD-001' });
  chain('TAC-005', 'TAD-001');
  mapPush(usByTacId, 'TAC-005', 'US-201');

  // BS-001 -> FBS-014 (cross-links to AC-201-1)
  link('buildSequence', 'BS-001');
  link('fbs', 'FBS-014', {
    fbsId: 'FBS-014', bsId: 'BS-001', acIds: ['AC-201-1'],
    contextRequirements: { tacIds: ['TAC-005'], adrIds: [] },
  });
  chain('FBS-014', 'BS-001');
  mapPush(fbsByAcId, 'AC-201-1', 'FBS-014');

  return {
    kindById, byId, parentByChild, childrenByParent,
    tsByAcId, tcsByAcId, fbsByAcId, usByTacId, dependentsByFbsId,
    fbsItems: [byId.get('FBS-014')],
  };
}

test('kindOf resolves inline AC / TC ids via id-prefix + parentByChild', () => {
  const tree = makeFixture();
  assert.equal(kindOf(tree, 'AC-201-1'), 'ac');
  assert.equal(kindOf(tree, 'TC-042-happy'), 'tc');
  assert.equal(kindOf(tree, 'PRD-001'), 'prd');
  assert.equal(kindOf(tree, 'DOES-NOT-EXIST'), null);
});

test('forward from PRD returns full descendant tree down to TC', () => {
  const tree = makeFixture();
  const r = computeTrace(tree, { id: 'PRD-001', direction: 'forward' });
  assert.equal(r.found, true);
  const ids = (r.nodes ?? []).map((n) => n.id);
  assert.ok(ids.includes('REQ-002'));
  assert.ok(ids.includes('US-201'));
  assert.ok(ids.includes('AC-201-1'));
  assert.ok(ids.includes('TS-042'));
  assert.ok(ids.includes('TC-042-happy'));
});

test('forward from REQ returns US -> AC -> TS -> TC subtree', () => {
  const tree = makeFixture();
  const r = computeTrace(tree, { id: 'REQ-002', direction: 'forward' });
  const ids = (r.nodes ?? []).map((n) => n.id);
  assert.ok(ids.includes('US-201'));
  assert.ok(ids.includes('AC-201-1'));
  assert.ok(ids.includes('TS-042'));
  assert.ok(ids.includes('TC-042-happy'));
  assert.ok(!ids.includes('PRD-001'));
});

test('forward from US returns AC + TS + TC', () => {
  const tree = makeFixture();
  const r = computeTrace(tree, { id: 'US-201', direction: 'forward' });
  const ids = (r.nodes ?? []).map((n) => n.id);
  assert.ok(ids.includes('AC-201-1'));
  assert.ok(ids.includes('TS-042'));
});

test('forward from AC includes TS + TC via cross-links', () => {
  const tree = makeFixture();
  const r = computeTrace(tree, { id: 'AC-201-1', direction: 'forward' });
  const ids = (r.nodes ?? []).map((n) => n.id);
  assert.ok(ids.includes('TS-042'));
  assert.ok(ids.includes('TC-042-happy'));
});

test('forward from AC includes FBS via fbsByAcId cross-link', () => {
  const tree = makeFixture();
  const r = computeTrace(tree, { id: 'AC-201-1', direction: 'forward' });
  const ids = (r.nodes ?? []).map((n) => n.id);
  assert.ok(ids.includes('FBS-014'));
});

test('forward from TS returns inline TC entries', () => {
  const tree = makeFixture();
  const r = computeTrace(tree, { id: 'TS-042', direction: 'forward' });
  const ids = (r.nodes ?? []).map((n) => n.id);
  assert.ok(ids.includes('TC-042-happy'));
});

test('forward from TC returns single-node result (pivot only, empty descendants)', () => {
  const tree = makeFixture();
  const r = computeTrace(tree, { id: 'TC-042-happy', direction: 'forward' });
  assert.equal(r.found, true);
  assert.equal((r.nodes ?? []).length, 1);
  assert.equal(r.nodes[0].id, 'TC-042-happy');
});

test('forward from TAC includes US via usByTacId cross-link', () => {
  const tree = makeFixture();
  const r = computeTrace(tree, { id: 'TAC-005', direction: 'forward' });
  const ids = (r.nodes ?? []).map((n) => n.id);
  assert.ok(ids.includes('US-201'));
});

test('back from AC walks AC -> US -> REQ -> PRD', () => {
  const tree = makeFixture();
  const r = computeTrace(tree, { id: 'AC-201-1', direction: 'back' });
  const ids = (r.nodes ?? []).map((n) => n.id);
  assert.deepEqual(ids, ['AC-201-1', 'US-201', 'REQ-002', 'PRD-001']);
});

test('back from TC walks TC -> TS -> AC -> US -> REQ -> PRD (AC via testCases.acId)', () => {
  const tree = makeFixture();
  const r = computeTrace(tree, { id: 'TC-042-happy', direction: 'back' });
  const ids = (r.nodes ?? []).map((n) => n.id);
  assert.deepEqual(ids, ['TC-042-happy', 'TS-042', 'AC-201-1', 'US-201', 'REQ-002', 'PRD-001']);
});

test('back from REQ returns REQ -> PRD', () => {
  const tree = makeFixture();
  const r = computeTrace(tree, { id: 'REQ-002', direction: 'back' });
  const ids = (r.nodes ?? []).map((n) => n.id);
  assert.deepEqual(ids, ['REQ-002', 'PRD-001']);
});

test('back from PRD returns pivot-only (empty ancestors)', () => {
  const tree = makeFixture();
  const r = computeTrace(tree, { id: 'PRD-001', direction: 'back' });
  const ids = (r.nodes ?? []).map((n) => n.id);
  assert.deepEqual(ids, ['PRD-001']);
});

test('both returns pivot + ancestors + descendants envelope', () => {
  const tree = makeFixture();
  const r = computeTrace(tree, { id: 'US-201', direction: 'both' });
  assert.equal(r.pivot, 'US-201');
  assert.equal(r.direction, 'both');
  assert.ok(Array.isArray(r.ancestors));
  assert.ok(Array.isArray(r.descendants));
  const ancIds = r.ancestors.map((n) => n.id);
  const descIds = r.descendants.map((n) => n.id);
  assert.ok(ancIds.includes('REQ-002'));
  assert.ok(ancIds.includes('PRD-001'));
  assert.ok(descIds.includes('AC-201-1'));
  // Pivot excluded from both arrays.
  assert.ok(!ancIds.includes('US-201'));
  assert.ok(!descIds.includes('US-201'));
});

test('unknown pivot returns {found:false}', () => {
  const tree = makeFixture();
  const r = computeTrace(tree, { id: 'REQ-999', direction: 'forward' });
  assert.equal(r.found, false);
});
