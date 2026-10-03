// Unit tests for src/define/concern-catalogue.js (PR 6; spec section 4
// row 'D5 catalogue'). The catalogue is the pure applicability map D5's
// crosscut:catalogue check reads to enumerate the (reqShape, concern)
// pairs each REQ in scope must have a concern-ledger entry for.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONCERN_KEYS,
  CONCERN_APPLICABILITY,
  REQ_SHAPES,
  applicableConcernsFor,
  applicableConcernsForShapes,
} from '../../src/define/concern-catalogue.js';

test('concern-catalogue (PR 6): CONCERN_KEYS lists the eight concerns in canonical order', () => {
  assert.deepEqual([...CONCERN_KEYS], [
    'auth',
    'errorEnvelope',
    'loggingAudit',
    'retention',
    'performance',
    'secrets',
    'timeAndTimezone',
    'concurrencyIdempotency',
  ]);
});

test('concern-catalogue (PR 6): applicability table matches spec section 4 D5', () => {
  // Verbatim from the spec: eight concerns keyed by REQ shape.
  assert.deepEqual([...CONCERN_APPLICABILITY.auth], ['auth', 'httpApi']);
  assert.deepEqual([...CONCERN_APPLICABILITY.errorEnvelope], ['httpApi', 'cliCommand']);
  // loggingAudit: every REQ shape but other.
  const everyButOther = REQ_SHAPES.filter((s) => s !== 'other');
  assert.deepEqual([...CONCERN_APPLICABILITY.loggingAudit], [...everyButOther]);
  assert.deepEqual([...CONCERN_APPLICABILITY.retention], ['persistence']);
  assert.deepEqual([...CONCERN_APPLICABILITY.performance], ['httpApi', 'batch']);
  assert.deepEqual([...CONCERN_APPLICABILITY.secrets], ['auth', 'externalIntegration']);
  assert.deepEqual([...CONCERN_APPLICABILITY.timeAndTimezone], ['persistence', 'batch']);
  assert.deepEqual([...CONCERN_APPLICABILITY.concurrencyIdempotency], ['httpApi', 'persistence']);
});

test('concern-catalogue (PR 6): applicableConcernsFor returns the concerns for a REQ shape, in canonical order', () => {
  assert.deepEqual(applicableConcernsFor('auth'), ['auth', 'loggingAudit', 'secrets']);
  // httpApi carries auth, errorEnvelope, loggingAudit, performance, concurrencyIdempotency.
  assert.deepEqual(applicableConcernsFor('httpApi'), [
    'auth', 'errorEnvelope', 'loggingAudit', 'performance', 'concurrencyIdempotency',
  ]);
  assert.deepEqual(applicableConcernsFor('cliCommand'), ['errorEnvelope', 'loggingAudit']);
  assert.deepEqual(applicableConcernsFor('persistence'), [
    'loggingAudit', 'retention', 'timeAndTimezone', 'concurrencyIdempotency',
  ]);
  assert.deepEqual(applicableConcernsFor('batch'), [
    'loggingAudit', 'performance', 'timeAndTimezone',
  ]);
  assert.deepEqual(applicableConcernsFor('externalIntegration'), ['loggingAudit', 'secrets']);
  assert.deepEqual(applicableConcernsFor('webUi'), ['loggingAudit']);
  // other is the catch-all; nothing applies.
  assert.deepEqual(applicableConcernsFor('other'), []);
  // Unknown shape returns [].
  assert.deepEqual(applicableConcernsFor('bogus'), []);
  assert.deepEqual(applicableConcernsFor(''), []);
  assert.deepEqual(applicableConcernsFor(null), []);
});

test('concern-catalogue (PR 6): applicableConcernsForShapes unions and preserves canonical order', () => {
  // A REQ carrying auth + httpApi: union is auth, errorEnvelope,
  // loggingAudit, performance, secrets, concurrencyIdempotency.
  assert.deepEqual(
    applicableConcernsForShapes(['auth', 'httpApi']),
    ['auth', 'errorEnvelope', 'loggingAudit', 'performance', 'secrets', 'concurrencyIdempotency'],
  );
  // Order of input does not matter: shapes come back in CONCERN_KEYS order.
  assert.deepEqual(
    applicableConcernsForShapes(['httpApi', 'auth']),
    ['auth', 'errorEnvelope', 'loggingAudit', 'performance', 'secrets', 'concurrencyIdempotency'],
  );
  // Deduplicates: persistence + batch share loggingAudit and timeAndTimezone.
  assert.deepEqual(
    applicableConcernsForShapes(['persistence', 'batch']),
    ['loggingAudit', 'retention', 'performance', 'timeAndTimezone', 'concurrencyIdempotency'],
  );
  // Empty / nullish is tolerated.
  assert.deepEqual(applicableConcernsForShapes([]), []);
  assert.deepEqual(applicableConcernsForShapes(undefined), []);
});

test('concern-catalogue (PR 6): the catalogue is frozen (consumers cannot mutate shared source)', () => {
  assert.ok(Object.isFrozen(CONCERN_KEYS));
  assert.ok(Object.isFrozen(CONCERN_APPLICABILITY));
  for (const key of CONCERN_KEYS) {
    assert.ok(Object.isFrozen(CONCERN_APPLICABILITY[key]), `${key} applicability array must be frozen`);
  }
});
