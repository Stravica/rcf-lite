// Runtime-profile module (spec §4, amendments 1 + 3) — the load-bearing
// correctness property of the whole tool. The single most expensive miss in
// the persona programme was "verified against one runtime, reported as
// another" (run-05: verified against wrangler-dev on localhost, reported as a
// live Worker). This module makes that failure structurally impossible: every
// verdict carries the runtime it ran against, and only `deployed` (or a
// declared-parity runtime) may carry the authority of a ship gate.
//
// Provenance-honesty, NOT a URL blocklist. localhost is a first-class target
// for ci/local-dev (that is the CI use case, amendment 3). What is forbidden
// is a lower profile claiming the authority of `deployed`.

import { rcfError } from '@stravica-ai/rcf-lite-core/errors';

/** The three runtime profiles (spec §4). */
export const PROFILES = Object.freeze(['deployed', 'ci', 'local-dev']);

/**
 * Resolve + validate the runtime declaration from parsed CLI flags. Errors
 * are returned as data (RcfError, kind 'usage'), never thrown — the CLI maps
 * them to a non-zero usage exit (spec §3 hard rules 1-2, §10).
 *
 * @param {{ profile?: string, url?: string, parityEnv?: boolean }} flags
 * @returns {{ profile: string, url: string, parityEnv: boolean } | import('@stravica-ai/rcf-lite-core/errors').RcfError}
 */
export function resolveProfile(flags = {}) {
  const { profile, url } = flags;
  if (!profile) {
    return rcfError({ kind: 'usage', message: '--profile is required (one of: deployed, ci, local-dev)', field: 'profile' });
  }
  if (!PROFILES.includes(profile)) {
    return rcfError({ kind: 'usage', message: `--profile must be one of: ${PROFILES.join(', ')} (got "${profile}")`, field: 'profile' });
  }
  if (!url) {
    return rcfError({ kind: 'usage', message: '--url is required (the running app for this profile)', field: 'url' });
  }
  return { profile, url, parityEnv: Boolean(flags.parityEnv) };
}

/**
 * Heuristic local-hostname detection. Pure/sync — no network. Errs toward
 * flagging local so the deployed reachability gate is advisory-strict.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function looksLocal(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // Unparseable URL — treat as suspicious (advisory-strict).
    return true;
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host === '[::1]') {
    return true;
  }
  // *.local / *.localhost mDNS + dev conventions, and RFC1918 private ranges.
  if (host.endsWith('.local') || host.endsWith('.localhost')) return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

/**
 * Deployed reachability gate (spec §4). Only consulted for
 * profile === 'deployed'. `looksLocal` is derived purely; `reachable` is
 * probed over the wire via an injectable fetch (unit tests fake it — no real
 * network). Advisory-strict: any probe failure yields reachable:false, which
 * routes the run to NOT-DEPLOYED rather than a false SHIP.
 *
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [deps]
 * @returns {Promise<{ reachable: boolean, looksLocal: boolean }>}
 */
export async function checkDeployedReachability(url, deps = {}) {
  const local = looksLocal(url);
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? 5000;
  let reachable = false;
  if (typeof fetchImpl === 'function') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { method: 'HEAD', redirect: 'manual', signal: controller.signal });
      // Any HTTP response (even 4xx/5xx/3xx) proves something is listening at
      // the wire address. A thrown/aborted probe means unreachable.
      reachable = Boolean(res && typeof res.status === 'number');
    } catch {
      reachable = false;
    } finally {
      clearTimeout(timer);
    }
  }
  return { reachable, looksLocal: local };
}

/**
 * Whether a profile+parity combination carries ship authority (spec §4).
 * `deployed` is always a ship gate; a non-deployed profile is a ship gate
 * ONLY with an explicit `--parity-env` operator assertion. Everything else is
 * a correctness/regression verdict.
 *
 * @param {string} profile
 * @param {boolean} parityEnv
 * @returns {'ship' | 'correctness'}
 */
export function verdictAuthorityFor(profile, parityEnv) {
  if (profile === 'deployed') return 'ship';
  if (parityEnv && (profile === 'ci' || profile === 'local-dev')) return 'ship';
  return 'correctness';
}

/**
 * Whether a `deployed` run must refuse to issue a verdict (NOT-DEPLOYED).
 * Only meaningful for profile === 'deployed'. Errs toward refusal.
 *
 * @param {string} profile
 * @param {{ reachable: boolean, looksLocal: boolean }} reachability
 * @returns {boolean}
 */
export function isNotDeployed(profile, reachability) {
  if (profile !== 'deployed') return false;
  if (!reachability) return true;
  return reachability.looksLocal === true || reachability.reachable === false;
}

/**
 * Stamp runtime provenance onto a verdict object (spec §4, §5.3). Returns a
 * new object; does not mutate the input.
 *
 * @param {object} verdict
 * @param {{ profile: string, url: string, parityEnv: boolean, reachability?: object }} ctx
 * @returns {object}
 */
export function stampProvenance(verdict, ctx) {
  return {
    ...verdict,
    provenance: {
      profile: ctx.profile,
      url: ctx.url,
      parityEnv: Boolean(ctx.parityEnv),
      reachability: ctx.reachability ?? null,
    },
  };
}
