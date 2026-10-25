// Deterministic verify mode (issue 330, 2026-10-08). A dispatched worker
// cannot spawn `claude` as a subagent (an estate rule the surrounding
// harness enforces by killing any such child), so the default
// `agentScreenshotCritique` mode is a parent-session mode. This module
// is its sister: a model-free verify path that a dispatched worker can
// run end-to-end from inside a tool call.
//
// Scope:
//   - HTTP reachability probe against `--url` recorded on `runStats`
//     as diagnostic context (NOT a per-AC verification);
//   - an AC with no probe is recorded on `blockedAcs[]` with reason
//     `critique-only`, so it is never a pass and the finalise gate
//     refuses promotion while one remains (ADR-4112 verified invariant).
//
// Per-AC probes (FBS-218, issue 349, TAC-4150): an AC carrying a probe
// (on the AC, rcf-schemas 0.8.0 `$defs/acProbe`, or in
// `rcf/verify-catalog.json`, see catalog.js) is resolved against `--url`
// to pass, fail or skipped with evidence; an AC with no probe stays
// critique-only on `blockedAcs[]`. A pass lands as a PASS finding, a fail
// as a BROKEN finding. `runStats.counts` gains `critiqueOnly` and the
// report carries `perAc[] { acId, result, evidence }`.
//
// Retired criteria (FBS-228, US-19401): an AC carrying `supersededBy` is
// recorded on perAc[] as `retired` with `evidence.supersededBy`, before
// any probe is selected, so its probe path is never requested. It is no
// finding, never pass or fail, and leaves `runStats.counts`: total counts
// the live testable ACs only, and verified and failed never count it.
//
// Shared-parent-state note: this module uses `globalThis.fetch`
// (injectable via `deps.fetchImpl`) and never spawns a child
// process for an HTTP probe, so it cannot leak the parent's Playwright
// or MCP session. A selector probe renders the page with the declared
// optional `playwright` peer in-process (`deps.domSnapshotImpl` seam),
// never the MCP.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { probeShapeError, selectProbe } from './catalog.js';

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

const PARITY_MISMATCH_REASON = 'parityEnv mismatch';

/**
 * Resolve one probe against an observed response. Pure: a function of
 * the probe, the fetched response and the optional DOM snapshot only.
 * Expectations are checked in order (status, header, body, selector);
 * the first that fails names itself on the evidence.
 *
 * @param {object} probe - the Probe record (TAC-4150)
 * @param {{ status: number, headers: Record<string, string>, body: string, elapsedMs: number }} response
 * @param {{ selector: string, count: number } | null} [dom]
 * @returns {{ result: 'pass'|'fail', evidence: object }}
 */
export function resolveProbe(probe, response, dom = null) {
  const base = { status: response.status, elapsedMs: response.elapsedMs };
  const fail = (failedExpectation, expected, observed) => ({
    result: 'fail',
    evidence: { ...base, failedExpectation, expected, observed },
  });
  const shapeError = probeShapeError(probe);
  if (shapeError) {
    return fail(shapeError.field, 'a probe matching $defs/acProbe with at least one response assertion', shapeError.message);
  }
  if (probe.expectStatus !== undefined && response.status !== probe.expectStatus) {
    return fail('expectStatus', probe.expectStatus, response.status);
  }
  if (probe.expectHeader) {
    const { name, match } = probe.expectHeader;
    const value = response.headers[String(name).toLowerCase()];
    if (typeof value !== 'string' || !value.includes(match)) {
      return fail(`expectHeader ${name}`, match, value ?? null);
    }
  }
  if (probe.expectBody) {
    const body = response.body ?? '';
    if (typeof probe.expectBody.contains === 'string' && !body.includes(probe.expectBody.contains)) {
      return fail('expectBody.contains', probe.expectBody.contains, body.slice(0, 256));
    }
    if (typeof probe.expectBody.matches === 'string' && !new RegExp(probe.expectBody.matches).test(body)) {
      return fail('expectBody.matches', probe.expectBody.matches, body.slice(0, 256));
    }
  }
  if (probe.selector) {
    const count = dom?.count ?? 0;
    if (count < 1) return fail('selector', probe.selector, count);
    return { result: 'pass', evidence: { ...base, selector: probe.selector, selectorCount: count } };
  }
  return { result: 'pass', evidence: base };
}

/**
 * Issue one probe request. Returns the observed response or a transport
 * error kind; never throws.
 *
 * @param {object} args
 * @param {string} args.url - the probe URL (base --url joined with probe.path)
 * @param {string} [args.method]
 * @param {typeof fetch} [args.fetchImpl]
 * @param {number} [args.timeoutMs]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string, elapsedMs: number } | { error: { kind: string, message: string }, elapsedMs: number }>}
 */
