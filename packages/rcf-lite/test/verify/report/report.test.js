// Report artifact tests (spec §5.3, §11): schema serialization round-trip,
// schemaVersion, chain-node mapping, secret-redaction defence, and the
// self-contained renderer.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isRcfError } from '@stravica-ai/rcf-lite-core/errors';
import {
  SCHEMA_VERSION,
  buildReport,
  serialiseReport,
  parseReport,
  validateReportShape,
} from '../../src/report/index.js';
import { renderReport } from '../../src/report/renderer.js';

function sampleReport() {
  return buildReport({
    profile: 'deployed',
    url: 'https://app.example.com',
    parityEnv: false,
    reachability: { reachable: true, looksLocal: false },
    chainRef: 'PRD-001',
    repo: '/path/to/repo',
    persona: 'generic-sceptic',
    startedAt: '2026-07-21T10:00:00.000Z',
    finishedAt: '2026-07-21T10:05:00.000Z',
    verifierIsolation: { autoMemory: false, nonEssentialTraffic: false },
    verdict: 'BROKEN',
    verdictAuthority: 'ship',
    findings: [
      { severity: 'BROKEN', acId: 'AC-101-1', journey: 'sign-in', reproSteps: ['open /login'], evidence: { kind: 'runtimeError', detail: 'auth 500' } },
    ],
    blockedAcs: [{ acId: 'AC-101-2', reason: 'cannot provision: payments sandbox key' }],
    provisioning: { provisioned: [{ kind: 'authAccount', ref: 'zzverify-a' }], blocked: [], cleanupRan: true, cleanupRemoved: ['zzverify-a'] },
  });
}

test('buildReport: matches the §5.3 shape with schemaVersion and runtime provenance', () => {
  const r = sampleReport();
  assert.equal(r.schemaVersion, SCHEMA_VERSION);
  assert.equal(r.run.profile, 'deployed');
  assert.equal(r.run.url, 'https://app.example.com');
  assert.equal(r.run.parityEnv, false);
  assert.deepEqual(r.run.reachability, { reachable: true, looksLocal: false });
  assert.equal(r.run.verifierIsolation.autoMemory, false);
  assert.equal(r.verdict, 'BROKEN');
  assert.equal(r.verdictAuthority, 'ship');
  assert.equal(r.findings[0].acId, 'AC-101-1'); // chain-node addressed
  assert.equal(r.blockedAcs[0].acId, 'AC-101-2');
});

test('serialise -> parse round-trips a report', () => {
  const r = sampleReport();
  const parsed = parseReport(serialiseReport(r));
  assert.ok(!isRcfError(parsed));
  assert.deepEqual(parsed, r);
});

test('parseReport: rejects unknown schemaVersion', () => {
  const err = parseReport(JSON.stringify({ schemaVersion: '99', verdict: 'PASS', verdictAuthority: 'ship', run: {} }));
  assert.ok(isRcfError(err));
  assert.equal(err.field, 'schemaVersion');
});

test('parseReport: rejects a non-JSON body', () => {
  assert.ok(isRcfError(parseReport('{not json')));
});

test('validateReportShape: rejects unknown verdict / bad authority', () => {
  assert.ok(isRcfError(validateReportShape({ schemaVersion: SCHEMA_VERSION, verdict: 'MAYBE', verdictAuthority: 'ship', run: {} })));
  assert.ok(isRcfError(validateReportShape({ schemaVersion: SCHEMA_VERSION, verdict: 'PASS', verdictAuthority: 'guess', run: {} })));
});

test('buildReport: redacts secrets that would otherwise reach the report body (§10)', () => {
  const r = buildReport({
    profile: 'ci', url: 'http://localhost:3000', parityEnv: false, verdict: 'PASS', verdictAuthority: 'correctness',
    findings: [], blockedAcs: [],
    provisioning: { provisioned: [{ kind: 'authAccount', ref: 'zzverify-a', password: 'hunter2', token: 'abc' }], blocked: [], cleanupRan: false, cleanupRemoved: [] },
  });
  const serialised = serialiseReport(r);
  assert.doesNotMatch(serialised, /hunter2/);
  assert.doesNotMatch(serialised, /abc/);
  assert.match(serialised, /\[redacted\]/);
});

test('renderReport: human render includes verdict, provenance, findings; never claims "fully verified"', () => {
  const text = renderReport(sampleReport());
  assert.match(text, /Verdict:\s+BROKEN/);
  assert.match(text, /profile:\s+deployed/);
  assert.match(text, /AC-101-1/);
  assert.match(text, /Blocked ACs/);
  assert.match(text, /not a correctness guarantee/);
  assert.doesNotMatch(text, /fully verified/i);
});

test('buildReport: LAUNCH-FAILURE report carries launchFailure + round-trips (fix 4)', () => {
  const r = buildReport({
    profile: 'ci', url: 'http://localhost:3000', parityEnv: false,
    verdict: 'LAUNCH-FAILURE', verdictAuthority: 'correctness',
    findings: [], blockedAcs: [],
    launchFailure: { message: 'agent output could not be ingested', rawOutputPath: '/tmp/raw.txt' },
  });
  assert.equal(r.verdict, 'LAUNCH-FAILURE');
  assert.equal(r.launchFailure.rawOutputPath, '/tmp/raw.txt');
  const parsed = parseReport(serialiseReport(r)); // LAUNCH-FAILURE is a valid verdict now
  assert.ok(!isRcfError(parsed));
  assert.deepEqual(parsed, r);
  const text = renderReport(r);
  assert.match(text, /Launch failure/);
  assert.match(text, /could not be ingested/);
});

test('buildReport: runStats land in run.runStats and render; absent -> null (fix 5, omit-not-fake)', () => {
  const r = buildReport({
    profile: 'ci', url: 'http://localhost:3000', parityEnv: false,
    verdict: 'PASS', verdictAuthority: 'correctness', findings: [], blockedAcs: [],
    runStats: { durationMs: 5000, numTurns: 3, totalCostUsd: 0.1, tokens: { inputTokens: 10, outputTokens: 20 } },
  });
  assert.equal(r.run.runStats.durationMs, 5000);
  assert.match(renderReport(r), /Run stats:/);
  const r2 = buildReport({ profile: 'ci', url: 'x', parityEnv: false, verdict: 'PASS', verdictAuthority: 'correctness', findings: [], blockedAcs: [] });
  assert.equal(r2.run.runStats, null);
});
