// The runner report readers of `rcf audit test-strength` (FBS-242,
// US-19904, TAC-4155): one bound test file runs per runner invocation,
// and the verb reads that runner's report, never its exit code alone
// (the legacy runner aside): node:test's TAP (a kind with no reader
// here yet gives no report the audit can read). Each reader gives the leaves
// the runner reported (title path and status) and whether the file
// itself was reported failed; judge() finds the bound test's pointer in
// them.

/** A TAP test point: indent, ok, name and directive. */
const POINT = /^( *)(not )?ok \d+(?: - (.*?))?(?: # (SKIP|TODO)\b.*)?$/i;
const SUBTEST = /^( *)# Subtest: (.*)$/;
const unescapeTap = (s) => s.replace(/\\(.)/g, '$1');

/**
 * node:test's TAP: leaves are test points with no test point nested
 * under them; a top-level point named for the file itself (the runner's
 * own line when no test of the file is reported) is the file's status.
 */
function readTap(stdout, file) {
  const out = stdout.split(/\r?\n/);
  if (!out.some((l) => /^TAP version \d+/.test(l))) return { ok: false };
  const stack = [];
  const points = [];
  for (const line of out) {
    const sub = SUBTEST.exec(line);
    if (sub) {
      const depth = Math.floor(sub[1].length / 4);
      stack.length = depth;
      stack[depth] = unescapeTap(sub[2]);
      continue;
    }
    const p = POINT.exec(line);
    if (!p || p[1].length % 4 !== 0) continue;
    const depth = p[1].length / 4;
    const directive = (p[4] ?? '').toUpperCase();
    points.push({
      depth,
      path: [...stack.slice(0, depth), unescapeTap(p[3] ?? '')],
      status: directive ? 'skipped' : (p[2] ? 'failed' : 'passed'),
    });
  }
  const leaves = [];
  let fileFailed = false;
  points.forEach((pt, i) => {
    const parent = i > 0 && points[i - 1].depth > pt.depth;
    if (parent) return;
    if (pt.depth === 0 && (pt.path[0] === file || pt.path[0].endsWith(`/${file}`))) {
      if (pt.status === 'failed') fileFailed = true;
      return;
    }
    leaves.push({ path: pt.path, status: pt.status });
  });
  return { ok: true, leaves, fileFailed };
}

/**
 * The report of one bound test run.
 *
 * @param {'nodeTest'|'vitest'|'playwright'} kind
 * @param {{ stdout: string, reportText: string|null, file: string }} run
 * @returns {{ ok: false } | { ok: true, leaves: Array<{ path: string[], status: 'passed'|'failed'|'skipped' }>, fileFailed: boolean }}
 */
export function readReport(kind, { stdout, reportText, file }) {
  if (kind === 'nodeTest') return readTap(stdout, file);
  return { ok: false };
}

const SEP = ' > ';

/**
 * Find a bound test's name in a report. The name is the leaf title, the
 * title path with " > " between describe titles and the test title, or
 * a describe title matched as a prefix of the title path: run when at
 * least one leaf under it ran, failed when any leaf under it failed. A
 * name matching two leaves is ambiguous. With no leaf of the name run,
 * a file reported failed with no leaf reported is a load failure, and
 * anything else is not run.
 *
 * @returns {{ status: 'pass'|'fail'|'notRun'|'loadError'|'ambiguous'|'unreadable', prefix?: boolean, names?: string[] }}
 */
export function judge(report, name) {
  if (!report.ok) return { status: 'unreadable' };
  const key = (l) => l.path.join(SEP);
  let hit = report.leaves.filter((l) => key(l) === name);
  if (!hit.length) hit = report.leaves.filter((l) => l.path[l.path.length - 1] === name);
  if (hit.length > 1) return { status: 'ambiguous', names: hit.map(key) };
  let prefix = false;
  if (!hit.length) {
    const segs = name.split(SEP);
    hit = report.leaves.filter((l) => l.path.length > segs.length && segs.every((s, i) => l.path[i] === s));
    prefix = true;
  }
  const ran = hit.filter((l) => l.status !== 'skipped');
  if (!ran.length) return { status: report.fileFailed && report.leaves.length === 0 ? 'loadError' : 'notRun' };
  return { status: ran.some((l) => l.status === 'failed') ? 'fail' : 'pass', prefix };
}
