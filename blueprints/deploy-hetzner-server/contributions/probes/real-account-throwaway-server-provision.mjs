// Probe: real-account throwaway-server provision (v1.1.4 closure fix).
//
// anchorAcId: AC-37103-1. accountBound: true.
//
// Addendum-driven contract:
//   - First-tier gate CI_HAS_HETZNER_ACCOUNT must equal exactly the
//     string "true"; anything else records an honest skip row naming
//     the variable (set-but-not-true distinguished from unset).
//   - Second-tier HCLOUD_TOKEN must be set once past the first-tier
//     gate; missing carries its own honest skip row naming HCLOUD_TOKEN.
//   - The pass row carries an `evidence` object with the created
//     server id, the pre-provision inventory count, the post-provision
//     inventory entry proving the id landed, the primaryIpv4, location
//     and serverType observed on the vendor payload, plus the emitted
//     `hetznerServerProvisioned` event shape (event names only, no
//     token bytes).
//   - Teardown lives in a finally block and its failure FAILS the
//     verdict; the evidence carries the surviving orphan id so a
//     later sweep-orphans run can find it.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import {
  firstTierGateSkipResult, secondTierMissingSkipResult, FIXTURE_DIR,
} from './probe-utils.mjs';

export const anchorAcId = 'AC-37103-1';
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
        resolvePromise(Array.isArray(parsed) ? parsed : (parsed.servers || []));
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
        'real-account throwaway-server provision skipped; run with CI_HAS_HETZNER_ACCOUNT=true to exercise.',
      )],
      extra: { skipped: true, missingEnv: ['CI_HAS_HETZNER_ACCOUNT'] },
    };
  }
  if (!process.env.HCLOUD_TOKEN) {
    return {
      results: [secondTierMissingSkipResult(
        anchorAcId,
        'HCLOUD_TOKEN',
        'the shared hetzner-throwaway-server provisioner cannot open without HCLOUD_TOKEN.',
      )],
      extra: { skipped: true, missingEnv: ['HCLOUD_TOKEN'] },
    };
  }
  const provisionPath = resolve(FIXTURE_DIR, 'provision.mjs');
  const destroyPath = resolve(FIXTURE_DIR, 'destroy.mjs');
  const { provisionThrowawayServer } = await import(provisionPath);
  const { destroyThrowawayServer } = await import(destroyPath);

  const evidence = {};
  let provisioned;
  const resultRow = { anchorAcId, verdict: 'fail', detail: '', evidence };
  // Observed event sink (reclosure Item 6). We OBSERVE the emitted
  // hetznerServerProvisioned event rather than constructing one from
  // the return value.
  const observedEvents = [];
  const eventSink = (body) => observedEvents.push(body);
  try {
    let baselineList = [];
    try {
      baselineList = await hcloudJson(['server', 'list', '--output', 'json']);
      evidence.baselineServerIds = baselineList.map((s) => s.id);
    } catch (err) {
      // Baseline list is diagnostic; capture error but do not fail.
      evidence.baselineListError = err.message;
    }
    provisioned = await provisionThrowawayServer({
      runId: process.env.GITHUB_RUN_ID ?? 'local',
      eventSink,
    });
    evidence.serverId = provisioned.id;
    evidence.serverName = provisioned.name;
    evidence.primaryIpv4 = provisioned.primaryIpv4;
    evidence.location = provisioned.location;
    evidence.serverType = provisioned.serverType;
    // OBSERVE the emitted event from the sink; do not manufacture it.
    const provisionedEvent = observedEvents.find((e) => e && e.event === 'hetznerServerProvisioned');
    evidence.observedEvents = observedEvents.map((e) => ({ event: e.event, keys: Object.keys(e).sort() }));
    if (!provisionedEvent) {
      resultRow.verdict = 'fail';
      resultRow.detail = `hetznerServerProvisioned event was not observed on the injected sink after provisionThrowawayServer returned id ${provisioned.id}.`;
      evidence.eventName = 'hetznerServerProvisioned';
      evidence.eventObserved = false;
      return { results: [resultRow], extra: evidence };
    }
    evidence.hetznerServerProvisionedEvent = provisionedEvent;
    // Observe the server-list AFTER provision to prove the id landed.
    // A list failure at this step FAILS the row (reclosure Item 6:
    // the new list failure is no longer allowed to continue to pass).
    let postListError = null;
    try {
      const postList = await hcloudJson(['server', 'list', '--output', 'json']);
      evidence.postProvisionServerIds = postList.map((s) => s.id);
      const match = postList.find((s) => s.id === provisioned.id);
      evidence.postProvisionMatch = match ? { id: match.id, name: match.name, status: match.status } : null;
      if (!match) {
        resultRow.verdict = 'fail';
        resultRow.detail = `provisionThrowawayServer returned id ${provisioned.id} but the post-provision hcloud server list did not carry it; the AC's inventory-diff evidence is missing.`;
        return { results: [resultRow], extra: evidence };
      }
    } catch (err) {
      postListError = err.message;
      evidence.postProvisionListError = postListError;
      resultRow.verdict = 'fail';
      resultRow.detail = `hcloud server list after provision failed (${postListError}); AC-37103-1 requires the live inventory-diff evidence, which could not be observed.`;
      return { results: [resultRow], extra: evidence };
    }
    if (!provisioned.primaryIpv4 || provisioned.location !== 'fsn1' || provisioned.serverType !== 'cx23') {
      resultRow.verdict = 'fail';
      resultRow.detail = `hetznerServerProvisioned payload malformed: expected primaryIpv4, location=fsn1, serverType=cx23; observed ${JSON.stringify(evidence.hetznerServerProvisionedEvent)}.`;
      return { results: [resultRow], extra: evidence };
    }
    resultRow.verdict = 'pass';
    resultRow.detail = `throwaway server ${provisioned.id} provisioned in fsn1; hetznerServerProvisioned event OBSERVED on the injected sink (id ${provisioned.id}, primaryIpv4 ${provisioned.primaryIpv4}, serverType cx23); post-provision hcloud server list carries the id.`;
  } catch (err) {
    resultRow.verdict = 'fail';
    resultRow.detail = `provision failed: ${err.message}`;
    evidence.provisionError = err.message;
    return { results: [resultRow], extra: evidence };
  } finally {
    if (provisioned && provisioned.id) {
      try {
        await destroyThrowawayServer(provisioned);
        evidence.teardown = { destroyed: provisioned.id };
        // Confirm absence by re-listing. Failure to confirm FAILS the
        // row (reclosure Item on partly-fixed teardown: post-teardown
        // inventory failures were being swallowed).
        try {
          const finalList = await hcloudJson(['server', 'list', '--output', 'json']);
          evidence.postTeardownServerIds = finalList.map((s) => s.id);
          if (finalList.some((s) => s.id === provisioned.id)) {
            resultRow.verdict = 'fail';
            resultRow.detail = `${resultRow.detail} TEARDOWN INCOMPLETE: server ${provisioned.id} still present in hcloud server list; sweep-orphans must collect.`;
          }
        } catch (err) {
          evidence.postTeardownListError = err.message;
          resultRow.verdict = 'fail';
          resultRow.detail = `${resultRow.detail} TEARDOWN CONFIRMATION FAILED: post-teardown hcloud server list threw (${err.message}); cannot confirm server ${provisioned.id} was removed.`;
        }
      } catch (err) {
        // Teardown failure fails the verdict (Addendum rule 5).
        resultRow.verdict = 'fail';
        resultRow.detail = `${resultRow.detail} TEARDOWN FAILED for server ${provisioned.id}: ${err.message}. Orphan surfaced through sweep-orphans on next run.`;
        evidence.teardownError = err.message;
        evidence.orphanServerId = provisioned.id;
      }
    }
  }
  return { results: [resultRow], extra: evidence };
}
