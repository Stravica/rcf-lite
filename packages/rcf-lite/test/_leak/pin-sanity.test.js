// Finding 3 biting test: the leak pin's child-run assessment must
// refuse a vacuous green. We exercise the extracted assessors
// (parseExecutedTests, assessPinChildRun, EXECUTED_TESTS_FLOOR)
// against several child-run shapes that would otherwise sneak past
// the leak gate: non-zero exit, missing TAP summary, and an
// executed-test count below the floor. Before the extraction the
// pin recorded these in diagnostics but never asserted on them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseExecutedTests,
  assessPinChildRun,
  EXECUTED_TESTS_FLOOR,
  resolvePinTimeout,
  innerWallTimeLine,
  PIN_TIMEOUT_ENV,
  DEFAULT_PIN_TIMEOUT_MS,
  innerFailures,
  innerFailureName,
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

test('resolvePinTimeout defaults to 90 minutes when RCF_LEAK_PIN_TIMEOUT_MS is unset or empty', () => {
  assert.deepEqual(resolvePinTimeout({}), { ms: 5400000, source: 'default' });
  assert.deepEqual(resolvePinTimeout({ RCF_LEAK_PIN_TIMEOUT_MS: '' }), { ms: 5400000, source: 'default' });
});

test('resolvePinTimeout takes a positive integer RCF_LEAK_PIN_TIMEOUT_MS in milliseconds', () => {
  assert.deepEqual(resolvePinTimeout({ RCF_LEAK_PIN_TIMEOUT_MS: '60000' }), {
    ms: 60000,
    source: 'RCF_LEAK_PIN_TIMEOUT_MS',
  });
});

test('resolvePinTimeout refuses a value that is not a positive integer', () => {
  for (const value of ['0', '-5', '1.5', 'abc', '90m', ' 60000']) {
    assert.throws(
      () => resolvePinTimeout({ RCF_LEAK_PIN_TIMEOUT_MS: value }),
      /RCF_LEAK_PIN_TIMEOUT_MS must be a positive integer of milliseconds, got '/,
      `expected a refusal for '${value}'`,
    );
  }
});

test('DEFAULT_PIN_TIMEOUT_MS is 90 minutes and PIN_TIMEOUT_ENV names the override', () => {
  assert.equal(DEFAULT_PIN_TIMEOUT_MS, 5400000);
  assert.equal(PIN_TIMEOUT_ENV, 'RCF_LEAK_PIN_TIMEOUT_MS');
});

test('innerWallTimeLine names the wall time, the cap and its source, and a stop at the cap', () => {
  assert.equal(
    innerWallTimeLine({ elapsedMs: 1265000, capMs: 5400000, source: 'default', timedOut: false }),
    'inner suite wall time: 1265000 ms (cap 5400000 ms, default)',
  );
  assert.equal(
    innerWallTimeLine({ elapsedMs: 60012, capMs: 60000, source: 'RCF_LEAK_PIN_TIMEOUT_MS', timedOut: true }),
    'inner suite wall time: 60012 ms (cap 60000 ms, RCF_LEAK_PIN_TIMEOUT_MS, stopped at the cap)',
  );
});

