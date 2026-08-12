// 0.8.0 slug-train car 4: SCOPE-MISMATCH ingestion tests.
// NV-BL-GATE-01 pulls verify's profile-vs-AC scope-mismatch check into
// REVIEW; REVIEW consumes the same shape via findScopeMismatchAcs /
// reportHasScopeMismatch. Finalise surfaces the mismatches alongside
// the 0.7.0 mock-only-declared section.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findScopeMismatchAcs,
  reportHasScopeMismatch,
  summariseReport,
} from '../../src/finalise/ingest.js';

test('findScopeMismatchAcs extracts SCOPE-MISMATCH entries only', () => {
  const report = {
    verdict: 'PASS',
    perAcVerdicts: [
      { acId: 'AC-101-1', verdict: 'PASS' },
      { acId: 'AC-101-2', verdict: 'MOCK-ONLY-DECLARED' },
      { acId: 'AC-101-3', verdict: 'SCOPE-MISMATCH', reason: 'library TC on runtime AC' },
      { acId: 'AC-101-4', verdict: 'SCOPE-MISMATCH' },
    ],
  };
  const mismatches = findScopeMismatchAcs(report);
  assert.equal(mismatches.length, 2);
  assert.deepEqual(mismatches.map((m) => m.acId).sort(), ['AC-101-3', 'AC-101-4']);
});

test('findScopeMismatchAcs is graceful when perAcVerdicts is absent', () => {
  assert.deepEqual(findScopeMismatchAcs({}), []);
  assert.deepEqual(findScopeMismatchAcs({ verdict: 'PASS' }), []);
});

test('reportHasScopeMismatch is true iff at least one SCOPE-MISMATCH entry is present', () => {
  assert.equal(reportHasScopeMismatch({}), false);
  assert.equal(reportHasScopeMismatch({ perAcVerdicts: [{ acId: 'AC-1', verdict: 'PASS' }] }), false);
  assert.equal(reportHasScopeMismatch({ perAcVerdicts: [{ acId: 'AC-1', verdict: 'SCOPE-MISMATCH' }] }), true);
});

test('summariseReport surfaces scope-mismatches as a dedicated section', () => {
  const report = {
    verdict: 'PASS',
    verdictAuthority: 'correctness',
    findings: [],
    perAcVerdicts: [
      { acId: 'AC-101-3', verdict: 'SCOPE-MISMATCH', reason: 'library TC on runtime AC' },
    ],
  };
  const summary = summariseReport(report);
  assert.match(summary, /scope mismatches \(1\)/);
  assert.match(summary, /AC-101-3 \(SCOPE-MISMATCH\)/);
  assert.match(summary, /library TC on runtime AC/);
});

test('summariseReport is silent on scope-mismatches when none are present (backwards-compatible)', () => {
  const report = { verdict: 'PASS', findings: [] };
  const summary = summariseReport(report);
  assert.equal(summary.includes('scope mismatches'), false);
});
