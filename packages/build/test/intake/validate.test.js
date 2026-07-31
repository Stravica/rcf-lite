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
