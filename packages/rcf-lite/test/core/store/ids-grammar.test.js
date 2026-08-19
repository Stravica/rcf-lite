// Grammar-side coverage for src/core/store/ids.js: parseIdParts,
// canonicaliseStem, familyLocation. Complements duplicate-ids.test.js
// (normaliseId / sameId identity behaviour, which stayed unchanged when
// the family grammar moved into this module).
//
// w-2026-08-19-003: before this landed, only walker.js (idFromFilenameStem)
// and loader.js (pathForId) knew about id shapes and both handled only the
// suffix family. Prefix-namespaced ids (spa-REQ-001) round-tripped wrong,
// which bricked `rcf validate` and every blueprint verb after a prefix
// contribution was written. These tests pin the shared grammar so a
// future refactor can't quietly regress it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicaliseStem,
  familyLocation,
  parseIdParts,
  PREFIX_FAMILIES,
  SUFFIX_FAMILIES,
  UNNAMESPACED_FAMILIES,
} from '../../../src/core/store/ids.js';

// ---------------------------------------------------------------------------
// parseIdParts (moved from src/blueprint/namespace.js in w-2026-08-19-003)
// ---------------------------------------------------------------------------

test('parseIdParts: bare prefix-family id parses with null prefixSlug', () => {
  assert.deepEqual(parseIdParts('REQ-001'), { family: 'REQ', prefixSlug: null, digits: '001', suffixSlug: null });
  assert.deepEqual(parseIdParts('US-201'), { family: 'US', prefixSlug: null, digits: '201', suffixSlug: null });
  assert.deepEqual(parseIdParts('TS-042'), { family: 'TS', prefixSlug: null, digits: '042', suffixSlug: null });
});

test('parseIdParts: prefix-family id with slug captures the slug', () => {
  assert.deepEqual(parseIdParts('spa-REQ-001'), { family: 'REQ', prefixSlug: 'spa', digits: '001', suffixSlug: null });
  assert.deepEqual(parseIdParts('my-blueprint-US-042'), { family: 'US', prefixSlug: 'my-blueprint', digits: '042', suffixSlug: null });
});

test('parseIdParts: bare suffix-family id parses with null suffixSlug', () => {
  assert.deepEqual(parseIdParts('ADR-005'), { family: 'ADR', prefixSlug: null, digits: '005', suffixSlug: null });
  assert.deepEqual(parseIdParts('FBS-003'), { family: 'FBS', prefixSlug: null, digits: '003', suffixSlug: null });
});

test('parseIdParts: suffix-family id with slug captures the slug', () => {
  assert.deepEqual(parseIdParts('ADR-005-spa'), { family: 'ADR', prefixSlug: null, digits: '005', suffixSlug: 'spa' });
  assert.deepEqual(parseIdParts('FBS-004-user-login'), { family: 'FBS', prefixSlug: null, digits: '004', suffixSlug: 'user-login' });
});

test('parseIdParts: AC / TC parse as unnamespaced families', () => {
  assert.equal(parseIdParts('AC-101').family, 'AC');
  assert.equal(parseIdParts('AC-101-1').family, 'AC');
  assert.equal(parseIdParts('TC-101-login').family, 'TC');
});

test('parseIdParts: unknown or non-string input returns null', () => {
  assert.equal(parseIdParts('XYZ-001'), null);
  assert.equal(parseIdParts(''), null);
  assert.equal(parseIdParts(null), null);
  assert.equal(parseIdParts(undefined), null);
  assert.equal(parseIdParts(42), null);
});

// ---------------------------------------------------------------------------
// canonicaliseStem: the load-time inversion of blueprint apply's writer
// (destPathFor uses `${id.toLowerCase()}.json`). Round-trip property:
// canonicaliseStem(id.toLowerCase()) === id for every valid id of every
// family that appears on disk.
// ---------------------------------------------------------------------------

test('canonicaliseStem: suffix-family stems (bare)', () => {
  assert.equal(canonicaliseStem('adr-005'), 'ADR-005');
  assert.equal(canonicaliseStem('fbs-003'), 'FBS-003');
  assert.equal(canonicaliseStem('tac-007'), 'TAC-007');
  assert.equal(canonicaliseStem('cn-001'), 'CN-001');
});

test('canonicaliseStem: suffix-family stems with slug tail preserve tail case verbatim', () => {
  assert.equal(canonicaliseStem('fbs-004-user-login'), 'FBS-004-user-login');
  assert.equal(canonicaliseStem('adr-005-spa'), 'ADR-005-spa');
  assert.equal(canonicaliseStem('adr-005-spa-theme'), 'ADR-005-spa-theme');
});

