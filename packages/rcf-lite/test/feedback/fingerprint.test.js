// FBS-181 slice 2 unit tests for src/feedback/fingerprint.js.
//
// Covers the canonical input, cross-version stability, anchor and
// class sensitivity, and the missing-anchor fallback per AC-15701-1.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fingerprint,
  fingerprintInput,
  deriveTargetKey,
  normaliseAnchor,
  normaliseTitle,
  FINGERPRINT_HEX_LEN,
} from '../../src/feedback/fingerprint.js';

const base = {
  kind: 'blueprint',
  target: { effectiveSlug: 'wsd-std-error-envelope', blueprintVersion: '1.2.0' },
  anchor: 'TAC-5002-wsd-std-error-envelope',
  symptomClass: 'docs-mismatch',
  title: 'probe calls requestId() but the TAC documents a getter',
};

test('fingerprint length is 12 hex chars', () => {
  const fp = fingerprint(base);
  assert.equal(fp.length, FINGERPRINT_HEX_LEN);
  assert.match(fp, /^[0-9a-f]{12}$/);
});

test('same-defect different-version yields identical fingerprints', () => {
  const other = { ...base, target: { ...base.target, blueprintVersion: '2.0.0' } };
  assert.equal(fingerprint(base), fingerprint(other));
});

test('different anchor yields different fingerprint', () => {
  const other = { ...base, anchor: 'AC-9999' };
  assert.notEqual(fingerprint(base), fingerprint(other));
});

test('different symptom class yields different fingerprint', () => {
  const other = { ...base, symptomClass: 'validate-fails' };
  assert.notEqual(fingerprint(base), fingerprint(other));
});

test('missing anchor uses the title-fallback canonical input', () => {
  const noAnchor = { ...base, anchor: null };
  const input = fingerprintInput(noAnchor);
  assert.equal(
    input,
    'blueprint|wsd-std-error-envelope|docs-mismatch|probe calls requestid tac documents getter',
  );
});

test('title fallback trims to eight tokens and drops stop-words / punctuation', () => {
  const normalised = normaliseTitle('The probe calls requestId() but the TAC documents a getter and more here now');
  const tokens = normalised.split(' ');
  assert.ok(tokens.length <= 8);
  assert.ok(!normalised.includes('the'));
  assert.ok(!normalised.includes('()'));
});

test('core targetKey normalises whitespace and casing', () => {
  const core = { kind: 'core', target: { ref: '  Define  Validate ' }, anchor: null, symptomClass: 'verb-error', title: 'hangs' };
  assert.equal(deriveTargetKey(core), 'define validate');
});

test('blueprint targetKey normalises prefix:slug to prefix-slug', () => {
  const bp = { kind: 'blueprint', target: { ref: 'wsd:std-error-envelope' }, anchor: 'X', symptomClass: 'other' };
  assert.equal(deriveTargetKey(bp), 'wsd-std-error-envelope');
});

test('normaliseAnchor upper-cases and returns "-" for empty inputs', () => {
  assert.equal(normaliseAnchor('ac-1234-1'), 'AC-1234-1');
  assert.equal(normaliseAnchor(null), '-');
  assert.equal(normaliseAnchor(''), '-');
  assert.equal(normaliseAnchor('  '), '-');
});

// -- review fix round (2026-09-16 slice 1-3 review) ---------------------

test('F-slice-2-11: fallback fingerprint strips ASCII hyphens AND normalises non-ASCII dashes to spaces so em-dash variants hash the same', () => {
  const base = {
    kind: 'core',
    target: { ref: 'define validate' },
    anchor: null,
    symptomClass: 'wrong-output',
  };
  const ascii = fingerprint({ ...base, title: 'probe-fails on the walker' });
  const emdash = fingerprint({ ...base, title: 'probe—fails on the walker' });
  const nodash = fingerprint({ ...base, title: 'probe fails on the walker' });
  assert.equal(ascii, emdash, 'ASCII hyphen and em-dash variants must fold to the same fingerprint');
  assert.equal(ascii, nodash, 'and to the space-separated variant');
});
