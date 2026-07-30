// Attestation × Profile matrix + aggregation unit tests
// (verification-integrity-cluster-spec §3.5).
//
// Covers every row of the §3.5 table via direct calls to
// classifyAttestationProfile, then the aggregation + missing detectors
// via synthetic walker-tree fixtures. The CLI-level exit-4 assertions
// live in test/cli/coverage-strict.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateAttestationsByAc,
  classifyAttestationProfile,
  findAttestationDrift,
  findAttestationMissing,
  findProvenanceMissing,
} from '../../src/query/attestation.js';

const MATRIX = [
  { attestation: 'live', profile: 'live', verdict: 'pass' },
  { attestation: 'live', profile: 'mock', verdict: 'refuse' },
  { attestation: 'live', profile: 'stub', verdict: 'refuse' },
  { attestation: 'live', profile: 'fixture', verdict: 'refuse' },
  { attestation: 'sandboxed', profile: 'live', verdict: 'pass' },
  { attestation: 'sandboxed', profile: 'stub', verdict: 'pass' },
  { attestation: 'sandboxed', profile: 'mock', verdict: 'refuse' },
  { attestation: 'sandboxed', profile: 'fixture', verdict: 'refuse' },
  { attestation: 'mocked', profile: 'mock', verdict: 'pass' },
  { attestation: 'mocked', profile: 'stub', verdict: 'pass' },
  { attestation: 'mocked', profile: 'fixture', verdict: 'pass' },
  { attestation: 'mocked', profile: 'live', verdict: 'pass' },
  { attestation: 'declaredMockOnly', profile: 'mock', verdict: 'pass' },
  { attestation: 'declaredMockOnly', profile: 'stub', verdict: 'pass' },
  { attestation: 'declaredMockOnly', profile: 'fixture', verdict: 'pass' },
  { attestation: 'declaredMockOnly', profile: 'live', verdict: 'passWithWarn' },
  { attestation: 'notShipped', profile: 'mock', verdict: 'pass' },
  { attestation: 'notShipped', profile: 'live', verdict: 'pass' },
  // `mixed` is the anti-pattern refusal, regardless of attestation.
  { attestation: 'live', profile: 'mixed', verdict: 'refuse' },
  { attestation: 'mocked', profile: 'mixed', verdict: 'refuse' },
];

for (const row of MATRIX) {
  test(`matrix: ${row.attestation} × ${row.profile} = ${row.verdict}`, () => {
    const cell = classifyAttestationProfile(row.attestation, row.profile);
    assert.equal(cell.verdict, row.verdict, `reason=${cell.reason}`);
    assert.equal(typeof cell.reason, 'string');
    assert.notEqual(cell.reason.length, 0);
  });
}

function buildTree({ fbsItems = [], testSuites = [], preFlightConfig = [] }) {
  const byId = new Map();
  const kindById = new Map();
  for (const f of fbsItems) { byId.set(f.fbsId, f); kindById.set(f.fbsId, 'fbs'); }
  for (const ts of testSuites) { byId.set(ts.id, ts); kindById.set(ts.id, 'testSuite'); }
  return {
    manifest: { preFlightConfig },
    fbsItems, testSuites, byId, kindById,
  };
}

test('aggregateAttestationsByAc surfaces every FBS binding into per-AC bundles', () => {
  const tree = buildTree({
    fbsItems: [
      { fbsId: 'FBS-001', acIds: ['AC-101-1'], dependsOnServices: [
        { id: 'resend', attestationMode: 'live', acIds: ['AC-101-1'] },
      ] },
      { fbsId: 'FBS-002', acIds: ['AC-101-1', 'AC-101-2'], dependsOnServices: [
        { id: 'stripe', attestationMode: 'sandboxed', acIds: ['AC-101-1'] },
      ] },
    ],
  });
  const map = aggregateAttestationsByAc(tree);
  const on101 = map.get('AC-101-1');
  assert.equal(on101.length, 2);
  assert.deepEqual(on101.map((b) => b.serviceId).sort(), ['resend', 'stripe']);
});

