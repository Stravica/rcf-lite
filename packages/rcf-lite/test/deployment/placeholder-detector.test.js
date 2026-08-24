// Tests for the canonical placeholder-credential-shape detector
// (w-2026-08-24-006 class cure; spa-US-1132 / TAC-210 bind to it).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectPlaceholderCredentialShape,
  PLACEHOLDER_DETECTOR_VERSION,
} from '../../src/deployment/placeholder-detector.js';

test('PLACEHOLDER_DETECTOR_VERSION is exported as a stable string identifier', () => {
  assert.equal(typeof PLACEHOLDER_DETECTOR_VERSION, 'string');
  assert.match(PLACEHOLDER_DETECTOR_VERSION, /^\d+\.\d+\.\d+$/);
});

test('detects the empty string as a placeholder (empty pattern)', () => {
  const v = detectPlaceholderCredentialShape('');
  assert.equal(v.isPlaceholder, true);
  assert.equal(v.pattern, 'empty');
  assert.match(v.reason, /empty/i);
});

test('detects whitespace-only strings as empty placeholders', () => {
  const v = detectPlaceholderCredentialShape('   ');
  assert.equal(v.isPlaceholder, true);
  assert.equal(v.pattern, 'empty');
});

test('detects the single-dash single-underscore stand-ins', () => {
  for (const raw of ['-', '_']) {
    const v = detectPlaceholderCredentialShape(raw);
    assert.equal(v.isPlaceholder, true, `single-char stand-in ${raw} was not matched`);
    assert.equal(v.pattern, 'single-dash');
  }
});

test('detects the null-token strings (null, undefined, none), case-insensitive', () => {
  for (const raw of ['null', 'undefined', 'None', 'NULL', 'Undefined']) {
    const v = detectPlaceholderCredentialShape(raw);
    assert.equal(v.isPlaceholder, true, `null-token ${raw} was not matched`);
    assert.equal(v.pattern, 'null-token');
  }
});

test('detects the YOUR_X_HERE scaffold pattern, case-insensitive with underscore or dash', () => {
  for (const raw of ['YOUR_API_KEY_HERE', 'your-resend-key-here', 'YOUR_STRIPE_SECRET_HERE']) {
    const v = detectPlaceholderCredentialShape(raw);
    assert.equal(v.isPlaceholder, true, `YOUR_X_HERE ${raw} was not matched`);
    assert.equal(v.pattern, 'you-here');
  }
});

test('detects the named stand-ins, case-insensitive', () => {
  for (const raw of ['changeme', 'CHANGEME', 'placeholder', 'Example', 'dummy', 'todo', 'TBD', 'sample']) {
    const v = detectPlaceholderCredentialShape(raw);
    assert.equal(v.isPlaceholder, true, `named stand-in ${raw} was not matched`);
    assert.equal(v.pattern, 'named-stand-in');
  }
});

test('detects the repeated-single-character stand-ins of length >= 3', () => {
  for (const raw of ['xxx', 'xxxxxxxx', '----', '0000000']) {
    const v = detectPlaceholderCredentialShape(raw);
    assert.equal(v.isPlaceholder, true, `repeat-char ${raw} was not matched`);
    assert.equal(v.pattern, 'repeat-char');
  }
});

test('does NOT match short 2-character strings against the repeat rule', () => {
  const v = detectPlaceholderCredentialShape('aa');
  assert.equal(v.isPlaceholder, false);
});

test('does NOT match real-looking credential values (Resend-style, Stripe-style, generic base64)', () => {
  const cases = [
    're_1234567890abcdefghijklmn',
    'sk_test_51H7abc5678defGHIjkl9012mnoPQRstu',
    'AKIAIOSFODNN7EXAMPLE',
    'ghp_1234567890abcdefghijklmnopqrstuvwxyz',
    'AbCdEf1234567890+/=',
    'a-real-token-with-dashes-and-numbers-9999',
  ];
  for (const raw of cases) {
    const v = detectPlaceholderCredentialShape(raw);
    assert.equal(v.isPlaceholder, false, `real credential ${raw} was misclassified as placeholder (pattern=${v.pattern})`);
  }
});

test('returns isPlaceholder:false for non-string inputs (undefined, null, number, object)', () => {
  for (const raw of [undefined, null, 0, 42, {}, [], true, false]) {
    const v = detectPlaceholderCredentialShape(raw);
    assert.equal(v.isPlaceholder, false, `non-string ${String(raw)} was flagged as placeholder`);
  }
});

test('every placeholder verdict carries a human-readable reason string with the matched shape', () => {
  const cases = ['', 'changeme', 'YOUR_KEY_HERE', 'xxxxxx', 'undefined'];
  for (const raw of cases) {
    const v = detectPlaceholderCredentialShape(raw);
    assert.equal(v.isPlaceholder, true, `case ${JSON.stringify(raw)} did not match`);
    assert.equal(typeof v.reason, 'string');
    assert.ok(v.reason.length > 0, `case ${JSON.stringify(raw)} had empty reason`);
  }
});

test('the watchpost RESEND_API_KEY placeholder pattern is refused (w-2026-08-24-005 regression seal)', () => {
  // The exact class of value that shipped in production on watchpost's
  // first review and rendered the only login path inert. The detector
  // MUST refuse every shape a developer would type as a stand-in.
  for (const raw of ['YOUR_RESEND_API_KEY_HERE', 'changeme', 'placeholder', '', 'todo']) {
    const v = detectPlaceholderCredentialShape(raw);
    assert.equal(v.isPlaceholder, true, `w-2026-08-24-005 regression: ${JSON.stringify(raw)} would ship`);
  }
});
