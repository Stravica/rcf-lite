// Report per-AC verdicts (0.7.0 train). The finalise-gate contract lives
// in packages/build/src/finalise/ingest.js; these tests lock the shape
// verify writes so `findMockOnlyDeclaredAcs` / `summariseReport` /
// `reportHasMockOnlyDeclared` all keep passing unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isRcfError } from '#core/errors';
import {
  buildReport,
  parseReport,
  serialiseReport,
  validateReportShape,
} from '../../../src/verify/report/index.js';
import { renderReport } from '../../../src/verify/report/renderer.js';

const baseInputs = {
  profile: 'deployed',
  url: 'https://app.example.com',
  parityEnv: false,
  verdict: 'PASS',
  verdictAuthority: 'ship',
  findings: [],
  blockedAcs: [],
};

test('buildReport: omits perAcVerdicts when the array is empty (backward-compatible)', () => {
  const r = buildReport(baseInputs);
  assert.equal('perAcVerdicts' in r, false);
});

test('buildReport: emits perAcVerdicts as {acId, verdict, reason} entries', () => {
  const r = buildReport({
    ...baseInputs,
    perAcVerdicts: [
      { acId: 'AC-101-2', verdict: 'MOCK-ONLY-DECLARED', reason: 'no live path' },
      { acId: 'AC-101-3', verdict: 'BLOCKED-BY-DECLARATION' },
    ],
  });
  assert.equal(r.perAcVerdicts.length, 2);
  assert.deepEqual(r.perAcVerdicts[0], { acId: 'AC-101-2', verdict: 'MOCK-ONLY-DECLARED', reason: 'no live path' });
  // Reason is omit-not-fake: an entry with no reason is written without the field.
  assert.deepEqual(r.perAcVerdicts[1], { acId: 'AC-101-3', verdict: 'BLOCKED-BY-DECLARATION' });
});

test('serialise -> parse round-trips a report carrying perAcVerdicts', () => {
  const r = buildReport({
    ...baseInputs,
    perAcVerdicts: [
      { acId: 'AC-101-2', verdict: 'UI-BASELINE-UNMET', reason: 'nav missing on /monitors' },
    ],
  });
  const parsed = parseReport(serialiseReport(r));
  assert.ok(!isRcfError(parsed));
  assert.deepEqual(parsed, r);
});

test('validateReportShape: rejects unknown per-AC verdict class as data', () => {
  const err = validateReportShape({
    schemaVersion: '1',
    verdict: 'PASS',
    verdictAuthority: 'ship',
    run: {},
    perAcVerdicts: [{ acId: 'AC-1', verdict: 'GUESS-WORK' }],
  });
  assert.ok(isRcfError(err));
  assert.equal(err.field, 'perAcVerdicts');
});

test('validateReportShape: accepts every 0.7.0 per-AC verdict class', () => {
  for (const verdict of [
    'MOCK-ONLY-DECLARED',
    'BLOCKED-BY-DECLARATION',
    'UI-BASELINE-UNMET',
    'BROWSER-VERIFICATION-MISSING',
  ]) {
    assert.equal(
      validateReportShape({
        schemaVersion: '1',
        verdict: 'PASS',
        verdictAuthority: 'ship',
        run: {},
        perAcVerdicts: [{ acId: 'AC-1', verdict }],
      }),
      null,
      `${verdict} rejected but should validate`,
    );
  }
});

test('validateReportShape: rejects perAcVerdicts that is not an array', () => {
  const err = validateReportShape({
    schemaVersion: '1',
    verdict: 'PASS',
    verdictAuthority: 'ship',
    run: {},
    perAcVerdicts: {},
  });
  assert.ok(isRcfError(err));
  assert.equal(err.field, 'perAcVerdicts');
});

test('renderReport: surfaces per-AC verdicts alongside findings', () => {
  const r = buildReport({
    ...baseInputs,
    perAcVerdicts: [
      { acId: 'AC-101-2', verdict: 'MOCK-ONLY-DECLARED', reason: 'resend attested mocked' },
    ],
  });
  const text = renderReport(r);
  assert.match(text, /Per-AC verdicts \(1\)/);
  assert.match(text, /\[MOCK-ONLY-DECLARED\] AC-101-2/);
  assert.match(text, /resend attested mocked/);
});

test('renderReport: pre-0.7.0 report (no perAcVerdicts) is unchanged', () => {
  const r = buildReport(baseInputs);
  const text = renderReport(r);
  assert.equal(text.includes('Per-AC verdicts'), false);
});