// Round F (F-7): whenever the child exits non-zero the pin names each
// inner failing test, its file and line and its title, where it printed
// only the transcript's last 800 characters before. The child TAP below
// is node:test's TAP reporter's shape for a failing test at the top
// level, a failing subtest under a describe (the describe itself
// failureType 'subtestsFailed'), a failing todo, a skip, a file that fails
// to load and a test past its timeout.
const CWD = '/work/pkg';
const CHILD_TAP = [
  'TAP version 13',
  '# Subtest: passes',
  'ok 1 - passes',
  '  ---',
  '  duration_ms: 0.2',
  "  type: 'test'",
  '  ...',
  '# Subtest: fails \\# with hash',
  'not ok 2 - fails \\# with hash',
  '  ---',
  '  duration_ms: 0.7',
  "  type: 'test'",
  "  location: '/work/pkg/test/a.test.js:4:1'",
  "  failureType: 'testCodeFailure'",
  '  error: |-',
  '    Expected values to be strictly equal:',
  '    ',
  "    location: '/elsewhere/not/this.js:9:9'",
  "  code: 'ERR_ASSERTION'",
  '  ...',
  '# Subtest: group',
  '    # Subtest: inner fails',
  '    not ok 1 - inner fails',
  '      ---',
  '      duration_ms: 0.3',
  "      type: 'test'",
  "      location: '/work/pkg/test/a.test.js:6:3'",
  "      failureType: 'testCodeFailure'",
  "      error: 'boom'",
  '      ...',
  '    1..1',
  'not ok 3 - group',
  '  ---',
  '  duration_ms: 0.9',
  "  type: 'suite'",
  "  location: '/work/pkg/test/a.test.js:5:1'",
  "  failureType: 'subtestsFailed'",
  "  error: '1 subtest failed'",
  '  ...',
  '# Subtest: todo fails',
  'not ok 4 - todo fails # TODO',
  '  ---',
  "  location: '/work/pkg/test/a.test.js:9:1'",
  "  failureType: 'testCodeFailure'",
  '  ...',
  '# Subtest: skipped',
  "ok 5 - skipped # SKIP nope",
  '# Subtest: test/b.test.js',
  'not ok 2 - test/b.test.js',
  '  ---',
  "  location: '/work/pkg/test/b.test.js:1:1'",
  "  failureType: 'testCodeFailure'",
  '  ...',
  '# Subtest: slow',
  'not ok 7 - slow',
  '  ---',
  "  location: '/work/pkg/test/c.test.js:2:1'",
  "  failureType: 'testTimeoutFailure'",
  '  ...',
  '1..7',
  '# tests 8',
  '# fail 3',
  '',
].join('\n');

test('innerFailures names each failing test of the child TAP: the file and line of its location relative to the child cwd, and its title, skipping a parent of failing subtests, a todo and a skip', () => {
  assert.deepEqual(innerFailures(CHILD_TAP, CWD), [
    { file: 'test/a.test.js', line: 4, title: 'fails # with hash' },
    { file: 'test/a.test.js', line: 6, title: 'inner fails' },
    { file: 'test/b.test.js', line: 1, title: 'test/b.test.js' },
    { file: 'test/c.test.js', line: 2, title: 'slow' },
  ]);
});

test('innerFailures keeps a location outside the child cwd absolute, gives a not ok line with no diagnostic a null file and line, and reads nothing from a non-string', () => {
  const tap = [
    'not ok 1 - outside',
    '  ---',
    "  location: '/other/test/x.test.js:12:5'",
    '  ...',
    'not ok 2 - bare',
    '# tests 2',
  ].join('\n');
  assert.deepEqual(innerFailures(tap, CWD), [
    { file: '/other/test/x.test.js', line: 12, title: 'outside' },
    { file: null, line: null, title: 'bare' },
  ]);
  assert.deepEqual(innerFailures(null, CWD), []);
  assert.deepEqual(innerFailures(undefined, CWD), []);
});

// The Codex review of the round F DEFINE diff (C-3, C-4): the YAML
// diagnostic of a test line is skipped whole, so an error message that
// quotes a child's TAP names no phantom test; and an unescaped " # "
// starts the directive even after a title that ends in an escaped
// backslash.
test('innerFailures skips each test line\'s YAML diagnostic, so an error message quoting a child TAP "not ok" line names no phantom test', () => {
  const tap = [
    'not ok 1 - real failure',
    '  ---',
    "  location: '/work/pkg/test/a.test.js:3:1'",
    "  failureType: 'testCodeFailure'",
    '  error: |-',
    '    the child said:',
    '    not ok 1 - phantom',
    "    location: '/work/pkg/test/phantom.test.js:1:1'",
    '  ...',
    '# tests 1',
  ].join('\n');
  assert.deepEqual(innerFailures(tap, CWD), [{ file: 'test/a.test.js', line: 3, title: 'real failure' }]);
});

