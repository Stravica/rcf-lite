// FBS-225 (US-19301, TAC-4151): suite-as-probe result mapping. A bound
// test is a TC whose acId is in scope; it maps to a reported test by exact
// equality of its testPointer title with the reported title, in the run of
// the file its pointer names. Results then roll up per AC: pass, skipped,
// fail (a failed or not-run bound test) or critiqueOnly (nothing bound).

import { splitTestPointer } from '#core/store';

/** Recorded on an AC whose HTTP probe a package target cannot run. */
export const PROBE_NOT_RUN = 'package target has no served URL';

/**
 * The bound tests for the in-scope criteria, in TS then TC order.
 *
 * @param {object} p
 * @param {Array<{ id: string, testCases?: object[] }>} p.testSuites
 * @param {string[]} p.acIds
 * @returns {Array<{ tsId: string, tcId: string, acId: string, file: string, title: string|null }>}
 */
export function boundTests({ testSuites, acIds }) {
  const inScope = new Set(acIds);
  const out = [];
  for (const ts of testSuites ?? []) {
    for (const tc of ts.testCases ?? []) {
      if (!inScope.has(tc?.acId) || typeof tc.testPointer !== 'string') continue;
      const { file, testName } = splitTestPointer(tc.testPointer);
      out.push({ tsId: ts.id, tcId: tc.id, acId: tc.acId, file, title: testName });
    }
  }
  return out;
}

/**
 * The key a suite run is stored under: one run per TS and file.
 *
 * @param {string} tsId
 * @param {string} file
 * @returns {string}
 */
export function suiteKey(tsId, file) {
  return `${tsId}::${file}`;
}

function testResult(reported) {
  if (reported.directive === 'TODO') return 'todo';
  if (reported.directive === 'SKIP') return 'skipped';
  return reported.ok ? 'pass' : 'fail';
}

// The reported test with this exact title, the shallowest when nested names repeat.
function findReported(parsed, title) {
  let found = null;
  for (const t of parsed?.tests ?? []) {
    if (t.title === title && (!found || t.depth < found.depth)) found = t;
  }
  return found;
}

/**
 * Per-AC results from the parsed suite runs.
 *
 * @param {object} p
 * @param {Array<{ acId: string, probe?: object|null }>} p.acs - in-scope criteria, each with the probe it carries (if any)
 * @param {ReturnType<typeof boundTests>} p.bound
 * @param {Map<string, { tests: object[] }>} p.runs - parseTap output by suiteKey
 * @returns {Array<{ acId: string, result: 'pass'|'fail'|'skipped'|'critiqueOnly', evidence: object|null }>}
 */
export function mapAcResults({ acs, bound, runs }) {
  return acs.map(({ acId, probe }) => {
    const probeNote = probe ? { probeNotRun: PROBE_NOT_RUN } : {};
    const mine = bound.filter((b) => b.acId === acId);
    if (mine.length === 0) {
      return { acId, result: 'critiqueOnly', evidence: probe ? probeNote : null };
    }
    const tests = [];
    const notRun = [];
    for (const b of mine) {
      const reported = findReported(runs.get(suiteKey(b.tsId, b.file)), b.title);
      if (!reported) {
        notRun.push(b.title);
        continue;
      }
      tests.push({ tcId: b.tcId, title: b.title, testNumber: reported.testNumber, result: testResult(reported) });
    }
    let result = 'pass';
    if (notRun.length > 0 || tests.some((t) => t.result === 'fail')) result = 'fail';
    else if (tests.some((t) => t.result === 'todo' || t.result === 'skipped')) result = 'skipped';
    return {
      acId,
      result,
      evidence: { testSuite: mine[0].tsId, file: mine[0].file, tests, notRun, ...probeNote },
    };
  });
}

/**
 * runStats.counts over per-AC results.
 *
 * @param {Array<{ result: string }>} perAc
 * @returns {{ verified: number, failed: number, skipped: number, critiqueOnly: number, total: number }}
 */
export function countResults(perAc) {
  const n = (r) => perAc.filter((row) => row.result === r).length;
  return { verified: n('pass'), failed: n('fail'), skipped: n('skipped'), critiqueOnly: n('critiqueOnly'), total: perAc.length };
}
