// Phase 10 (X2 CodeNode bridge): computeTrace tests for the code layer.
// D9: --to-code is opt-in on forward/both; spec-only forward traces must be
// byte-identical whether includeCode is passed or not, when no CN edges
// exist. D10: CN is a uniform pivot (forward = dependents blast radius,
// backward = CN -> AC -> US -> REQ -> PRD).

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

  // PRD-001 -> REQ-002 -> US-201 -> AC-201-1 -> CN-001 -> CN-002 (dependent)
  link('prd', 'PRD-001');
  link('req', 'REQ-002', { reqId: 'REQ-002', prdId: 'PRD-001' });
  link('userStory', 'US-201', {
    usId: 'US-201', reqId: 'REQ-002',
    acceptanceCriteria: [{ id: 'AC-201-1' }],
  });
  chain('REQ-002', 'PRD-001');
  chain('US-201', 'REQ-002');
  parentByChild.set('AC-201-1', 'US-201');

  link('codeNode', 'CN-001', { cnId: 'CN-001', path: 'src/a.js', implementsAcIds: ['AC-201-1'], dependencies: [] });
  link('codeNode', 'CN-002', { cnId: 'CN-002', path: 'src/b.js', implementsAcIds: [], dependencies: ['CN-001'] });
  mapPush(cnByAcId, 'AC-201-1', 'CN-001');
  mapPush(dependentsByCnId, 'CN-001', 'CN-002');

  return {
    kindById, byId, parentByChild, childrenByParent,
    tsByAcId, tcsByAcId, fbsByAcId, usByTacId, dependentsByFbsId,
    cnByAcId, dependentsByCnId,
  };
}

test('kindOf resolves a codeNode id', () => {
  const tree = makeFixture();
  assert.equal(kindOf(tree, 'CN-001'), 'codeNode');
});

test('D9: forward trace from AC without --to-code does not reach the code layer (byte-identical default)', () => {
  const tree = makeFixture();
  const result = computeTrace(tree, { id: 'AC-201-1', direction: 'forward' });
  assert.ok(!result.nodes.some((n) => n.kind === 'codeNode'), 'CN nodes must not leak in without includeCode');
});

test('D9: forward trace from AC with includeCode=true reaches implementing + transitively dependent CNs', () => {
  const tree = makeFixture();
  const result = computeTrace(tree, { id: 'AC-201-1', direction: 'forward', includeCode: true });
  const ids = result.nodes.map((n) => n.id);
  assert.ok(ids.includes('CN-001'));
  assert.ok(ids.includes('CN-002'), 'transitive dependent should be reached');
  const edge = result.edges.find((e) => e.from === 'AC-201-1' && e.to === 'CN-001');
  assert.equal(edge.kind, 'crossLink');
});

test('D10: CN is a uniform forward pivot - dependency blast radius via dependentsByCnId', () => {
  const tree = makeFixture();
  const result = computeTrace(tree, { id: 'CN-001', direction: 'forward', includeCode: true });
  assert.ok(result.found);
  assert.ok(result.nodes.some((n) => n.id === 'CN-002'));
});

test('D10: CN forward without includeCode returns no code-layer fan-out (still byte-identical default)', () => {
  const tree = makeFixture();
  const result = computeTrace(tree, { id: 'CN-001', direction: 'forward' });
  assert.deepEqual(result.nodes.map((n) => n.id), ['CN-001']);
});

test('D9/D10: backward trace from a CN pivot walks CN -> AC -> US -> REQ -> PRD', () => {
  const tree = makeFixture();
  const result = computeTrace(tree, { id: 'CN-001', direction: 'back' });
  const ids = result.nodes.map((n) => n.id);
  assert.deepEqual(ids, ['CN-001', 'AC-201-1', 'US-201', 'REQ-002', 'PRD-001']);
  const crossLink = result.edges.find((e) => e.kind === 'crossLink');
  assert.deepEqual(crossLink, { from: 'CN-001', to: 'AC-201-1', kind: 'crossLink' });
});

test('backward trace from an orphan CN (empty implementsAcIds) returns only the pivot', () => {
  const tree = makeFixture();
  const result = computeTrace(tree, { id: 'CN-002', direction: 'back' });
  assert.deepEqual(result.nodes.map((n) => n.id), ['CN-002']);
});
