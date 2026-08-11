// Tests for `#core/patterns/req-shapes` - the REQ-shape
// classifier's pattern set (Track C+D §4.3).
//
// AC coverage:
//   - req-shapes-01: `REQ_SHAPE_PATTERNS_V1` exposes the five shapes and only those
//   - req-shapes-02: `webUi` shape is populated from `UI_SEED_PATTERNS_V1` (single source of truth)
//   - req-shapes-03: `httpApi` matches on `api`, `endpoint`, `POST`, `GET`
//   - req-shapes-04: `auth` matches on `login`, `session`, `token`, `magic-link`
//   - req-shapes-05: `persistence` matches on `database`, `migration`, `survives restart`
//   - req-shapes-06: `notifications` matches on `email`, `SMS`, `webhook deliver`
//   - req-shapes-07: `matchReqShapeSignals` returns per-shape provenance in document order
//   - req-shapes-08: `SHAPE_KEYS` and `SHAPE_KEYS_WITH_NONE` match spec §4.2

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  REQ_SHAPE_PATTERNS_V1,
  SHAPE_KEYS,
  SHAPE_KEYS_WITH_NONE,
  matchReqShapeSignals,
} from '../../../src/core/patterns/req-shapes.js';
import { UI_SEED_PATTERNS_V1 } from '../../../src/core/patterns/ui-shapes.js';

test('req-shapes-01: REQ_SHAPE_PATTERNS_V1 exposes the five shapes and only those', () => {
  const expected = ['webUi', 'httpApi', 'auth', 'persistence', 'notifications'];
  assert.deepEqual(Object.keys(REQ_SHAPE_PATTERNS_V1).sort(), [...expected].sort());
  for (const shape of expected) {
    assert.ok(Array.isArray(REQ_SHAPE_PATTERNS_V1[shape]));
    assert.ok(REQ_SHAPE_PATTERNS_V1[shape].length > 0);
  }
});

test('req-shapes-02: webUi shape is composed from UI_SEED_PATTERNS_V1 (single source of truth)', () => {
  // Every explicit UI noun from ui-shapes must be present in webUi's pattern list.
  for (const noun of UI_SEED_PATTERNS_V1.explicitUiNouns) {
    assert.ok(
      REQ_SHAPE_PATTERNS_V1.webUi.includes(noun),
      `webUi missing UI noun "${noun}"`,
    );
  }
  // And an accessibility signal too.
  assert.ok(REQ_SHAPE_PATTERNS_V1.webUi.some((p) => p === 'WCAG'));
});

test('req-shapes-03: httpApi matches on api / endpoint / POST / GET', () => {
  const signals = matchReqShapeSignals('The system exposes an api endpoint that accepts POST or GET.');
  const httpApiMatches = signals.filter((s) => s.shape === 'httpApi').map((s) => s.match.toLowerCase());
  assert.ok(httpApiMatches.includes('api'));
  assert.ok(httpApiMatches.includes('endpoint'));
  assert.ok(httpApiMatches.some((m) => m === 'post'));
  assert.ok(httpApiMatches.some((m) => m === 'get'));
});

test('req-shapes-04: auth matches on login / session / token / magic-link', () => {
  const signals = matchReqShapeSignals('Users login via a magic-link that establishes a session token.');
  const authMatches = signals.filter((s) => s.shape === 'auth').map((s) => s.match.toLowerCase());
  assert.ok(authMatches.includes('login'));
  assert.ok(authMatches.includes('session'));
  assert.ok(authMatches.includes('token'));
  assert.ok(authMatches.some((m) => m.startsWith('magic')));
});

test('req-shapes-05: persistence matches on database / migration / survives restart', () => {
  const signals = matchReqShapeSignals('The database schema requires a migration; state survives a restart.');
  const persMatches = signals.filter((s) => s.shape === 'persistence').map((s) => s.match.toLowerCase());
  assert.ok(persMatches.includes('database'));
  assert.ok(persMatches.includes('migration'));
  assert.ok(persMatches.some((m) => /survives?/.test(m)));
});

test('req-shapes-06: notifications matches on email / SMS / webhook deliver', () => {
  const signals = matchReqShapeSignals('On failure send an email or SMS; a webhook delivers to Slack.');
  const notifMatches = signals.filter((s) => s.shape === 'notifications').map((s) => s.match.toLowerCase());
  assert.ok(notifMatches.includes('email'));
  assert.ok(notifMatches.includes('sms'));
  assert.ok(notifMatches.some((m) => /webhook/.test(m)));
});

test('req-shapes-07: matchReqShapeSignals returns per-shape provenance in document order', () => {
  const signals = matchReqShapeSignals('The dashboard renders login form results from the database.');
  // Some signals overlap shapes (webUi vs auth); each has its own record.
  const shapes = new Set(signals.map((s) => s.shape));
  assert.ok(shapes.has('webUi'));
  assert.ok(shapes.has('auth'));
  assert.ok(shapes.has('persistence'));
  for (let i = 1; i < signals.length; i += 1) {
    assert.ok(signals[i].index >= signals[i - 1].index, 'signals not sorted by document offset');
  }
});

test('req-shapes-08: SHAPE_KEYS / SHAPE_KEYS_WITH_NONE match spec §4.2', () => {
  assert.deepEqual([...SHAPE_KEYS], ['webUi', 'httpApi', 'auth', 'persistence', 'notifications']);
  assert.deepEqual([...SHAPE_KEYS_WITH_NONE], ['webUi', 'httpApi', 'auth', 'persistence', 'notifications', 'none']);
});

test('req-shapes-09: REQ_SHAPE_PATTERNS_V1 is frozen (shared source cannot be mutated)', () => {
  assert.throws(() => { REQ_SHAPE_PATTERNS_V1.newShape = ['bad']; });
  assert.throws(() => { REQ_SHAPE_PATTERNS_V1.auth.push('bad'); });
});

test('req-shapes-10: text with no shape signals returns an empty array', () => {
  const signals = matchReqShapeSignals('Billing rules that calculate entitlements offline.');
  // "table" is a persistence signal; this sentence should not include one.
  assert.equal(signals.length, 0);
});
