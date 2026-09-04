// finalise/ingest.js EVAL refusal readers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findEvalRefusalAcs,
  reportHasEvalRefusal,
} from '../../src/finalise/ingest.js';

test('findEvalRefusalAcs returns only EVAL-shaped per-AC entries', () => {
  const report = {
    perAcVerdicts: [
      { acId: 'AC-1', verdict: 'MOCK-ONLY-DECLARED' },
      { acId: 'AC-2', verdict: 'EVAL-MISSING' },
      { acId: 'AC-3', verdict: 'EVAL-BELOW-THRESHOLD' },
    ],
  };
  const out = findEvalRefusalAcs(report);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((e) => e.acId).sort(), ['AC-2', 'AC-3']);
  assert.equal(reportHasEvalRefusal(report), true);
});

test('reportHasEvalRefusal is false when no EVAL verdicts are present', () => {
  const report = { perAcVerdicts: [{ acId: 'AC-1', verdict: 'PASS' }] };
  assert.equal(reportHasEvalRefusal(report), false);
});

test('missing perAcVerdicts field is graceful (older reports)', () => {
  assert.equal(reportHasEvalRefusal({}), false);
  assert.deepEqual(findEvalRefusalAcs({}), []);
});
