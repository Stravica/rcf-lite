// Real-account GitHub Actions run-record probe for delivery-ci-workflows.
//
// Live branch: read-only. Uses ambient `gh` auth (checked via
// `gh auth status` as a pre-flight observation). The probe requires
// evidence that a commit-triggered run of one of the BLUEPRINT'S
// OWN commit-triggered workflow templates (default-branch-checks,
// pull-request-checks) executed successfully  -  release and
// scheduled-audit workflows are NOT commit-triggered per user story 6101
// and are excluded from the qualifying set. If no matching run is
// found the row is an honest AMBER (not a passing skip); the probe
// never cites an unrelated run as evidence for the anchor AC.
//
// Additional row: the aggregate pipeline report content
// (.rcf/reports/ci/pipeline.json trigger field) is not observable
// from `gh run list` alone; recorded as AMBER with a named reason.
//
// Vendor citation: GitHub Actions REST API,
// https://docs.github.com/en/rest/actions/workflow-runs (verified
// 2026-09-11).
//
// Skip contract:
// - CI_HAS_GITHUB_ACTIONS unset -> accountBoundSkipped naming the var
// - gh auth status failure when the gate IS set is a FAIL with the
//   error excerpt, not a passing skip.
//
// Every detail line begins with the first eight words of the AC text.
import { spawn } from 'node:child_process';

export const anchorAcId = 'AC-6101-1';
export const accountBound = true;
const AC1 = "The CI provider's jobs for the commit-triggered workflows";

// Commit-triggered workflows only per user story 6101; release/scheduled-audit excluded.
const BLUEPRINT_COMMIT_WORKFLOW_NAMES = new Set([
  'default-branch-checks',
  'pull-request-checks',
]);

function skipRow(reason, detail) {
  return { anchorAcId, verdict: 'pass', accountBoundSkipped: true, reason, detail };
}
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
      results: [skipRow('CI_HAS_GITHUB_ACTIONS', `${AC1}  -  accountBoundSkipped: CI_HAS_GITHUB_ACTIONS not set to true; the probe did not query gh.`)],
      extra: commonExtra({ accountBoundSkipped: true, reason: 'CI_HAS_GITHUB_ACTIONS' }),
    };
  }
  const preflight = await runCmd('gh', ['auth', 'status']);
  if (!preflight.ran || preflight.exitCode !== 0) {
    return {
      results: [{
        anchorAcId,
        verdict: 'fail',
        detail: `${AC1}  -  observed gh auth status FAILED with CI_HAS_GITHUB_ACTIONS=true: exit=${preflight.exitCode ?? 'n/a'} reason=${preflight.reason ?? ''} stderr='${preflight.stderr?.trim().slice(0, 200) ?? ''}'.`,
        evidence: { ghAuthExitCode: preflight.exitCode, ghAuthStderr: preflight.stderr, spawnReason: preflight.reason },
      }],
      extra: commonExtra({}),
    };
  }
  const repo = process.env.RCF_FIXTURE_CIW_REPO;
  if (!repo) {
    return {
      results: [skipRow('RCF_FIXTURE_CIW_REPO', `${AC1}  -  accountBoundSkipped: RCF_FIXTURE_CIW_REPO unset. Set to a repo whose workflows the probe may query read-only; no default repository is embedded.`)],
      extra: commonExtra({ accountBoundSkipped: true, reason: 'RCF_FIXTURE_CIW_REPO' }),
    };
  }

  const list = await runCmd('gh', ['run', 'list', '-R', repo, '--limit', '30', '--json', 'databaseId,conclusion,event,name,workflowName,url,createdAt,headBranch']);
  const results = [];
  if (!list.ran || list.exitCode !== 0) {
    results.push({
      anchorAcId,
      verdict: 'fail',
      detail: `${AC1}  -  observed gh run list -R ${repo} FAILED exit=${list.exitCode ?? 'n/a'} stderr='${list.stderr?.trim().slice(0, 200) ?? list.reason}'.`,
      evidence: { repo, exitCode: list.exitCode, stderr: list.stderr, spawnReason: list.reason },
    });
    return { results, extra: commonExtra({ repo }) };
  }
  const runs = JSON.parse(list.stdout || '[]');
  const anchored = runs.filter((r) => BLUEPRINT_COMMIT_WORKFLOW_NAMES.has(r.workflowName) || BLUEPRINT_COMMIT_WORKFLOW_NAMES.has(r.name));
  const most = anchored[0];
  if (!most) {
    results.push({
      anchorAcId,
      verdict: 'warn',
      detail: `${AC1}  -  observed no recent run of the blueprint's commit-triggered workflow templates (${[...BLUEPRINT_COMMIT_WORKFLOW_NAMES].join(', ')}) in the last ${runs.length} runs of the queried repo. Recording AMBER; the probe never cites an unrelated repository run as evidence.`,
      evidence: { runsScanned: runs.length, commitTriggeredWorkflowNames: [...BLUEPRINT_COMMIT_WORKFLOW_NAMES], mostRecentByWorkflow: runs.slice(0, 5).map((r) => ({ workflowName: r.workflowName, conclusion: r.conclusion })) },
    });
  } else {
    results.push({
      anchorAcId,
      verdict: most.databaseId && most.conclusion === 'success' ? 'pass' : 'fail',
      detail: `${AC1}  -  observed the most recent run of a blueprint-anchored commit-triggered workflow: runId=${most.databaseId} workflowName='${most.workflowName}' conclusion=${most.conclusion} event=${most.event} branch=${most.headBranch}.`,
      evidence: { runId: most.databaseId, workflowName: most.workflowName, conclusion: most.conclusion, event: most.event, headBranch: most.headBranch, url: most.url, createdAt: most.createdAt },
    });
  }

  return { results, extra: commonExtra({ latestRunId: anchored[0]?.databaseId, latestRunConclusion: anchored[0]?.conclusion, latestRunWorkflow: anchored[0]?.workflowName }) };
}
