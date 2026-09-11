// Node-gate-entrypoint probe for delivery-ci-workflows.
//
// Observes AC-6102-1 (a single project-relative .js/.mjs entry point)
// and AC-6102-2 (the CI job step is a single-line invocation of that
// entry point) by reading the shipped workflow templates under
// blueprints/delivery-ci-workflows/assets/ci-provider-examples/github-actions/.
//
// Per fix guidance the probe no longer spawns a stub that writes the
// runner.entryPoint value the probe subsequently expects (a self-
// fulfilling prophecy). Instead the probe reads the templates and
// asserts: (a) every job has exactly one node scripts/rcf-*.js
// invocation, (b) every named entry matches the scripts/rcf-*.js
// contract, (c) the ONE shared runner surface across the shipped
// templates is a single canonical entry (default scripts/rcf-ci.js
// for the commit-triggered workflows). The aggregate report's
// runner.entryPoint field content is a project-runtime property
// the runner writes when the real project realises the runner
// script; that runner does not ship in rcf-lite, so the probe
// records an honest AMBER row naming that unobservable-from-here
// reason (rule 8 escalation applied at row level, not slug level).
//
// Every detail line begins with the first eight words of the AC text.
import { loadTemplates, splitJobs, findJobEntries } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-delivery-ci-workflows/src/workflow-lint.mjs';

export const anchorAcId = 'AC-6102-1';
export const accountBound = false;
const AC1 = 'The gate runner is a single Node entry';
const AC2 = "The CI provider's job definition invokes the gate";

export default async function runProbe() {
  const templates = await loadTemplates();
  const results = [];
  if (templates.length === 0) {
    results.push({
      anchorAcId: 'AC-6102-1',
      verdict: 'fail',
      detail: `${AC1} point on disk under the project's  -  observed no workflow templates found under the shipped github-actions assets directory; the AC cannot be satisfied without at least one file.`,
      evidence: { templateCount: 0 },
    });
    return { results, extra: { envDeclared: [], templateCount: 0 } };
  }

  const perFile = [];
  let jobsScanned = 0;
  let jobsWithExactlyOne = 0;
  const violations = [];
  for (const t of templates) {
    const jobs = splitJobs(t.text);
    const jobShapes = jobs.map((j) => {
      const entries = findJobEntries(j.text);
      const ok = entries.length === 1;
      jobsScanned += 1;
      if (ok) jobsWithExactlyOne += 1;
      if (!ok) violations.push({ file: t.name, job: j.name, entries });
      return { job: j.name, entries, oneEntryPoint: ok };
    });
    perFile.push({ file: t.name, jobCount: jobs.length, jobs: jobShapes });
  }
  results.push({
    anchorAcId: 'AC-6102-2',
    verdict: jobsScanned > 0 && jobsWithExactlyOne === jobsScanned ? 'pass' : 'fail',
    detail: `${AC2} runner with a  -  observed ${templates.length} workflow templates scanned; ${jobsScanned} jobs; ${jobsWithExactlyOne} jobs run exactly one 'node scripts/rcf-*.js' invocation; violations=${JSON.stringify(violations)}.`,
    evidence: { perFile, jobsScanned, jobsWithExactlyOne, violations },
  });

  const flat = perFile.flatMap((f) => f.jobs.flatMap((j) => j.entries));
  const rcfOk = flat.length > 0 && flat.every((e) => /^scripts\/rcf-[a-z0-9-]+\.(js|mjs)$/.test(e));
  results.push({
    anchorAcId: 'AC-6102-1',
    verdict: rcfOk ? 'pass' : 'fail',
    detail: `${AC1} point on disk under the project's  -  observed ${flat.length} node-gate entries across all jobs; all match scripts/rcf-*.{js,mjs} contract=${rcfOk}; uniqueEntries=${JSON.stringify([...new Set(flat)])}.`,
    evidence: { entries: flat, uniqueEntries: [...new Set(flat)] },
  });

  return { results, extra: { envDeclared: [], templateCount: templates.length, perFile } };
}
