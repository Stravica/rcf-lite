// Browser-verify verdict aggregation + record composition tests (spec §3.3, §8.5).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateVerdict,
  composeBrowserVerificationRecord,
  nextBrowserVerificationId,
} from '../../src/browser-verify/manifest-writer.js';

test('aggregateVerdict returns pass on a clean invariant set with no smoke checks', () => {
  const invariants = [{ invariant: 'sharedNavPresent', verdict: 'pass', severity: 'block' }];
  assert.equal(aggregateVerdict(invariants, []), 'pass');
});

test('aggregateVerdict returns block on a block-severity fail', () => {
  const invariants = [{ invariant: 'sharedNavPresent', verdict: 'fail', severity: 'block' }];
  assert.equal(aggregateVerdict(invariants, []), 'block');
});

test('aggregateVerdict returns block on any auth smoke fail regardless of invariants', () => {
  const invariants = [{ invariant: 'sharedNavPresent', verdict: 'pass', severity: 'block' }];
  assert.equal(aggregateVerdict(invariants, [{ check: 'GET /login', verdict: 'fail' }]), 'block');
});

test('aggregateVerdict returns warn on a warn-severity fail with no blocks', () => {
  const invariants = [{ invariant: 'focusRingsVisible', verdict: 'fail', severity: 'warn' }];
  assert.equal(aggregateVerdict(invariants, []), 'warn');
});

test('aggregateVerdict prefers block over warn when both are present', () => {
  const invariants = [
    { invariant: 'focusRingsVisible', verdict: 'fail', severity: 'warn' },
    { invariant: 'sharedNavPresent', verdict: 'fail', severity: 'block' },
  ];
  assert.equal(aggregateVerdict(invariants, []), 'block');
});

test('nextBrowserVerificationId allocates monotonic per-FBS ids', () => {
  const manifest = {
    browserVerification: [
      { id: 'bv-FBS-016-1', fbsId: 'FBS-016' },
      { id: 'bv-FBS-016-2', fbsId: 'FBS-016' },
      { id: 'bv-FBS-017-1', fbsId: 'FBS-017' },
    ],
  };
  assert.equal(nextBrowserVerificationId(manifest, 'FBS-016'), 'bv-FBS-016-3');
  assert.equal(nextBrowserVerificationId(manifest, 'FBS-017'), 'bv-FBS-017-2');
  assert.equal(nextBrowserVerificationId(null, 'FBS-020'), 'bv-FBS-020-1');
});

test('composeBrowserVerificationRecord composes id, timestamps, mode, routes, verdict', () => {
  const now = new Date('2026-07-30T15:22:00Z');
  const record = composeBrowserVerificationRecord({
    manifest: null,
    fbsId: 'FBS-016',
    mode: 'agentScreenshotCritique',
    runtimeProfile: 'local-dev',
    runtimeUrl: 'http://127.0.0.1:3000',
    routesChecked: [
      { path: '/', screenshotPath: '.rcf/artefacts/bv/dashboard.png', themeApplied: 'light' },
    ],
    invariantChecks: [
      { invariant: 'sharedNavPresent', verdict: 'pass', severity: 'block' },
    ],
    authSmokeChecks: [
      { check: 'GET /login', status: 200, verdict: 'pass' },
    ],
    notes: 'component consistency: clean',
    now,
  });
  assert.equal(record.id, 'bv-FBS-016-1');
  assert.equal(record.mode, 'agentScreenshotCritique');
  assert.equal(record.runtimeProfile, 'local-dev');
  assert.equal(record.verdict, 'pass');
  assert.equal(record.notes, 'component consistency: clean');
  assert.equal(record.createdAt, '2026-07-30T15:22:00.000Z');
  // Severity is stripped from the record shape (schema field is free-string invariant).
  assert.equal(record.invariantChecks[0].severity, undefined);
});

test('composeBrowserVerificationRecord remaps a pass check with no evidence to fail (positive-evidence rule; section 7d)', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  const record = composeBrowserVerificationRecord({
    manifest: null,
    fbsId: 'FBS-090',
    mode: 'agentScreenshotCritique',
    runtimeProfile: 'ci',
    runtimeUrl: 'http://127.0.0.1:3000',
    routesChecked: [],
    invariantChecks: [],
    authSmokeChecks: [],
    probePacks: [{
      packName: 'messaging-queue-cloudflare-concurrency',
      packVersion: '1.0.0',
      blueprintSlug: 'messaging-queue-cloudflare',
      applicable: true,
      checks: [
        { id: 'AC-29104-1', severity: 'block', verdict: 'pass' },
      ],
    }],
    now,
  });
  assert.equal(record.verdict, 'block');
  assert.equal(record.probePacks[0].checks[0].verdict, 'fail');
  assert.equal(record.probePacks[0].checks[0].detail, 'positive-evidence-missing');
});

