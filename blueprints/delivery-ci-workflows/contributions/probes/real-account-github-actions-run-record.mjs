// Real-account GitHub Actions run-record probe for delivery-ci-workflows.
//
// Live branch: read-only. Uses ambient `gh` auth (checked via
// `gh auth status` as a pre-flight observation). The probe requires
// evidence that a run of one of the BLUEPRINT'S OWN workflow templates
// (default-branch-checks, pull-request-checks, release or scheduled-audit)
// executed successfully - not merely an arbitrary recent repository
// workflow run. It queries the last 30 runs of the repo, filters to
// those whose workflow name equals one of the blueprint's template
// file names (per the templates' `name:` field: default-branch-checks,
// pull-request-checks, release, scheduled-audit), and asserts the
// most recent such run has conclusion === 'success'. When no run
// matches, the live branch is an honest AMBER stating that; the
// probe never cites an unrelated run as evidence for the anchor AC.
//
// Vendor citation: GitHub Actions REST API (via gh),
// https://docs.github.com/en/rest/actions/workflow-runs (verified
// 2026-09-11).
//
// Skip contract:
// - CI_HAS_GITHUB_ACTIONS unset  -> accountBoundSkipped naming the var
// - gh auth status failure when the gate IS set is a FAIL with the
//   error excerpt, not a passing skip: with the gate turned on the
//   caller has asked the probe to execute, so auth must succeed.
//
// anchorAcId: AC-6101-1 (the CI provider's jobs for the commit-
// triggered workflows are triggered by the branch-model events;
// the aggregate report at .rcf/reports/ci/pipeline.json is written).
// accountBound: true.

import { spawn } from 'node:child_process';

export const anchorAcId = 'AC-6101-1';
export const accountBound = true;

// Blueprint-shipped workflow template names. If the templates change
// this list moves with them.
const BLUEPRINT_WORKFLOW_NAMES = new Set([
  'default-branch-checks',
  'pull-request-checks',
  'release',
  'scheduled-audit',
]);

function skipRow(reason, detail) {
  return { anchorAcId, verdict: 'pass', accountBoundSkipped: true, reason, detail };
}

function commonExtra(base = {}) {
  return {
    envDeclared: ['CI_HAS_GITHUB_ACTIONS', 'RCF_FIXTURE_CIW_REPO'],
    vendorFact: { url: 'https://docs.github.com/en/rest/actions/workflow-runs', verifiedOn: '2026-09-11' },
    blueprintWorkflowNames: [...BLUEPRINT_WORKFLOW_NAMES],
    ...base,
  };
}

function runCmd(cmd, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = []; const err = [];
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve({ ran: false, reason: 'timeout' }); }, timeoutMs);
    child.stdout.on('data', (b) => out.push(b.toString('utf8')));
    child.stderr.on('data', (b) => err.push(b.toString('utf8')));
    child.on('error', (e) => { clearTimeout(timer); resolve({ ran: false, reason: `spawn: ${e.code || e.message}` }); });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ ran: true, exitCode: code, stdout: out.join(''), stderr: err.join('') }); });
  });
}

export default async function runProbe() {
  if (process.env.CI_HAS_GITHUB_ACTIONS !== 'true') {
    return {
      results: [skipRow('CI_HAS_GITHUB_ACTIONS', 'accountBoundSkipped: CI_HAS_GITHUB_ACTIONS is not set to true; the probe did not query gh.')],
      extra: commonExtra({ accountBoundSkipped: true, reason: 'CI_HAS_GITHUB_ACTIONS' }),
    };
  }
  const preflight = await runCmd('gh', ['auth', 'status']);
  if (!preflight.ran || preflight.exitCode !== 0) {
    // Gate is on: the operator has asserted the account is present.
    // An auth failure at this point is a real failure, never a passing
    // skip. Report the FAIL with the error excerpt.
    return {
      results: [{
        anchorAcId,
        verdict: 'fail',
        detail: `gh auth status FAILED with CI_HAS_GITHUB_ACTIONS=true: exit=${preflight.exitCode ?? 'n/a'} reason=${preflight.reason ?? ''} stderr='${preflight.stderr?.trim().slice(0, 200) ?? ''}'`,
        evidence: { ghAuthExitCode: preflight.exitCode, ghAuthStderr: preflight.stderr, spawnReason: preflight.reason },
      }],
      extra: commonExtra({}),
    };
  }
  const repo = process.env.RCF_FIXTURE_CIW_REPO;
  if (!repo) {
    // Repo is optional but a real query needs it. Skip the live branch
    // honestly naming the exact var; the caller sets it to a repo the
    // probe can query read-only.
    return {
      results: [skipRow('RCF_FIXTURE_CIW_REPO', 'accountBoundSkipped: RCF_FIXTURE_CIW_REPO unset. The probe does not default to any repository; set it to a repo whose workflows the probe may query read-only.')],
      extra: commonExtra({ accountBoundSkipped: true, reason: 'RCF_FIXTURE_CIW_REPO' }),
    };
  }

  const list = await runCmd('gh', ['run', 'list', '-R', repo, '--limit', '30', '--json', 'databaseId,conclusion,event,name,workflowName,url,createdAt,headBranch']);
  const results = [];
  if (!list.ran || list.exitCode !== 0) {
    results.push({
      anchorAcId,
      verdict: 'fail',
      detail: `gh run list -R ${repo} FAILED exit=${list.exitCode ?? 'n/a'} stderr='${list.stderr?.trim().slice(0, 200) ?? list.reason}'`,
      evidence: { repo, exitCode: list.exitCode, stderr: list.stderr, spawnReason: list.reason },
    });
    return { results, extra: commonExtra({ repo }) };
  }
  const runs = JSON.parse(list.stdout || '[]');
  const anchored = runs.filter((r) => BLUEPRINT_WORKFLOW_NAMES.has(r.workflowName) || BLUEPRINT_WORKFLOW_NAMES.has(r.name));
  const most = anchored[0];
  if (!most) {
    results.push({
      anchorAcId,
      verdict: 'warn',
      detail: `no recent run of the blueprint's own workflow templates (${[...BLUEPRINT_WORKFLOW_NAMES].join(', ')}) found in the last ${runs.length} runs of ${repo}. Cannot cite an unrelated repository run as evidence for the anchor AC; recording AMBER honestly.`,
      evidence: { repo, runsScanned: runs.length, blueprintWorkflowNames: [...BLUEPRINT_WORKFLOW_NAMES], mostRecentByWorkflow: runs.slice(0, 5).map((r) => ({ workflowName: r.workflowName, conclusion: r.conclusion, url: r.url })) },
    });
    return { results, extra: commonExtra({ repo, runsScanned: runs.length }) };
  }
  results.push({
    anchorAcId,
    verdict: most.databaseId && most.conclusion === 'success' ? 'pass' : 'fail',
    detail: `gh run list -R ${repo}: most recent run of a blueprint-anchored workflow id=${most.databaseId} workflowName='${most.workflowName}' conclusion=${most.conclusion} event=${most.event} branch=${most.headBranch} url=${most.url}`,
    evidence: { repo, runId: most.databaseId, workflowName: most.workflowName, conclusion: most.conclusion, event: most.event, headBranch: most.headBranch, url: most.url, createdAt: most.createdAt },
  });
  return {
    results,
    extra: commonExtra({ repo, latestRunId: most.databaseId, latestRunUrl: most.url, latestRunConclusion: most.conclusion, latestRunWorkflow: most.workflowName }),
  };
}
