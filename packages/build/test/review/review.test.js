// REVIEW-stage test-theatre audit unit tests
// (verification-integrity-cluster-spec §5.5).
//
// Covers the four deterministic detectors + verdict aggregation +
// record composition. The `rcf review` CLI-level exit codes live in
// test/cli/review-cli.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateVerdict,
  auditTestTheatre,
  composeReviewAuditRecord,
  nextReviewAuditId,
} from '../../src/review/index.js';

function buildTree({ fbsItems = [], testSuites = [] }) {
  const byId = new Map();
  const kindById = new Map();
  for (const f of fbsItems) { byId.set(f.fbsId, f); kindById.set(f.fbsId, 'fbs'); }
  for (const ts of testSuites) { byId.set(ts.id, ts); kindById.set(ts.id, 'testSuite'); }
  return { manifest: {}, fbsItems, testSuites, byId, kindById };
}

test('detects mockOnlyIntegrationClaim on a live-attested AC covered by an integration TS whose TCs are all mock-shaped', () => {
  const fbs = { fbsId: 'FBS-001', acIds: ['AC-101-1'], dependsOnServices: [
    { id: 'resend', attestationMode: 'live', acIds: ['AC-101-1'] },
  ] };
  const ts = { id: 'TS-001', usId: 'US-101', testLevel: 'integration', acIds: ['AC-101-1'], testCases: [
    { id: 'TC-001-a', acId: 'AC-101-1', runtimeProvenance: { profile: 'stub' } },
  ] };
  const tree = buildTree({ fbsItems: [fbs], testSuites: [ts] });
  const findings = auditTestTheatre({ tree, fbs });
  const mocked = findings.filter((f) => f.kind === 'mockOnlyIntegrationClaim');
  assert.equal(mocked.length, 1);
  assert.equal(mocked[0].severity, 'block');
});

test('does NOT flag mockOnlyIntegrationClaim on a unit-level TS', () => {
  const fbs = { fbsId: 'FBS-001', acIds: ['AC-101-1'], dependsOnServices: [
    { id: 'resend', attestationMode: 'live', acIds: ['AC-101-1'] },
  ] };
  const ts = { id: 'TS-001', testLevel: 'unit', acIds: ['AC-101-1'], testCases: [
    { id: 'TC-001-a', acId: 'AC-101-1', runtimeProvenance: { profile: 'mock' } },
  ] };
  const tree = buildTree({ fbsItems: [fbs], testSuites: [ts] });
  const findings = auditTestTheatre({ tree, fbs });
  assert.equal(findings.filter((f) => f.kind === 'mockOnlyIntegrationClaim').length, 0);
});

test('detects testPointerBroken via injected testPointers map', () => {
  const fbs = { fbsId: 'FBS-001', acIds: ['AC-101-1'] };
  const ts = { id: 'TS-001', testLevel: 'unit', acIds: ['AC-101-1'], testCases: [
    { id: 'TC-001-a', acId: 'AC-101-1', testPointer: 'test/missing.js::gone' },
  ] };
  const tree = buildTree({ fbsItems: [fbs], testSuites: [ts] });
  const testPointers = new Map([
    ['TS-001::TC-001-a', { resolved: false, testPointer: 'test/missing.js::gone', reason: 'file-missing' }],
  ]);
  const findings = auditTestTheatre({ tree, fbs, testPointers });
  const broken = findings.filter((f) => f.kind === 'testPointerBroken');
  assert.equal(broken.length, 1);
  assert.equal(broken[0].severity, 'block');
});

test('detects acIdsCoverageDrift: TS covers an AC not on the FBS', () => {
  const fbs = { fbsId: 'FBS-001', acIds: ['AC-101-1'] };
  const ts = { id: 'TS-001', testLevel: 'unit', acIds: ['AC-101-1', 'AC-101-2'], testCases: [] };
  const tree = buildTree({ fbsItems: [fbs], testSuites: [ts] });
  const findings = auditTestTheatre({ tree, fbs });
  const drift = findings.filter((f) => f.kind === 'acIdsCoverageDrift');
  assert.equal(drift.length, 1);
  assert.match(drift[0].detail, /AC-101-2/);
});

