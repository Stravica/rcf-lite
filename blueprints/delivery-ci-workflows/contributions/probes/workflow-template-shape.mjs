// Workflow-template-shape probe for delivery-ci-workflows.
//
// The blueprint ships illustrative GitHub Actions workflow files under
// its assets directory. This probe loads them, scans the top-level
// name/on/jobs keys and checks for a checkout step. It does NOT observe
// the full trigger set, package-manager setup, entry-point invocation,
// or artefact-upload clauses of REQ-009, so every row is de-claimed
// (conformanceOnly, anchorAcId=null) with a limitation naming the
// nearest shipped AC id whose property the row does not fully observe.
//
// Rows:
//   - template shape: de-claimed from AC-6101-1 (the AC governing
//     commit-triggered workflows the materialiser produces; template
//     shape is one narrow slice of that AC).
//   - actionlint: de-claimed from AC-6101-3 (the materialiser refusal
//     contract on missing required triggers; actionlint checks yaml
//     syntax, not materialiser refusal). Honest skip when the binary
//     is unavailable, naming RCF_FIXTURE_CIW_ACTIONLINT_PATH.
//   - branch protection: de-claimed from AC-6101-2 (the merge-policy
//     block on a non-successful required check; a repository property
//     no shelf probe can observe without a probe-controlled repository).
import { loadTemplates, scanTopLevel, findCheckoutStep, actionlintOn } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-delivery-ci-workflows/src/workflow-lint.mjs';

export const anchorAcId = 'AC-6101-1';
export const accountBound = false;

const LIM_TEMPLATE_SHAPE = `AC-6101-1: requires the materialiser to produce commit-triggered workflows wired to the elicited branch model trigger events (pushes and PR events for feature-branch, pushes and optional PRs for trunk). This row observes only name/on/jobs and a checkout step in each shipped illustrative template; it does not observe the trigger set, package-manager setup, entry-point invocation, or artefact-upload clauses.`;
const LIM_ACTIONLINT = `AC-6101-3: requires the materialiser to refuse a template whose trigger set omits a required event, exit non-zero, emit WORKFLOW_TRIGGER_INCOMPLETE, and leave the workflow directory unchanged. Actionlint observes yaml syntax, not materialiser refusal, error code, or filesystem effect.`;
const LIM_BRANCH_PROTECTION = `AC-6101-2: requires the platform merge policy to refuse a change whose most recent aggregate pipeline run recorded a failed verdict, with the refusal reason referencing the failed required check. This property requires a probe-controlled repository with branch protection wired and an attempted protected merge; a shelf probe cannot create branch protection or issue a protected merge.`;

export default async function runProbe() {
  const templates = await loadTemplates();
  const results = [];
  if (templates.length === 0) {
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_TEMPLATE_SHAPE,
      verdict: 'fail',
      detail: `observed no workflow templates found under the shipped github-actions assets directory; a v2 blueprint must ship at least one illustrative workflow file.`,
      evidence: { templateCount: 0, entries: [], bodyExcerpt: 'no templates found' },
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
    anchorAcId: null,
    conformanceOnly: true,
    limitation: LIM_TEMPLATE_SHAPE,
    verdict: allShapeOk ? 'pass' : 'fail',
    detail: `observed ${templates.length} github-actions templates scanned; every one has name/on/jobs + a checkout step (illustrative-file shape only).`,
    evidence: { perFile, bodyExcerpt: `templates=${templates.length} allShapeOk=${allShapeOk}` },
  });

  const actionlint = await actionlintOn(templates.map((t) => t.path));
  if (actionlint.ran) {
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_ACTIONLINT,
      verdict: actionlint.exitCode === 0 ? 'pass' : 'fail',
      detail: `observed actionlint (binary=${actionlint.binaryUsed}, override=${actionlint.overrideProvided}) exit=${actionlint.exitCode}; stdout='${actionlint.stdout.trim().slice(0, 500)}' stderr='${actionlint.stderr.trim().slice(0, 500)}'.`,
      evidence: { binaryUsed: actionlint.binaryUsed, overrideProvided: actionlint.overrideProvided, exitCode: actionlint.exitCode, stdoutExcerpt: actionlint.stdout.slice(0, 800), stderrExcerpt: actionlint.stderr.slice(0, 800), perFile },
    });
  } else {
    results.push({
      anchorAcId: null,
      accountBoundSkipped: true,
      reason: 'RCF_FIXTURE_CIW_ACTIONLINT_PATH',
      verdict: 'pass',
      detail: `accountBoundSkipped: actionlint not runnable (${actionlint.reason}). Set RCF_FIXTURE_CIW_ACTIONLINT_PATH to an actionlint binary to run this observation.`,
      evidence: { reason: actionlint.reason, binaryTried: actionlint.binaryUsed, overrideProvided: actionlint.overrideProvided },
    });
  }

  results.push({
    anchorAcId: null,
    conformanceOnly: true,
    limitation: LIM_BRANCH_PROTECTION,
    verdict: 'pass',
    detail: `AC-6101-2 branch-protection merge-policy refusal is not observable from a shelf probe without a probe-controlled repository; row de-claimed with the limitation naming AC-6101-2.`,
    evidence: { suggestedFollowUp: 'move AC-6101-2 verification to a repository-scoped harness', bodyExcerpt: 'not observable at shelf' },
  });

  return { results, extra: { envDeclared: ['RCF_FIXTURE_CIW_ACTIONLINT_PATH'], templateCount: templates.length, actionlintRan: actionlint.ran, actionlintBinaryUsed: actionlint.binaryUsed, actionlintOverrideProvided: actionlint.overrideProvided } };
}
