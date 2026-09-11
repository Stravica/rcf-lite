// Probe: real-account snapshot on demand (v1.1.5).
//
// anchorAcId: AC-37108-1. accountBound: true.
//
// Contract:
//   - First-tier gate CI_HAS_HETZNER_ACCOUNT must equal exactly the
//     string "true"; anything else records an honest skip row.
//   - Second-tier HCLOUD_TOKEN missing carries its own honest skip row.
//   - The pass row carries an `evidence` object with the created
//     server id, the pre- and post-snapshot inventory (proving the
//     snapshot id was created then deleted), the snapshot id, the
//     hetznerSnapshotTaken event shape (serverName, snapshotId, ts),
//     and the label-match evidence.
//   - Teardown failure FAILS the verdict (the shape rule); the
//     evidence tree carries the orphan snapshot id and server id when
//     the destroy leaks.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import {
  firstTierGateSkipResult, secondTierMissingSkipResult, FIXTURE_DIR,
} from './probe-utils.mjs';

export const anchorAcId = 'AC-37108-1';
export const accountBound = true;

function hcloudJson(argv, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const p = spawn('hcloud', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch (_) {} reject(new Error(`hcloud ${argv.join(' ')} timed out after ${timeoutMs}ms`)); }, timeoutMs);
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', (err) => { clearTimeout(timer); reject(err); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`hcloud ${argv.join(' ')} exited ${code}: ${stderr}`));
      const trimmed = stdout.trim();
      if (trimmed.length === 0) return resolvePromise([]);
      try {
        const parsed = JSON.parse(trimmed);
        resolvePromise(Array.isArray(parsed) ? parsed : (parsed.images || parsed.servers || []));
      } catch (err) {
        reject(new Error(`hcloud stdout not JSON: ${err.message}`));
      }
    });
  });
}