test('detects attestationDrift (declaredMockOnly × live) as otherDeclared warn', () => {
  const fbs = { fbsId: 'FBS-001', acIds: ['AC-101-1'], dependsOnServices: [
    { id: 'resend', attestationMode: 'declaredMockOnly', acIds: ['AC-101-1'] },
  ] };
  const ts = { id: 'TS-001', testLevel: 'unit', acIds: ['AC-101-1'], testCases: [
    { id: 'TC-001-a', acId: 'AC-101-1', runtimeProvenance: { profile: 'live' } },
  ] };
  const tree = buildTree({ fbsItems: [fbs], testSuites: [ts] });
  const findings = auditTestTheatre({ tree, fbs });
  const attDrift = findings.filter((f) => f.kindDescription === 'attestationDrift');
  assert.equal(attDrift.length, 1);
  assert.equal(attDrift[0].severity, 'warn');
});

test('aggregateVerdict: block wins over warn wins over pass', () => {
  assert.equal(aggregateVerdict([]), 'pass');
  assert.equal(aggregateVerdict([{ severity: 'advisory' }, { severity: 'warn' }]), 'warn');
  assert.equal(aggregateVerdict([{ severity: 'warn' }, { severity: 'block' }]), 'block');
});

test('aggregateVerdict: a surviving mutant escalates to block', () => {
  assert.equal(aggregateVerdict([], { mode: 'agent-v1', survivors: [{ mutationId: 'x' }] }), 'block');
});

test('aggregateVerdict: unwired mutation runner (agent-v1-not-wired) promotes clean audit to warn (N-2)', () => {
  // Review N-2: an unwired runner is indistinguishable at the exit-code
  // layer from a wired runner that killed every mutant if we let it
  // pass. Warn forces the operator to wire a runner or acknowledge the
  // skip via --skip-mutation.
  assert.equal(
    aggregateVerdict([], { mode: 'agent-v1-not-wired', mutantsGenerated: 0, mutantsRun: 0, killed: 0, survived: 0 }),
    'warn',
  );
});

test('aggregateVerdict: explicit --skip-mutation (mode skipped) still passes on a clean audit (N-2)', () => {
  // Distinct from agent-v1-not-wired: skipped is an operator-declared
  // choice, so it remains pass rather than warn.
  assert.equal(
    aggregateVerdict([], { mode: 'skipped', mutantsGenerated: 0, mutantsRun: 0, killed: 0, survived: 0 }),
    'pass',
  );
});

test('aggregateVerdict: block finding still wins over agent-v1-not-wired warn (N-2)', () => {
  assert.equal(
    aggregateVerdict(
      [{ severity: 'block' }],
      { mode: 'agent-v1-not-wired', mutantsGenerated: 0, mutantsRun: 0, killed: 0, survived: 0 },
    ),
    'block',
  );
});

test('composeReviewAuditRecord builds a valid record with monotonic id per FBS', () => {
  const fbs = { fbsId: 'FBS-001', acIds: ['AC-101-1'] };
  const tree = buildTree({ fbsItems: [fbs] });
  const rec = composeReviewAuditRecord({
    tree, fbs, findings: [],
    mutationSampling: { mode: 'skipped', mutantsGenerated: 0, mutantsRun: 0, killed: 0, survived: 0 },
    now: new Date('2026-07-30T15:10:00Z'),
  });
  assert.equal(rec.id, 'ra-FBS-001-1');
  assert.equal(rec.fbsId, 'FBS-001');
  assert.equal(rec.verdict, 'pass');
  assert.equal(rec.mutationSampling.mode, 'skipped');
});

test('nextReviewAuditId increments per FBS across existing records', () => {
  const manifest = { reviewAudit: [
    { id: 'ra-FBS-001-1' }, { id: 'ra-FBS-001-2' }, { id: 'ra-FBS-002-1' },
  ] };
  assert.equal(nextReviewAuditId(manifest, 'FBS-001'), 'ra-FBS-001-3');
  assert.equal(nextReviewAuditId(manifest, 'FBS-002'), 'ra-FBS-002-2');
  assert.equal(nextReviewAuditId(manifest, 'FBS-003'), 'ra-FBS-003-1');
});
