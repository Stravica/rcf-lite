// Unit tests for src/blueprint/namespace.js. Pure function; no fixtures.
// Covers the prefix / suffix / unnamespaced family split (AC-1002-1
// namespacing at the id layer).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stampId, parseIdParts, namespaceStyleFor, isNamespacedFor } from '../../src/blueprint/namespace.js';

test('parseIdParts: bare REQ id parses as prefix family with no prefix slug', () => {
  const p = parseIdParts('REQ-001');
  assert.deepEqual(p, { family: 'REQ', prefixSlug: null, digits: '001', suffixSlug: null });
});

test('parseIdParts: prefixed REQ id parses with the prefix slug', () => {
  assert.deepEqual(parseIdParts('spa-REQ-001'), { family: 'REQ', prefixSlug: 'spa', digits: '001', suffixSlug: null });
  assert.deepEqual(parseIdParts('my-blueprint-REQ-042'), { family: 'REQ', prefixSlug: 'my-blueprint', digits: '042', suffixSlug: null });
});

test('parseIdParts: suffix-family id (ADR-005-spa) parses with the suffix slug', () => {
  assert.deepEqual(parseIdParts('ADR-005'), { family: 'ADR', prefixSlug: null, digits: '005', suffixSlug: null });
  assert.deepEqual(parseIdParts('ADR-005-spa'), { family: 'ADR', prefixSlug: null, digits: '005', suffixSlug: 'spa' });
  assert.deepEqual(parseIdParts('ADR-005-spa-theme'), { family: 'ADR', prefixSlug: null, digits: '005', suffixSlug: 'spa-theme' });
});

test('parseIdParts: unnamespaced AC and TC parse to family=AC/TC with no slug', () => {
  assert.equal(parseIdParts('AC-101-1').family, 'AC');
  assert.equal(parseIdParts('TC-001-happy-path').family, 'TC');
});

test('parseIdParts: unknown pattern returns null', () => {
  assert.equal(parseIdParts('nonsense'), null);
  assert.equal(parseIdParts('SPA-REQ-001'), null); // uppercase slug prefix
  assert.equal(parseIdParts('spa--REQ-001'), null); // double hyphen
});

test('namespaceStyleFor: prefix families report prefix; suffix families report suffix; AC reports none', () => {
  assert.equal(namespaceStyleFor('REQ-001'), 'prefix');
  assert.equal(namespaceStyleFor('BS-001'), 'prefix');
  assert.equal(namespaceStyleFor('TS-042'), 'prefix');
  assert.equal(namespaceStyleFor('ADR-005'), 'suffix');
  assert.equal(namespaceStyleFor('TAC-014'), 'suffix');
  assert.equal(namespaceStyleFor('FBS-007'), 'suffix');
  assert.equal(namespaceStyleFor('CN-042'), 'suffix');
  assert.equal(namespaceStyleFor('AC-101-1'), 'none');
  assert.equal(namespaceStyleFor('TC-001-happy'), 'none');
});

test('stampId: bare prefix-family id gains the slug as PREFIX', () => {
  assert.deepEqual(stampId('REQ-001', 'spa'), { id: 'spa-REQ-001' });
  assert.deepEqual(stampId('US-101', 'rest'), { id: 'rest-US-101' });
  assert.deepEqual(stampId('BS-003', 'msg-consumer'), { id: 'msg-consumer-BS-003' });
});

test('stampId: bare suffix-family id gains the slug as SUFFIX', () => {
  assert.deepEqual(stampId('ADR-005', 'spa'), { id: 'ADR-005-spa' });
  assert.deepEqual(stampId('TAC-014', 'rest'), { id: 'TAC-014-rest' });
  assert.deepEqual(stampId('FBS-007', 'spa'), { id: 'FBS-007-spa' });
});

test('stampId: already-namespaced id for the same slug is idempotent (exact slug)', () => {
  assert.deepEqual(stampId('spa-REQ-001', 'spa'), { id: 'spa-REQ-001' });
  assert.deepEqual(stampId('ADR-005-spa', 'spa'), { id: 'ADR-005-spa' });
  // A longer slug is its OWN blueprint's namespace, so the same-slug
  // idempotency does NOT extend: `ADR-005-spa-theme` belongs to
  // blueprint `spa-theme`, not blueprint `spa`.
  assert.deepEqual(stampId('ADR-005-spa-theme', 'spa-theme'), { id: 'ADR-005-spa-theme' });
});

test('stampId: suffix slug that is a hyphen-prefix of another slug is NOT idempotent (exact-slug match)', () => {
  // Pre-fix, `startsWith('spa-')` treated `ADR-005-spa-theme` as
  // already namespaced for `spa` and silently returned it unchanged;
  // apply.js then wrote it as if `spa` owned it. Now refused.
  const result = stampId('ADR-005-spa-theme', 'spa');
  assert.ok('error' in result, `expected refusal, got ${JSON.stringify(result)}`);
  assert.match(result.error, /already carries suffix namespace 'spa-theme'/);
});

test('stampId: id already namespaced for a DIFFERENT slug is refused with an error', () => {
  assert.ok('error' in stampId('spa-REQ-001', 'rest'));
  assert.ok('error' in stampId('ADR-005-spa', 'rest'));
});

test('stampId: AC and TC ids pass through unchanged (no namespacing family)', () => {
  assert.deepEqual(stampId('AC-101-1', 'spa'), { id: 'AC-101-1' });
  assert.deepEqual(stampId('TC-001-happy-path', 'spa'), { id: 'TC-001-happy-path' });
});

test('stampId: invalid slug (uppercase, empty, punctuation) is refused', () => {
  assert.ok('error' in stampId('REQ-001', 'SPA'));
  assert.ok('error' in stampId('REQ-001', ''));
  assert.ok('error' in stampId('REQ-001', 'spa_thing'));
});

test('stampId: unknown-family id is refused', () => {
  assert.ok('error' in stampId('XYZ-001', 'spa'));
});

test('isNamespacedFor: recognises prefix and suffix namespacing for a given slug (exact-slug match)', () => {
  assert.equal(isNamespacedFor('spa-REQ-001', 'spa'), true);
  assert.equal(isNamespacedFor('spa-REQ-001', 'rest'), false);
  assert.equal(isNamespacedFor('ADR-005-spa', 'spa'), true);
  // Exact-slug match. `ADR-005-spa-theme` belongs to blueprint
  // `spa-theme`, NOT blueprint `spa`. The prior loose check
  // (`startsWith('spa-')`) let blueprint `spa` claim ownership of
  // ids that actually belonged to a longer-slug sibling, which
  // apply.js relied on when deciding whether an on-disk overwrite
  // was a same-blueprint re-apply.
  assert.equal(isNamespacedFor('ADR-005-spa-theme', 'spa'), false);
  assert.equal(isNamespacedFor('ADR-005-spa-theme', 'spa-theme'), true);
  // Symmetry check both directions: the longer blueprint slug
  // never claims a shorter-slug id either.
  assert.equal(isNamespacedFor('ADR-005-spa', 'spa-theme'), false);
  // Prefix-family symmetry (was already exact pre-fix; pin it).
  assert.equal(isNamespacedFor('spa-theme-REQ-001', 'spa'), false);
  assert.equal(isNamespacedFor('spa-REQ-001', 'spa-theme'), false);
  assert.equal(isNamespacedFor('REQ-001', 'spa'), false);
});
