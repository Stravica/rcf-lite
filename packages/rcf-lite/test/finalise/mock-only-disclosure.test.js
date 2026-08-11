// Finalise MOCK-ONLY-DECLARED disclosure + refusal tests
// (verification-integrity-cluster-spec §4.5 finalise text, §5.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findMockOnlyDeclaredAcs,
  reportHasMockOnlyDeclared,
  summariseReport,
} from '../../src/finalise/ingest.js';

test('findMockOnlyDeclaredAcs extracts entries from perAcVerdicts[]', () => {
  const report = {
    verdict: 'PASS',
    verdictAuthority: 'ship',
    perAcVerdicts: [
      { acId: 'AC-101-1', verdict: 'PASS' },
      { acId: 'AC-101-2', verdict: 'MOCK-ONLY-DECLARED', reason: 'no live path' },
      { acId: 'AC-101-3', verdict: 'BLOCKED-BY-DECLARATION' },
    ],
  };
  const declared = findMockOnlyDeclaredAcs(report);
  assert.equal(declared.length, 2);
  assert.deepEqual(declared.map((d) => d.acId).sort(), ['AC-101-2', 'AC-101-3']);
});

test('findMockOnlyDeclaredAcs is graceful when perAcVerdicts is absent (older verify reports)', () => {
  assert.deepEqual(findMockOnlyDeclaredAcs({ verdict: 'PASS' }), []);
  assert.deepEqual(findMockOnlyDeclaredAcs({}), []);
});

test('reportHasMockOnlyDeclared is true iff at least one entry is present', () => {
  assert.equal(reportHasMockOnlyDeclared({}), false);
  assert.equal(reportHasMockOnlyDeclared({ perAcVerdicts: [{ acId: 'AC-1', verdict: 'PASS' }] }), false);
  assert.equal(reportHasMockOnlyDeclared({ perAcVerdicts: [{ acId: 'AC-1', verdict: 'MOCK-ONLY-DECLARED' }] }), true);
});

test('summariseReport surfaces mock-only-declared as a dedicated section on a passing report', () => {
  const report = {
    verdict: 'PASS',
    verdictAuthority: 'ship',
    run: { profile: 'deployed', url: 'https://example.com' },
    findings: [],
    perAcVerdicts: [
      { acId: 'AC-101-2', verdict: 'MOCK-ONLY-DECLARED', reason: 'operator declared mock-only at pre-flight' },
    ],
  };
  const summary = summariseReport(report);
  assert.match(summary, /mock-only declared \(1\)/);
  assert.match(summary, /AC-101-2 \(MOCK-ONLY-DECLARED\)/);
});

test('summariseReport is unchanged (backwards compatible) on a report without perAcVerdicts', () => {
  const report = { verdict: 'PASS', verdictAuthority: 'ship', findings: [] };
  const summary = summariseReport(report);
  assert.equal(summary.includes('mock-only declared'), false);
  assert.match(summary, /verdict: PASS/);
});
