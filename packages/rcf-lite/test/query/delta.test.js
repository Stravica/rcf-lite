// Unit tests for the detection-model primitives (REQ-172; proposal
// 2026-09-22 §2.2 v3). Pure over hand-built TreeModel fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  canonicaliseJson,
  computeDelta,
  computeTreeHash,
  hashDocument,
} from '../../src/query/delta.js';

function makeTree(entries) {
  const byId = new Map();
  for (const [id, doc] of entries) byId.set(id, doc);
  return { byId };
}

test('delta: canonicaliseJson sorts object keys recursively and strips whitespace', () => {
  const a = { b: 1, a: 2, nested: { z: [3, 2, 1], a: null } };
  const b = { nested: { a: null, z: [3, 2, 1] }, a: 2, b: 1 };
  assert.equal(canonicaliseJson(a), canonicaliseJson(b));
  assert.equal(canonicaliseJson(a), '{"a":2,"b":1,"nested":{"a":null,"z":[3,2,1]}}');
});

test('delta: hashDocument returns a sha256:<64-hex> string over the canonical form', () => {
  const doc = { z: 1, a: [2, 3] };
  const canonical = '{"a":[2,3],"z":1}';
  const expected = `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
  assert.equal(hashDocument(doc), expected);
  assert.match(hashDocument(doc), /^sha256:[0-9a-f]{64}$/);
});

test('delta: hashDocument is invariant under key reorder and whitespace-only reformat', () => {
  const parsed1 = JSON.parse('{"a":1,"b":2,"c":{"x":"y","w":1}}');
  const parsed2 = JSON.parse('{\n  "c": { "w": 1, "x": "y" },\n  "b": 2,\n  "a": 1\n}');
  assert.equal(hashDocument(parsed1), hashDocument(parsed2));
});

test('delta: computeTreeHash is order-independent over the docHashes map', () => {
  const h1 = { 'REQ-002': hashDocument({}), 'REQ-001': hashDocument({}) };
  const h2 = { 'REQ-001': hashDocument({}), 'REQ-002': hashDocument({}) };
  assert.equal(computeTreeHash(h1), computeTreeHash(h2));
  const asMap = new Map(Object.entries(h2));
  assert.equal(computeTreeHash(asMap), computeTreeHash(h1));
});

test('delta: unfrozen tree returns every id in added with frozen:false', () => {
  const tree = makeTree([
    ['PRD-001', { prdId: 'PRD-001' }],
    ['REQ-001', { reqId: 'REQ-001', prdId: 'PRD-001' }],
  ]);
  const d = computeDelta(tree, null);
  assert.equal(d.frozen, false);
  assert.equal(d.frozenAt, null);
  assert.equal(d.treeHash, null);
  assert.match(d.currentTreeHash, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(d.added, ['PRD-001', 'REQ-001']);
  assert.deepEqual(d.changed, []);
  assert.deepEqual(d.removed, []);
  assert.deepEqual(d.briefSince, []);
  assert.equal(d.unchanged, 0);
});

test('delta: unfrozen tree with ledgers records ledger:<name> docHashes in added', () => {
  const tree = makeTree([['PRD-001', { prdId: 'PRD-001' }]]);
  const d = computeDelta(tree, null, { brief: { statements: [] } });
  assert.deepEqual(d.added, ['PRD-001', 'ledger:brief']);
});

test('delta: an unchanged tree against a matching freeze reports empty changed/added/removed', () => {
  const tree = makeTree([
    ['PRD-001', { prdId: 'PRD-001', v: 1 }],
    ['REQ-001', { reqId: 'REQ-001', v: 1 }],
  ]);
  const docHashes = {
    'PRD-001': hashDocument({ prdId: 'PRD-001', v: 1 }),
    'REQ-001': hashDocument({ reqId: 'REQ-001', v: 1 }),
  };
  const freeze = {
    frozenAt: '2026-09-20T14:00:00Z',
    treeHash: computeTreeHash(docHashes),
    docHashes,
    briefStatements: 0,
  };
  const d = computeDelta(tree, freeze);
  assert.equal(d.frozen, true);
  assert.equal(d.frozenAt, '2026-09-20T14:00:00Z');
  assert.equal(d.treeHash, freeze.treeHash);
  assert.equal(d.currentTreeHash, freeze.treeHash);
  assert.deepEqual(d.changed, []);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed, []);
  assert.equal(d.unchanged, 2);
});

test('delta: changed / added / removed classify against the freeze record', () => {
  const frozenPrd = { prdId: 'PRD-001', v: 1 };
  const frozenReq = { reqId: 'REQ-001', v: 1 };
  const frozenGone = { reqId: 'REQ-002', v: 1 };
  const docHashes = {
    'PRD-001': hashDocument(frozenPrd),
    'REQ-001': hashDocument(frozenReq),
    'REQ-002': hashDocument(frozenGone),
  };
  const tree = makeTree([
    ['PRD-001', frozenPrd], // unchanged
    ['REQ-001', { reqId: 'REQ-001', v: 2 }], // changed
    ['REQ-003', { reqId: 'REQ-003' }], // added
    // REQ-002 removed
  ]);
  const freeze = {
    frozenAt: '2026-09-20T14:00:00Z',
    treeHash: computeTreeHash(docHashes),
    docHashes,
    briefStatements: 0,
  };
  const d = computeDelta(tree, freeze);
  assert.deepEqual(d.changed, ['REQ-001']);
  assert.deepEqual(d.added, ['REQ-003']);
  assert.deepEqual(d.removed, ['REQ-002']);
  assert.equal(d.unchanged, 1);
  assert.notEqual(d.currentTreeHash, d.treeHash);
});

test('delta: briefSince names statement ids above briefStatements high-water mark', () => {
  const tree = makeTree([]);
  const brief = {
    statements: [
      { id: 1, text: 'x' },
      { id: 2, text: 'y' },
      { id: 3, text: 'z' },
    ],
  };
  const freeze = {
    frozenAt: '2026-09-20T14:00:00Z',
    treeHash: computeTreeHash({}),
    docHashes: {},
    briefStatements: 1,
  };
  const d = computeDelta(tree, freeze, { brief });
  assert.deepEqual(d.briefSince, [2, 3]);
});

test('delta: a whitespace-only reformat of a document produces zero changed ids', () => {
  const parsed = { prdId: 'PRD-001', body: { list: [1, 2, 3] } };
  const docHashes = { 'PRD-001': hashDocument(parsed) };
  const freeze = {
    frozenAt: '2026-09-20T14:00:00Z',
    treeHash: computeTreeHash(docHashes),
    docHashes,
    briefStatements: 0,
  };
  // Reformatted (key order changed, added optional undefined key which
  // canonicaliseJson drops): should still hash identically.
  const reformatted = {
    body: { list: [1, 2, 3] },
    prdId: 'PRD-001',
    /** @type {any} */ ghost: undefined,
  };
  const tree = makeTree([['PRD-001', reformatted]]);
  const d = computeDelta(tree, freeze);
  assert.deepEqual(d.changed, []);
  assert.deepEqual(d.added, []);
  assert.equal(d.unchanged, 1);
});
