// Pure helpers for the temp-dir leak pin's child-run assessment.
//
// Factored out of temp-dir-cleanup.test.js so the vacuous-pin guard
// (child exit code + minimum executed-test count) can be exercised
// without actually spawning the suite.

import assert from 'node:assert/strict';

// The packaged test suite runs several thousand tests on a healthy
// pass (around 7,000 as of October 2026). The 3,000 floor is a
// vacuous-pin guard: a child that discovers only a handful of tests
// (early crash, broken glob, test-runner misconfiguration) would
// otherwise leave `TMPDIR` empty and let the leak gate pass without
// actually exercising the suite. The floor sits comfortably below
// steady state so it never fires on normal suite expansion or
// contraction while still refusing a cherry-picked subset.
export const EXECUTED_TESTS_FLOOR = 3000;

// Parse node:test's summary tally. Node emits one summary line at
// the end of the run; the shape depends on reporter:
//   TAP reporter : `# tests <N>`
//   spec reporter: `ℹ tests <N>` (Node 24+ default on both TTY and
//                                 non-TTY output).
// The pin pins the child to the TAP reporter, but this regex
// accepts either prefix so a reporter default change does not
// re-break the parser. A child that crashes before the summary
// returns null so the caller refuses the run instead of trusting
// a vacuous green.
export function parseExecutedTests(tap) {
  if (typeof tap !== 'string' || tap.length === 0) return null;
  const m = tap.match(/^(?:#|ℹ)[ \t]+tests[ \t]+(\d+)[ \t]*$/m);
  return m ? Number(m[1]) : null;
}

// Refuses:
// - a non-zero exit code (any non-zero child means the leak snapshot
//   is not trustworthy);
// - a null `executedTests` (TAP summary not seen at all);
// - an `executedTests` below `floor` (vacuous run).
//
// Throws an AssertionError that node:test surfaces as a failed
// assertion in the pin test body. Returns `undefined` on a healthy
// run so the caller can proceed to the leak-count assertion.
export function assessPinChildRun({ code, signal, executedTests, floor }) {
  if (code !== 0) {
    throw new assert.AssertionError({
      message: `pin invariant: child exit code must be 0, got code=${code} signal=${signal ?? 'none'}`,
      actual: code,
      expected: 0,
      operator: '==',
    });
  }
  if (executedTests === null) {
    throw new assert.AssertionError({
      message: `pin invariant: could not parse '# tests <N>' from child TAP summary; refusing vacuous pin`,
      actual: executedTests,
      expected: 'a non-null integer >= ' + floor,
      operator: '>=',
    });
  }
  if (executedTests < floor) {
    throw new assert.AssertionError({
      message: `pin invariant: child executed only ${executedTests} tests, below vacuous-pin floor ${floor}; refusing vacuous pin`,
      actual: executedTests,
      expected: floor,
      operator: '>=',
    });
  }
}
