// FBS-238 (US-20101, TAC-4157): the release report. Composes
// ReleaseVerifyReport v1 from the scope, the per-criterion results and the
// smoke results, and renders the lines the verb prints.

export const RELEASE_REPORTS_DIR = 'rcf/verify-reports/releases';

/**
 * Why a --release label cannot name a report file, or null when it can: a
 * label holding a path separator, or a . or .. segment, would write outside
 * RELEASE_REPORTS_DIR (AC-20102-4).
 */
export function releaseLabelProblem(label) {
  if (label === '' || /[\\/]/.test(label) || label === '.' || label === '..') {
    return `--release ${label}: a release label holds no path separator and no . or .. segment`;
  }
  return null;
}

/** The project-relative path of a release's report. */
export function releaseReportPath(label) {
  return `${RELEASE_REPORTS_DIR}/${label}.json`;
}

/**
 * ReleaseVerifyReport v1. A spec is verified when the smoke run passed and
 * every one of its criteria rows passed; testOnlyOnly and unflagged specs
 * are never verified.
 *
 * @param {object} p
 * @param {string} p.release
 * @param {string} p.head
 * @param {string} p.since
 * @param {object} p.target
 * @param {{ fbsIds: string[], testOnlyOnly: string[], unflagged: string[] }} p.scope
 * @param {string[]} p.smokeSuites
 * @param {Array<{ acId: string, fbsId: string, result: string, reason: string|null, tests: string[] }>} p.perAc
 * @param {Array<{ tsId: string, result: string, tests: string[] }>} p.smoke
 * @param {string} p.startedAt
 * @returns {object}
 */
export function composeReleaseReport({ release, head, since, target, scope, smokeSuites, perAc, smoke, startedAt }) {
  const smokePassed = smoke.every((s) => s.result === 'pass');
  const verdict = smokePassed && perAc.every((r) => r.result === 'pass') ? 'PASS' : 'FAIL';
  const verifiedFbsIds = smokePassed
    ? scope.fbsIds.filter((id) => {
      const rows = perAc.filter((r) => r.fbsId === id);
      return rows.length > 0 && rows.every((r) => r.result === 'pass');
    })
    : [];
  return {
    version: 1,
    release,
    head,
    since,
    target,
    scope: { fbsIds: scope.fbsIds, smokeSuites },
    perAc,
    smoke,
    testOnlyOnly: scope.testOnlyOnly,
    unflagged: scope.unflagged,
    verdict,
    verifiedFbsIds,
    startedAt,
    finishedAt: new Date().toISOString(),
    node: process.version,
  };
}

/** How the target reads on the verdict line. */
export function targetLabel(target) {
  return target.kind === 'url' ? target.url : `${target.name}@${target.version} sha256:${target.sha256.slice(0, 12)}`;
}

// The one-letter JavaScript escapes of the control characters that have one.
const CONTROL_ESCAPE = { '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\v': '\\v' };

/**
 * A reason as the reason line prints it (round F, AC-20101-11; TAC-4157
 * interfaces[0]): each control character (Unicode category Cc) other than
 * tab as its JavaScript escape, \n, \r, \b, \f, \v, else \x and two
 * lowercase hex digits (\x1b for the escape character), so the line stays
 * one line and readable; a tab as a tab, and every other character, a
 * backslash included, as itself. The report keeps the reason as it is.
 *
 * @param {string} reason
 * @returns {string}
 */
export function printedReason(reason) {
  return String(reason).replace(/[\x00-\x08\x0a-\x1f\x7f-\x9f]/g, (c) => CONTROL_ESCAPE[c] ?? `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

/**
 * The per-criterion lines, each fail line followed by "  reason: <reason>"
 * (round E, AC-20101-9; none after a pass or blocked line; round F,
 * AC-20101-11, the reason as printedReason gives it), and the verdict
 * line.
 *
 * @param {object} report - ReleaseVerifyReport v1
 * @returns {string[]}
 */
export function releaseLines(report) {
  const passed = report.perAc.filter((r) => r.result === 'pass').length;
  const smokePassed = report.smoke.filter((s) => s.result === 'pass').length;
  return [
    ...report.perAc.flatMap((r) => [`${r.acId} ${r.fbsId} ${r.result}`, ...(r.result === 'fail' ? [`  reason: ${printedReason(r.reason)}`] : [])]),
    `verify: release ${report.release} ${report.verdict} ${passed}/${report.perAc.length} external criteria, smoke ${smokePassed}/${report.smoke.length} (target ${targetLabel(report.target)})`,
  ];
}