test('findAttestationMissing only fires on FBSes in affectedFbsIds without a matching entry', () => {
  const tree = buildTree({
    fbsItems: [
      { fbsId: 'FBS-001', acIds: ['AC-101-1'], dependsOnServices: [
        { id: 'resend', attestationMode: 'live', acIds: ['AC-101-1'] },
      ] },
      { fbsId: 'FBS-002', acIds: ['AC-101-2'], dependsOnServices: [] },
    ],
    preFlightConfig: [
      { id: 'pfc-2026-07-30-001', createdAt: '', prdId: 'PRD-001', operatorAckAt: '',
        servicesInScope: [
          { id: 'resend', displayName: 'r', sourceRefs: [], attestationMode: 'live',
            credentialSupplied: true, sandboxProvisioned: false,
            affectedFbsIds: ['FBS-001', 'FBS-002'] },
        ] },
    ],
  });
  const missing = findAttestationMissing(tree);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].fbsId, 'FBS-002');
  assert.equal(missing[0].serviceId, 'resend');
});

test('findAttestationMissing skips services with empty affectedFbsIds (honesty over noise)', () => {
  const tree = buildTree({
    fbsItems: [{ fbsId: 'FBS-001', acIds: ['AC-101-1'], dependsOnServices: [] }],
    preFlightConfig: [{
      id: 'pfc-2026-07-30-001', createdAt: '', prdId: 'PRD-001', operatorAckAt: '',
      servicesInScope: [{ id: 'resend', displayName: 'r', sourceRefs: [], attestationMode: 'live',
        credentialSupplied: true, sandboxProvisioned: false }],
    }],
  });
  assert.equal(findAttestationMissing(tree).length, 0);
});

test('findProvenanceMissing lists every TC lacking a block when its AC binds a service', () => {
  const tree = buildTree({
    fbsItems: [{ fbsId: 'FBS-001', acIds: ['AC-101-1'], dependsOnServices: [
      { id: 'resend', attestationMode: 'live', acIds: ['AC-101-1'] },
    ] }],
    testSuites: [{
      id: 'TS-001', acIds: ['AC-101-1'],
      testCases: [
        { id: 'TC-001-a', acId: 'AC-101-1', runtimeProvenance: { profile: 'mock' } },
        { id: 'TC-001-b', acId: 'AC-101-1' /* no provenance */ },
      ],
    }],
  });
  const missing = findProvenanceMissing(tree);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].tcId, 'TC-001-b');
});

test('findAttestationDrift raises the live × mock refusal', () => {
  const tree = buildTree({
    fbsItems: [{ fbsId: 'FBS-001', acIds: ['AC-101-1'], dependsOnServices: [
      { id: 'resend', attestationMode: 'live', acIds: ['AC-101-1'] },
    ] }],
    testSuites: [{
      id: 'TS-001', acIds: ['AC-101-1'],
      testCases: [{ id: 'TC-001-x', acId: 'AC-101-1', runtimeProvenance: { profile: 'mock' } }],
    }],
  });
  const drift = findAttestationDrift(tree);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].verdict, 'refuse');
  assert.equal(drift[0].serviceId, 'resend');
});

test('findAttestationDrift raises declaredMockOnly × live as passWithWarn', () => {
  const tree = buildTree({
    fbsItems: [{ fbsId: 'FBS-001', acIds: ['AC-101-1'], dependsOnServices: [
      { id: 'resend', attestationMode: 'declaredMockOnly', acIds: ['AC-101-1'] },
    ] }],
    testSuites: [{
      id: 'TS-001', acIds: ['AC-101-1'],
      testCases: [{ id: 'TC-001-x', acId: 'AC-101-1', runtimeProvenance: { profile: 'live' } }],
    }],
  });
  const drift = findAttestationDrift(tree);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].verdict, 'passWithWarn');
});
