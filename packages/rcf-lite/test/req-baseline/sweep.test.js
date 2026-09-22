// 0.28.2 (issue #231) tests for req-baseline sweep AC-id allocation.
//
// Barry's WSD dogfood: `rcf discover req-baseline sweep --yes` on a
// story with two or more open candidates assigned every accepted
// candidate the identical `AC-<usNum>-<maxN+1>` and the writer's
// post-write validation refused the tree with a duplicate-id
// breakage. Ordinal allocation is now monotone across a batch via a
// closure seeded once per US.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeBaselineAc, makeAcIdAllocator } from '../../src/req-baseline/sweep.js';

function stubUsDoc(overrides = {}) {
  return {
    usId: 'US-1301',
    acceptanceCriteria: [
      { id: 'AC-1301-1', description: 'first' },
      { id: 'AC-1301-9', description: 'ninth' },
    ],
    ...overrides,
  };
}

function stubCandidate(baselineKey) {
  return {
    baselineKey,
    reqShape: 'logging',
    canonicalText: `Given X, when Y ${baselineKey}, then Z.`,
    given: 'X',
    when: `Y ${baselineKey}`,
    then: 'Z',
  };
}

test('makeAcIdAllocator seeds from the current maxN and increments across a batch (0.28.2 #231)', () => {
  const usDoc = stubUsDoc();
  const alloc = makeAcIdAllocator(usDoc);
  assert.equal(alloc(), 'AC-1301-10');
  assert.equal(alloc(), 'AC-1301-11');
  assert.equal(alloc(), 'AC-1301-12');
});

test('composeBaselineAc honours an idOverride (the per-US allocator handoff, 0.28.2 #231)', () => {
  const usDoc = stubUsDoc();
  const now = new Date('2026-09-22T12:00:00.000Z');
  const a = composeBaselineAc({ usDoc, candidate: stubCandidate('one'), now, idOverride: 'AC-1301-10' });
  const b = composeBaselineAc({ usDoc, candidate: stubCandidate('two'), now, idOverride: 'AC-1301-11' });
  const c = composeBaselineAc({ usDoc, candidate: stubCandidate('three'), now, idOverride: 'AC-1301-12' });
  assert.equal(a.id, 'AC-1301-10');
  assert.equal(b.id, 'AC-1301-11');
  assert.equal(c.id, 'AC-1301-12');
  const ids = new Set([a.id, b.id, c.id]);
  assert.equal(ids.size, 3, 'three accept decisions on one US must yield three distinct AC ids');
});

test('composeBaselineAc without an idOverride still returns a well-formed AC-<usNum>-<n> id (backwards-compatible callers)', () => {
  const usDoc = stubUsDoc();
  const now = new Date('2026-09-22T12:00:00.000Z');
  const a = composeBaselineAc({ usDoc, candidate: stubCandidate('lone'), now });
  assert.match(a.id, /^AC-1301-\d+$/);
});

test('makeAcIdAllocator on a US with no hierarchical AC ids starts at 1', () => {
  const usDoc = { usId: 'US-1302', acceptanceCriteria: [{ id: 'legacy-1', description: 'not-hier' }] };
  const alloc = makeAcIdAllocator(usDoc);
  assert.equal(alloc(), 'AC-1302-1');
  assert.equal(alloc(), 'AC-1302-2');
});
