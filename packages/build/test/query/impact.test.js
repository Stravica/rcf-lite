// Unit tests for `computeImpact`. Verifies the D7 (kind, role) action
// label rules plus the fan-out around a pivot. Spec §D7 / §4.3.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeImpact, labelFor } from '../../src/query/impact.js';

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

  link('prd', 'PRD-001');
  link('req', 'REQ-002', { reqId: 'REQ-002', prdId: 'PRD-001' });
  link('userStory', 'US-201', {
    usId: 'US-201', reqId: 'REQ-002',
    acceptanceCriteria: [{ id: 'AC-201-1' }],
  });
  chain('REQ-002', 'PRD-001');
  chain('US-201', 'REQ-002');
  parentByChild.set('AC-201-1', 'US-201');
  link('testSuite', 'TS-042', {
    id: 'TS-042', usId: 'US-201', acIds: ['AC-201-1'],
    testCases: [{ id: 'TC-042-happy', acId: 'AC-201-1' }],
  });
  chain('TS-042', 'US-201');
  parentByChild.set('TC-042-happy', 'TS-042');
  mapPush(tsByAcId, 'AC-201-1', 'TS-042');
  mapPush(tcsByAcId, 'AC-201-1', { tsId: 'TS-042', tcId: 'TC-042-happy' });

  link('tad', 'TAD-001');
  link('tac', 'TAC-005', { tacId: 'TAC-005', tadId: 'TAD-001' });
  link('adr', 'ADR-003', { adrId: 'ADR-003', tadId: 'TAD-001' });
  chain('TAC-005', 'TAD-001');
  chain('ADR-003', 'TAD-001');
  mapPush(usByTacId, 'TAC-005', 'US-201');

  link('buildSequence', 'BS-001');
  link('fbs', 'FBS-014', {
    fbsId: 'FBS-014', bsId: 'BS-001', acIds: ['AC-201-1'],
    contextRequirements: { tacIds: ['TAC-005'], adrIds: ['ADR-003'] },
  });
  link('fbs', 'FBS-015', {
    fbsId: 'FBS-015', bsId: 'BS-001', acIds: [],
    contextRequirements: { tacIds: [], adrIds: [] },
  });
  chain('FBS-014', 'BS-001');
  chain('FBS-015', 'BS-001');
  mapPush(fbsByAcId, 'AC-201-1', 'FBS-014');
  mapPush(dependentsByFbsId, 'FBS-014', 'FBS-015');

  return {
    kindById, byId, parentByChild, childrenByParent,
    tsByAcId, tcsByAcId, fbsByAcId, usByTacId, dependentsByFbsId,
    fbsItems: [byId.get('FBS-014'), byId.get('FBS-015')],
  };
}

test('impact from AC: ancestors up to PRD; descendants include TS + TC + FBS with correct labels', () => {
  const tree = makeFixture();
  const r = computeImpact(tree, { id: 'AC-201-1' });
  assert.equal(r.found, true);
  const byId = Object.fromEntries((r.nodes ?? []).map((n) => [n.id, n]));
  assert.equal(byId['AC-201-1'].role, 'pivot');
  assert.equal(byId['AC-201-1'].actionNeeded, null);
  assert.equal(byId['US-201'].actionNeeded, 'review-scope');
  assert.equal(byId['REQ-002'].actionNeeded, 'review-scope');
  assert.equal(byId['PRD-001'].actionNeeded, 're-approve');
  assert.equal(byId['TS-042'].actionNeeded, 're-verify');
  assert.equal(byId['TC-042-happy'].actionNeeded, 're-run');
  assert.equal(byId['FBS-014'].actionNeeded, 're-execute');
});

test('impact from REQ: ancestor PRD; descendants US -> AC -> TS -> TC with labels', () => {
  const tree = makeFixture();
  const r = computeImpact(tree, { id: 'REQ-002' });
  const byId = Object.fromEntries((r.nodes ?? []).map((n) => [n.id, n]));
  assert.equal(byId['REQ-002'].role, 'pivot');
  assert.equal(byId['PRD-001'].actionNeeded, 're-approve');
  assert.equal(byId['US-201'].actionNeeded, 'review-scope');
  assert.equal(byId['AC-201-1'].actionNeeded, 're-approve');
  assert.equal(byId['TS-042'].actionNeeded, 're-verify');
});

