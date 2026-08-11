// Per-AC verdict tests for the 0.7.0 train
// (verification-integrity-cluster-spec §5.2, ui-design-gate-0.7.0-spec §8.7).
//
// The four new verdict classes ride on report.perAcVerdicts[]; the
// finalise gate (packages/rcf-lite/src/finalise/ingest.js) reads that array
// and refuses `verified` on any MOCK-ONLY-DECLARED /
// BLOCKED-BY-DECLARATION entry. These tests lock the derivation shape
// against that contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PER_AC_VERDICTS,
  VERDICTS,
  attestationPerAcVerdict,
  derivePerAcVerdicts,
  uiPerAcVerdict,
} from '../../../src/verify/verdict/index.js';

test('PER_AC_VERDICTS enumerates the four 0.7.0 per-AC verdict classes', () => {
  assert.deepEqual([...PER_AC_VERDICTS], [
    'MOCK-ONLY-DECLARED',
    'BLOCKED-BY-DECLARATION',
    'UI-BASELINE-UNMET',
    'BROWSER-VERIFICATION-MISSING',
  ]);
});

test('VERDICTS stays the pre-0.7.0 set — per-AC verdicts do not leak into the run-level enum', () => {
  // The report's top-level verdict must remain assignable from the
  // pre-0.7.0 taxonomy so backward-compatible consumers (rcf finalise
  // pre-0.7.0, MCP callers) continue to validate.
  for (const v of PER_AC_VERDICTS) {
    assert.equal(VERDICTS.includes(v), false, `${v} leaked into run-level VERDICTS`);
  }
});

test('attestationPerAcVerdict: declaredMockOnly wins over mocked (explicit declaration overrides implicit mock)', () => {
  const v = attestationPerAcVerdict([
    { serviceId: 'stripe', attestationMode: 'live' },
    { serviceId: 'resend', attestationMode: 'declaredMockOnly' },
    { serviceId: 'sendgrid', attestationMode: 'mocked' },
  ]);
  assert.equal(v.verdict, 'BLOCKED-BY-DECLARATION');
  assert.match(v.reason, /resend/);
  assert.match(v.reason, /pre-flight/);
});

test('attestationPerAcVerdict: mocked emits MOCK-ONLY-DECLARED when no declaredMockOnly is present', () => {
  const v = attestationPerAcVerdict([
    { serviceId: 'resend', attestationMode: 'mocked' },
    { serviceId: 'stripe', attestationMode: 'live' },
  ]);
  assert.equal(v.verdict, 'MOCK-ONLY-DECLARED');
  assert.match(v.reason, /resend/);
  assert.match(v.reason, /no live path/);
});

test('attestationPerAcVerdict: live / sandboxed / notShipped attestations emit no verdict', () => {
  assert.equal(attestationPerAcVerdict([]), null);
  assert.equal(attestationPerAcVerdict(null), null);
  assert.equal(attestationPerAcVerdict([{ serviceId: 'stripe', attestationMode: 'live' }]), null);
  assert.equal(attestationPerAcVerdict([{ serviceId: 'stripe', attestationMode: 'sandboxed' }]), null);
  assert.equal(attestationPerAcVerdict([{ serviceId: 'devlib', attestationMode: 'notShipped' }]), null);
});

test('uiPerAcVerdict: non-UI-bearing AC never emits', () => {
  const v = uiPerAcVerdict({ acId: 'AC-1', fbsUiBearing: false, fbsIds: ['FBS-001'] }, [{ fbsId: 'FBS-001', verdict: 'block' }]);
  assert.equal(v, null);
});

test('uiPerAcVerdict: UI-bearing AC with no browserVerification for the FBS -> BROWSER-VERIFICATION-MISSING', () => {
  const v = uiPerAcVerdict({ acId: 'AC-1', fbsUiBearing: true, fbsIds: ['FBS-001'] }, []);
  assert.equal(v.verdict, 'BROWSER-VERIFICATION-MISSING');
  assert.match(v.reason, /FBS-001/);
});

