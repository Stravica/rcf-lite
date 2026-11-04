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
//
// Round F (F-7): on a non-zero exit the message also names the child's
// inner failing tests, `failures` as innerFailures gives them, each as
// "<file>:<line> <title>" joined by "; ", or says that the child's TAP
// named none (the transcript tail is then the only record).
export function assessPinChildRun({ code, signal, executedTests, floor, failures = [] }) {
  if (code !== 0) {
    const named = failures.length
      ? `; ${failures.length} inner failing test(s): ${failures.map(innerFailureName).join('; ')}`
      : "; the child's TAP names no failing test (see the child transcript tail)";
    throw new assert.AssertionError({
      message: `pin invariant: child exit code must be 0, got code=${code} signal=${signal ?? 'none'}${named}`,
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

// The name of the environment variable that overrides the pin's cap.
export const PIN_TIMEOUT_ENV = 'RCF_LEAK_PIN_TIMEOUT_MS';

// The pin's own cap on the inner suite: about three times the inner
// suite's time on CI, overridable by RCF_LEAK_PIN_TIMEOUT_MS.
export const DEFAULT_PIN_TIMEOUT_MS = 90 * 60 * 1000;

// Resolves the pin's cap from the environment. Unset or empty reads
// the default; a positive integer of milliseconds overrides it; any
// other value is refused loudly, never a silent fallback.
export function resolvePinTimeout(env = process.env) {
  const value = env[PIN_TIMEOUT_ENV];
  if (value === undefined || value === '') {
    return { ms: DEFAULT_PIN_TIMEOUT_MS, source: 'default' };
  }
  if (/^[1-9][0-9]*$/.test(value)) {
    return { ms: Number(value), source: PIN_TIMEOUT_ENV };
  }
  throw new assert.AssertionError({
    message: `pin invariant: RCF_LEAK_PIN_TIMEOUT_MS must be a positive integer of milliseconds, got '${value}'`,
  });
}

// The pin's one line on the inner suite's measured wall time, printed
// on every exit of the child so a later round can size the cap.
export function innerWallTimeLine({ elapsedMs, capMs, source, timedOut }) {
  return `inner suite wall time: ${elapsedMs} ms (cap ${capMs} ms, ${source}${timedOut ? ', stopped at the cap' : ''})`;
}

// A location value as node:test's TAP reporter writes it in a YAML
// diagnostic: util.inspect's quoting (single, double or backtick quotes,
// backslash escapes), or a bare value.
function tapValue(text) {
  const q = text[0];
  if ((q === "'" || q === '"' || q === '`') && text.length > 1 && text.endsWith(q)) {
    return text.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  return text;
}

// The inner failing tests of the child's TAP (round F, F-7): every
// "not ok" test line at any depth that carries no TODO or SKIP directive,
// less a parent whose diagnostic reads failureType 'subtestsFailed' (its
// failing subtests are named instead), each as { file, line, title }:
// the file and line of its diagnostic's location (the file relative to
// `cwd` when it is inside it), and its title with the reporter's `\#` and
// `\\` escapes undone. Each test line's own YAML diagnostic ("---" to
// "...") is read for its location and failure type and then skipped, so
// text inside it, such as an error message quoting a child's TAP, is
// never read as a test line. The reporter writes a "#" in a title as
// "\#", so an unescaped " # " always starts the directive. A test line
// with no location in its diagnostic gives file and line null. Returns []
// for anything but a string.
export function innerFailures(tap, cwd = '') {
  if (typeof tap !== 'string') return [];
  const out = [];
  const lines = tap.split('\n');
  const root = cwd && !cwd.endsWith('/') ? `${cwd}/` : cwd;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^( *)(not ok|ok) \d+ - (.*)$/);
    if (!m) continue;
    const pad = m[1];
    let location = null;
    let parent = false;
    if (lines[i + 1] === `${pad}  ---`) {
      let j = i + 2;
      for (; j < lines.length && lines[j] !== `${pad}  ...`; j += 1) {
        // An unclosed diagnostic ends at the first line outside its indent.
        if (lines[j].trim() && !lines[j].startsWith(`${pad}  `)) { j -= 1; break; }
        if (lines[j].startsWith(`${pad}  location: `)) location = tapValue(lines[j].slice(pad.length + 'location: '.length + 2));
        if (lines[j] === `${pad}  failureType: 'subtestsFailed'`) parent = true;
      }
      i = j;
    }
    if (m[2] === 'ok' || parent || / # (TODO|SKIP)\b/.test(m[3])) continue;
    const at = location ? location.match(/^(.*):(\d+):\d+$/) : null;
    let file = at ? at[1] : null;
    if (file && root && file.startsWith(root)) file = file.slice(root.length);
    out.push({ file, line: at ? Number(at[2]) : null, title: m[3].replace(/\\(.)/g, '$1') });
  }
  return out;
}

// One inner failing test as the pin names it: "<file>:<line> <title>",
// or "<title> (no location)" when its diagnostic gave none.
export function innerFailureName({ file, line, title }) {
  return file === null ? `${title} (no location)` : `${file}:${line} ${title}`;
}
