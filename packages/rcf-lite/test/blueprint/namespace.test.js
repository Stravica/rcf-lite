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
  assert.deepEqual(stampId('ADR-005-spa-theme', 'spa-theme'), { id: 'ADR-005-spa-theme' });
});

test('stampId: suffix-family id with a slug+tail is accepted as declared (w-2026-08-19-005)', () => {
  // The blueprint's declared contribution list IS the truth for what
  // this blueprint owns; stamping does not veto on string parse. This
  // is what lets a suffix-family id with a semantic tail after the
  // slug (`ADR-201-spa-routing`, `TAC-201-spa-app-shell`) apply
  // cleanly under blueprint `spa`. Cross-blueprint ownership
  // ambiguity (spa vs spa-theme) is caught by the manifest-record
  // check in apply.js, not here in the string grammar.
  assert.deepEqual(stampId('ADR-201-spa-routing', 'spa'), { id: 'ADR-201-spa-routing' });
  assert.deepEqual(stampId('TAC-201-spa-app-shell', 'spa'), { id: 'TAC-201-spa-app-shell' });
  assert.deepEqual(stampId('ADR-005-spa-theme', 'spa'), { id: 'ADR-005-spa-theme' });
});

test('stampId: prefix-family id already carrying any slug segment is accepted as declared (w-2026-08-19-005)', () => {
  // Symmetrical with the suffix side: a prefix-family id with a slug
  // that does not equal the applying blueprint's slug is trusted as
  // declared. The manifest-record cross-claim check in apply.js
  // catches the case where that id is already owned by another
  // applied blueprint.
  assert.deepEqual(stampId('spa-REQ-001', 'rest'), { id: 'spa-REQ-001' });
  assert.deepEqual(stampId('ADR-005-spa', 'rest'), { id: 'ADR-005-spa' });
  assert.deepEqual(stampId('spa-theme-REQ-001', 'spa'), { id: 'spa-theme-REQ-001' });
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

test('isNamespacedFor: GRAMMAR predicate — parsed slug segment equals `slug` (exact-slug match, NOT an ownership check)', () => {
  // The predicate reports what the id STRING parses to. It is not an
  // ownership decision -- ownership of an applied contribution is
  // answered by the manifest's appliedBlueprintRecord.contributions[]
  // list. Downstream consumers (docs generators, id audit tooling)
  // may still care about the grammar shape, so the exact-slug
  // semantics are pinned here.
  assert.equal(isNamespacedFor('spa-REQ-001', 'spa'), true);
  assert.equal(isNamespacedFor('spa-REQ-001', 'rest'), false);
  assert.equal(isNamespacedFor('ADR-005-spa', 'spa'), true);
  // Slug+tail parses as the whole tail, exact-slug false.
  assert.equal(isNamespacedFor('ADR-005-spa-theme', 'spa'), false);
  assert.equal(isNamespacedFor('ADR-005-spa-theme', 'spa-theme'), true);
  // Symmetry both directions.
  assert.equal(isNamespacedFor('ADR-005-spa', 'spa-theme'), false);
  assert.equal(isNamespacedFor('spa-theme-REQ-001', 'spa'), false);
  assert.equal(isNamespacedFor('spa-REQ-001', 'spa-theme'), false);
  assert.equal(isNamespacedFor('REQ-001', 'spa'), false);
});
