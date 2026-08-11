// Phase 10 (X2 CodeNode bridge): computeImpact + labelFor tests for the
// code layer (spec D9/D11 re-verify-code action label).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeImpact, labelFor } from '../../src/query/impact.js';

function makeFixture() {
  const kindById = new Map();
  const byId = new Map();
  const parentByChild = new Map();
  const childrenByParent = new Map();
  const cnByAcId = new Map();
  const dependentsByCnId = new Map();

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
  link('userStory', 'US-201', { usId: 'US-201', reqId: 'REQ-002', acceptanceCriteria: [{ id: 'AC-201-1' }] });
  chain('REQ-002', 'PRD-001');
  chain('US-201', 'REQ-002');
  parentByChild.set('AC-201-1', 'US-201');

  link('codeNode', 'CN-001', { cnId: 'CN-001', path: 'src/a.js', implementsAcIds: ['AC-201-1'], dependencies: [] });
  mapPush(cnByAcId, 'AC-201-1', 'CN-001');

  return {
    kindById, byId, parentByChild, childrenByParent,
    tsByAcId: new Map(), tcsByAcId: new Map(), fbsByAcId: new Map(), usByTacId: new Map(), dependentsByFbsId: new Map(),
    cnByAcId, dependentsByCnId,
  };
}

test('labelFor: descendant codeNode maps to re-verify-code', () => {
  assert.equal(labelFor('codeNode', 'descendant'), 're-verify-code');
});

test('computeImpact with includeCode=true surfaces the implementing CN as a descendant with re-verify-code', () => {
  const tree = makeFixture();
  const result = computeImpact(tree, { id: 'AC-201-1', includeCode: true });
  const cnNode = result.nodes.find((n) => n.id === 'CN-001');
  assert.ok(cnNode, JSON.stringify(result.nodes));
  assert.equal(cnNode.role, 'descendant');
  assert.equal(cnNode.actionNeeded, 're-verify-code');
});

test('computeImpact without includeCode omits the code layer entirely (byte-identical default, D9)', () => {
  const tree = makeFixture();
  const result = computeImpact(tree, { id: 'AC-201-1' });
  assert.ok(!result.nodes.some((n) => n.kind === 'codeNode'));
});
