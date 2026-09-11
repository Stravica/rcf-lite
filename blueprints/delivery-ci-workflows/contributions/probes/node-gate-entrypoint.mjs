// Node-gate-entrypoint probe for delivery-ci-workflows.
//
// AC-6102-2 requires the CI job's step to be a single-line node
// invocation of the gate runner AND every gate-level branching,
// timing, and report-writing responsibility to live inside the Node
// runner rather than the CI configuration. This probe observes only
// the single-line invocation half; it cannot cheaply prove absence of
// branching/timing/report-writing logic elsewhere in the job. The row
// is de-claimed (conformanceOnly) with the limitation naming AC-6102-2.
//
// AC-6102-1 requires the aggregate report's runner.entryPoint field
// (a runtime property the project's rcf runner writes into
// .rcf/reports/ci/pipeline.json) and requires the field's project-
// relative path to exist in the tree. Neither the aggregate report
// nor a project tree is available to a shelf probe; row de-claimed.
import { loadTemplates, splitJobs, findJobEntries } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-delivery-ci-workflows/src/workflow-lint.mjs';

export const anchorAcId = 'AC-6102-2';
export const accountBound = false;

const LIM_6102_2 = `AC-6102-2: requires the CI job step to be a single-line node invocation AND every gate-level branching, timing, and report-writing responsibility to live inside the Node runner rather than the CI configuration. This row observes only the single-line invocation; it does not prove absence of gate-specific logic elsewhere in the job.`;
const LIM_6102_1 = `AC-6102-1: requires the aggregate report's runner.entryPoint field (a runtime property the project's rcf runner writes into .rcf/reports/ci/pipeline.json) to record a project-relative .js/.mjs path AND that path to exist in the tree. Neither the runtime aggregate report nor a project tree is available to a shelf probe.`;

export default async function runProbe() {
  const templates = await loadTemplates();
  const results = [];
  if (templates.length === 0) {
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_6102_2,
      verdict: 'fail',
      detail: `observed no workflow templates found under the shipped github-actions assets directory; the single-line invocation observation cannot be made without at least one file.`,
      evidence: { templateCount: 0, entries: [], bodyExcerpt: 'no templates' },
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
    anchorAcId: null,
    conformanceOnly: true,
    limitation: LIM_6102_2,
    verdict: jobsScanned > 0 && jobsWithExactlyOne === jobsScanned ? 'pass' : 'fail',
    detail: `observed ${templates.length} workflow templates scanned; ${jobsScanned} jobs; ${jobsWithExactlyOne} jobs run exactly one 'node scripts/rcf-*.js' invocation; violations=${JSON.stringify(violations)}. Absence of gate-specific branching/timing/report-writing logic elsewhere in the job not observed.`,
    evidence: { perFile, jobsScanned, jobsWithExactlyOne, violations, entries: perFile.flatMap((f) => f.jobs.flatMap((j) => j.entries)), bodyExcerpt: `jobs=${jobsScanned} oneEntry=${jobsWithExactlyOne}` },
  });

  const flat = perFile.flatMap((f) => f.jobs.flatMap((j) => j.entries));
  const uniqueEntries = [...new Set(flat)];
  results.push({
    anchorAcId: null,
    conformanceOnly: true,
    limitation: LIM_6102_1,
    verdict: 'pass',
    detail: `observed ${flat.length} 'node scripts/rcf-*.{js,mjs}' entries across all jobs; uniqueEntries=${JSON.stringify(uniqueEntries)}. Each shipped template names its own canonical entry per workflow; the shelf cannot observe the runtime aggregate report's runner.entryPoint field or its path existence in a downstream tree.`,
    evidence: { entries: flat, uniqueEntries, bodyExcerpt: `entries=${flat.length} unique=${uniqueEntries.length}` },
  });

  return { results, extra: { envDeclared: [], templateCount: templates.length, perFile } };
}