test('uiPerAcVerdict: UI-bearing AC with block verdict on the latest browserVerification -> UI-BASELINE-UNMET', () => {
  const v = uiPerAcVerdict(
    { acId: 'AC-1', fbsUiBearing: true, fbsIds: ['FBS-001'] },
    [
      { id: 'bv-FBS-001-1', fbsId: 'FBS-001', createdAt: '2026-07-30T10:00:00Z', verdict: 'block' },
    ],
  );
  assert.equal(v.verdict, 'UI-BASELINE-UNMET');
  assert.match(v.reason, /FBS-001/);
  assert.match(v.reason, /bv-FBS-001-1/);
});

test('uiPerAcVerdict: pass verdict on the latest browserVerification -> no per-AC verdict', () => {
  const v = uiPerAcVerdict(
    { acId: 'AC-1', fbsUiBearing: true, fbsIds: ['FBS-001'] },
    [
      { id: 'bv-FBS-001-1', fbsId: 'FBS-001', createdAt: '2026-07-30T10:00:00Z', verdict: 'block' },
      { id: 'bv-FBS-001-2', fbsId: 'FBS-001', createdAt: '2026-07-30T11:00:00Z', verdict: 'pass' },
    ],
  );
  assert.equal(v, null);
});

test('uiPerAcVerdict: mixed FBS list — one missing bv wins over another FBS blocked (missing named first)', () => {
  const v = uiPerAcVerdict(
    { acId: 'AC-1', fbsUiBearing: true, fbsIds: ['FBS-001', 'FBS-002'] },
    [
      { id: 'bv-FBS-002-1', fbsId: 'FBS-002', createdAt: '2026-07-30T10:00:00Z', verdict: 'block' },
    ],
  );
  assert.equal(v.verdict, 'BROWSER-VERIFICATION-MISSING');
  assert.match(v.reason, /FBS-001/);
});

test('derivePerAcVerdicts: emits both Track A and Track B verdicts per AC', () => {
  const acs = [
    {
      acId: 'AC-101-1',
      serviceAttestations: [{ serviceId: 'resend', attestationMode: 'declaredMockOnly' }],
      fbsUiBearing: true,
      fbsIds: ['FBS-001'],
    },
    {
      acId: 'AC-101-2',
      serviceAttestations: [{ serviceId: 'stripe', attestationMode: 'live' }],
      fbsUiBearing: false,
      fbsIds: ['FBS-001'],
    },
  ];
  const browserVerification = [];
  const out = derivePerAcVerdicts({ acs, browserVerification });
  // AC-101-1 emits BOTH BLOCKED-BY-DECLARATION and BROWSER-VERIFICATION-MISSING.
  // AC-101-2 emits nothing (live attestation, not UI-bearing).
  assert.equal(out.length, 2);
  assert.equal(out[0].acId, 'AC-101-1');
  assert.equal(out[0].verdict, 'BLOCKED-BY-DECLARATION');
  assert.equal(out[1].acId, 'AC-101-1');
  assert.equal(out[1].verdict, 'BROWSER-VERIFICATION-MISSING');
});

test('derivePerAcVerdicts: pre-0.7.0 chain (empty derived fields) produces no per-AC verdicts', () => {
  const acs = [
    { acId: 'AC-1', serviceAttestations: [], fbsUiBearing: false, fbsIds: [] },
  ];
  assert.deepEqual(derivePerAcVerdicts({ acs, browserVerification: [] }), []);
});

test('derivePerAcVerdicts: entries carry the finalise-gate contract shape ({acId, verdict, reason})', () => {
  // packages/rcf-lite/src/finalise/ingest.js:findMockOnlyDeclaredAcs filters
  // perAcVerdicts by {verdict in {MOCK-ONLY-DECLARED, BLOCKED-BY-DECLARATION}}
  // and destructures {acId, verdict, reason}. Every emitted entry must
  // satisfy that shape exactly.
  const out = derivePerAcVerdicts({
    acs: [{ acId: 'AC-1', serviceAttestations: [{ serviceId: 'resend', attestationMode: 'mocked' }], fbsUiBearing: false, fbsIds: [] }],
    browserVerification: [],
  });
  assert.equal(out.length, 1);
  const e = out[0];
  assert.deepEqual(Object.keys(e).sort(), ['acId', 'reason', 'verdict']);
  assert.equal(typeof e.acId, 'string');
  assert.equal(typeof e.verdict, 'string');
  assert.equal(typeof e.reason, 'string');
});
