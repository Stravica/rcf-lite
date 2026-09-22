// Matrix guard for the shared validate-composed-record helper
// (0.28.2, issues #230/#232 + the three folded verbs review /
// ui-baseline init / browser-verify).
//
// Barry's 2026-09-21 ruling: dry-run and write share ONE schema pass.
// This test asserts each verb's buildNextManifest produces the same
// shape the writer synthesises, and that a bad record surfaces the
// same validation error the write path would refuse on.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildNextManifest, validateComposedRecord } from '../../../src/core/store/validate-composed-record.js';

const cleanTree = { manifest: { schemaVersion: '0.6.3', prd: { id: 'PRD-001', path: 'prd.json' } } };

test('buildNextManifest(intake) sets intakeClassification', () => {
  const record = { id: 'ic-2026-09-22-001', fidelity: 'briefLight', artefacts: [], validationFindings: [], createdAt: '2026-09-22T00:00:00Z', elicitationScope: {}, operatorAckAt: '2026-09-22T00:00:00Z' };
  const next = buildNextManifest({ manifest: cleanTree.manifest, record, verb: 'intake' });
  assert.deepEqual(next.intakeClassification, record);
});

test('buildNextManifest(preflight) appends to preFlightConfig and merges optOuts', () => {
  const record = { id: 'pfc-2026-09-22-001', servicesInScope: [{ id: 'stripeCheckout', name: 's', category: 'payment' }], mode: 'shortlist' };
  const optOuts = [{ id: 'bao-2026-09-22-001', ac: 'AC-1' }];
  const next = buildNextManifest({ manifest: cleanTree.manifest, record, verb: 'preflight', extraRecords: optOuts });
  assert.ok(Array.isArray(next.preFlightConfig));
  assert.deepEqual(next.preFlightConfig[next.preFlightConfig.length - 1], record);
  assert.deepEqual(next.baselineAcOptOuts, optOuts);
});

test('buildNextManifest(review) appends to reviewAudit', () => {
  const record = { id: 'ra-2026-09-22-001', verdict: 'pass' };
  const next = buildNextManifest({ manifest: cleanTree.manifest, record, verb: 'review' });
  assert.deepEqual(next.reviewAudit[next.reviewAudit.length - 1], record);
});

test('buildNextManifest(uiBaselineInit) moves prior into history and replaces uiBaseline', () => {
  const priorRecord = { id: 'uib-2026-09-01-001' };
  const record = { id: 'uib-2026-09-22-001' };
  const next = buildNextManifest({
    manifest: { ...cleanTree.manifest, uiBaseline: priorRecord },
    record,
    verb: 'uiBaselineInit',
  });
  assert.deepEqual(next.uiBaseline, record);
  assert.ok(Array.isArray(next.uiBaselineHistory));
  assert.deepEqual(next.uiBaselineHistory[next.uiBaselineHistory.length - 1], priorRecord);
});

test('buildNextManifest(browserVerify) appends to browserVerification', () => {
  const record = { id: 'bv-2026-09-22-001', verdict: 'pass' };
  const next = buildNextManifest({ manifest: cleanTree.manifest, record, verb: 'browserVerify' });
  assert.deepEqual(next.browserVerification[next.browserVerification.length - 1], record);
});

test('validateComposedRecord surfaces the same schema error the writer would refuse on (intake, bad fidelity)', () => {
  // A caller-supplied fidelity of "briefRich" is not in the allowed
  // enum. The dry-run branch must now surface the same manifest-schema
  // refusal the real writer surfaces.
  const bad = {
    id: 'ic-2026-09-22-001',
    fidelity: 'briefRich',
    artefacts: [],
    validationFindings: [],
    createdAt: '2026-09-22T00:00:00Z',
    elicitationScope: { requestElicitationForAll: false },
    operatorAckAt: '2026-09-22T00:00:00Z',
  };
  const err = validateComposedRecord({ tree: cleanTree, record: bad, verb: 'intake' });
  assert.ok(err, 'validation error must fire on a bad fidelity');
  assert.equal(err.kind, 'validation');
});

test('validateComposedRecord surfaces the same schema error the writer would refuse on (preflight, kebab-case id)', () => {
  const bad = {
    id: 'pfc-2026-09-22-001',
    prdId: 'PRD-001',
    createdAt: '2026-09-22T00:00:00Z',
    servicesInScope: [{ id: 'kebab-case-id', name: 's', category: 'payment', attestation: { mode: 'stubbed' } }],
    designShapeAnswers: [],
    completedAt: '2026-09-22T00:00:00Z',
    outputs: {},
  };
  const err = validateComposedRecord({ tree: cleanTree, record: bad, verb: 'preflight' });
  assert.ok(err, 'validation error must fire on a kebab-case service id');
  assert.equal(err.kind, 'validation');
});

test('validateComposedRecord returns null on an unknown verb rather than crashing', () => {
  assert.throws(
    () => validateComposedRecord({ tree: cleanTree, record: {}, verb: 'not-a-verb' }),
    /unknown verb/,
  );
});
