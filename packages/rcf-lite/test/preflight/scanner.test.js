// Pre-flight scanner unit tests
// (verification-integrity-cluster-spec §4.3, §4.4, §5.3).
//
// The load-bearing property: matchServiceSignals is IMPORTED from core,
// never re-implemented, so the "email channel" miss d-142 identified
// cannot recur from regex drift. These tests use tightly-crafted
// prose fixtures and assert on the shape the scanner packages, not on
// the seed pattern set itself (that lives in core with its own tests).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scanForServiceCandidates } from '../../src/preflight/scanner.js';

function buildTreeFixture({ prdProse, tadProse }) {
  const prd = {
    prdId: 'PRD-001',
    title: 'Test PRD',
    problem: 'A problem statement',
    intent: prdProse ?? '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const tad = tadProse
    ? {
        tadId: 'TAD-001',
        prdId: 'PRD-001',
        title: 'Test TAD',
        summary: tadProse,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }
    : null;
  return {
    manifest: {},
    prd,
    tad,
    byId: new Map([['PRD-001', prd], ...(tad ? [['TAD-001', tad]] : [])]),
    requirements: [],
  };
}

test('scanner catches "email channel" (the d-142 miss) as an emailDelivery candidate', () => {
  const tree = buildTreeFixture({
    prdProse: 'This product ships outbound recovery notifications via an email channel provider.',
  });
  const result = scanForServiceCandidates({ tree, prdId: 'PRD-001' });
  const email = result.candidates.find((c) => c.category === 'emailDelivery');
  assert.notEqual(email, undefined, 'emailDelivery candidate expected');
  const matched = email.sourceRefs.map((r) => r.phrase.toLowerCase());
  assert.equal(matched.includes('email'), true, `expected 'email' among matched phrases, got ${matched.join(',')}`);
});

test('scanner promotes a vendor-role hit into the candidate name', () => {
  // Payment category enumerates vendors separately (§4.4), so a
  // vendor-role hit is what promotes the candidate id. Resend sits in
  // the emailDelivery tokens list, not the vendors list, so the same
  // trick does not apply there — Stripe is the honest vendor-promotion
  // fixture.
  const tree = buildTreeFixture({
    prdProse: 'The billing surface hands off to Stripe for the invoice charge.',
  });
  const result = scanForServiceCandidates({ tree, prdId: 'PRD-001' });
  const payment = result.candidates.find((c) => c.category === 'payment');
  assert.notEqual(payment, undefined);
  assert.equal(payment.id, 'stripe', `expected id to promote to 'stripe', got '${payment.id}'`);
});

test('scanner deduplicates candidates by category and preserves seed-set order', () => {
  const tree = buildTreeFixture({
    prdProse: 'Feature-flag provider; then a payment gateway; then an oauth provider.',
  });
  const result = scanForServiceCandidates({ tree, prdId: 'PRD-001' });
  const categories = result.candidates.map((c) => c.category);
  // Seed-set order per §4.4: emailDelivery, payment, smsVoice, auth,
  // storageCdn, llmAi, analyticsTelemetry, featureFlags, search. So
  // payment before auth before featureFlags in the output.
  const paymentIdx = categories.indexOf('payment');
  const authIdx = categories.indexOf('auth');
  const flagsIdx = categories.indexOf('featureFlags');
  assert.notEqual(paymentIdx, -1);
  assert.notEqual(authIdx, -1);
  assert.notEqual(flagsIdx, -1);
  assert.equal(paymentIdx < authIdx, true, 'payment before auth');
  assert.equal(authIdx < flagsIdx, true, 'auth before featureFlags');
});

test('scanner records TAD hits alongside PRD hits when a TAD id is supplied', () => {
  const tree = buildTreeFixture({
    prdProse: 'Outbound recovery emails.',
    tadProse: 'The dispatch flow imports the Resend SDK and reads RESEND_API_KEY.',
  });
  const result = scanForServiceCandidates({ tree, prdId: 'PRD-001', tadId: 'TAD-001' });
  const email = result.candidates.find((c) => c.category === 'emailDelivery');
  const docs = new Set(email.sourceRefs.map((r) => r.docId));
  assert.equal(docs.has('PRD-001'), true);
  assert.equal(docs.has('TAD-001'), true);
});

test('scanner reports skipped ids when the tree does not contain them', () => {
  const tree = buildTreeFixture({ prdProse: 'nothing to see here' });
  const result = scanForServiceCandidates({ tree, prdId: 'PRD-001', tadId: 'TAD-999' });
  assert.deepEqual(result.skippedDocIds, ['TAD-999']);
});
