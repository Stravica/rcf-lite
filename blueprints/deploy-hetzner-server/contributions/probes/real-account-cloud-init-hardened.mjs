// Probe: real-account cloud-init hardened.
//
// anchorAcId: AC-37105-1. accountBound: true.
//
// Without CI_HAS_HETZNER_ACCOUNT the probe records
// accountBoundSkipped: true and the aggregate flips to pass.
//
// With the env var set the probe:
//   - provisions the throwaway server via the fixture provision.mjs;
//   - shells cloud-init status --wait over ssh to the throwaway server;
//   - runs the six baseline checks over ssh (grep for the marker per
//     baseline block); FAILS naming the first missing block on any
//     defect.
//   - always() calls destroy.mjs regardless of verdict.

import { accountBoundSkippedResult, FIXTURE_DIR } from './probe-utils.mjs';
import { resolve } from 'node:path';

export const anchorAcId = 'AC-37105-1';
export const accountBound = true;

export default async function runProbe() {
  if (process.env.CI_HAS_HETZNER_ACCOUNT !== 'true') {
    return {
      results: [accountBoundSkippedResult(anchorAcId, 'real-account cloud-init hardened check skipped; run with CI_HAS_HETZNER_ACCOUNT=true to exercise the six ssh baseline checks against a throwaway cx23.')],
    };
  }
  const provisionPath = resolve(FIXTURE_DIR, 'provision.mjs');
  const destroyPath = resolve(FIXTURE_DIR, 'destroy.mjs');
  const sshCheckPath = resolve(FIXTURE_DIR, 'src/ssh-baseline-check.mjs');
  const { provisionThrowawayServer } = await import(provisionPath);
  const { destroyThrowawayServer } = await import(destroyPath);
  const { runSshBaselineChecks } = await import(sshCheckPath);
  let provisioned;
  try {
    provisioned = await provisionThrowawayServer({ runId: process.env.GITHUB_RUN_ID ?? 'local' });
    const report = await runSshBaselineChecks(provisioned);
    const failed = report.checks.filter((c) => c.verdict === 'fail');
    if (failed.length > 0) {
      return {
        results: failed.map((c) => ({
          anchorAcId,
          verdict: 'fail',
          detail: `cloud-init baseline block "${c.label}" failed on server ${provisioned.id}: ${c.detail}`,
        })),
      };
    }
    const blocks = report.checks.filter((c) => c.verdict === 'pass').map((c) => c.id);
    return {
      results: [{
        anchorAcId,
        verdict: 'pass',
        detail: `cloud-init reached terminal state on server ${provisioned.id} (cloud-init status --wait exit ${report.cloudInit ? report.cloudInit.code : 'skipped'}); six baseline hardening blocks observed: ${blocks.join(', ')}.`,
      }],
      extra: report,
    };
  } catch (err) {
    return { results: [{ anchorAcId, verdict: 'fail', detail: `check failed: ${err.message}` }] };
  } finally {
    if (provisioned && provisioned.id) {
      try { await destroyThrowawayServer(provisioned); } catch (_) { /* swept by orphan cron */ }
    }
  }
}
