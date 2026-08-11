// Tests for `#core/baseline-catalog` - the five
// REQ-shape baseline sets (Track C+D §5.2.1-§5.2.5).
//
// AC coverage:
//   - catalog-01: five shape sets present and non-empty
//   - catalog-02: entry counts match spec (webUi 6, httpApi 4, auth 4, persistence 3, notifications 3)
//   - catalog-03: every entry carries the full contract: baselineKey/canonicalText/given/when/then/testable
//   - catalog-04: baselineKey is unique across all shapes
//   - catalog-05: canonicalText starts with "given " and matches spec verbatim (spot-check)
//   - catalog-06: no em-dashes in any canonicalText (shipped-canonical-text lint)
//   - catalog-07: `getBaselineSet` returns the right set / null for unknown shapes
//   - catalog-08: `getBaselineEntry` resolves any baselineKey
//   - catalog-09: `iterateBaselineEntries` visits every entry in canonical order
//   - catalog-10: catalog is frozen (shared source cannot be mutated)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASELINE_CATALOG_V1,
  BASELINE_SHAPE_KEYS,
  getBaselineSet,
  getBaselineEntry,
  iterateBaselineEntries,
} from '../../../src/core/baseline-catalog/index.js';

const EXPECTED_ENTRY_COUNT = {
  webUi: 6,
  httpApi: 4,
  auth: 4,
  persistence: 3,
  notifications: 3,
};

test('catalog-01: five shape sets present and non-empty', () => {
  assert.deepEqual([...BASELINE_SHAPE_KEYS], ['webUi', 'httpApi', 'auth', 'persistence', 'notifications']);
  for (const shape of BASELINE_SHAPE_KEYS) {
    assert.ok(BASELINE_CATALOG_V1[shape], `${shape} missing`);
    assert.ok(BASELINE_CATALOG_V1[shape].entries.length > 0, `${shape} empty`);
  }
});

test('catalog-02: entry counts match spec (webUi 6, httpApi 4, auth 4, persistence 3, notifications 3)', () => {
  for (const [shape, expected] of Object.entries(EXPECTED_ENTRY_COUNT)) {
    assert.equal(
      BASELINE_CATALOG_V1[shape].entries.length,
      expected,
      `${shape} expected ${expected} entries, got ${BASELINE_CATALOG_V1[shape].entries.length}`,
    );
  }
});

test('catalog-03: every entry carries the full contract', () => {
  for (const { shape, entry } of iterateBaselineEntries()) {
    assert.equal(typeof entry.baselineKey, 'string', `${shape}: baselineKey missing`);
    assert.ok(entry.baselineKey.startsWith(`${shape}.`), `baselineKey "${entry.baselineKey}" must be prefixed with its shape`);
    assert.equal(typeof entry.canonicalText, 'string', `${entry.baselineKey}: canonicalText missing`);
    assert.equal(typeof entry.given, 'string');
    assert.equal(typeof entry.when, 'string');
    assert.equal(typeof entry.then, 'string');
    assert.equal(entry.testable, true, `${entry.baselineKey}: testable must be true`);
  }
});

test('catalog-04: baselineKey is unique across all shapes', () => {
  const seen = new Set();
  for (const { entry } of iterateBaselineEntries()) {
    assert.ok(!seen.has(entry.baselineKey), `duplicate baselineKey: ${entry.baselineKey}`);
    seen.add(entry.baselineKey);
  }
  // 6 + 4 + 4 + 3 + 3 = 20
  assert.equal(seen.size, 20);
});

test('catalog-05: canonicalText matches spec verbatim (spot-check webUi.sharedNav + auth.postLogout)', () => {
  const sharedNav = getBaselineEntry('webUi.sharedNav');
  assert.ok(sharedNav);
  assert.equal(
    sharedNav.canonicalText,
    'given the user is signed in, when any authenticated route is loaded, then the response HTML renders the shared nav element (declared by `uiBaseline.defaults.sharedLayoutModule`) with `aria-current="page"` on the nav link whose href matches the current route.',
  );

  const postLogout = getBaselineEntry('auth.postLogout');
  assert.ok(postLogout);
  assert.equal(
    postLogout.canonicalText,
    'given a signed-in session, when `POST /logout` is invoked, then the session cookie is cleared (Set-Cookie with an expiry in the past), the response is 302 to `/login` (or the project-declared post-logout route), and subsequent requests to protected routes return 401 or 302 as the REQ defines.',
  );
});

test('catalog-06: no em-dashes in canonicalText or notes (shipped-canonical-text lint)', () => {
  const emDash = '—'; // U+2014
  const enDash = '–'; // U+2013 (also disallowed as em-dash substitute)
  for (const { entry } of iterateBaselineEntries()) {
    assert.ok(!entry.canonicalText.includes(emDash), `${entry.baselineKey}: canonicalText contains em-dash`);
    assert.ok(!entry.canonicalText.includes(enDash), `${entry.baselineKey}: canonicalText contains en-dash`);
    if (entry.notes) {
      assert.ok(!entry.notes.includes(emDash), `${entry.baselineKey}: notes contains em-dash`);
      assert.ok(!entry.notes.includes(enDash), `${entry.baselineKey}: notes contains en-dash`);
    }
  }
});

test('catalog-07: getBaselineSet returns the right set / null for unknown shapes', () => {
  assert.equal(getBaselineSet('webUi').sourceReqShape, 'webUi');
  assert.equal(getBaselineSet('httpApi').sourceReqShape, 'httpApi');
  assert.equal(getBaselineSet('unknown'), null);
  assert.equal(getBaselineSet('none'), null);
});

test('catalog-08: getBaselineEntry resolves any baselineKey and returns null for unknown', () => {
  for (const { entry } of iterateBaselineEntries()) {
    const looked = getBaselineEntry(entry.baselineKey);
    assert.ok(looked, `${entry.baselineKey}: not found by lookup`);
    assert.equal(looked.canonicalText, entry.canonicalText);
  }
  assert.equal(getBaselineEntry('unknown.key'), null);
});

test('catalog-09: iterateBaselineEntries visits every entry in canonical order', () => {
  const seen = [];
  for (const { shape, entry } of iterateBaselineEntries()) {
    seen.push({ shape, key: entry.baselineKey });
  }
  const first = seen[0];
  assert.equal(first.shape, 'webUi');
  assert.equal(first.key, 'webUi.sharedNav');
  const last = seen[seen.length - 1];
  assert.equal(last.shape, 'notifications');
  assert.equal(last.key, 'notifications.channelIdentification');
});

test('catalog-10: catalog is frozen (shared source cannot be mutated)', () => {
  assert.throws(() => { BASELINE_CATALOG_V1.newShape = { entries: [] }; });
  assert.throws(() => { BASELINE_CATALOG_V1.webUi.entries.push({ baselineKey: 'bad' }); });
});
