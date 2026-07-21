// Verdict taxonomy + aggregation tests (spec §5.1, §5.2, §11).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isRcfError } from '@stravica-ai/rcf-lite-core/errors';
import {
  FINDING_SEVERITIES,
  VERDICTS,
  validateFinding,
  aggregateSeverity,
  aggregateVerdict,
  gateTripped,
} from '../../src/verdict/index.js';

const goodFinding = {
  severity: 'BROKEN',
  acId: 'AC-101-1',
  journey: 'sign-in',
  reproSteps: ['open /login', 'submit valid creds', '500 returned'],
  evidence: { kind: 'runtimeError', detail: 'auth 500' },
};

test('taxonomy constants', () => {
  assert.deepEqual([...FINDING_SEVERITIES], ['PASS', 'COSMETIC', 'DEGRADED', 'BROKEN']);
  assert.ok(VERDICTS.includes('NOT-DEPLOYED'));
  assert.ok(VERDICTS.includes('BLOCKED'));
});

test('validateFinding: a complete finding validates', () => {
  assert.equal(validateFinding(goodFinding), null);
});

test('validateFinding: every §5.2 field is required (chain-node addressing)', () => {
  for (const field of ['severity', 'acId', 'journey', 'reproSteps', 'evidence']) {
    const bad = { ...goodFinding };
    delete bad[field];
    const err = validateFinding(bad);
    assert.ok(isRcfError(err), `missing ${field} should error`);
  }
  assert.ok(isRcfError(validateFinding({ ...goodFinding, severity: 'FATAL' })));
});

test('aggregateSeverity: worst finding wins; empty is PASS', () => {
  assert.equal(aggregateSeverity([]), 'PASS');
  assert.equal(aggregateSeverity([{ severity: 'COSMETIC' }, { severity: 'DEGRADED' }]), 'DEGRADED');
  assert.equal(aggregateSeverity([{ severity: 'PASS' }, { severity: 'BROKEN' }, { severity: 'DEGRADED' }]), 'BROKEN');
});

test('aggregateVerdict: split-not-averaged — one BROKEN makes the run BROKEN regardless of passes', () => {
  const findings = [{ severity: 'PASS' }, { severity: 'PASS' }, { severity: 'BROKEN' }];
  assert.equal(aggregateVerdict({ findings }), 'BROKEN');
});

test('aggregateVerdict: notDeployed overrides everything', () => {
  assert.equal(aggregateVerdict({ findings: [{ severity: 'BROKEN' }], notDeployed: true }), 'NOT-DEPLOYED');
});

test('aggregateVerdict: no findings but blocked ACs -> BLOCKED', () => {
  assert.equal(aggregateVerdict({ findings: [], blockedAcs: [{ acId: 'AC-1' }] }), 'BLOCKED');
});

test('aggregateVerdict: some findings + some blocked -> partial verdict from findings (blocked reported separately)', () => {
  assert.equal(aggregateVerdict({ findings: [{ severity: 'DEGRADED' }], blockedAcs: [{ acId: 'AC-2' }] }), 'DEGRADED');
});

test('gateTripped: gate at BROKEN trips on BROKEN, not on DEGRADED', () => {
  assert.equal(gateTripped({ verdict: 'BROKEN', findings: [{ severity: 'BROKEN' }], gate: 'BROKEN' }), true);
  assert.equal(gateTripped({ verdict: 'DEGRADED', findings: [{ severity: 'DEGRADED' }], gate: 'BROKEN' }), false);
});

test('gateTripped: gate at DEGRADED trips on DEGRADED and BROKEN', () => {
  assert.equal(gateTripped({ verdict: 'DEGRADED', findings: [{ severity: 'DEGRADED' }], gate: 'DEGRADED' }), true);
});

test('gateTripped: no gate -> never trips on findings (report still written by the CLI)', () => {
  assert.equal(gateTripped({ verdict: 'BROKEN', findings: [{ severity: 'BROKEN' }] }), false);
});

test('gateTripped: NOT-DEPLOYED and BLOCKED always trip, even with no gate', () => {
  assert.equal(gateTripped({ verdict: 'NOT-DEPLOYED', findings: [] }), true);
  assert.equal(gateTripped({ verdict: 'BLOCKED', findings: [] }), true);
});