test('impact from TAC: ancestor TAD; descendants include US via usByTacId + FBS via fan-out', () => {
  const tree = makeFixture();
  const r = computeImpact(tree, { id: 'TAC-005' });
  const byId = Object.fromEntries((r.nodes ?? []).map((n) => [n.id, n]));
  assert.equal(byId['TAC-005'].role, 'pivot');
  assert.equal(byId['TAD-001'].actionNeeded, 'review-arch');
  assert.equal(byId['US-201'].actionNeeded, 'review-scope');
  // FBS-014 references TAC-005 via contextRequirements, so it appears
  // as a descendant. The kind-based rule labels FBS descendants as
  // 're-execute'; the D7 'review-context' label applies to the
  // TAC / ADR direction (which the pivot itself covers).
  assert.equal(byId['FBS-014'].role, 'descendant');
});

test('impact from ADR: ancestor TAD; descendants include FBS via contextRequirements.adrIds', () => {
  const tree = makeFixture();
  const r = computeImpact(tree, { id: 'ADR-003' });
  const byId = Object.fromEntries((r.nodes ?? []).map((n) => [n.id, n]));
  assert.equal(byId['TAD-001'].actionNeeded, 'review-arch');
  assert.ok(byId['FBS-014'], 'FBS-014 should be a descendant via contextRequirements.adrIds');
});

test('impact from FBS: ancestor BS; descendants include dependent FBS via dependentsByFbsId', () => {
  const tree = makeFixture();
  const r = computeImpact(tree, { id: 'FBS-014' });
  const byId = Object.fromEntries((r.nodes ?? []).map((n) => [n.id, n]));
  assert.equal(byId['FBS-014'].role, 'pivot');
  assert.equal(byId['BS-001'].actionNeeded, 'review-plan');
  assert.equal(byId['FBS-015'].actionNeeded, 're-execute');
});

test('impact from TC: ancestors include TS, AC, US, REQ, PRD', () => {
  const tree = makeFixture();
  const r = computeImpact(tree, { id: 'TC-042-happy' });
  const byId = Object.fromEntries((r.nodes ?? []).map((n) => [n.id, n]));
  assert.equal(byId['TC-042-happy'].role, 'pivot');
  assert.equal(byId['TS-042'].actionNeeded, 're-verify');
  assert.equal(byId['AC-201-1'].actionNeeded, 're-approve');
  assert.equal(byId['US-201'].actionNeeded, 'review-scope');
  assert.equal(byId['REQ-002'].actionNeeded, 'review-scope');
  assert.equal(byId['PRD-001'].actionNeeded, 're-approve');
});

test('impact from unknown id returns {found:false}', () => {
  const tree = makeFixture();
  const r = computeImpact(tree, { id: 'REQ-999' });
  assert.equal(r.found, false);
});

test('labelFor: pivot=null, ancestor rules, descendant rules match D7 table', () => {
  assert.equal(labelFor('prd', 'pivot'), null);
  assert.equal(labelFor('prd', 'ancestor'), 're-approve');
  assert.equal(labelFor('tad', 'ancestor'), 'review-arch');
  assert.equal(labelFor('buildSequence', 'ancestor'), 'review-plan');
  assert.equal(labelFor('req', 'descendant'), 'review-scope');
  assert.equal(labelFor('userStory', 'descendant'), 'review-scope');
  assert.equal(labelFor('ac', 'descendant'), 're-approve');
  assert.equal(labelFor('testSuite', 'descendant'), 're-verify');
  assert.equal(labelFor('tc', 'descendant'), 're-run');
  assert.equal(labelFor('fbs', 'descendant'), 're-execute');
  assert.equal(labelFor('tac', 'descendant'), 'review-context');
  assert.equal(labelFor('adr', 'descendant'), 'review-context');
});