test('canonicaliseStem: prefix-family stems (bare)', () => {
  assert.equal(canonicaliseStem('req-002'), 'REQ-002');
  assert.equal(canonicaliseStem('us-201'), 'US-201');
  assert.equal(canonicaliseStem('ts-001'), 'TS-001');
  assert.equal(canonicaliseStem('prd-001'), 'PRD-001');
});

test('canonicaliseStem: prefix-family stems with slug head (w-2026-08-19-003 regression)', () => {
  // The whole reason this module exists. Before the fix, walker.js
  // idFromFilenameStem upper-cased only the first dash segment and
  // produced SPA-req-001, which then failed pathForId and bricked every
  // downstream verb.
  assert.equal(canonicaliseStem('spa-req-001'), 'spa-REQ-001');
  assert.equal(canonicaliseStem('spa-us-201'), 'spa-US-201');
  assert.equal(canonicaliseStem('my-blueprint-req-042'), 'my-blueprint-REQ-042');
  assert.equal(canonicaliseStem('spa-ts-001'), 'spa-TS-001');
});

test('canonicaliseStem: round-trip property for every top-level family', () => {
  // For every id of a family that appears on disk, the stem-to-canonical
  // inversion is exact. This is the property idFromFilenameStem + the
  // blueprint apply writer (destPathFor: `${id.toLowerCase()}.json`)
  // require to agree.
  const cases = [
    'REQ-001', 'spa-REQ-001', 'my-blueprint-REQ-042',
    'US-201', 'spa-US-201',
    'TS-001', 'spa-TS-001',
    'ADR-005', 'ADR-005-spa', 'ADR-005-spa-theme',
    'TAC-007', 'TAC-007-spa',
    'FBS-004-user-login', 'FBS-003',
    'CN-001', 'CN-001-spa',
  ];
  for (const id of cases) {
    assert.equal(canonicaliseStem(id.toLowerCase()), id, `round-trip failed for ${id}`);
  }
});

test('canonicaliseStem: non-matching stems return null (defensive fallback lives in walker)', () => {
  assert.equal(canonicaliseStem('xyz-001'), null);
  assert.equal(canonicaliseStem('not-a-real-stem'), null);
  assert.equal(canonicaliseStem('req-'), null);       // no digits
  assert.equal(canonicaliseStem('req-1'), null);      // digits below \d{3,}
  assert.equal(canonicaliseStem(''), null);
  assert.equal(canonicaliseStem(null), null);
});

// ---------------------------------------------------------------------------
// familyLocation: family -> { kind, subdir, rootFile }. This is what
// loader.pathForId consumes.
// ---------------------------------------------------------------------------

test('familyLocation: child families resolve to their subdir', () => {
  assert.deepEqual(familyLocation('REQ'), { kind: 'req', subdir: 'requirements', rootFile: null });
  assert.deepEqual(familyLocation('US'), { kind: 'userStory', subdir: 'user-stories', rootFile: null });
  assert.deepEqual(familyLocation('ADR'), { kind: 'adr', subdir: 'adrs', rootFile: null });
  assert.deepEqual(familyLocation('FBS'), { kind: 'fbs', subdir: 'fbs', rootFile: null });
  assert.deepEqual(familyLocation('CN'), { kind: 'codeNode', subdir: 'code-nodes', rootFile: null });
});

test('familyLocation: root families resolve to their root file', () => {
  assert.deepEqual(familyLocation('PRD'), { kind: 'prd', subdir: null, rootFile: 'prd.json' });
  assert.deepEqual(familyLocation('TAD'), { kind: 'tad', subdir: null, rootFile: 'tad.json' });
  assert.deepEqual(familyLocation('BS'), { kind: 'buildSequence', subdir: null, rootFile: 'build-sequence.json' });
});

test('familyLocation: AC and TC (inline families) return null', () => {
  assert.equal(familyLocation('AC'), null);
  assert.equal(familyLocation('TC'), null);
});

test('family enumerations expose the same shape rcf-schemas 0.4.4 defines', () => {
  assert.deepEqual([...PREFIX_FAMILIES].sort(), ['BS', 'PRD', 'REQ', 'TAD', 'TS', 'US']);
  assert.deepEqual([...SUFFIX_FAMILIES].sort(), ['ADR', 'CN', 'FBS', 'TAC']);
  assert.deepEqual([...UNNAMESPACED_FAMILIES].sort(), ['AC', 'TC']);
});
