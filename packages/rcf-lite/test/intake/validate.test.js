// Track C+D §6.4 phase 2 validation-scan tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scanArtefactForFindings } from '../../src/intake/validate.js';

test('scanArtefactForFindings surfaces impliedButNotStated when a web UI is named without a sign-in surface', () => {
  const text = 'The dashboard renders every monitor in a browser table. Operators view HTML pages.';
  const findings = scanArtefactForFindings(text);
  const impl = findings.find((f) => f.kind === 'impliedButNotStated');
  assert.ok(impl, `expected impliedButNotStated in ${JSON.stringify(findings)}`);
  assert.match(impl.detail, /browser sign-in page/);
});

test('scanArtefactForFindings surfaces contradiction when "no login required" appears with an admin surface', () => {
  const text = 'No login is required for the public status page. The admin dashboard shows every monitor.';
  const findings = scanArtefactForFindings(text);
  assert.ok(findings.some((f) => f.kind === 'contradiction'));
});

test('scanArtefactForFindings surfaces missingLoadBearingConstraint when a service name appears without its env var', () => {
  const text = 'Recovery emails go via Resend when an outage clears.';
  const findings = scanArtefactForFindings(text);
  const miss = findings.find((f) => f.kind === 'missingLoadBearingConstraint');
  assert.ok(miss);
  assert.match(miss.detail, /Resend/);
  assert.match(miss.detail, /credential env var/);
});

test('scanArtefactForFindings stays quiet when the service name comes with its env var', () => {
  const text = 'Recovery emails go via Resend when an outage clears. The env var is RESEND_API_KEY.';
  const findings = scanArtefactForFindings(text);
  assert.equal(findings.some((f) => f.kind === 'missingLoadBearingConstraint'), false);
});

test('scanArtefactForFindings returns an empty array on a clean brief', () => {
  const text = 'The plan calculates monthly billing at a fixed rate. Nothing external is used.';
  const findings = scanArtefactForFindings(text);
  assert.deepEqual(findings, []);
});

// ---------------------------------------------------------------------------
// REQ-187 (US-18702): runIntakeScansOnDelta over new vs existing statements.
// ---------------------------------------------------------------------------

import { runIntakeScansOnDelta } from '../../src/intake/orchestrator.js';

test('runIntakeScansOnDelta (AC-18702-1): a contradiction between a new and existing statement names both ids', () => {
  const existing = [
    { id: 1, text: 'No login is required for the public page.' },
  ];
  const newStatements = [
    { id: 2, text: 'The admin dashboard shows every monitor.' },
  ];
  const findings = runIntakeScansOnDelta(newStatements, existing);
  const contradiction = findings.find((f) => f.kind === 'contradiction');
  assert.ok(contradiction, `expected contradiction, got ${JSON.stringify(findings)}`);
  assert.ok(contradiction.ids.includes(1));
  assert.ok(contradiction.ids.includes(2));
});

test('runIntakeScansOnDelta: a scan on new statements alone surfaces inside the new side', () => {
  const newStatements = [
    { id: 1, text: 'No login is required for the public page. The admin dashboard shows every monitor.' },
  ];
  const findings = runIntakeScansOnDelta(newStatements, []);
  assert.ok(findings.some((f) => f.kind === 'contradiction'));
});

test('runIntakeScansOnDelta: zero new statements returns an empty array', () => {
  const findings = runIntakeScansOnDelta([], [{ id: 1, text: 'x' }]);
  assert.deepEqual(findings, []);
});

test('runIntakeScansOnDelta (AC-18702-3): on a frozen set the comparison set is every existing statement', () => {
  const frozen = [
    { id: 1, text: 'No login is required.' },
    { id: 2, text: 'The admin dashboard lists tenants.' },
  ];
  const newStatements = [{ id: 3, text: 'Also an admin panel exists.' }];
  const findings = runIntakeScansOnDelta(newStatements, frozen);
  // A contradiction already present among frozen is attributed with
  // a new id when the new side participates. The new statement
  // mentions "admin panel", which is a HAS_ADMIN_UI token, so a
  // contradiction with id 1's "no login required" surfaces.
  const contradiction = findings.find((f) => f.kind === 'contradiction');
  assert.ok(contradiction);
  assert.ok(contradiction.ids.includes(3));
});
