// Node-gate-entrypoint probe for delivery-ci-workflows.
//
// AC-6102-1 states the runner is ONE Node entry point on disk under
// the project tree and requires the aggregate report's runner.entryPoint
// field to record a project-relative path that exists in the tree.
// That aggregate report is written by the project runtime; a shelf
// probe over the shipped templates cannot observe the runtime field
// nor verify path existence in a downstream project. Per closure-3
// §6 ruling, this row is de-claimed (anchorAcId=null, conformanceOnly)
// with the limitation naming AC-6102-1. The template scan is
// preserved as OBSERVATION detail (not an AC claim).
//
// AC-6102-2 asserts the CI provider's job definition invokes the
// gate as a single-line node invocation with no gate-specific logic
// inside the CI job. That IS observable at shelf: each job step
// runs exactly one `node scripts/rcf-*.{js,mjs}` invocation.
//
// Every detail line begins with the first eight words of the AC or
// limitation text.
import { loadTemplates, splitJobs, findJobEntries } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-delivery-ci-workflows/src/workflow-lint.mjs';

export const anchorAcId = 'AC-6102-2';
export const accountBound = false;
const AC2 = "The CI provider's job definition invokes the gate";

export default async function runProbe() {
  const templates = await loadTemplates();
  const results = [];
  if (templates.length === 0) {
    results.push({
      anchorAcId: 'AC-6102-2',
      verdict: 'fail',
      detail: `${AC2} runner with a  -  observed no workflow templates found under the shipped github-actions assets directory; the AC cannot be satisfied without at least one file.`,
      evidence: { templateCount: 0, entries: [] },
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
    evidence: { perFile, jobsScanned, jobsWithExactlyOne, violations, entries: perFile.flatMap((f) => f.jobs.flatMap((j) => j.entries)) },
  });

  const flat = perFile.flatMap((f) => f.jobs.flatMap((j) => j.entries));
  const uniqueEntries = [...new Set(flat)];
  // De-claim AC-6102-1: the AC requires the aggregate report's
  // runner.entryPoint field (a runtime property the project's
  // rcf runner writes into .rcf/reports/ci/pipeline.json) and
  // requires the field's project-relative path to EXIST at that
  // path in the tree. Neither is observable from a shelf-level
  // scan of the shipped templates: the aggregate report is not
  // shipped, and the shelf has no project tree to check for path
  // existence. The shipped templates deliberately name distinct
  // canonical entry points per workflow (rcf-ci, rcf-ci-e2e,
  // rcf-scheduled-audit, rcf-release), one per gate-suite, so
  // the "shared single entry" reading is not what the shipped
  // set demonstrates either. The row records what WAS observed
  // (the distinct canonical entries per shipped template) and
  // names the limitation.
  results.push({
    anchorAcId: null,
    conformanceOnly: true,
    limitation: `AC-6102-1: requires the aggregate report's runner.entryPoint field (a runtime property the project's rcf runner writes into .rcf/reports/ci/pipeline.json) to record a project-relative .js/.mjs path AND that path to exist in the tree. Neither the runtime aggregate report nor a project tree is available to a shelf probe.`,
    verdict: 'warn',
    detail: `observed ${flat.length} 'node scripts/rcf-*.{js,mjs}' entries across all jobs; uniqueEntries=${JSON.stringify(uniqueEntries)}. Each shipped template names its own canonical entry (rcf-ci for commit-triggered, rcf-ci-e2e for e2e, rcf-scheduled-audit for scheduled, rcf-release for release); the shelf cannot observe the runtime aggregate report's runner.entryPoint field.`,
    evidence: { entries: flat, uniqueEntries, unobservableReason: 'aggregate report runner.entryPoint is a runtime property the project runner writes; not observable on the shelf' },
  });

  return { results, extra: { envDeclared: [], templateCount: templates.length, perFile } };
}
