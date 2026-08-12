// 0.8.0 slug-train car 4 (NV-BL-GATE-01, NV-BL-ADM-03): SCOPE-MISMATCH
// per-AC verdict. Verify pulls the profile-vs-AC scope-mismatch check
// out of finalise and emits it on the same perAcVerdicts[] array as
// the 0.7.0 classes, so REVIEW consumes one shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  derivePerAcVerdicts,
  scopePerAcVerdict,
} from '../../../src/verify/verdict/index.js';

test('scopePerAcVerdict: a library-scope TC bound to a runtime-scope AC surfaces SCOPE-MISMATCH', () => {
  const v = scopePerAcVerdict({
    acId: 'AC-101-1',
    scope: 'runtime',
    boundTcs: [{ tsId: 'TS-001', tcId: 'TC-001-fixture', scope: 'library' }],
  });
  assert.ok(v);
  assert.equal(v.verdict, 'SCOPE-MISMATCH');
  assert.match(v.reason, /AC-101-1/);
  assert.match(v.reason, /narrower/);
  assert.match(v.reason, /TC-001-fixture on TS-001/);
});

test('scopePerAcVerdict: at least one TC at or above the AC scope clears the AC', () => {
  const v = scopePerAcVerdict({
    acId: 'AC-101-1',
    scope: 'runtime',
    boundTcs: [
      { tsId: 'TS-001', tcId: 'TC-001-fixture', scope: 'library' },
      { tsId: 'TS-002', tcId: 'TC-002-boot', scope: 'runtime' },
    ],
  });
  assert.equal(v, null, 'a wider or equal TC on the same AC clears the mismatch');
});

test('scopePerAcVerdict: a deployed-scope TC covering a runtime-scope AC is fine (wider is admissible)', () => {
  const v = scopePerAcVerdict({
    acId: 'AC-101-1',
    scope: 'runtime',
    boundTcs: [{ tsId: 'TS-003', tcId: 'TC-003-deployed', scope: 'deployed' }],
  });
  assert.equal(v, null);
});

test('scopePerAcVerdict: an AC with no scope tag is silent (NV-BL-ADM-02 catches it at admissibility)', () => {
  const v = scopePerAcVerdict({
    acId: 'AC-101-1',
    boundTcs: [{ tsId: 'TS-001', tcId: 'TC-001-x', scope: 'library' }],
  });
  assert.equal(v, null);
});

test('scopePerAcVerdict: a TC with no declared scope tag does not fire the mismatch (bootstrap tolerance)', () => {
  // The bootstrap window (rcf-lite ruleset v1) tolerates TCs with no
  // scope tag; the admissibility lint (NV-BL-ADM-03) is the mechanical
  // gate for that class. Verify's per-AC verdict is silent so it does
  // not double-emit against the same defect.
  const v = scopePerAcVerdict({
    acId: 'AC-101-1',
    scope: 'runtime',
    boundTcs: [{ tsId: 'TS-001', tcId: 'TC-001-untagged' }],
  });
  assert.equal(v, null);
});

test('scopePerAcVerdict: an AC with no bound TCs is silent (coverage handles that class)', () => {
  const v = scopePerAcVerdict({
    acId: 'AC-101-1',
    scope: 'runtime',
    boundTcs: [],
  });
  assert.equal(v, null);
});

test('derivePerAcVerdicts emits SCOPE-MISMATCH alongside the 0.7.0 classes when both apply', () => {
  const acs = [
    {
      acId: 'AC-101-1',
      scope: 'runtime',
      boundTcs: [{ tsId: 'TS-001', tcId: 'TC-001-fixture', scope: 'library' }],
      serviceAttestations: [{ serviceId: 'resend', attestationMode: 'mocked' }],
      fbsUiBearing: false,
      fbsIds: [],
    },
  ];
  const out = derivePerAcVerdicts({ acs });
  const verdicts = out.map((e) => e.verdict).sort();
  assert.ok(verdicts.includes('MOCK-ONLY-DECLARED'), 'should still emit MOCK-ONLY-DECLARED');
  assert.ok(verdicts.includes('SCOPE-MISMATCH'), 'should also emit SCOPE-MISMATCH');
});
