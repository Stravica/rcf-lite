// Probe: real-account snapshot on demand.
//
// anchorAcId: AC-37108-1. accountBound: true.
//
// Without CI_HAS_HETZNER_ACCOUNT the probe records
// accountBoundSkipped: true and the aggregate flips to pass.
//
// With the env var set the probe:
//   - provisions the throwaway server via provision.mjs;
//   - fires the snapshot verb on the provisioner facade;
//   - asserts hcloud image list --type=snapshot --output json shows a
//     snapshot with the server name and current wall-clock time in the
//     labels;
//   - always() calls destroy.mjs regardless of verdict; the snapshot is
//     deleted as part of destroy.mjs so the run leaves no orphaned
//     image behind.

import { accountBoundSkippedResult, FIXTURE_DIR } from './probe-utils.mjs';
import { resolve } from 'node:path';

export const anchorAcId = 'AC-37108-1';
export const accountBound = true;

export default async function runProbe() {
  if (process.env.CI_HAS_HETZNER_ACCOUNT !== 'true') {
    return {
      results: [accountBoundSkippedResult(anchorAcId, 'real-account snapshot on-demand skipped; run with CI_HAS_HETZNER_ACCOUNT=true to exercise the hcloud image create-image path.')],
    };
  }
  const provisionPath = resolve(FIXTURE_DIR, 'provision.mjs');
  const destroyPath = resolve(FIXTURE_DIR, 'destroy.mjs');
  const snapshotPath = resolve(FIXTURE_DIR, 'src/snapshot-verb.mjs');
  const { provisionThrowawayServer } = await import(provisionPath);
  const { destroyThrowawayServer } = await import(destroyPath);
  const { takeAndVerifySnapshot } = await import(snapshotPath);
  let provisioned;
  try {
    provisioned = await provisionThrowawayServer({ runId: process.env.GITHUB_RUN_ID ?? 'local' });
    const outcome = await takeAndVerifySnapshot(provisioned);
    if (!outcome.snapshotId) {
      return {
        results: [{ anchorAcId, verdict: 'fail', detail: `snapshot verb ran but no matching snapshot appeared in hcloud image list.` }],
      };
    }
    return {
      results: [{
        anchorAcId,
        verdict: 'pass',
        detail: `snapshot ${outcome.snapshotId} tagged with server name ${provisioned.name} and time ${outcome.wallClockTime} on server ${provisioned.id}.`,
      }],
      extra: outcome,
    };
  } catch (err) {
    return { results: [{ anchorAcId, verdict: 'fail', detail: `snapshot verb threw: ${err.message}` }] };
  } finally {
    if (provisioned && provisioned.id) {
      try { await destroyThrowawayServer(provisioned); } catch (_) { /* swept by orphan cron */ }
    }
  }
}
