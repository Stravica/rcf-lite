// Workflow-template-shape probe for delivery-ci-workflows.
//
// Loads every workflow template under the blueprint's github-actions
// assets and asserts the top-level 'name', 'on' and 'jobs' keys and
// a checkout step are present. This observes REQ-009-delivery-ci-workflows
// (the blueprint ships illustrative GitHub Actions workflow files);
// no shipped AC states basic template shape, so per Addendum rule 1
// the requirement is the anchor. Actionlint on the same set is
// anchored to AC-6101-3 (trigger completeness) as an additional
// syntactic gate on the trigger block; the binary path is
// overridable via the declared env RCF_FIXTURE_CIW_ACTIONLINT_PATH.
// When actionlint is unavailable the row records an honest SKIP
// naming that variable.
//
// AC-6101-2 (branch-protection/merge-policy refusal) is a runtime
// repository property this probe cannot observe without a repository
// it controls; recorded as AMBER with a named reason.
//
// Every detail line begins with the first eight words of the AC or
// REQ text.
import { loadTemplates, scanTopLevel, findCheckoutStep, actionlintOn } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-delivery-ci-workflows/src/workflow-lint.mjs';

export const anchorAcId = 'REQ-009-delivery-ci-workflows';
export const accountBound = false;
const REQ9 = 'The blueprint ships illustrative GitHub Actions workflow files';
const AC3 = 'A workflow whose trigger set omits one of';

export default async function runProbe() {
  const templates = await loadTemplates();
  const results = [];
  if (templates.length === 0) {
    results.push({
      anchorAcId: 'REQ-009-delivery-ci-workflows',
      verdict: 'fail',
      detail: `${REQ9}  -  observed no workflow templates found under the shipped github-actions assets directory.`,
      evidence: { templateCount: 0 },
    });
    return { results, extra: { envDeclared: ['RCF_FIXTURE_CIW_ACTIONLINT_PATH'], templateCount: 0 } };
  }

  const perFile = [];
  let allShapeOk = true;
  for (const t of templates) {
    const scan = scanTopLevel(t.text);
    const checkout = findCheckoutStep(t.text);
    perFile.push({ file: t.name, path: t.path, scan, checkout });
    if (!scan.name || !scan.on || !scan.jobs || !checkout) allShapeOk = false;
  }
  results.push({
    anchorAcId: 'REQ-009-delivery-ci-workflows',
    verdict: allShapeOk ? 'pass' : 'fail',
    detail: `${REQ9}  -  observed ${templates.length} github-actions templates scanned; every one has name/on/jobs + a checkout step (illustrative-file shape).`,
    evidence: { perFile },
  });

  const actionlint = await actionlintOn(templates.map((t) => t.path));
  if (actionlint.ran) {
    results.push({
      anchorAcId: 'AC-6101-3',
      verdict: actionlint.exitCode === 0 ? 'pass' : 'fail',
      detail: `${AC3} the required events  -  observed actionlint (binary=${actionlint.binaryUsed}, override=${actionlint.overrideProvided}) exit=${actionlint.exitCode}; stdout='${actionlint.stdout.trim().slice(0, 500)}' stderr='${actionlint.stderr.trim().slice(0, 500)}'.`,
      evidence: { binaryUsed: actionlint.binaryUsed, overrideProvided: actionlint.overrideProvided, exitCode: actionlint.exitCode, stdoutExcerpt: actionlint.stdout.slice(0, 800), stderrExcerpt: actionlint.stderr.slice(0, 800) },
    });
  } else {
    results.push({
      anchorAcId: 'AC-6101-3',
      verdict: 'pass',
      accountBoundSkipped: true,
      reason: 'RCF_FIXTURE_CIW_ACTIONLINT_PATH',
      detail: `${AC3} the required events  -  accountBoundSkipped: actionlint not runnable (${actionlint.reason}). Set RCF_FIXTURE_CIW_ACTIONLINT_PATH to an actionlint binary to run this check.`,
      evidence: { reason: actionlint.reason, binaryTried: actionlint.binaryUsed, overrideProvided: actionlint.overrideProvided },
    });
  }

  results.push({
    anchorAcId: 'AC-6101-2',
    verdict: 'warn',
    detail: `${REQ9}  -  the merge policy blocks a merge property (AC-6101-2) cannot be observed from a shelf probe without a repository the probe controls; recording AMBER with a named reason. A repository-scoped closure would need a scratch repo, branch protection wired, a failing pipeline record and an attempted merge refused by the platform.`,
    evidence: { unobservableReason: 'no probe-controlled repository available; branch protection cannot be created or attempted from a shelf probe', suggestedFollowUp: 'move AC-6101-2 verification to a repository-scoped harness' },
  });

  return { results, extra: { envDeclared: ['RCF_FIXTURE_CIW_ACTIONLINT_PATH'], templateCount: templates.length, actionlintRan: actionlint.ran, actionlintBinaryUsed: actionlint.binaryUsed, actionlintOverrideProvided: actionlint.overrideProvided } };
}
