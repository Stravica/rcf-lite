// Design-shape catalogue + selector unit tests
// (verification-integrity-cluster-spec ADDENDUM §A).
//
// The v1 catalogue carries exactly one question. Any change to that
// count is a spec change (§A.3) and must be reflected in tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATALOGUE_V1,
  selectApplicableQuestions,
  validateDesignShapeAnswer,
} from '../../src/preflight/design-shapes.js';

test('the v1 catalogue carries exactly one question: auth.htmlLoginPage', () => {
  assert.equal(CATALOGUE_V1.length, 1);
  assert.equal(CATALOGUE_V1[0].id, 'auth.htmlLoginPage');
  assert.equal(CATALOGUE_V1[0].scope, 'reqScoped');
  assert.equal(CATALOGUE_V1[0].reasonMinLength, 20);
  const values = CATALOGUE_V1[0].choices.map((c) => c.value);
  assert.deepEqual(values.sort(), ['apiOnly', 'htmlLoginPage']);
});

test('selectApplicableQuestions fires auth.htmlLoginPage on a REQ carrying shapeClassification.shapes:[auth]', () => {
  const reqs = [
    { reqId: 'REQ-101', shapeClassification: { shapes: ['auth'] } },
    { reqId: 'REQ-102', shapeClassification: { shapes: ['webUi'] } },
  ];
  const applicable = selectApplicableQuestions(reqs);
  assert.equal(applicable.length, 1);
  assert.equal(applicable[0].reqId, 'REQ-101');
  assert.equal(applicable[0].question.id, 'auth.htmlLoginPage');
});

test('selectApplicableQuestions falls back to prose matching when shapeClassification is absent', () => {
  const reqs = [
    { reqId: 'REQ-201', title: 'Sign-in via OAuth provider', description: '', rationale: '' },
    { reqId: 'REQ-202', title: 'Report page', description: 'nothing about auth', rationale: '' },
  ];
  const applicable = selectApplicableQuestions(reqs);
  assert.equal(applicable.length, 1);
  assert.equal(applicable[0].reqId, 'REQ-201');
});

test('validateDesignShapeAnswer accepts a valid htmlLoginPage answer', () => {
  const err = validateDesignShapeAnswer({ questionId: 'auth.htmlLoginPage', answer: 'htmlLoginPage' });
  assert.equal(err, null);
});

test('validateDesignShapeAnswer refuses apiOnly without a ledger-floor reason', () => {
  const err = validateDesignShapeAnswer({ questionId: 'auth.htmlLoginPage', answer: 'apiOnly', reason: 'too short' });
  assert.notEqual(err, null);
  assert.match(err, /at least 20 characters/);
});

test('validateDesignShapeAnswer accepts apiOnly with a 20+ char reason', () => {
  const err = validateDesignShapeAnswer({
    questionId: 'auth.htmlLoginPage',
    answer: 'apiOnly',
    reason: 'SDK-only clients; no HTML flow ships in v1',
  });
  assert.equal(err, null);
});

test('validateDesignShapeAnswer refuses unknown questionId / answer', () => {
  assert.match(validateDesignShapeAnswer({ questionId: 'nope', answer: 'x' }), /unknown design-shape question/);
  assert.match(validateDesignShapeAnswer({ questionId: 'auth.htmlLoginPage', answer: 'maybe' }), /unknown answer/);
});

test('CATALOGUE_V1 is deep-frozen at every nested level (review N-6)', () => {
  // Object.freeze is shallow, so the review flagged that a caller could
  // mutate a choice's `triggersOptOut` even on the outwardly frozen
  // catalogue. deepFreeze closes the gap.
  assert.equal(Object.isFrozen(CATALOGUE_V1), true, 'top-level array frozen');
  const question = CATALOGUE_V1[0];
  assert.equal(Object.isFrozen(question), true, 'question object frozen');
  assert.equal(Object.isFrozen(question.choices), true, 'choices array frozen');
  for (const choice of question.choices) {
    assert.equal(Object.isFrozen(choice), true, `choice ${choice.value} frozen`);
    assert.throws(
      () => { choice.triggersOptOut = !choice.triggersOptOut; },
      TypeError,
      `mutating triggersOptOut on ${choice.value} must throw in strict mode`,
    );
  }
});
