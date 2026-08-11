// Track B (ui-design-gate-0.7.0-spec §5.5, §7 mandate 10): unit tests
// for the pure mark-complete Design gate + contrast-before-palette gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkDesignGate, checkContrastBeforePaletteGate } from '../../src/build/mark.js';

test('checkDesignGate: non-uiBearing FBS always passes', () => {
  assert.deepEqual(checkDesignGate({ uiBearing: false }), { ok: true });
  assert.deepEqual(checkDesignGate({}), { ok: true });
});

test('checkDesignGate: uiBearing FBS with designStageComplete=true passes', () => {
  assert.deepEqual(checkDesignGate({ uiBearing: true, designStageComplete: true }), { ok: true });
});

test('checkDesignGate: uiBearing FBS without designStageComplete refuses', () => {
  const result = checkDesignGate({ uiBearing: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'designStageIncomplete');
});

test('checkDesignGate: uiBearing FBS with designStageComplete=false refuses', () => {
  const result = checkDesignGate({ uiBearing: true, designStageComplete: false });
  assert.equal(result.ok, false);
});

test('checkContrastBeforePaletteGate: non-uiBearing FBS always passes', () => {
  assert.deepEqual(checkContrastBeforePaletteGate({ uiBearing: false }), { ok: true });
});

test('checkContrastBeforePaletteGate: passes when themeAndA11y is absent (deferred to design surface)', () => {
  assert.deepEqual(checkContrastBeforePaletteGate({ uiBearing: true, designStage: {} }), { ok: true });
});

test('checkContrastBeforePaletteGate: refuses when the operator has attested contrastTestAuthoredBeforePalette=false', () => {
  const fbs = {
    fbsId: 'FBS-016',
    uiBearing: true,
    designStage: { themeAndA11y: { themeMode: 'light-default-with-toggle', contrastTestAuthoredBeforePalette: false } },
  };
  const result = checkContrastBeforePaletteGate(fbs);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'contrastTestAfterPalette');
  assert.match(result.message, /contrastTestAuthoredBeforePalette is false/);
});

test('checkContrastBeforePaletteGate: passes when boolean=true and history probe is inconclusive (default)', () => {
  const fbs = {
    fbsId: 'FBS-016', uiBearing: true,
    designStage: { themeAndA11y: { themeMode: 'light-default-with-toggle', contrastTestAuthoredBeforePalette: true, themeTokensModule: 'src/ui/tokens.ts', contrastTestPath: 'test/x.test.ts' } },
  };
  assert.deepEqual(checkContrastBeforePaletteGate(fbs), { ok: true });
});

test('checkContrastBeforePaletteGate: refuses when boolean=true but git history unambiguously contradicts', () => {
  const fbs = {
    fbsId: 'FBS-016', uiBearing: true,
    designStage: { themeAndA11y: { themeMode: 'light-default-with-toggle', contrastTestAuthoredBeforePalette: true, themeTokensModule: 'src/ui/tokens.ts', contrastTestPath: 'test/x.test.ts' } },
  };
  const result = checkContrastBeforePaletteGate(fbs, { inconclusive: false, tokensCreatedFirst: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'contrastGitHistoryConflict');
});
