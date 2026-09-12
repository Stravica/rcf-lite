// Real-account GitHub Actions run-record probe for delivery-ci-workflows.
//
// Live branch: read-only. Uses ambient `gh` auth (checked via
// `gh auth status`). Queries the last N run records from the target
// repo and records what was observed.
//
// AC-6101-1 requires the CI provider's jobs for the commit-triggered
// workflows to trigger on the branch-model events AND the aggregate
// pipeline report's `trigger` field to record the specific triggering
// event. A `gh run list` record carries event, workflowName and
// conclusion but is not evidence of the CONFIGURED trigger set
// (branch-model coverage) and the aggregate report `trigger` field is
// a runtime pipeline-report property this probe does not read. Row
// de-claimed (conformanceOnly) with the limitation naming AC-6101-1.
//
// Skip contract:
// - CI_HAS_GITHUB_ACTIONS unset: accountBoundSkipped naming the var.
// - RCF_FIXTURE_CIW_REPO unset while the gate is on: accountBoundSkipped
//   naming that var.
// - gh auth status failure when the gate IS set: FAIL with the error
//   excerpt, not a passing skip.
//
// Vendor citation: GitHub Actions REST API,
// https://docs.github.com/en/rest/actions/workflow-runs
// (verified 2026-09-11).
import { spawn } from 'node:child_process';

export const anchorAcId = 'AC-6101-1';
export const accountBound = true;

// Commit-triggered workflows only per user story 6101.
const BLUEPRINT_COMMIT_WORKFLOW_NAMES = new Set([
  'default-branch-checks',
  'pull-request-checks',
]);

const LIMITATION = "AC-6101-1: requires observation of the CONFIGURED trigger set (branch-model push and pull-request events) on the workflow AND the aggregate pipeline report's `trigger` field. A gh run list record carries event, workflowName and conclusion but is not evidence of configured branch-model triggers, and the aggregate report is a runtime pipeline-report property this probe does not read.";

function commonExtra(base = {}) {
  return {
    envDeclared: ['CI_HAS_GITHUB_ACTIONS', 'RCF_FIXTURE_CIW_REPO'],
    vendorFact: { url: 'https://docs.github.com/en/rest/actions/workflow-runs', verifiedOn: '2026-09-11' },
    commitTriggeredWorkflowNames: [...BLUEPRINT_COMMIT_WORKFLOW_NAMES],
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
      results: [{
        anchorAcId: null,
        accountBoundSkipped: true,
        reason: 'CI_HAS_GITHUB_ACTIONS',
        verdict: 'pass',
        detail: `accountBoundSkipped: CI_HAS_GITHUB_ACTIONS not set to true; the probe did not query gh.`,
        evidence: { reason: 'CI_HAS_GITHUB_ACTIONS', declared: 'gate variable' },
      }],
      extra: commonExtra({ accountBoundSkipped: true, reason: 'CI_HAS_GITHUB_ACTIONS' }),
    };
  }
  const preflight = await runCmd('gh', ['auth', 'status']);
  if (!preflight.ran || preflight.exitCode !== 0) {
    return {
      results: [{
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMITATION,
        verdict: 'fail',
        detail: `observed gh auth status FAILED with CI_HAS_GITHUB_ACTIONS=true: exit=${preflight.exitCode ?? 'n/a'} reason=${preflight.reason ?? ''} stderr='${preflight.stderr?.trim().slice(0, 200) ?? ''}'.`,
        evidence: { ghAuthExitCode: preflight.exitCode, ghAuthStderr: preflight.stderr, spawnReason: preflight.reason },
      }],
      extra: commonExtra({}),
    };
  }
  const repo = process.env.RCF_FIXTURE_CIW_REPO;
  if (!repo) {
    return {
      results: [{
        anchorAcId: null,
        accountBoundSkipped: true,
        reason: 'RCF_FIXTURE_CIW_REPO',
        verdict: 'pass',
        detail: `accountBoundSkipped: RCF_FIXTURE_CIW_REPO unset. Set to a repo whose workflows the probe may query read-only; no default repository is embedded.`,
        evidence: { reason: 'RCF_FIXTURE_CIW_REPO', declared: 'target repository slug' },
      }],
      extra: commonExtra({ accountBoundSkipped: true, reason: 'RCF_FIXTURE_CIW_REPO' }),
    };
  }

  const list = await runCmd('gh', ['run', 'list', '-R', repo, '--limit', '30', '--json', 'databaseId,conclusion,event,name,workflowName,url,createdAt,headBranch']);
  const results = [];
  if (!list.ran || list.exitCode !== 0) {
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIMITATION,
      verdict: 'fail',
      detail: `observed gh run list -R ${repo} FAILED exit=${list.exitCode ?? 'n/a'} stderr='${list.stderr?.trim().slice(0, 200) ?? list.reason}'.`,
      evidence: { exitCode: list.exitCode, stderr: list.stderr, spawnReason: list.reason },
    });
    return { results, extra: commonExtra({}) };
  }
  const runs = JSON.parse(list.stdout || '[]');
  const anchored = runs.filter((r) => BLUEPRINT_COMMIT_WORKFLOW_NAMES.has(r.workflowName) || BLUEPRINT_COMMIT_WORKFLOW_NAMES.has(r.name));
  const most = anchored[0];
  if (!most) {
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIMITATION,
      verdict: 'pass',
      detail: `observed no recent run of the blueprint's commit-triggered workflow templates (${[...BLUEPRINT_COMMIT_WORKFLOW_NAMES].join(', ')}) in the last ${runs.length} runs of the queried repo. The probe never cites an unrelated repository run as evidence.`,
      evidence: { runsScanned: runs.length, commitTriggeredWorkflowNames: [...BLUEPRINT_COMMIT_WORKFLOW_NAMES], mostRecentByWorkflow: runs.slice(0, 5).map((r) => ({ workflowName: r.workflowName, conclusion: r.conclusion })), workflowName: 'none', conclusion: 'none', bodyExcerpt: `no anchored workflow run in ${runs.length} scanned` },
    });
  } else {
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIMITATION,
      verdict: most.databaseId && most.conclusion === 'success' ? 'pass' : 'fail',
      detail: `observed the most recent run of a blueprint-anchored commit-triggered workflow: runId=${most.databaseId} workflowName='${most.workflowName}' conclusion=${most.conclusion} event=${most.event} branch=${most.headBranch}.`,
      evidence: { runId: most.databaseId, workflowName: most.workflowName, conclusion: most.conclusion, event: most.event, headBranch: most.headBranch, url: most.url, createdAt: most.createdAt, bodyExcerpt: `runId=${most.databaseId} conclusion=${most.conclusion}` },
    });
  }

  return { results, extra: commonExtra({ latestRunId: anchored[0]?.databaseId, latestRunConclusion: anchored[0]?.conclusion, latestRunWorkflow: anchored[0]?.workflowName }) };
}
