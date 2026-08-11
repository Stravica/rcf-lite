// Tests for `@stravica-ai/rcf-lite-core/patterns/ui-shapes` - the UI seed
// pattern set consumed by the Track B UI-bearing FBS classifier AND (via
// `req-shapes.js`) the Track C+D REQ-shape classifier.
//
// AC coverage:
//   - ui-shapes-01: `UI_SEED_PATTERNS_V1` exposes every category from spec §4.3
//   - ui-shapes-02: `matchUiSignals` fires on an explicit UI noun
//   - ui-shapes-03: `matchUiSignals` fires on an HTML/render verb
//   - ui-shapes-04: `matchUiSignals` fires on a response-shape signal
//   - ui-shapes-05: `matchUiSignals` fires on an auth-flow signal
//   - ui-shapes-06: `matchUiSignals` fires on an accessibility signal
//   - ui-shapes-07: sentences containing an excluded phrase are suppressed
//   - ui-shapes-08: single-match verdict (over-collect posture; false-positives cheap)
//   - ui-shapes-09: case-insensitive matching
//   - ui-shapes-10: `UI_EXCLUDED_PHRASES` covers every phrase spec §4.3 lists

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  UI_SEED_PATTERNS_V1,
  UI_EXCLUDED_PHRASES,
  matchUiSignals,
} from '../../src/patterns/ui-shapes.js';

test('ui-shapes-01: UI_SEED_PATTERNS_V1 exposes every category from spec §4.3', () => {
  const expected = [
    'explicitUiNouns',
    'htmlRenderVerbs',
    'responseShapeSignals',
    'authFlowSignals',
    'accessibilitySignals',
  ];
  for (const category of expected) {
    assert.ok(Array.isArray(UI_SEED_PATTERNS_V1[category]), `${category} missing`);
    assert.ok(UI_SEED_PATTERNS_V1[category].length > 0, `${category} empty`);
  }
  assert.deepEqual(Object.keys(UI_SEED_PATTERNS_V1).sort(), [...expected].sort());
});

test('ui-shapes-02: matchUiSignals fires on an explicit UI noun', () => {
  const signals = matchUiSignals('Operator opens the dashboard to see recent activity.');
  assert.ok(signals.length >= 1);
  assert.ok(signals.some((s) => s.category === 'explicitUiNouns' && s.match.toLowerCase() === 'dashboard'));
});

test('ui-shapes-03: matchUiSignals fires on an HTML/render verb', () => {
  const signals = matchUiSignals('The application renders a summary card.');
  assert.ok(signals.some((s) => s.category === 'htmlRenderVerbs'));
});

test('ui-shapes-04: matchUiSignals fires on a response-shape signal', () => {
  const signals = matchUiSignals('Server returns HTML for every route.');
  assert.ok(signals.some((s) => s.category === 'responseShapeSignals' && /html/i.test(s.match)));
});

test('ui-shapes-05: matchUiSignals fires on an auth-flow signal', () => {
  const signals = matchUiSignals('Owner submits the login form to authenticate.');
  assert.ok(signals.some((s) => s.category === 'authFlowSignals' && /login form/i.test(s.match)));
});

test('ui-shapes-06: matchUiSignals fires on an accessibility signal', () => {
  const signals = matchUiSignals('The theme meets WCAG AA contrast for every text-on-background pair.');
  assert.ok(signals.some((s) => s.category === 'accessibilitySignals'));
});

test('ui-shapes-07: sentences containing an excluded phrase are suppressed', () => {
  // A sentence about an API endpoint that happens to name "page" should NOT
  // fire, per the §4.3 exclusion rule (favours ui only when ambiguous).
  const signals = matchUiSignals('This API endpoint returns a page cursor as JSON.');
  assert.equal(signals.length, 0, `unexpected matches: ${JSON.stringify(signals)}`);
});

test('ui-shapes-08: a single match is enough to trigger the UI verdict (over-collect posture)', () => {
  const signals = matchUiSignals('This REQ concerns a form.');
  assert.equal(signals.length, 1);
  assert.equal(signals[0].match.toLowerCase(), 'form');
});

test('ui-shapes-09: matching is case-insensitive', () => {
  const upper = matchUiSignals('The DASHBOARD shows results.');
  const lower = matchUiSignals('the dashboard shows results.');
  assert.ok(upper.some((s) => s.match.toLowerCase() === 'dashboard'));
  assert.ok(lower.some((s) => s.match.toLowerCase() === 'dashboard'));
});

test('ui-shapes-10: UI_EXCLUDED_PHRASES covers every phrase spec §4.3 lists', () => {
  const specPhrases = ['API endpoint', 'CLI command', 'shell prompt', 'JSON response'];
  for (const phrase of specPhrases) {
    assert.ok(UI_EXCLUDED_PHRASES.includes(phrase), `${phrase} missing from UI_EXCLUDED_PHRASES`);
  }
});

test('ui-shapes-11: UI_SEED_PATTERNS_V1 is frozen (shared source cannot be mutated)', () => {
  assert.throws(() => { UI_SEED_PATTERNS_V1.newCategory = ['bad']; });
  assert.throws(() => { UI_SEED_PATTERNS_V1.explicitUiNouns.push('bad'); });
});

test('ui-shapes-12: multi-signal input records every hit in document order', () => {
  const signals = matchUiSignals('The dashboard renders a shared nav on every page.');
  // "dashboard" (noun) then "renders" (verb) then "nav" (noun) then "page" (noun).
  assert.ok(signals.length >= 3);
  for (let i = 1; i < signals.length; i += 1) {
    assert.ok(signals[i].index >= signals[i - 1].index, 'signals not sorted by document offset');
  }
});
