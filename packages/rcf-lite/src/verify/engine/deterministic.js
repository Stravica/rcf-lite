// Deterministic verify mode (issue 330, 2026-10-08). A dispatched worker
// cannot spawn `claude` as a subagent (an estate rule the surrounding
// harness enforces by killing any such child), so the default
// `agentScreenshotCritique` mode is a parent-session mode. This module
// is its sister: a model-free verify path that a dispatched worker can
// run end-to-end from inside a tool call.
//
// Scope today (minimal, honest, additive):
//   - HTTP reachability probe against `--url` recorded on `runStats`
//     as diagnostic context (NOT a per-AC verification);
//   - every AC the chain carries is recorded on `blockedAcs[]` with
//     reason `critique-only` so the aggregate verdict is BLOCKED and
//     the finalise gate refuses promotion by construction (ADR-4112
//     verified invariant). The report also carries
//     `runStats.counts = { verified, failed, skipped, total }` so a
//     report reader sees the mode did not actively verify anything.
//
// The catalog-driven per-AC probe seam is a later train car: when the
// chain's AC subschema gains structured probe fields (status, path,
// header, body substring, selector) OR a project ships
// `docs/runtime-verify-catalog.md` keyed by acId, this module will
// resolve those probes and surface pass/fail/skipped per AC with
// evidence. The partial fix today keeps that door open: `runStats.mode`
// and `runStats.counts` are stable across future extensions.
//
// Shared-parent-state note: this module uses `globalThis.fetch`
// (injectable via `deps.fetchImpl`) and never spawns a child
// process, so it cannot leak the parent's Playwright or MCP session.
// A DOM-probe extension (Playwright headless, in-process) can land in
// a later train car; it would use the already-declared optional peer
// dependency and never the MCP.

const DEFAULT_REACHABLE_TIMEOUT_MS = 10000;
const CRITIQUE_ONLY_REASON = 'critique-only: subjective visual judgement needed; deterministic mode cannot judge this AC (parent-session agentScreenshotCritique mode is required).';

/**
 * One-shot HTTP probe. Returns status/ok/elapsedMs + a short bodyHead
 * sample so a report reader can see what the deployed URL served, or
 * an `error.kind` on a transport failure. Diagnostic context on
 * `runStats` only, not a verification claim against any AC.
 *
 * @param {object} args
 * @param {string} args.url
 * @param {typeof fetch} [args.fetchImpl]
 * @param {number} [args.timeoutMs]
 * @returns {Promise<{ ok: boolean, status: number|null, elapsedMs: number, bodyHead?: string, error?: { kind: string, message: string } }>}
 */
export async function probeHttpReachability({ url, fetchImpl, timeoutMs = DEFAULT_REACHABLE_TIMEOUT_MS }) {
  const fetchFn = fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return { ok: false, status: null, elapsedMs: 0, error: { kind: 'noFetch', message: 'no fetch implementation available (node >=24 ships globalThis.fetch; pass deps.fetchImpl otherwise)' } };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetchFn(url, { method: 'GET', signal: controller.signal, redirect: 'follow' });
    const elapsedMs = Date.now() - startedAt;
    let bodyHead;
    try {
      const text = await res.text();
      bodyHead = typeof text === 'string' ? text.slice(0, 256) : undefined;
    } catch {
      bodyHead = undefined;
    }
    return {
      ok: typeof res.status === 'number' && res.status > 0 && res.status < 500,
      status: typeof res.status === 'number' ? res.status : null,
      elapsedMs,
      ...(bodyHead !== undefined ? { bodyHead } : {}),
    };
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const kind = err?.name === 'AbortError' ? 'timeout' : 'network';
    return { ok: false, status: null, elapsedMs, error: { kind, message: err?.message ?? String(err) } };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the deterministic verify pass. Pure in-process; no agent CLI,
 * no MCP, no child processes. Returns the per-AC skip ledger and the
 * diagnostic HTTP probe on `runStats`.
 *
 * Honest minimum (no chain-level probe field exists today): every
 * testable AC lands on `blockedAcs[]` as critique-only, so the
 * aggregate verdict is BLOCKED and the finalise gate refuses by
 * construction. The caller (engine) MERGES these entries with the
 * provisioning-side blockedAcs; the two are the same shape.
 *
 * @param {object} args
 * @param {string} args.url
 * @param {Array<object>} args.acs - flattened acceptance criteria from the chain
 * @param {object} [args.deps]
 * @param {typeof fetch} [args.deps.fetchImpl]
 * @returns {Promise<{ findings: object[], blockedAcs: Array<{acId: string, reason: string, mode: string}>, runStats: object }>}
 */
export async function runDeterministic({ url, acs = [], deps = {} }) {
  const testable = Array.isArray(acs) ? acs.filter((a) => a && a.testable !== false) : [];
  const startedAt = Date.now();
  const probe = await probeHttpReachability({ url, fetchImpl: deps.fetchImpl });
  probe.url = url;
  const findings = [];
  const blockedAcs = testable.map((ac) => ({
    acId: ac.acId,
    reason: CRITIQUE_ONLY_REASON,
    mode: 'deterministic',
  }));
  const finishedAt = Date.now();
  const counts = {
    total: testable.length,
    verified: 0,
    failed: 0,
    skipped: blockedAcs.length,
  };
  return {
    findings,
    blockedAcs,
    runStats: {
      mode: 'deterministic',
      httpProbe: {
        url,
        ok: probe.ok,
        status: probe.status,
        elapsedMs: probe.elapsedMs,
        ...(probe.bodyHead !== undefined ? { bodyHead: probe.bodyHead } : {}),
        ...(probe.error !== undefined ? { error: probe.error } : {}),
      },
      counts,
      startedAtMs: startedAt,
      finishedAtMs: finishedAt,
    },
  };
}

/** Supported verify modes (public enum for CLI + engine). */
export const VERIFY_MODES = Object.freeze(['agentScreenshotCritique', 'deterministic']);
export const DEFAULT_VERIFY_MODE = 'agentScreenshotCritique';

/**
 * True iff value is a known verify mode. The CLI uses this as its
 * sole gate so a new mode added here is accepted everywhere.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isVerifyMode(value) {
  return typeof value === 'string' && VERIFY_MODES.includes(value);
}
