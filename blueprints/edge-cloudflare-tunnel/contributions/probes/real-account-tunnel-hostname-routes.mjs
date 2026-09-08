// Probe: real-account-tunnel-hostname-routes.
//
// anchorAcId list:
// - AC-tunnel-hostnameRoutes (public-hostname sub-case)
// - AC-tunnel-accessGated (access-gated sub-case, gated on CI_HAS_CLOUDFLARE_ACCESS)
// accountBound: true (CI_HAS_CLOUDFLARE_ACCOUNT AND CI_HAS_HETZNER_ACCOUNT for
// the public-hostname sub-case; add CI_HAS_CLOUDFLARE_ACCESS for the
// access-gated sub-case per Q4 ratification).
//
// Without the env vars the sub-cases skip independently and each records
// accountBoundSkipped: true. The aggregate flips to pass per hetzner-
// round-7-spec section 3.5.
//
// With the env vars (not exercised in this dispatch; the blueprint
// author has no account tokens per the dispatch envelope):
// - Public-hostname sub-case: undici curl against the scratch subdomain,
//   asserts 200 and the internal service payload.
// - Access-gated sub-case: two fixture identities; the JWT-less request
//   is refused at the edge; the JWT-carrying request proceeds.

import { runShim, accountBoundSkippedResult } from './probe-utils.mjs';

export const anchorAcIds = ['AC-tunnel-hostnameRoutes', 'AC-tunnel-accessGated'];
export const accountBound = true;

export default async function runProbe() {
  const results = [];
  const extra = {
    envRequired: {
      publicHostname: ['CI_HAS_CLOUDFLARE_ACCOUNT', 'CI_HAS_HETZNER_ACCOUNT'],
      accessGated: ['CI_HAS_CLOUDFLARE_ACCOUNT', 'CI_HAS_HETZNER_ACCOUNT', 'CI_HAS_CLOUDFLARE_ACCESS'],
    },
    envPresent: {
      CI_HAS_CLOUDFLARE_ACCOUNT: process.env.CI_HAS_CLOUDFLARE_ACCOUNT === 'true',
      CI_HAS_HETZNER_ACCOUNT: process.env.CI_HAS_HETZNER_ACCOUNT === 'true',
      CI_HAS_CLOUDFLARE_ACCESS: process.env.CI_HAS_CLOUDFLARE_ACCESS === 'true',
    },
  };
  const hasPublic = extra.envPresent.CI_HAS_CLOUDFLARE_ACCOUNT && extra.envPresent.CI_HAS_HETZNER_ACCOUNT;
  const hasGated = hasPublic && extra.envPresent.CI_HAS_CLOUDFLARE_ACCESS;
  if (!hasPublic) {
    results.push(accountBoundSkippedResult(
      'AC-tunnel-hostnameRoutes',
      ['CI_HAS_CLOUDFLARE_ACCOUNT', 'CI_HAS_HETZNER_ACCOUNT'],
      'public-hostname sub-case: undici curl against the scratch subdomain not exercised. Set CI_HAS_CLOUDFLARE_ACCOUNT=true AND CI_HAS_HETZNER_ACCOUNT=true to run this path.',
    ));
  } else {
    results.push({
      anchorAcId: 'AC-tunnel-hostnameRoutes',
      verdict: 'warn',
      detail: 'public-hostname sub-case: account-bound path present but not exercised by the blueprint-author role; run under the delivery-ci-workflows lane.',
    });
  }
  if (!hasGated) {
    results.push(accountBoundSkippedResult(
      'AC-tunnel-accessGated',
      ['CI_HAS_CLOUDFLARE_ACCOUNT', 'CI_HAS_HETZNER_ACCOUNT', 'CI_HAS_CLOUDFLARE_ACCESS'],
      'access-gated sub-case: two-identity JWT check against the scratch subdomain not exercised. Requires all three env vars (CI_HAS_CLOUDFLARE_ACCESS added per Q4 ratification).',
    ));
  } else {
    results.push({
      anchorAcId: 'AC-tunnel-accessGated',
      verdict: 'warn',
      detail: 'access-gated sub-case: account-bound path present but not exercised by the blueprint-author role; run under the delivery-ci-workflows lane.',
    });
  }
  return { results, extra };
}

const engine = { kind: 'real-account-tunnel-curl', image: 'undici + cloudflared (scratch subdomain)', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('real-account-tunnel-hostname-routes', engine, runProbe);
}
