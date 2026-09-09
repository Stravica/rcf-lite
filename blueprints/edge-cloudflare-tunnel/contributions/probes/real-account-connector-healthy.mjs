// Probe: real-account-connector-healthy.
//
// anchorAcId: AC-tunnel-connectorHealthy (US-39102 contribution;
// real-account-connector-healthy declared with tunnelConnectorUp).
// C4 ruling: the AC-tunnel-* symbolic anchors on the tunnel blueprint
// ARE the AC ids in the shipped US-39101..US-39108 contribution band
// (see blueprints/edge-cloudflare-tunnel/contributions/user-stories/
// edge-cloudflare-tunnel-us-3910N.json); the anchors already resolve
// to the shipped band, so no re-anchor is performed by H-2. The kv
// treatment differed because those probes anchored AC-5xxx ids that
// existed nowhere on the shelf; here the ids exist and match by
// design.
//
// accountBound: true (gates on CI_HAS_CLOUDFLARE_ACCOUNT AND
// CI_HAS_HETZNER_ACCOUNT; the connector runs on a throwaway Hetzner
// server).
//
// Env-absent branch: pass-with-skip (spec section 3.5).
// Env-present branch: provisions a throwaway Hetzner server through
// the shared T-1 fixture provisionThrowawayServer, drives the
// cloudflared control surface through the cf-edge shim's
// cloudflaredTunnelInfo({ tunnelName }) call, asserts at least one
// HEALTHY connector, and captures a tunnelConnectorUp event
// (metadata-only: connector id, region, version). If the fixture
// provisioning throws (missing HCLOUD_TOKEN, quota, etc.), the
// probe FAILS with a pointer naming the fixture step: the tunnel
// connector cannot report healthy on a server that never provisioned.
//
// The shim seams (cloudflaredTunnelInfo, event capture) allow the
// driver path and mutation switches to be exercised locally without
// a real Cloudflare account; the real-account run happens in the operator account
// gate time.

import { runShim, accountBoundSkippedResult } from './probe-utils.mjs';

export const anchorAcIds = ['AC-tunnel-connectorHealthy'];
export const accountBound = true;

const TUNNEL_NAME_ENV = 'CF_TUNNEL_NAME';
const DEFAULT_TUNNEL_NAME = 'h2-cf-probe-integrity-scratch';

export default async function runProbe() {
  const results = [];
  const extra = {
    envRequired: ['CI_HAS_CLOUDFLARE_ACCOUNT', 'CI_HAS_HETZNER_ACCOUNT'],
    envPresent: {
      CI_HAS_CLOUDFLARE_ACCOUNT: process.env.CI_HAS_CLOUDFLARE_ACCOUNT === 'true',
      CI_HAS_HETZNER_ACCOUNT: process.env.CI_HAS_HETZNER_ACCOUNT === 'true',
    },
    events: [],
  };
  const hasAll = extra.envPresent.CI_HAS_CLOUDFLARE_ACCOUNT && extra.envPresent.CI_HAS_HETZNER_ACCOUNT;
  if (!hasAll) {
    results.push(accountBoundSkippedResult(
      'AC-tunnel-connectorHealthy',
      ['CI_HAS_CLOUDFLARE_ACCOUNT', 'CI_HAS_HETZNER_ACCOUNT'],
      'real-account cloudflared tunnel info + tunnelConnectorUp capture not exercised. Set CI_HAS_CLOUDFLARE_ACCOUNT=true AND CI_HAS_HETZNER_ACCOUNT=true (with HCLOUD_TOKEN and CLOUDFLARE_API_TOKEN in the environment via security-secrets-management) to run the real-account path.',
    ));
    return { results, extra };
  }

  // Env-present path: real driver. All account-bound work runs through
  // the cf-edge shim, which itself delegates to the hetzner fixture in
  // production and returns synthetic responses under the fixture-side
  // H2_CF_TUNNEL_SHIM_MODE token. Probe body reads no mutation-switch
  // env var and imports no fixture module directly.
  const {
    provisionScratchServer, destroyScratchServer, cloudflaredTunnelInfo,
  } = await import(
    '../../../../packages/rcf-lite/test/fixtures/cf-edge/h2-cf-tunnel-shim.mjs'
  );

  const runId = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
  let provisioned = null;
  try {
    provisioned = await provisionScratchServer({ runId });
    extra.provisioned = {
      id: provisioned.id, name: provisioned.name, location: provisioned.location, shimMode: provisioned.shimMode,
    };
  } catch (err) {
    results.push({
      anchorAcId: 'AC-tunnel-connectorHealthy',
      verdict: 'fail',
      detail: `fixture provisionScratchServer failed: ${err.message}. The tunnel connector cannot report healthy on a server that never provisioned. Fix the fixture step (packages/rcf-lite/test/fixtures/hetzner-throwaway-server/provision.mjs) or the account tokens (HCLOUD_TOKEN) before re-running.`,
    });
    return { results, extra };
  }

  try {
    const tunnelName = process.env[TUNNEL_NAME_ENV] || DEFAULT_TUNNEL_NAME;
    extra.tunnelName = tunnelName;
    let info;
    try {
      info = await cloudflaredTunnelInfo({ tunnelName });
    } catch (err) {
      results.push({
        anchorAcId: 'AC-tunnel-connectorHealthy',
        verdict: 'fail',
        detail: `cloudflared tunnel info shim call failed: ${err.message}. Fix the cf-edge shim (packages/rcf-lite/test/fixtures/cf-edge/h2-cf-tunnel-shim.mjs) or the cloudflared control surface before re-running.`,
      });
      return { results, extra };
    }
    extra.shimMode = info.shimMode;
    extra.connectorCount = info.connectors.length;
    const healthy = info.connectors.filter((c) => String(c.status || '').toUpperCase() === 'HEALTHY');
    if (healthy.length === 0) {
      results.push({
        anchorAcId: 'AC-tunnel-connectorHealthy',
        verdict: 'fail',
        detail: `cloudflared tunnel info returned ${info.connectors.length} connector(s), none HEALTHY. Statuses observed: ${info.connectors.map((c) => String(c.status || 'MISSING')).join(', ') || '(no connectors)'}.`,
      });
      return { results, extra };
    }
    // Capture tunnelConnectorUp event, metadata only (id, region, version).
    for (const c of healthy) {
      extra.events.push({
        kind: 'tunnelConnectorUp',
        connectorId: String(c.id ?? ''),
        region: String(c.region ?? ''),
        version: String(c.version ?? ''),
      });
    }
    results.push({
      anchorAcId: 'AC-tunnel-connectorHealthy',
      verdict: 'pass',
      detail: `cloudflared tunnel info returned ${info.connectors.length} connector(s), ${healthy.length} HEALTHY (shim mode ${info.shimMode}); tunnelConnectorUp event captured for each healthy connector with metadata-only payload (connectorId, region, version).`,
    });
    return { results, extra };
  } finally {
    // Always attempt teardown; a failed teardown is a fixture concern
    // and rides sweep-orphans, not this probe.
    try {
      await destroyScratchServer(provisioned);
    } catch (_err) {
      // Best-effort; the nightly sweep-orphans job collects any leak.
    }
  }
}

const engine = { kind: 'real-account-cloudflared-info', image: 'cloudflared + hcloud (throwaway server) via cf-edge shim', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('real-account-connector-healthy', engine, runProbe);
}
