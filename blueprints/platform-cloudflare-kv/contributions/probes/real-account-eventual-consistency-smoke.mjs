// Real-account eventual-consistency smoke for platform-cloudflare-kv
// v1.1.0.
//
// Self-provisioning: the probe mints its own scratch KV namespace via
// the fixture shim (packages/rcf-lite/test/fixtures/cf-platform/
// h2-cf-kv-real-account-shim.mjs), writes a fixture key, waits up to
// 60 seconds bounded (poll every 2s) for the same-region read to see
// the write, then deletes the key AND destroys the scratch namespace.
// Positive evidence captured: the CF-assigned namespace id, the exact
// scratch title used (throwaway prefix "h2-cf-probe-integrity-scratch-kv-"),
// the scratch key (throwaway prefix "h2-storage-smoke-"), elapsed milli-
// seconds to first same-region visibility, and the PUT status code.
// The teardown is fail-safe: a mid-run crash surfaces the scratch id
// through the shim's persisted record; the shim's sweepOrphans entry
// point cleans any residue by listing over the account and filtering
// on the throwaway prefix.
//
// accountBound: true. Without CI_HAS_CLOUDFLARE_ACCOUNT the probe
// records accountBoundSkipped: true and the aggregate flips to pass
// per spec section 3.5. With CI_HAS_CLOUDFLARE_ACCOUNT=true the probe
// either produces positive evidence of execution or fails; no third
// outcome (dispatch requirement 5).
//
// Declared env (dispatch requirement 4): every env var that can cause
// a skip or an early return is enumerated in report.extra.envDeclared
// and mirrored in the fixture shim's DECLARED_ENV export. If a new
// gate is added and does not appear in DECLARED_ENV the anatomy test
// fails.
//
// anchorAcId: AC-31103-1. The eventual-consistency round-trip proves
// the shipped put/get shape on a real Cloudflare KV namespace,
// re-covering AC-31103-1 (facade put then get returns the same bytes
// with paired kvWrite / kvHit events on the shipped binding contract).
//
// Local-proof scope: the local test harness
// under packages/rcf-lite/test/fixtures/cf-platform/test/ is a mock
// of Cloudflare's REST contract, not the wire. The local run
// exercises OUR lifecycle logic against a mock of Cloudflare's
// contract; the real-account gate is the only surface that proves
// the wire format. This probe is never described as "locally
// verified" - the local runs are our own lifecycle-logic proof;
// wire correctness is proven at the real-account gate.

import {
  mintScratchNamespace, destroyScratchNamespace,
  putScratchKey, getScratchKey, deleteScratchKey,
  generateKey, DECLARED_ENV, NAMESPACE_PREFIX, KEY_PREFIX,
} from '../../../../packages/rcf-lite/test/fixtures/cf-platform/h2-cf-kv-real-account-shim.mjs';

export const anchorAcId = 'AC-31103-1';
export const accountBound = true;

const CAP_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

function skipResult(detail) {
  return {
    results: [{
      anchorAcId: 'AC-31103-1',
      verdict: 'pass',
      detail,
      accountBoundSkipped: true,
    }],
    extra: {
      accountBoundSkipped: true,
      envDeclared: Array.from(DECLARED_ENV),
      throwawayPrefixes: { namespaceTitle: NAMESPACE_PREFIX, kvKey: KEY_PREFIX },
    },
  };
}

export default async function runProbe() {
  if (process.env.CI_HAS_CLOUDFLARE_ACCOUNT !== 'true') {
    return skipResult('accountBoundSkipped: CI_HAS_CLOUDFLARE_ACCOUNT is not set to true; spec section 3.5 pass-with-skip. Declared env for a live run: CI_HAS_CLOUDFLARE_ACCOUNT + CF_ACCOUNT_ID + CF_API_TOKEN (CF_API_BASE_URL optional test override).');
  }
  if (!process.env.CF_ACCOUNT_ID || !process.env.CF_API_TOKEN) {
    return {
      results: [{
        anchorAcId: 'AC-31103-1',
        verdict: 'fail',
        detail: `CI_HAS_CLOUDFLARE_ACCOUNT=true but one of CF_ACCOUNT_ID / CF_API_TOKEN is missing: accountIdPresent=${!!process.env.CF_ACCOUNT_ID} tokenPresent=${!!process.env.CF_API_TOKEN}.`,
      }],
      extra: {
        envDeclared: Array.from(DECLARED_ENV),
        throwawayPrefixes: { namespaceTitle: NAMESPACE_PREFIX, kvKey: KEY_PREFIX },
      },
    };
  }

  const runId = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
  let namespace = null;
  const evidence = {
    envDeclared: Array.from(DECLARED_ENV),
    throwawayPrefixes: { namespaceTitle: NAMESPACE_PREFIX, kvKey: KEY_PREFIX },
    runId,
  };
  try {
    namespace = await mintScratchNamespace({ runId });
    evidence.namespaceId = namespace.id;
    evidence.namespaceTitle = namespace.title;
  } catch (err) {
    return {
      results: [{
        anchorAcId: 'AC-31103-1',
        verdict: 'fail',
        detail: `mintScratchNamespace failed: ${err.message}`,
      }],
      extra: evidence,
    };
  }

  const key = generateKey({ runId });
  const value = `smoke-${Math.random().toString(36).slice(2)}`;
  evidence.key = key;
  evidence.valueSample = value;

  try {
    const put = await putScratchKey({ namespaceId: namespace.id, key, value });
    evidence.putStatus = put.status;

    const start = Date.now();
    let observed = null;
    while (Date.now() - start < CAP_MS) {
      const got = await getScratchKey({ namespaceId: namespace.id, key });
      if (got.ok && got.text === value) {
        observed = got.text;
        evidence.getStatusOnHit = got.status;
        break;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    const elapsed = Date.now() - start;
    evidence.elapsedMs = elapsed;
    evidence.capMs = CAP_MS;

    // Delete the scratch key regardless of outcome; the namespace
    // destroy in the finally block would remove it anyway, but the
    // per-key delete proves the delete verb on the shipped path.
    try {
      const del = await deleteScratchKey({ namespaceId: namespace.id, key });
      evidence.deleteStatus = del.status;
    } catch (err) {
      evidence.deleteError = err.message;
    }

    const pass = observed === value;
    return {
      results: [{
        anchorAcId: 'AC-31103-1',
        verdict: pass ? 'pass' : 'fail',
        detail: pass
          ? `real-account KV eventual-consistency: mint namespace ${namespace.id} (${namespace.title}); PUT key ${key} (status ${evidence.putStatus}); write eventually appeared on same-region GET within elapsed=${elapsed}ms (CAP=${CAP_MS}ms); DELETE key (status ${evidence.deleteStatus ?? 'unset'}); namespace destroyed on teardown.`
          : `real-account KV eventual-consistency: mint namespace ${namespace.id} (${namespace.title}); PUT key ${key} (status ${evidence.putStatus}); write did NOT appear within CAP=${CAP_MS}ms; elapsed=${elapsed}ms.`,
      }],
      extra: evidence,
    };
  } finally {
    try {
      const teardown = await destroyScratchNamespace(namespace);
      evidence.namespaceDestroyed = teardown.destroyed;
    } catch (err) {
      evidence.teardownError = err.message;
      process.stderr.write(`h2-cf-kv probe: teardown failed for namespace ${namespace && namespace.id}: ${err.message}; sweepOrphans will collect on next run.\n`);
    }
  }
}
