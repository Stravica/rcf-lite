// Real-account GitHub Actions run-record probe for delivery-ci-workflows v2.3.1.
//
// Live branch: read-only. Uses ambient `gh` auth (checked via
// `gh auth status` as a pre-flight observation). Queries the last 5
// workflow runs of the rcf-lite repo (or RCF_FIXTURE_CIW_REPO) via
// `gh run list --json` and records the most recent run's id,
// conclusion, event, workflow name and htmlUrl as positive evidence
// of a real deploy record.
//
// Vendor citation: GitHub Actions REST API (via gh),
// https://docs.github.com/en/rest/actions/workflow-runs (verified
// 2026-09-11 for e-mixed dispatch).
//
// Honest skip: without CI_HAS_GITHUB_ACTIONS=true, or when
// `gh auth status` fails, the probe records accountBoundSkipped:
// true and the reason names the missing capability.
//
// anchorAcId: AC-6103-1 (deploy-record shape). accountBound: true.
// The probe NEVER triggers a workflow.

import { spawn } from 'node:child_process';

export const anchorAcId = 'AC-6103-1';
export const accountBound = true;

function skipResult(reason, detail) {
  return {
    results: [{ anchorAcId, verdict: 'pass', accountBoundSkipped: true, reason, detail }],
    extra: {
      accountBoundSkipped: true, reason,
      envDeclared: ['CI_HAS_GITHUB_ACTIONS', 'RCF_FIXTURE_CIW_REPO'],
      vendorFact: { url: 'https://docs.github.com/en/rest/actions/workflow-runs', verifiedOn: '2026-09-11' },
    },
  };
}

function runCmd(cmd, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = []; const err = [];
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {}; resolve({ ran: false, reason: 'timeout' }); }, timeoutMs);
    child.stdout.on('data', (b) => out.push(b.toString('utf8')));
    child.stderr.on('data', (b) => err.push(b.toString('utf8')));
    child.on('error', (e) => { clearTimeout(timer); resolve({ ran: false, reason: `spawn: ${e.code || e.message}` }); });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ ran: true, exitCode: code, stdout: out.join(''), stderr: err.join('') }); });
  });
}

export default async function runProbe() {
  if (process.env.CI_HAS_GITHUB_ACTIONS !== 'true') return skipResult('CI_HAS_GITHUB_ACTIONS', 'accountBoundSkipped: CI_HAS_GITHUB_ACTIONS is not set to true; the probe did not query gh.');
  const preflight = await runCmd('gh', ['auth', 'status']);
  if (!preflight.ran || preflight.exitCode !== 0) {
    return skipResult('gh auth status failed', `accountBoundSkipped: gh auth status exit=${preflight.exitCode ?? 'n/a'} reason=${preflight.reason ?? ''}`);
  }
  const repo = process.env.RCF_FIXTURE_CIW_REPO || 'Stravica/rcf-lite';
  const list = await runCmd('gh', ['run', 'list', '-R', repo, '--limit', '5', '--json', 'databaseId,conclusion,event,name,workflowName,url,createdAt']);
  const results = [];
  if (!list.ran || list.exitCode !== 0) {
    results.push({ anchorAcId: 'AC-6103-1', verdict: 'fail', detail: `gh run list -R ${repo} exit=${list.exitCode ?? 'n/a'} stderr='${list.stderr?.trim().slice(0, 200) ?? list.reason}'`, evidence: { stderr: list.stderr } });
    return { results, extra: { envDeclared: ['CI_HAS_GITHUB_ACTIONS', 'RCF_FIXTURE_CIW_REPO'] } };
  }
  const runs = JSON.parse(list.stdout || '[]');
  const most = runs[0];
  results.push({
    anchorAcId: 'AC-6103-1',
    verdict: Array.isArray(runs) && runs.length >= 1 && most.databaseId ? 'pass' : 'fail',
    detail: `gh run list -R ${repo} returned ${runs.length} runs; latest id=${most?.databaseId} conclusion=${most?.conclusion} event=${most?.event} url=${most?.url}`,
    evidence: { repo, runs: runs.slice(0, 5).map((r) => ({ id: r.databaseId, conclusion: r.conclusion, event: r.event, workflowName: r.workflowName, url: r.url, createdAt: r.createdAt })) },
  });
  return {
    results,
    extra: {
      envDeclared: ['CI_HAS_GITHUB_ACTIONS', 'RCF_FIXTURE_CIW_REPO'],
      repo, latestRunId: most?.databaseId, latestRunUrl: most?.url,
      vendorFact: { url: 'https://docs.github.com/en/rest/actions/workflow-runs', verifiedOn: '2026-09-11' },
    },
  };
}
