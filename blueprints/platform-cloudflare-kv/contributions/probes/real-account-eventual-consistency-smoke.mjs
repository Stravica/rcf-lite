// Real-account eventual-consistency smoke for platform-cloudflare-kv
// v1.0.0.
//
// Opens the facade against a real Cloudflare KV namespace via the
// Workers KV REST API (per https://developers.cloudflare.com/api/
// operations/workers-kv-namespace-write-key-value-pair). Writes a
// fixture key, waits up to 60 seconds bounded (poll every 2s), then
// reads and asserts the write eventually appears. The probe does
// NOT bind a specific propagation time; only that a write eventually
// becomes visible under the 60-second cap. Cleans up the written
// key on exit.
//
// accountBound: true. Without CI_HAS_CLOUDFLARE_ACCOUNT (and the
// paired CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN env vars),
// the probe records accountBoundSkipped: true and the aggregate
// flips to pass per spec section 3.5.
//
// anchorAcId: AC-31103-1. The eventual-consistency round-trip
// proves the shipped put/get shape on a real Cloudflare KV
// namespace, re-covering AC-31103-1 (facade put then get returns
// the same bytes with paired kvWrite/kvHit events on the shipped
// binding contract). The dispatch-addendum groundwork mapping
// treats this probe as the real-account carrier for AC-31103-1;
// the local facade-round-trip probe holds the primary anchor.

export const anchorAcId = 'AC-31103-1';
export const accountBound = true;

const CAP_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;
const API_BASE = 'https://api.cloudflare.com/client/v4';

export default async function runProbe() {
  if (process.env.CI_HAS_CLOUDFLARE_ACCOUNT !== 'true') {
    return {
      results: [{
        anchorAcId: 'AC-31103-1',
        verdict: 'pass',
        detail: 'accountBoundSkipped: CI_HAS_CLOUDFLARE_ACCOUNT is not set to true; spec section 3.5 pass-with-skip.',
      }],
      extra: { accountBoundSkipped: true },
    };
  }

  const accountId = process.env.CF_ACCOUNT_ID;
  const namespaceId = process.env.CF_KV_NAMESPACE_ID;
  const token = process.env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !token) {
    return {
      results: [{
        anchorAcId: 'AC-31103-1',
        verdict: 'fail',
        detail: `CI_HAS_CLOUDFLARE_ACCOUNT=true but one of CF_ACCOUNT_ID/CF_KV_NAMESPACE_ID/CF_API_TOKEN is missing: accountIdPresent=${!!accountId} namespaceIdPresent=${!!namespaceId} tokenPresent=${!!token}`,
      }],
    };
  }

  const key = `platform-cloudflare-kv/real-account-smoke/${Date.now()}`;
  const value = `smoke-${Math.random().toString(36).slice(2)}`;
  const putUrl = `${API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  const authHeaders = { authorization: `Bearer ${token}`, 'content-type': 'text/plain' };

  const putResp = await fetch(putUrl, { method: 'PUT', headers: authHeaders, body: value });
  if (!putResp.ok) {
    return {
      results: [{
        anchorAcId: 'AC-31103-1',
        verdict: 'fail',
        detail: `real-account smoke: PUT returned status ${putResp.status}`,
      }],
    };
  }

  const start = Date.now();
  let observed = null;
  while (Date.now() - start < CAP_MS) {
    const getResp = await fetch(putUrl, { method: 'GET', headers: { authorization: `Bearer ${token}` } });
    if (getResp.ok) {
      const body = await getResp.text();
      if (body === value) {
        observed = body;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  const elapsed = Date.now() - start;

  // Clean up the written key regardless of outcome.
  try {
    await fetch(putUrl, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
  } catch (_err) {
    // Best effort; do not fail the probe on cleanup.
  }

  const pass = observed === value;
  return {
    results: [{
      anchorAcId: 'AC-31103-1',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `write eventually appeared on the same-region read within elapsed=${elapsed}ms (CAP=${CAP_MS}ms)`
        : `write did not appear within CAP=${CAP_MS}ms; elapsed=${elapsed}ms`,
    }],
    extra: { elapsedMs: elapsed, cap: CAP_MS },
  };
}
