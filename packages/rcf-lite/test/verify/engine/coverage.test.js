// ADR-4147 / ADR-4112 scoped coverage reconciliation (pure unit tests).
// A scoped criterion with no finding is recorded as blocked (noFinding);
// a finding outside the scope is ignored and noted; a criterion already
// blocked (provisioning, deterministic skip) is not recorded twice; a
// non-testable criterion is not expected to carry a finding.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reconcileScopedCoverage, NO_FINDING_REASON } from '../../../src/verify/engine/coverage.js';

const acs = [
  { acId: 'AC-1', testable: true },
  { acId: 'AC-2', testable: true },
  { acId: 'AC-3', testable: true },
  { acId: 'AC-4', testable: false },
];
const finding = (acId, severity = 'PASS') => ({ severity, acId, journey: acId, reproSteps: [], evidence: { kind: 'note', detail: 'ok' } });

test('reconcileScopedCoverage: a scoped criterion with no finding is blocked with reason noFinding', () => {
  const out = reconcileScopedCoverage({ acs, findings: [finding('AC-1'), finding('AC-3')], blockedAcs: [], mode: 'agentScreenshotCritique' });
  assert.deepEqual(out.findings.map((f) => f.acId), ['AC-1', 'AC-3']);
  assert.deepEqual(out.blockedAcs, [{ acId: 'AC-2', reason: NO_FINDING_REASON, mode: 'agentScreenshotCritique' }]);
  assert.deepEqual(out.coverage, { expected: 3, found: 2, missing: ['AC-2'], ignored: [] });
});

test('reconcileScopedCoverage: a finding outside the scope is dropped from the verdict set and noted', () => {
  const out = reconcileScopedCoverage({ acs, findings: [finding('AC-1'), finding('AC-2'), finding('AC-3'), finding('AC-99', 'BROKEN')], blockedAcs: [] });
  assert.deepEqual(out.findings.map((f) => f.acId), ['AC-1', 'AC-2', 'AC-3']);
  assert.deepEqual(out.blockedAcs, []);
  assert.deepEqual(out.coverage.ignored, [{ acId: 'AC-99', severity: 'BROKEN' }]);
  assert.deepEqual(out.coverage.missing, []);
});

test('reconcileScopedCoverage: an already blocked criterion is kept once and a non-testable one is not expected', () => {
  const prior = [{ acId: 'AC-2', reason: 'cannot provision: no signup route' }];
  const out = reconcileScopedCoverage({ acs, findings: [finding('AC-1')], blockedAcs: prior, mode: 'deterministic' });
  assert.deepEqual(out.blockedAcs.map((b) => b.acId), ['AC-2', 'AC-3']);
  assert.equal(out.blockedAcs[0].reason, prior[0].reason);
  assert.deepEqual(out.blockedAcs[1], { acId: 'AC-3', reason: NO_FINDING_REASON, mode: 'deterministic' });
  assert.deepEqual(out.coverage, { expected: 3, found: 1, missing: ['AC-3'], ignored: [] });
});

test('reconcileScopedCoverage: no findings at all blocks every scoped testable criterion', () => {
  const out = reconcileScopedCoverage({ acs, findings: [], blockedAcs: [] });
  assert.deepEqual(out.blockedAcs.map((b) => b.acId), ['AC-1', 'AC-2', 'AC-3']);
  assert.equal(out.coverage.found, 0);
});
