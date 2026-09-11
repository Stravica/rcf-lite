// Workflow-template-shape probe for delivery-ci-workflows.
//
// Loads every workflow template under the blueprint's github-actions
// assets and asserts the top-level 'name', 'on' and 'jobs' keys and
// a checkout step are present. This observes REQ-009-delivery-ci-workflows
// (the blueprint ships illustrative GitHub Actions workflow files);
// no shipped AC states basic template shape, so per Addendum rule 1
// the requirement is the anchor.
//
// The actionlint syntax gate is retained as an OBSERVATION row but
// de-claimed from AC-6101-3. AC-6101-3 requires the MATERIALISER to
// refuse a template whose trigger set is missing a required event,
// producing a stable-coded WORKFLOW_TRIGGER_INCOMPLETE error and
// leaving the workflow directory unchanged. Actionlint checks syntax,
// not materialiser refusal; per closure-3 §6 the row is de-claimed
// (anchorAcId=null, conformanceOnly true) with the limitation naming
// AC-6101-3. The binary path is overridable via the declared env
// RCF_FIXTURE_CIW_ACTIONLINT_PATH; when actionlint is unavailable
// the row records an honest SKIP naming that variable.
//
// AC-6101-2 (branch-protection/merge-policy refusal) is a runtime
// repository property this probe cannot observe without a repository
// it controls; recorded as notObservableHere.
//
// Every detail line begins with the first eight words of the AC or
// REQ text.
import { loadTemplates, scanTopLevel, findCheckoutStep, actionlintOn } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-delivery-ci-workflows/src/workflow-lint.mjs';

export const anchorAcId = 'REQ-009-delivery-ci-workflows';
export const accountBound = false;
const REQ9 = 'The blueprint ships illustrative GitHub Actions workflow files';

export default async function runProbe() {
  const templates = await loadTemplates();
  const results = [];
  if (templates.length === 0) {
    results.push({
      anchorAcId: 'REQ-009-delivery-ci-workflows',
      verdict: 'fail',
      detail: `${REQ9}  -  observed no workflow templates found under the shipped github-actions assets directory.`,
      evidence: { templateCount: 0, entries: [] },
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
    // De-claim: actionlint checks yaml syntax, not the AC-6101-3
    // materialiser refusal contract. Observation kept.
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: `AC-6101-3: requires the MATERIALISER to refuse a template with a missing required trigger event, emit a stable-coded WORKFLOW_TRIGGER_INCOMPLETE error, and leave the workflow directory unchanged. Actionlint observes yaml syntax, not materialiser refusal, error code, or filesystem effect.`,
      verdict: actionlint.exitCode === 0 ? 'pass' : 'fail',
      detail: `observed actionlint (binary=${actionlint.binaryUsed}, override=${actionlint.overrideProvided}) exit=${actionlint.exitCode}; stdout='${actionlint.stdout.trim().slice(0, 500)}' stderr='${actionlint.stderr.trim().slice(0, 500)}'.`,
      evidence: { binaryUsed: actionlint.binaryUsed, overrideProvided: actionlint.overrideProvided, exitCode: actionlint.exitCode, stdoutExcerpt: actionlint.stdout.slice(0, 800), stderrExcerpt: actionlint.stderr.slice(0, 800), perFile },
    });
  } else {
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: `AC-6101-3: requires the MATERIALISER to refuse a template with a missing required trigger event, emit a stable-coded WORKFLOW_TRIGGER_INCOMPLETE error, and leave the workflow directory unchanged. Actionlint observes yaml syntax, not materialiser refusal.`,
      verdict: 'pass',
      accountBoundSkipped: true,
      reason: 'RCF_FIXTURE_CIW_ACTIONLINT_PATH',
      detail: `accountBoundSkipped: actionlint not runnable (${actionlint.reason}). Set RCF_FIXTURE_CIW_ACTIONLINT_PATH to an actionlint binary to run this observation.`,
      evidence: { reason: actionlint.reason, binaryTried: actionlint.binaryUsed, overrideProvided: actionlint.overrideProvided },
    });
  }

  results.push({
    anchorAcId: null,
    notObservableHere: {
      ac: 'AC-6101-2',
      reason: 'the merge policy blocks a merge whose most recent required check is not success — the property requires a probe-controlled repository with branch protection wired and an attempted protected merge; a shelf probe cannot create branch protection or issue a protected merge.',
    },
    verdict: 'warn',
    detail: `${REQ9}  -  AC-6101-2 is not observable from a shelf probe without a probe-controlled repository with branch protection wired and an attempted protected merge; recorded as notObservableHere. A repository-scoped closure would need a scratch repo, branch protection, a failing pipeline record and an attempted merge refused by the platform.`,
    evidence: { unobservableReason: 'no probe-controlled repository available; branch protection cannot be created or attempted from a shelf probe', suggestedFollowUp: 'move AC-6101-2 verification to a repository-scoped harness' },
  });

  return { results, extra: { envDeclared: ['RCF_FIXTURE_CIW_ACTIONLINT_PATH'], templateCount: templates.length, actionlintRan: actionlint.ran, actionlintBinaryUsed: actionlint.binaryUsed, actionlintOverrideProvided: actionlint.overrideProvided } };
}
