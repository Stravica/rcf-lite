// Probe: real-account-tunnel-hostname-routes.
//
// anchorAcId list (unchanged per H-2 C4 ruling; the AC-tunnel-* ids
// ARE the shipped AC ids in the US-39104 / US-39106 contribution
// bodies):
// - AC-tunnel-hostnameRoutes (public-hostname sub-case: ingress rule
//   routes public hostname to internal service URL and returns 200).
// - AC-tunnel-accessGated (access-gated sub-case: Access-gated
//   composition; unauthenticated request refused, JWT-carrying
//   request accepted; per US-39106).
//
// accountBound: true.
// Gating (amendment 4 verbatim):
// - Public-hostname sub-case activated on CI_HAS_CLOUDFLARE_ACCOUNT
//   AND CI_HAS_HETZNER_ACCOUNT.
// - Access-gated sub-case activated only when CI_HAS_CLOUDFLARE_ACCESS
//   is ALSO set. Env-absent branch keeps pass-with-skip; a pass must
//   never be reachable from CI_HAS_CLOUDFLARE_ACCOUNT presence alone.
// - HQ note: Cloudflare Access is not enabled on the HQ account, so
//   at gate time the AUD sub-case stays pass-with-skip; expected,
//   not a driver defect.
//
// Env-present, sub-case active: undici-based fetch driver against the
// scratch subdomain via the cf-edge shim (production path uses Node's
// built-in fetch; shim-synthetic path lets local runs exercise the
// driver body without account access). For the access-gated
// sub-case: send an unauthenticated request (must be refused with
// 4xx) AND a JWT-carrying request (must be accepted with 2xx). A
// pass requires BOTH results.

import { runShim, accountBoundSkippedResult } from './probe-utils.mjs';

export const anchorAcIds = ['AC-tunnel-hostnameRoutes', 'AC-tunnel-accessGated'];
export const accountBound = true;

const PUBLIC_URL_ENV = 'CF_TUNNEL_PUBLIC_URL';
const ACCESS_URL_ENV = 'CF_TUNNEL_ACCESS_URL';
const ACCESS_AUDIENCE_ENV = 'CF_ACCESS_AUDIENCE';
const ACCESS_TEAM_SECRET_ENV = 'CF_ACCESS_TEAM_SECRET';
const DEFAULT_PUBLIC_URL = 'https://h2-cf-public.scratch.example.invalid/health';
const DEFAULT_ACCESS_URL = 'https://h2-cf-gated.scratch.example.invalid/protected';

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
      'public-hostname sub-case: undici fetch against the scratch subdomain not exercised. Set CI_HAS_CLOUDFLARE_ACCOUNT=true AND CI_HAS_HETZNER_ACCOUNT=true to run this path.',
    ));
  }
  if (!hasGated) {
    results.push(accountBoundSkippedResult(
      'AC-tunnel-accessGated',
      ['CI_HAS_CLOUDFLARE_ACCOUNT', 'CI_HAS_HETZNER_ACCOUNT', 'CI_HAS_CLOUDFLARE_ACCESS'],
      'access-gated sub-case: two-identity JWT check against the scratch subdomain not exercised. Requires all three env vars; a pass here is unreachable from CI_HAS_CLOUDFLARE_ACCOUNT presence alone (amendment 4 verbatim).',
    ));
  }
  if (!hasPublic && !hasGated) {
    return { results, extra };
  }

  // Sub-case active: load the shim seams.
  const { fetchTunnelHostname, mintScratchIdentity } = await import(
    '../../../../packages/rcf-lite/test/fixtures/cf-edge/h2-cf-tunnel-shim.mjs'
  );

  if (hasPublic) {
    const url = process.env[PUBLIC_URL_ENV] || DEFAULT_PUBLIC_URL;
    extra.publicHostnameUrl = url;
    try {
      const resp = await fetchTunnelHostname(url, { method: 'GET' });
      extra.publicHostnameResponse = { status: resp.status, shimMode: resp.shimMode, bodyLength: resp.textBody.length };
      if (resp.status >= 200 && resp.status < 300) {
        results.push({
          anchorAcId: 'AC-tunnel-hostnameRoutes',
          verdict: 'pass',
          detail: `public-hostname sub-case: fetch(${url}) returned ${resp.status} (shim mode ${resp.shimMode}), body length ${resp.textBody.length}. Ingress rule routes the public hostname to the internal service URL.`,
        });
      } else {
        results.push({
          anchorAcId: 'AC-tunnel-hostnameRoutes',
          verdict: 'fail',
          detail: `public-hostname sub-case: fetch(${url}) returned ${resp.status} (shim mode ${resp.shimMode}). Expected 2xx; the ingress rule did not route the public hostname to a healthy internal service.`,
        });
      }
    } catch (err) {
      results.push({
        anchorAcId: 'AC-tunnel-hostnameRoutes',
        verdict: 'fail',
        detail: `public-hostname sub-case: fetch(${url}) threw: ${err.message}. Check the scratch subdomain, the tunnel manifest ingress rules, or the cf-edge shim.`,
      });
    }
  }

  if (hasGated) {
    const url = process.env[ACCESS_URL_ENV] || DEFAULT_ACCESS_URL;
    const audience = process.env[ACCESS_AUDIENCE_ENV] || 'h2-cf-scratch-audience';
    const secret = process.env[ACCESS_TEAM_SECRET_ENV] || 'h2-cf-scratch-team-secret';
    extra.accessGatedUrl = url;
    let refusalResp;
    let acceptResp;
    try {
      refusalResp = await fetchTunnelHostname(url, { method: 'GET' });
    } catch (err) {
      results.push({
        anchorAcId: 'AC-tunnel-accessGated',
        verdict: 'fail',
        detail: `access-gated sub-case: unauthenticated fetch(${url}) threw: ${err.message}.`,
      });
      return { results, extra };
    }
    try {
      const jwt = mintScratchIdentity({ audience, subject: 'h2-cf-scratch-identity', secret });
      acceptResp = await fetchTunnelHostname(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${jwt}` },
      });
    } catch (err) {
      results.push({
        anchorAcId: 'AC-tunnel-accessGated',
        verdict: 'fail',
        detail: `access-gated sub-case: JWT-carrying fetch(${url}) threw: ${err.message}.`,
      });
      return { results, extra };
    }
    extra.accessGatedRefusal = { status: refusalResp.status, shimMode: refusalResp.shimMode };
    extra.accessGatedAccept = { status: acceptResp.status, shimMode: acceptResp.shimMode };
    const refused = refusalResp.status >= 400 && refusalResp.status < 500;
    const accepted = acceptResp.status >= 200 && acceptResp.status < 300;
    if (refused && accepted) {
      results.push({
        anchorAcId: 'AC-tunnel-accessGated',
        verdict: 'pass',
        detail: `access-gated sub-case: unauthenticated request refused with ${refusalResp.status} and JWT-carrying request accepted with ${acceptResp.status} (shim mode ${refusalResp.shimMode}). Access gate composed correctly.`,
      });
    } else {
      results.push({
        anchorAcId: 'AC-tunnel-accessGated',
        verdict: 'fail',
        detail: `access-gated sub-case: expected 4xx-then-2xx; observed refusal status ${refusalResp.status} and JWT-accept status ${acceptResp.status} (shim mode ${refusalResp.shimMode}). Gate is drifted: unauthenticated request should be refused and JWT request accepted.`,
      });
    }
  }

  return { results, extra };
}

const engine = { kind: 'real-account-tunnel-fetch', image: 'undici fetch + cf-edge shim (scratch subdomain)', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('real-account-tunnel-hostname-routes', engine, runProbe);
}
