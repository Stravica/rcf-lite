// Probe: real-account-connector-healthy.
//
// anchorAcId: AC-tunnel-connectorHealthy.
// accountBound: true (gates on CI_HAS_CLOUDFLARE_ACCOUNT AND CI_HAS_HETZNER_ACCOUNT).
//
// Without both env vars the probe records accountBoundSkipped: true and
// the aggregate flips to pass per hetzner-round-7-spec section 3.5.
//
// With both env vars the probe (not exercised in this dispatch; the
// blueprint author has no account tokens per the dispatch envelope):
// - Provisions a throwaway Hetzner server via the shared fixture
//   provision.mjs (T-1 verb).
// - Stands up cloudflared against a scratch Cloudflare subdomain and asks
//   the api for `cloudflared tunnel info <name>`; asserts at least one
//   healthy connector.
// - Captures a tunnelConnectorUp event with connector id, region and
//   version metadata (metadata only).
// - Tears down via destroy.mjs in an always() block.

import { runShim, accountBoundSkippedResult } from './probe-utils.mjs';

export const anchorAcIds = ['AC-tunnel-connectorHealthy'];
export const accountBound = true;

export default async function runProbe() {
  const results = [];
  const extra = {
    envRequired: ['CI_HAS_CLOUDFLARE_ACCOUNT', 'CI_HAS_HETZNER_ACCOUNT'],
    envPresent: {
      CI_HAS_CLOUDFLARE_ACCOUNT: process.env.CI_HAS_CLOUDFLARE_ACCOUNT === 'true',
      CI_HAS_HETZNER_ACCOUNT: process.env.CI_HAS_HETZNER_ACCOUNT === 'true',
    },
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
  results.push({
    anchorAcId: 'AC-tunnel-connectorHealthy',
    verdict: 'warn',
    detail: 'account-bound path present in this dispatch environment but not exercised by the blueprint-author role; run under the delivery-ci-workflows lane with the account tokens loaded.',
  });
  return { results, extra };
}

const engine = { kind: 'real-account-cloudflared-info', image: 'cloudflared + hcloud (throwaway server)', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('real-account-connector-healthy', engine, runProbe);
}