async function requestProbe({ url, method = 'GET', fetchImpl, timeoutMs = DEFAULT_REACHABLE_TIMEOUT_MS }) {
  const fetchFn = fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return { elapsedMs: 0, error: { kind: 'noFetch', message: 'no fetch implementation available' } };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetchFn(url, { method, signal: controller.signal, redirect: 'follow' });
    const body = await res.text();
    const headers = {};
    res.headers?.forEach?.((value, name) => { headers[name.toLowerCase()] = value; });
    return { status: res.status, headers, body, elapsedMs: Date.now() - startedAt };
  } catch (err) {
    const kind = err?.name === 'AbortError' ? 'timeout' : 'network';
    return { elapsedMs: Date.now() - startedAt, error: { kind, message: err?.message ?? String(err) } };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Count the elements a selector matches on the rendered page, in-process
 * through the optional `playwright` peer (never the MCP). Returns an
 * error kind when the peer is not installed or the render fails.
 *
 * @param {{ url: string, selector: string }} args
 * @returns {Promise<{ selector: string, count: number } | { error: { kind: string, message: string } }>}
 */
export async function snapshotSelector({ url, selector }) {
  let chromium;
  try {
    // The declared optional peer, resolved the way pack-browser.js does so
    // it stays out of the runtime dependency set.
    const playwrightPath = createRequire(import.meta.url).resolve('playwright');
    const mod = await import(pathToFileURL(playwrightPath).href);
    chromium = mod?.chromium ?? mod?.default?.chromium;
  } catch (err) {
    return { error: { kind: 'noPlaywright', message: `selector probes need the optional playwright peer: ${err.message}` } };
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url);
    return { selector, count: await page.locator(selector).count() };
  } catch (err) {
    return { error: { kind: 'render', message: err?.message ?? String(err) } };
  } finally {
    await browser?.close();
  }
}

/**
 * Run the deterministic verify pass. Pure in-process; no agent CLI and
 * no MCP. Each testable AC resolves through its probe (AC-level first,
 * then the catalog) to pass, fail or skipped with evidence; an AC with
 * no probe is critique-only; a retired AC (supersededBy) is recorded
 * retired and never probed. Skipped and critique-only ACs land on
 * `blockedAcs[]`, which the caller MERGES with the provisioning-side
 * list; passes and fails land as findings.
 *
 * @param {object} args
 * @param {string} args.url
 * @param {Array<object>} args.acs - flattened acceptance criteria from the chain
 * @param {{ probes: Record<string, object> }} [args.catalog] - rcf/verify-catalog.json (catalog.js)
 * @param {string|null} [args.parityEnv] - the run's --parity-env value
 * @param {object} [args.deps]
 * @param {typeof fetch} [args.deps.fetchImpl]
 * @param {typeof snapshotSelector} [args.deps.domSnapshotImpl]
 * @returns {Promise<{ findings: object[], blockedAcs: Array<{acId: string, reason: string, mode: string}>, perAc: Array<{acId: string, result: string, evidence: object}>, runStats: object }>}
 */
export async function runDeterministic({ url, acs = [], catalog = { probes: {} }, parityEnv = null, deps = {} }) {
  const testable = Array.isArray(acs) ? acs.filter((a) => a && a.testable !== false) : [];
  const startedAt = Date.now();
  const probe = await probeHttpReachability({ url, fetchImpl: deps.fetchImpl });
  probe.url = url;
  const findings = [];
  const blockedAcs = [];
  const perAc = [];
  const live = testable.filter((a) => typeof a.supersededBy !== 'string');
  const counts = { total: live.length, verified: 0, failed: 0, skipped: 0, critiqueOnly: 0 };
  const skip = (acId, evidence, reason) => {
    counts.skipped += 1;
    perAc.push({ acId, result: 'skipped', evidence });
    blockedAcs.push({ acId, reason: `skipped: ${reason}`, mode: 'deterministic' });
  };

  for (const ac of testable) {
    if (typeof ac.supersededBy === 'string') {
      perAc.push({ acId: ac.acId, result: 'retired', evidence: { supersededBy: ac.supersededBy } });
      continue;
    }
    const selected = selectProbe(ac, catalog);
    if (!selected) {
      counts.critiqueOnly += 1;
      perAc.push({ acId: ac.acId, result: 'critiqueOnly', evidence: { reason: CRITIQUE_ONLY_REASON } });
      blockedAcs.push({ acId: ac.acId, reason: CRITIQUE_ONLY_REASON, mode: 'deterministic' });
      continue;
    }
    const { probe: acProbe, source } = selected;
    if (acProbe.parityEnv !== undefined && acProbe.parityEnv !== parityEnv) {
      skip(ac.acId, { source, reason: PARITY_MISMATCH_REASON, probeParityEnv: acProbe.parityEnv, runParityEnv: parityEnv }, PARITY_MISMATCH_REASON);
      continue;
    }
    const probeUrl = new URL(acProbe.path, url).href;
    const response = await requestProbe({ url: probeUrl, method: acProbe.method, fetchImpl: deps.fetchImpl });
    if (response.error) {
      skip(ac.acId, { source, url: probeUrl, elapsedMs: response.elapsedMs, error: response.error }, `${response.error.kind} error reaching ${probeUrl}`);
      continue;
    }
    let dom = null;
    if (acProbe.selector) {
      dom = await (deps.domSnapshotImpl ?? snapshotSelector)({ url: probeUrl, selector: acProbe.selector });
      if (dom.error) {
        skip(ac.acId, { source, url: probeUrl, error: dom.error }, `${dom.error.kind}: ${dom.error.message}`);
        continue;
      }
    }
    const { result, evidence } = resolveProbe(acProbe, response, dom);
    const stamped = { source, url: probeUrl, ...evidence };
    perAc.push({ acId: ac.acId, result, evidence: stamped });
    if (result === 'pass') counts.verified += 1;
    else counts.failed += 1;
    findings.push({
      severity: result === 'pass' ? 'PASS' : 'BROKEN',
      acId: ac.acId,
      journey: `deterministic probe ${acProbe.method ?? 'GET'} ${acProbe.path}`,
      reproSteps: [`${acProbe.method ?? 'GET'} ${probeUrl}`],
      evidence: stamped,
    });
  }
  const finishedAt = Date.now();
  return {
    findings,
    blockedAcs,
    perAc,
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
