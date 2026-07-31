// UI-baseline compose + preflight seam pickup tests (spec §3.2, §5.4, §6).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  baselineDesignDisagreement,
  composeUiBaselineRecord,
  nextUiBaselineId,
  preflightSeamOverrides,
} from '../../src/ui-baseline/manifest-writer.js';

test('nextUiBaselineId allocates monotonic uib-YYYY-MM-DD-NNN per project', () => {
  const now = new Date('2026-07-30T00:00:00Z');
  const empty = nextUiBaselineId(null, now);
  assert.equal(empty, 'uib-2026-07-30-001');
  const first = nextUiBaselineId({ uiBaseline: { id: 'uib-2026-07-30-001' } }, now);
  assert.equal(first, 'uib-2026-07-30-002');
  const withHistory = nextUiBaselineId({
    uiBaseline: { id: 'uib-2026-07-30-004' },
    uiBaselineHistory: [{ id: 'uib-2026-07-30-002' }, { id: 'uib-2026-07-30-003' }],
  }, now);
  assert.equal(withHistory, 'uib-2026-07-30-005');
});

test('composeUiBaselineRecord composes id, timestamps, defaults, and operator ack', () => {
  const now = new Date('2026-07-30T14:15:00Z');
  const record = composeUiBaselineRecord({
    manifest: null,
    prdId: 'PRD-001',
    optOuts: [],
    overrides: {},
    now,
  });
  assert.equal(record.id, 'uib-2026-07-30-001');
  assert.equal(record.prdId, 'PRD-001');
  assert.equal(record.createdAt, '2026-07-30T14:15:00.000Z');
  assert.equal(record.operatorAckAt, '2026-07-30T14:15:00.000Z');
  // §6.1 defaults present.
  assert.equal(record.defaults.themeMode, 'light-default-with-toggle');
  assert.equal(record.defaults.authFlow.htmlLoginPageRequired, true);
});

test('composeUiBaselineRecord folds opt-outs with the same operatorAckAt as the top-level ack', () => {
  const now = new Date('2026-07-30T14:15:00Z');
  const record = composeUiBaselineRecord({
    manifest: null,
    prdId: 'PRD-001',
    optOuts: [{ field: 'componentVocabulary.declaredComponents', reason: 'single-page app; only Button + Notice needed' }],
    now,
  });
  assert.equal(record.operatorOptOuts.length, 1);
  assert.equal(record.operatorOptOuts[0].field, 'componentVocabulary.declaredComponents');
  assert.equal(record.operatorOptOuts[0].operatorAckAt, '2026-07-30T14:15:00.000Z');
});

test('preflightSeamOverrides picks up auth.htmlLoginPage answers, newest wins', () => {
  const manifest = {
    preFlightConfig: [
      {
        id: 'pfc-2026-07-30-001',
        designShapeAnswers: [{ questionId: 'auth.htmlLoginPage', answer: 'htmlLoginPage', answeredAt: 'x' }],
      },
      {
        id: 'pfc-2026-07-30-002',
        designShapeAnswers: [{ questionId: 'auth.htmlLoginPage', answer: 'apiOnly', answeredAt: 'y' }],
      },
    ],
  };
  const overrides = preflightSeamOverrides(manifest);
  assert.equal(overrides['authFlow.htmlLoginPageRequired'], false);
});

test('preflightSeamOverrides returns {} when no preflight answers apply', () => {
  assert.deepEqual(preflightSeamOverrides(null), {});
  assert.deepEqual(preflightSeamOverrides({ preFlightConfig: [] }), {});
  assert.deepEqual(preflightSeamOverrides({ preFlightConfig: [{ id: 'x', designShapeAnswers: [] }] }), {});
});

test('baselineDesignDisagreement reports mismatched values without an opt-out', () => {
  const baseline = { defaults: { themeMode: 'light-default-with-toggle' } };
  const stage = { themeAndA11y: { themeMode: 'dark-default-with-toggle' } };
  const d = baselineDesignDisagreement(baseline, stage, 'themeMode', 'themeAndA11y.themeMode');
  assert.deepEqual(d, {
    path: 'themeMode',
    baselineValue: 'light-default-with-toggle',
    designValue: 'dark-default-with-toggle',
  });
});

test('baselineDesignDisagreement returns null when an opt-out excuses the mismatch', () => {
  const baseline = {
    defaults: { themeMode: 'light-default-with-toggle' },
    operatorOptOuts: [{ field: 'themeMode', reason: 'kiosk mode across the estate', operatorAckAt: 'x' }],
  };
  const stage = { themeAndA11y: { themeMode: 'dark-default-with-toggle' } };
  assert.equal(baselineDesignDisagreement(baseline, stage, 'themeMode', 'themeAndA11y.themeMode'), null);
});

test('baselineDesignDisagreement returns null when either side is missing the field', () => {
  const baseline = { defaults: {} };
  const stage = { themeAndA11y: { themeMode: 'dark-default-with-toggle' } };
  assert.equal(baselineDesignDisagreement(baseline, stage, 'themeMode', 'themeAndA11y.themeMode'), null);
});
