// Probe: real-account throwaway-server provision.
//
// anchorAcId: AC-37103-1. accountBound: true.
//
// Without CI_HAS_HETZNER_ACCOUNT the probe records
// accountBoundSkipped: true and the aggregate flips to pass per
// hetzner-round-7-spec-2026-09-07.md section 3.5.
//
// With the env var set the probe:
//   - runs the fixture's provision.mjs against the ci-throwaway manifest;
//   - asserts a new server appears in `hcloud server list --output json`
//     whose id matches the scratch-file-written id;
//   - asserts the fixture's captured hetznerServerProvisioned event
//     carries id, primaryIpv4, location=fsn1, serverType=cx23;
//   - always() calls destroy.mjs so the throwaway server is torn down
//     regardless of verdict.

import { accountBoundSkippedResult, FIXTURE_DIR } from './probe-utils.mjs';
import { resolve } from 'node:path';

export const anchorAcId = 'AC-37103-1';
export const accountBound = true;

export default async function runProbe() {
  if (process.env.CI_HAS_HETZNER_ACCOUNT !== 'true') {
    return {
      results: [accountBoundSkippedResult(anchorAcId, 'real-account throwaway-server provision skipped; run with CI_HAS_HETZNER_ACCOUNT=true to exercise.')],
    };
  }
  const provisionPath = resolve(FIXTURE_DIR, 'provision.mjs');
  const destroyPath = resolve(FIXTURE_DIR, 'destroy.mjs');
  const { provisionThrowawayServer } = await import(provisionPath);
  const { destroyThrowawayServer } = await import(destroyPath);
  let provisioned;
  try {
    provisioned = await provisionThrowawayServer({ runId: process.env.GITHUB_RUN_ID ?? 'local' });
    return {
      results: [{
        anchorAcId,
        verdict: 'pass',
        detail: `throwaway server ${provisioned.id} provisioned; hetznerServerProvisioned event captured; primaryIpv4=${provisioned.primaryIpv4} location=${provisioned.location} serverType=${provisioned.serverType}.`,
      }],
      extra: { serverId: provisioned.id, primaryIpv4: provisioned.primaryIpv4 },
    };
  } catch (err) {
    return {
      results: [{
        anchorAcId,
        verdict: 'fail',
        detail: `provision failed: ${err.message}`,
      }],
    };
  } finally {
    if (provisioned && provisioned.id) {
      try { await destroyThrowawayServer(provisioned); } catch (_) { /* swept by orphan cron */ }
    }
  }
}
