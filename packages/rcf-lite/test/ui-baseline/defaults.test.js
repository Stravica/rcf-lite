// UI-baseline defaults + compose tests (spec §6.1, §6.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  UI_BASELINE_DEFAULTS_V1,
  composeDefaults,
  deepGet,
  deepSet,
  isKnownBaselinePath,
} from '../../src/ui-baseline/defaults.js';

test('UI_BASELINE_DEFAULTS_V1 covers every §6.1 ruled field with a deterministic value', () => {
  const paths = UI_BASELINE_DEFAULTS_V1.map((s) => s.path);
  // Spec §6.1 ratifies eighteen field rulings; the catalogue MUST land
  // every one of them so an operator sees the full list on the summary
  // screen (spec §5.4 enter-to-accept-all).
  assert.equal(paths.length, 18);
  const expectedPaths = [
    'themeMode', 'sharedLayoutModule', 'designTokensModule', 'noHexInViewFiles',
    'contrastTarget', 'contrastTestBeforePalette', 'focusRingsRequired', 'hoverStatesRequired',
    'componentVocabulary.declaredComponents', 'componentVocabulary.singleBadgeShape',
    'typography.baseFontStack', 'typography.bodyLineHeight', 'typography.headingLineHeight', 'typography.proseMaxWidth',
    'interactionDefaults.loadingIndicatorOnFetch', 'interactionDefaults.disabledStateVisuallyDistinct',
    'authFlow.htmlLoginPageRequired', 'authFlow.smokeChecksRequired',
  ];
  assert.deepEqual(paths.sort(), [...expectedPaths].sort());
});

test('composeDefaults places every ruled value at its dot-path', () => {
  const defaults = composeDefaults();
  assert.equal(defaults.themeMode, 'light-default-with-toggle');
  assert.equal(defaults.sharedLayoutModule, 'src/ui/layout.ts');
  assert.equal(defaults.designTokensModule, 'src/ui/tokens.ts');
  assert.equal(defaults.noHexInViewFiles, true);
  assert.equal(defaults.contrastTarget, 'WCAG AA');
  assert.deepEqual(defaults.componentVocabulary.declaredComponents, ['Button', 'Input', 'Card', 'Badge', 'Table', 'Notice']);
  assert.equal(defaults.componentVocabulary.singleBadgeShape, true);
  assert.equal(defaults.typography.proseMaxWidth, '72ch');
  assert.equal(defaults.authFlow.htmlLoginPageRequired, true);
  assert.equal(defaults.authFlow.smokeChecksRequired, true);
});

test('composeDefaults applies overrides (dot-path -> value) after the ruled defaults', () => {
  const defaults = composeDefaults({ 'authFlow.htmlLoginPageRequired': false, 'themeMode': 'dark-default-with-toggle' });
  assert.equal(defaults.authFlow.htmlLoginPageRequired, false);
  assert.equal(defaults.themeMode, 'dark-default-with-toggle');
  // Sibling values in the same nested object are preserved.
  assert.equal(defaults.authFlow.smokeChecksRequired, true);
});

test('composeDefaults copies arrays, not shares references', () => {
  const a = composeDefaults();
  const b = composeDefaults();
  a.componentVocabulary.declaredComponents.push('Sneaky');
  assert.equal(b.componentVocabulary.declaredComponents.includes('Sneaky'), false);
});

test('deepSet + deepGet round-trip nested paths', () => {
  const obj = {};
  deepSet(obj, 'a.b.c', 42);
  deepSet(obj, 'a.b.d', 'hello');
  deepSet(obj, 'top', true);
  assert.equal(deepGet(obj, 'a.b.c'), 42);
  assert.equal(deepGet(obj, 'a.b.d'), 'hello');
  assert.equal(deepGet(obj, 'top'), true);
  assert.equal(deepGet(obj, 'a.missing'), undefined);
});

test('isKnownBaselinePath knows every ruled field and refuses unknowns', () => {
  assert.equal(isKnownBaselinePath('themeMode'), true);
  assert.equal(isKnownBaselinePath('componentVocabulary.declaredComponents'), true);
  assert.equal(isKnownBaselinePath('authFlow.htmlLoginPageRequired'), true);
  assert.equal(isKnownBaselinePath('typography.proseMaxWidth'), true);
  assert.equal(isKnownBaselinePath('made.up.path'), false);
  assert.equal(isKnownBaselinePath(''), false);
});
