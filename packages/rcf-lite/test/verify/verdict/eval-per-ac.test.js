// evalPerAcVerdict + derivePerAcVerdicts EVAL integration. Covers the
// two new classes (EVAL-MISSING, EVAL-BELOW-THRESHOLD) and the
// deterministic-AC no-op guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PER_AC_VERDICTS,
  derivePerAcVerdicts,
  evalPerAcVerdict,
} from '../../../src/verify/verdict/index.js';

test('PER_AC_VERDICTS carries the two new EVAL classes', () => {
  assert.ok(PER_AC_VERDICTS.includes('EVAL-MISSING'));
  assert.ok(PER_AC_VERDICTS.includes('EVAL-BELOW-THRESHOLD'));
});

test('deterministic ACs never emit an EVAL verdict', () => {
  const v = evalPerAcVerdict({ acId: 'AC-1', determinism: 'deterministic', evalStatus: 'absent' });
  assert.equal(v, null);
});

test('nonDeterministic AC without a resolving EVAL fires EVAL-MISSING', () => {
  const v = evalPerAcVerdict({
    acId: 'AC-2',
    determinism: 'nonDeterministic',
    evalStatus: 'absent',
    evalRunVerdict: null,
  });
  assert.equal(v.verdict, 'EVAL-MISSING');
  assert.match(v.reason, /nonDeterministic/);
});

test('nonDeterministic AC with a failing EVAL run fires EVAL-BELOW-THRESHOLD', () => {
  const v = evalPerAcVerdict({
    acId: 'AC-3',
    determinism: 'nonDeterministic',
    evalStatus: 'resolving',
    evalRunVerdict: 'fail',
  });
  assert.equal(v.verdict, 'EVAL-BELOW-THRESHOLD');
});

test('nonDeterministic AC with a passing EVAL run emits no verdict', () => {
  const v = evalPerAcVerdict({
    acId: 'AC-4',
    determinism: 'nonDeterministic',
    evalStatus: 'resolving',
    evalRunVerdict: 'pass',
  });
  assert.equal(v, null);
});

test('derivePerAcVerdicts folds EVAL classes alongside the pre-existing per-AC verdicts', () => {
  const acs = [
    { acId: 'AC-a', determinism: 'nonDeterministic', evalStatus: 'absent', evalRunVerdict: null },
    { acId: 'AC-b', determinism: 'nonDeterministic', evalStatus: 'resolving', evalRunVerdict: 'fail' },
    { acId: 'AC-c', determinism: 'deterministic' },
  ];
  const out = derivePerAcVerdicts({ acs });
  const found = out.map((e) => `${e.acId}/${e.verdict}`);
  assert.ok(found.includes('AC-a/EVAL-MISSING'));
  assert.ok(found.includes('AC-b/EVAL-BELOW-THRESHOLD'));
  assert.ok(!found.some((f) => f.startsWith('AC-c/EVAL-')));
});
