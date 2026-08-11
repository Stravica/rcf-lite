// Track C+D §6.4 phase 1 fidelity classifier tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyFidelity } from '../../src/intake/fidelity.js';

test('classifyFidelity returns none on empty text', () => {
  const { fidelity } = classifyFidelity('');
  assert.equal(fidelity, 'none');
});

test('classifyFidelity returns napkin on a short prose paragraph', () => {
  const { fidelity, signals } = classifyFidelity('A quick note. Nothing structured. Small idea.');
  assert.equal(fidelity, 'napkin');
  assert.ok(signals.wordCount < 100);
});

test('classifyFidelity returns briefLight when capabilities are enumerated but NFRs and out-of-scope are missing', () => {
  const text = `${Array(120).fill('word').join(' ')}\n\n## Capabilities\n\n- one\n- two\n- three`;
  const { fidelity } = classifyFidelity(text);
  assert.equal(fidelity, 'briefLight');
});

test('classifyFidelity returns briefStrong when capabilities + NFRs + out-of-scope are all present', () => {
  const text = [
    Array(150).fill('word').join(' '),
    '## Capabilities',
    '- one',
    '## Non-functional constraints',
    '- runs on Raspberry Pi',
    '## Out-of-scope',
    '- multi-tenant',
  ].join('\n');
  const { fidelity } = classifyFidelity(text);
  assert.equal(fidelity, 'briefStrong');
});

test('classifyFidelity returns prd when PRD-shaped markers are present with enumerated capabilities', () => {
  const text = [
    '# Product Requirements Document',
    Array(100).fill('word').join(' '),
    '## Capabilities',
    '- one',
  ].join('\n');
  const { fidelity } = classifyFidelity(text);
  assert.equal(fidelity, 'prd');
});

test('classifyFidelity returns prd when REQ / US markers appear in prose', () => {
  const text = [
    'Requirements list:',
    'REQ-001 sign-in',
    'US-101 as an admin I want ...',
    Array(80).fill('word').join(' '),
  ].join('\n');
  const { fidelity } = classifyFidelity(text);
  assert.equal(fidelity, 'prd');
});

test('classifyFidelity returns prdPlusTad when TAD-shaped markers appear alongside PRD-shaped signals', () => {
  const text = [
    '# Product Requirements Document',
    Array(100).fill('word').join(' '),
    '## Capabilities',
    '- one',
    '# Technical Architecture',
    'ADR-001 pick language',
  ].join('\n');
  const { fidelity } = classifyFidelity(text);
  assert.equal(fidelity, 'prdPlusTad');
});

test('classifyFidelity honours an operator kindHint of napkin regardless of length', () => {
  const text = Array(200).fill('word').join(' ');
  const { fidelity } = classifyFidelity(text, { kindHint: 'napkin' });
  assert.equal(fidelity, 'napkin');
});
