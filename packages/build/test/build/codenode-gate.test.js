// Phase 10 (X2 CodeNode bridge, D17, operator ruling 2026-07-10): unit
// tests for the mark-complete CN gate's pure logic.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkCodeNodeGate, hasNoCodeNodesDeclaration } from '../../src/build/mark.js';

test('checkCodeNodeGate: ok when every AC has at least one implementing CN', () => {
  const tree = { cnByAcId: new Map([['AC-101-1', ['CN-001']], ['AC-101-2', ['CN-002']]]) };
  const fbs = { acIds: ['AC-101-1', 'AC-101-2'] };
  assert.deepEqual(checkCodeNodeGate(tree, fbs), { ok: true });
});

test('checkCodeNodeGate: reports every AC with zero CNs, sorted', () => {
  const tree = { cnByAcId: new Map([['AC-101-1', ['CN-001']]]) };
  const fbs = { acIds: ['AC-101-3', 'AC-101-1', 'AC-101-2'] };
  const result = checkCodeNodeGate(tree, fbs);
  assert.deepEqual(result, { ok: false, missingAcIds: ['AC-101-2', 'AC-101-3'] });
});

test('checkCodeNodeGate: an FBS with no acIds passes vacuously', () => {
  const tree = { cnByAcId: new Map() };
  assert.deepEqual(checkCodeNodeGate(tree, { acIds: [] }), { ok: true });
});

test('hasNoCodeNodesDeclaration: true only when noCodeNodes is exactly true', () => {
  assert.equal(hasNoCodeNodesDeclaration({ noCodeNodes: true }), true);
  assert.equal(hasNoCodeNodesDeclaration({ noCodeNodes: false }), false);
  assert.equal(hasNoCodeNodesDeclaration({}), false);
  assert.equal(hasNoCodeNodesDeclaration(undefined), false);
});