test('innerFailures reads a TODO or SKIP directive after a title that ends in an escaped backslash', () => {
  const tap = [
    'not ok 1 - path\\\\ # TODO',
    '  ---',
    "  location: '/work/pkg/test/a.test.js:3:1'",
    '  ...',
    'not ok 2 - dir\\\\ # SKIP not here',
    'not ok 3 - ends\\\\',
    '  ---',
    "  location: '/work/pkg/test/a.test.js:9:1'",
    '  ...',
  ].join('\n');
  assert.deepEqual(innerFailures(tap, CWD), [{ file: 'test/a.test.js', line: 9, title: 'ends\\' }]);
});

test('innerFailureName reads "<file>:<line> <title>", and "<title> (no location)" with no location', () => {
  assert.equal(innerFailureName({ file: 'test/a.test.js', line: 6, title: 'inner fails' }), 'test/a.test.js:6 inner fails');
  assert.equal(innerFailureName({ file: null, line: null, title: 'bare' }), 'bare (no location)');
});

test('assessPinChildRun names the inner failing tests in its message when the child exits non-zero, each "<file>:<line> <title>" joined by "; "', () => {
  assert.throws(
    () => assessPinChildRun({ code: 1, signal: null, executedTests: 7000, floor: EXECUTED_TESTS_FLOOR, failures: innerFailures(CHILD_TAP, CWD) }),
    (err) => {
      assert.equal(
        err.message,
        'pin invariant: child exit code must be 0, got code=1 signal=none; 4 inner failing test(s): test/a.test.js:4 fails # with hash; test/a.test.js:6 inner fails; test/b.test.js:1 test/b.test.js; test/c.test.js:2 slow',
      );
      return true;
    },
  );
});

test("assessPinChildRun says the child's TAP names no failing test when the child exits non-zero with none", () => {
  assert.throws(
    () => assessPinChildRun({ code: null, signal: 'SIGKILL', executedTests: null, floor: EXECUTED_TESTS_FLOOR }),
    (err) => {
      assert.equal(err.message, "pin invariant: child exit code must be 0, got code=null signal=SIGKILL; the child's TAP names no failing test (see the child transcript tail)");
      return true;
    },
  );
});

// The same read over a child node:test really ran, so the pin keeps
// naming failures if node's TAP reporter changes shape: a scratch package
// (under the OS temp directory, removed after) with a failing test at the
// top level and a failing subtest in a describe, run as the pin runs the
// suite (the TAP reporter, the test glob, node:test's own markers dropped).
test('innerFailures names the failing tests of a child node --test run over a scratch package, file, line and title', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rcf-pin-inner-')));
  try {
    mkdirSync(join(dir, 'test'));
    writeFileSync(join(dir, 'test', 'a.test.js'), [
      "import { test, describe } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "test('passes', () => {});",
      "test('top fails', () => { assert.equal(1, 2); });",
      "describe('group', () => {",
      "  test('nested fails', () => { throw new Error('boom'); });",
      '});',
      "test('quotes a child TAP', () => { assert.fail('the child said:\\nnot ok 1 - phantom\\n# tests 1'); });",
      "test('todo ends in a backslash \\\\', { todo: true }, () => { throw new Error('x'); });",
      '',
    ].join('\n'));
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_TEST_WORKER_ID;
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', 'test/**/*.test.js'], { cwd: dir, env, encoding: 'utf8' });
    assert.notEqual(r.status, 0, `the scratch child exits non-zero\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /^ {4}not ok 1 - phantom$/m, 'the child TAP quotes a "not ok" line inside an error block');
    assert.match(r.stdout, /^not ok \d+ - todo ends in a backslash \\\\ # TODO$/m, 'the child TAP writes the todo title with its backslash escaped, then the directive');
    assert.deepEqual(innerFailures(r.stdout, dir), [
      { file: 'test/a.test.js', line: 4, title: 'top fails' },
      { file: 'test/a.test.js', line: 6, title: 'nested fails' },
      { file: 'test/a.test.js', line: 8, title: 'quotes a child TAP' },
    ], r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