test('composeBrowserVerificationRecord keeps a pass check that carries an evidence field (request id)', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  const record = composeBrowserVerificationRecord({
    manifest: null,
    fbsId: 'FBS-091',
    mode: 'agentScreenshotCritique',
    runtimeProfile: 'ci',
    runtimeUrl: 'http://127.0.0.1:3000',
    routesChecked: [],
    invariantChecks: [],
    authSmokeChecks: [],
    probePacks: [{
      packName: 'messaging-queue-cloudflare-concurrency',
      packVersion: '1.0.0',
      blueprintSlug: 'messaging-queue-cloudflare',
      applicable: true,
      checks: [
        { id: 'AC-29104-1', severity: 'block', verdict: 'pass', evidence: { kind: 'requestId', value: 'cf-req-8f7a-1234' } },
      ],
    }],
    now,
  });
  assert.equal(record.verdict, 'pass');
  assert.equal(record.probePacks[0].checks[0].verdict, 'pass');
  assert.equal(record.probePacks[0].checks[0].detail, undefined);
});

test('composeBrowserVerificationRecord keeps a pass check that records accountBoundSkipped with a non-empty reason', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  const record = composeBrowserVerificationRecord({
    manifest: null,
    fbsId: 'FBS-092',
    mode: 'agentScreenshotCritique',
    runtimeProfile: 'ci',
    runtimeUrl: 'http://127.0.0.1:3000',
    routesChecked: [],
    invariantChecks: [],
    authSmokeChecks: [],
    probePacks: [{
      packName: 'platform-cloudflare-kv-eventual-consistency',
      packVersion: '1.0.0',
      blueprintSlug: 'platform-cloudflare-kv',
      applicable: true,
      checks: [
        { id: 'AC-33001-1', severity: 'block', verdict: 'pass', accountBoundSkipped: true, reason: 'CI_HAS_CLOUDFLARE_ACCOUNT unset' },
      ],
    }],
    now,
  });
  assert.equal(record.verdict, 'pass');
  assert.equal(record.probePacks[0].checks[0].verdict, 'pass');
  assert.equal(record.probePacks[0].checks[0].accountBoundSkipped, true);
  assert.equal(record.probePacks[0].checks[0].detail, undefined);
});

test('composeBrowserVerificationRecord remaps a pass check with accountBoundSkipped:true but no reason to fail (positive-evidence rule)', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  const record = composeBrowserVerificationRecord({
    manifest: null,
    fbsId: 'FBS-093',
    mode: 'agentScreenshotCritique',
    runtimeProfile: 'ci',
    runtimeUrl: 'http://127.0.0.1:3000',
    routesChecked: [],
    invariantChecks: [],
    authSmokeChecks: [],
    probePacks: [{
      packName: 'platform-cloudflare-kv-eventual-consistency',
      packVersion: '1.0.0',
      blueprintSlug: 'platform-cloudflare-kv',
      applicable: true,
      checks: [
        { id: 'AC-33001-2', severity: 'block', verdict: 'pass', accountBoundSkipped: true, reason: '' },
      ],
    }],
    now,
  });
  assert.equal(record.verdict, 'block');
  assert.equal(record.probePacks[0].checks[0].verdict, 'fail');
  assert.equal(record.probePacks[0].checks[0].detail, 'positive-evidence-missing');
});

test('composeBrowserVerificationRecord applies the positive-evidence remap to preChecks[] too', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  const record = composeBrowserVerificationRecord({
    manifest: null,
    fbsId: 'FBS-094',
    mode: 'agentScreenshotCritique',
    runtimeProfile: 'ci',
    runtimeUrl: 'http://127.0.0.1:3000',
    routesChecked: [],
    invariantChecks: [],
    authSmokeChecks: [],
    probePacks: [{
      packName: 'application-datatable-grid-shell',
      packVersion: '1.0.0',
      blueprintSlug: 'application-datatable',
      applicable: true,
      preChecks: [
        { id: 'no-inline-style', severity: 'block', verdict: 'pass' },
      ],
      checks: [
        { id: 'AC-17101-1', severity: 'block', verdict: 'pass', evidence: { kind: 'responseExcerpt', value: 'HTTP/1.1 200 OK' } },
      ],
    }],
    now,
  });
  assert.equal(record.probePacks[0].preChecks[0].verdict, 'fail');
  assert.equal(record.probePacks[0].preChecks[0].detail, 'positive-evidence-missing');
  assert.equal(record.verdict, 'block');
});

test('composeBrowserVerificationRecord leaves a warn-verdict check unchanged (remap only bites on pass)', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  const record = composeBrowserVerificationRecord({
    manifest: null,
    fbsId: 'FBS-095',
    mode: 'agentScreenshotCritique',
    runtimeProfile: 'ci',
    runtimeUrl: 'http://127.0.0.1:3000',
    routesChecked: [],
    invariantChecks: [],
    authSmokeChecks: [],
    probePacks: [{
      packName: 'application-datatable-grid-shell',
      packVersion: '1.0.0',
      blueprintSlug: 'application-datatable',
      applicable: true,
      checks: [
        { id: 'AC-17101-2', severity: 'warn', verdict: 'warn' },
      ],
    }],
    now,
  });
  assert.equal(record.probePacks[0].checks[0].verdict, 'warn');
  assert.equal(record.probePacks[0].checks[0].detail, undefined);
});