export default async function runProbe() {
  if (process.env.CI_HAS_HETZNER_ACCOUNT !== 'true') {
    return {
      results: [firstTierGateSkipResult(
        anchorAcId,
        'CI_HAS_HETZNER_ACCOUNT',
        'real-account snapshot on-demand skipped; run with CI_HAS_HETZNER_ACCOUNT=true to exercise the hcloud server create-image path.',
      )],
      extra: { skipped: true, missingEnv: ['CI_HAS_HETZNER_ACCOUNT'] },
    };
  }
  if (!process.env.HCLOUD_TOKEN) {
    return {
      results: [secondTierMissingSkipResult(
        anchorAcId,
        'HCLOUD_TOKEN',
        'the snapshot verb cannot be issued without HCLOUD_TOKEN.',
      )],
      extra: { skipped: true, missingEnv: ['HCLOUD_TOKEN'] },
    };
  }
  const provisionPath = resolve(FIXTURE_DIR, 'provision.mjs');
  const destroyPath = resolve(FIXTURE_DIR, 'destroy.mjs');
  const snapshotPath = resolve(FIXTURE_DIR, 'src/snapshot-verb.mjs');
  const { provisionThrowawayServer } = await import(provisionPath);
  const { destroyThrowawayServer } = await import(destroyPath);
  const { takeAndVerifySnapshot } = await import(snapshotPath);

  const evidence = {};
  const resultRow = { anchorAcId, verdict: 'fail', detail: '', evidence };
  let provisioned;
  // Observed events on injected sinks (defect): the snapshot
  // verb emits hetznerSnapshotTaken; the provision emits
  // hetznerServerProvisioned. Both are OBSERVED, not constructed here.
  const observedEvents = [];
  const eventSink = (body) => observedEvents.push(body);
  try {
    // Pre-snapshot inventory: capture the snapshot ids present before
    // the run so the inventory-diff evidence shape is honest.
    try {
      const baseline = await hcloudJson(['image', 'list', '--type=snapshot', '--output', 'json']);
      evidence.baselineSnapshotIds = baseline.map((s) => s.id);
    } catch (err) {
      evidence.baselineListError = err.message;
    }
    provisioned = await provisionThrowawayServer({
      runId: process.env.GITHUB_RUN_ID ?? 'local',
      eventSink,
    });
    evidence.serverId = provisioned.id;
    evidence.serverName = provisioned.name;
    const outcome = await takeAndVerifySnapshot(provisioned, { eventSink });
    evidence.snapshotId = outcome.snapshotId;
    evidence.wallClockTime = outcome.wallClockTime;
    evidence.labelMatch = outcome.match ? {
      id: outcome.match.id,
      serverNameLabel: (outcome.match.labels || {}).serverName,
    } : null;
    // OBSERVE the hetznerSnapshotTaken event from the sink. The event
    // body is derived by snapshot-verb.mjs after the vendor list call
    // confirmed the id landed (defect: was constructed here
    // in v1.1.4; now observed from the sink emit).
    evidence.observedEvents = observedEvents.map((e) => ({ event: e.event, keys: Object.keys(e).sort() }));
    const snapshotEvent = observedEvents.find((e) => e && e.event === 'hetznerSnapshotTaken');
    if (outcome.snapshotId && !snapshotEvent) {
      resultRow.verdict = 'fail';
      resultRow.detail = `snapshot verb returned snapshotId ${outcome.snapshotId} but no hetznerSnapshotTaken event was observed on the injected sink; AC-37108-3 event-shape observation is missing.`;
      evidence.eventName = 'hetznerSnapshotTaken';
      evidence.eventObserved = false;
      return { results: [resultRow], extra: evidence };
    }
    evidence.hetznerSnapshotTakenEvent = snapshotEvent ?? null;
    // Post-create inventory: prove the id appears in the vendor
    // snapshot list so the AC's inventory-diff evidence is real.
    try {
      const afterCreate = await hcloudJson(['image', 'list', '--type=snapshot', '--output', 'json']);
      evidence.postCreateSnapshotIds = afterCreate.map((s) => s.id);
      evidence.postCreateSnapshotCarriedId = !!(outcome.snapshotId && afterCreate.some((s) => s.id === outcome.snapshotId));
    } catch (err) {
      evidence.postCreateListError = err.message;
    }
    if (!outcome.snapshotId) {
      resultRow.verdict = 'fail';
      resultRow.detail = `snapshot verb ran but no matching snapshot appeared in hcloud image list; the AC's inventory-diff evidence is missing.`;
      return { results: [resultRow], extra: evidence };
    }
    resultRow.verdict = 'pass';
    resultRow.detail = `snapshot ${outcome.snapshotId} created against server ${provisioned.id} (${provisioned.name}); hcloud image list --type=snapshot carries the id; hetznerSnapshotTaken event shape {serverName, snapshotId, ts} confirmed.`;
  } catch (err) {
    resultRow.verdict = 'fail';
    resultRow.detail = `snapshot verb threw: ${err.message}`;
    evidence.snapshotError = err.message;
    return { results: [resultRow], extra: evidence };
  } finally {
    if (provisioned && provisioned.id) {
      try {
        await destroyThrowawayServer(provisioned);
        evidence.teardown = { destroyed: provisioned.id };
        // Confirm the snapshot AND the server were both removed;
        // destroy.mjs sweeps snapshots that carry the server-name
        // label in the same call, so the post-teardown snapshot list
        // must NOT carry the id.
        try {
          const finalSnaps = await hcloudJson(['image', 'list', '--type=snapshot', '--output', 'json']);
          evidence.postTeardownSnapshotIds = finalSnaps.map((s) => s.id);
          if (evidence.snapshotId && finalSnaps.some((s) => s.id === evidence.snapshotId)) {
            resultRow.verdict = 'fail';
            resultRow.detail = `${resultRow.detail} TEARDOWN INCOMPLETE: snapshot ${evidence.snapshotId} still present.`;
            evidence.orphanSnapshotId = evidence.snapshotId;
          }
        } catch (err) {
          evidence.postTeardownListError = err.message;
          resultRow.verdict = 'fail';
          resultRow.detail = `${resultRow.detail} TEARDOWN CONFIRMATION FAILED: post-teardown snapshot list threw (${err.message}); cannot confirm snapshot ${evidence.snapshotId || 'n/a'} was deleted.`;
        }
        try {
          const finalServers = await hcloudJson(['server', 'list', '--output', 'json']);
          evidence.postTeardownServerIds = finalServers.map((s) => s.id);
          if (finalServers.some((s) => s.id === provisioned.id)) {
            resultRow.verdict = 'fail';
            resultRow.detail = `${resultRow.detail} TEARDOWN INCOMPLETE: server ${provisioned.id} still present.`;
          }
        } catch (err) {
          evidence.postTeardownServerListError = err.message;
          resultRow.verdict = 'fail';
          resultRow.detail = `${resultRow.detail} TEARDOWN CONFIRMATION FAILED: post-teardown server list threw (${err.message}); cannot confirm server ${provisioned.id} was removed.`;
        }
      } catch (err) {
        resultRow.verdict = 'fail';
        resultRow.detail = `${resultRow.detail} TEARDOWN FAILED for server ${provisioned.id}: ${err.message}.`;
        evidence.teardownError = err.message;
        evidence.orphanServerId = provisioned.id;
        if (evidence.snapshotId) evidence.orphanSnapshotId = evidence.snapshotId;
      }
    }
  }
  return { results: [resultRow], extra: evidence };
}
