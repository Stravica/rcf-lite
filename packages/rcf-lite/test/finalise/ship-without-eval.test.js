// ship-without-eval writer + composer.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  composeShipWithoutEvalRecord,
  nextShipWithoutEvalId,
} from '../../src/finalise/ship-without-eval.js';

test('nextShipWithoutEvalId starts at 1 on an empty manifest', () => {
  assert.equal(nextShipWithoutEvalId({}, 'FBS-001'), 'swe-FBS-001-1');
});

test('nextShipWithoutEvalId increments monotonically', () => {
  const manifest = {
    shipWithoutEval: [
      { id: 'swe-FBS-001-1' },
      { id: 'swe-FBS-001-2' },
    ],
  };
  assert.equal(nextShipWithoutEvalId(manifest, 'FBS-001'), 'swe-FBS-001-3');
});

test('composeShipWithoutEvalRecord carries the operator reason and the declared AC verdicts', () => {
  const record = composeShipWithoutEvalRecord({
    manifest: null,
    fbsId: 'FBS-042',
    reason: 'harness offline in CI',
    declaredAcs: [
      { acId: 'AC-1', verdict: 'EVAL-MISSING', reason: 'no bound EVAL' },
      { acId: 'AC-2', verdict: 'EVAL-BELOW-THRESHOLD' },
    ],
    reportPath: '.rcf-verify-report.json',
    now: new Date('2026-09-04T18:00:00Z'),
  });
  assert.equal(record.fbsId, 'FBS-042');
  assert.equal(record.reason, 'harness offline in CI');
  assert.equal(record.ackedAt, '2026-09-04T18:00:00.000Z');
  assert.equal(record.declaredAcs.length, 2);
  assert.equal(record.declaredAcs[0].reason, 'no bound EVAL');
  // Second entry has no reason field (not just an empty one).
  assert.equal(Object.prototype.hasOwnProperty.call(record.declaredAcs[1], 'reason'), false);
  assert.equal(record.reportPath, '.rcf-verify-report.json');
});
