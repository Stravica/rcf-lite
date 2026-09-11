// Workflow-template-shape probe for delivery-ci-workflows v2.3.1.
// Loads every workflow template under the blueprint's github-actions
// assets and asserts the top-level 'name', 'on' and 'jobs' keys are
// present in each. Optionally runs actionlint on the same set when
// the binary is on PATH; a missing actionlint records a WARN result
// naming the unavailable binary as the reason.
//
// Positive evidence: file paths plus scanned top-level keys per
// template are excerpted on the report; the actionlint branch, when
// it ran, includes its stdout as positive evidence.
// anchorAcId: AC-6101-1. accountBound: false.

import { loadTemplates, scanTopLevel, findCheckoutStep, actionlintOn } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-delivery-ci-workflows/src/workflow-lint.mjs';

export const anchorAcId = 'AC-6101-1';
export const accountBound = false;

export default async function runProbe() {
  const templates = await loadTemplates();
  const results = [];
  const perFile = [];
  let allShapeOk = templates.length >= 1;
  for (const t of templates) {
    const scan = scanTopLevel(t.text);
    const checkout = findCheckoutStep(t.text);
    perFile.push({ file: t.name, path: t.path, scan, checkout });
    if (!scan.name || !scan.on || !scan.jobs || !checkout) allShapeOk = false;
  }
  results.push({
    anchorAcId: 'AC-6101-1',
    verdict: allShapeOk ? 'pass' : 'fail',
    detail: `${templates.length} github-actions templates scanned; every one has name/on/jobs + a checkout step`,
    evidence: { perFile },
  });

  const actionlint = await actionlintOn(templates.map((t) => t.path));
  if (actionlint.ran) {
    results.push({
      anchorAcId: 'AC-6101-2',
      verdict: actionlint.exitCode === 0 ? 'pass' : 'fail',
      detail: `actionlint exit=${actionlint.exitCode}; stdout='${actionlint.stdout.trim().slice(0, 500)}' stderr='${actionlint.stderr.trim().slice(0, 500)}'`,
      evidence: { exitCode: actionlint.exitCode, stdoutExcerpt: actionlint.stdout.slice(0, 800), stderrExcerpt: actionlint.stderr.slice(0, 800) },
    });
  } else {
    results.push({
      anchorAcId: 'AC-6101-2',
      verdict: 'warn',
      detail: `actionlint not run: ${actionlint.reason}; fell back to fixture YAML shape check`,
      accountBoundSkipped: false,
      reason: 'actionlint-not-on-PATH',
      evidence: { reason: actionlint.reason },
    });
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_CIW_ACTIONLINT_PATH'], templateCount: templates.length, actionlintRan: actionlint.ran } };
}
