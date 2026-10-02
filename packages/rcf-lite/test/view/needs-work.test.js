// Viewer UI refresh PR 3: unit coverage for the needs-work helper.
// The helper reads the readiness result the server already carries on
// `model.readiness` and returns a Set of REQ ids that still need PO
// work. Decision 14 (two audiences): the Requirements tab's engineer-
// facing Needs-work chip reuses this same set, so a product-owner and
// an engineer looking at the same tree see the same "still needs
// work" requirements.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeReqNeedsWorkIds, needsWorkReasonFor } from '../../src/view/needs-work.js';

function makeReadiness(blockers) {
  return {
    levels: {
      intentComplete: { ok: false, blockedBy: blockers, nextAction: null },
      readyToBuild: { ok: false, blockedBy: [], nextAction: null },
    },
  };
}

test('needs-work: returns an empty set when readiness is null or has no blockers', () => {
  assert.equal(computeReqNeedsWorkIds(null).size, 0);
  assert.equal(computeReqNeedsWorkIds(undefined).size, 0);
  assert.equal(computeReqNeedsWorkIds(makeReadiness([])).size, 0);
});

test('needs-work: collects REQ ids from skeleton:reqIntent blockers', () => {
  const r = makeReadiness([
    { check: 'skeleton:reqIntent', ids: ['REQ-003', 'REQ-040'] },
  ]);
  const ids = computeReqNeedsWorkIds(r);
  assert.ok(ids.has('REQ-003'));
  assert.ok(ids.has('REQ-040'));
  assert.equal(ids.size, 2);
});

test('needs-work: collects REQ ids from stories:reqHasUs blockers', () => {
  const r = makeReadiness([
    { check: 'stories:reqHasUs', ids: ['REQ-100'] },
  ]);
  const ids = computeReqNeedsWorkIds(r);
  assert.ok(ids.has('REQ-100'));
});

test('needs-work: picks up REQ ids inside skeleton:resolvedBy suggestions', () => {
  const r = makeReadiness([
    { check: 'skeleton:resolvedBy', ids: ['SK-7', 'REQ-050'] },
  ]);
  const ids = computeReqNeedsWorkIds(r);
  assert.ok(ids.has('REQ-050'));
  assert.ok(!ids.has('SK-7'));
});

test('needs-work: ignores unrelated checks', () => {
  const r = makeReadiness([
    { check: 'decisions:wellFormed', ids: ['REQ-999'] },
    { check: 'brief:openQuestions', ids: ['REQ-888'] },
  ]);
  const ids = computeReqNeedsWorkIds(r);
  assert.equal(ids.size, 0);
});

test('needs-work: deduplicates when the same REQ appears in multiple checks', () => {
  const r = makeReadiness([
    { check: 'skeleton:reqIntent', ids: ['REQ-003'] },
    { check: 'stories:reqHasUs', ids: ['REQ-003'] },
  ]);
  const ids = computeReqNeedsWorkIds(r);
  assert.equal(ids.size, 1);
  assert.ok(ids.has('REQ-003'));
});

test('needsWorkReasonFor: returns a short engineer-plain reason per check', () => {
  const r = makeReadiness([
    { check: 'skeleton:reqIntent', ids: ['REQ-003'] },
    { check: 'stories:reqHasUs', ids: ['REQ-003'] },
  ]);
  const reason = needsWorkReasonFor(r, 'REQ-003');
  assert.ok(reason);
  assert.match(reason, /description|domain/);
  assert.match(reason, /story/);
});

test('needsWorkReasonFor: null for a REQ not in the set', () => {
  const r = makeReadiness([{ check: 'skeleton:reqIntent', ids: ['REQ-003'] }]);
  assert.equal(needsWorkReasonFor(r, 'REQ-999'), null);
  assert.equal(needsWorkReasonFor(null, 'REQ-003'), null);
});
