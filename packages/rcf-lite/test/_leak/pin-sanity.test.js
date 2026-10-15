// Finding 3 biting test: the leak pin's child-run assessment must
// refuse a vacuous green. We exercise the extracted assessors
// (parseExecutedTests, assessPinChildRun, EXECUTED_TESTS_FLOOR)
// against several child-run shapes that would otherwise sneak past
// the leak gate: non-zero exit, missing TAP summary, and an
// executed-test count below the floor. Before the extraction the
// pin recorded these in diagnostics but never asserted on them.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseExecutedTests,
  assessPinChildRun,
  EXECUTED_TESTS_FLOOR,
} from './pin-core.js';

test('parseExecutedTests parses the TAP summary # tests line', () => {
  const tap = `TAP version 13
# subtest: ...
ok 1 - something
# tests 7421
# pass 7421
# fail 0
`;
  assert.equal(parseExecutedTests(tap), 7421);
});

test('parseExecutedTests parses the spec summary ℹ tests line (Node 24 default)', () => {
  const spec = `✔ something (1ms)
ℹ tests 3837
ℹ suites 0
ℹ pass 3837
`;
  assert.equal(parseExecutedTests(spec), 3837);
});

test('parseExecutedTests returns null when the summary line is absent', () => {
  assert.equal(parseExecutedTests('nothing TAP-shaped at all'), null);
});

test('parseExecutedTests returns null on empty or non-string input', () => {
  assert.equal(parseExecutedTests(''), null);
  assert.equal(parseExecutedTests(null), null);
  assert.equal(parseExecutedTests(undefined), null);
});

test('assessPinChildRun throws when the child exit code is non-zero', () => {
  assert.throws(
    () =>
      assessPinChildRun({
        code: 1,
        signal: null,
        executedTests: 7000,
        floor: EXECUTED_TESTS_FLOOR,
      }),
    /child exit code must be 0/,
  );
});

test('assessPinChildRun throws when the TAP summary could not be parsed (null count)', () => {
  assert.throws(
    () =>
      assessPinChildRun({
        code: 0,
        signal: null,
        executedTests: null,
        floor: EXECUTED_TESTS_FLOOR,
      }),
    /refusing vacuous pin/,
  );
});

test('assessPinChildRun throws when executed-test count is below the floor', () => {
  assert.throws(
    () =>
      assessPinChildRun({
        code: 0,
        signal: null,
        executedTests: 5,
        floor: EXECUTED_TESTS_FLOOR,
      }),
    /below vacuous-pin floor/,
  );
});

test('assessPinChildRun passes silently on a healthy run (exit 0, count >= floor)', () => {
  assert.doesNotThrow(() =>
    assessPinChildRun({
      code: 0,
      signal: null,
      executedTests: EXECUTED_TESTS_FLOOR + 1,
      floor: EXECUTED_TESTS_FLOOR,
    }),
  );
});

test('EXECUTED_TESTS_FLOOR is a round, documented guard well below steady state', () => {
  assert.equal(EXECUTED_TESTS_FLOOR, 3000);
});
