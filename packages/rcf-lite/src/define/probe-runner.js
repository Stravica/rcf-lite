// Probe runner seam (REQ-175; spec 2026-10-01 section 4 row 'D6 scans
// and the injectable probe runner' and section 11.6; ADR-4131 extended
// by DEFINE step 3 PR 7).
//
// A probeRunner is `({ reqId, tree }) => findings[]` where each
// finding is `{ reqId, finding, severity?, hash?, status? }`. The
// shape mirrors a probe-ledger entry minus the ids and timestamps
// computeReadiness assigns when it merges the findings into the probe
// ledger it hands the gate.
//
// IMPORTANT: NO RUNNER SHIPS. rcf-lite has no LLM at runtime and does
// not spawn processes or make network calls. The harness is the
// runner: it either calls `ledger probes add` directly, or it drives a
// test invocation that passes a stub runner into computeReadiness. The
// seam exists so a test harness or a future harness-driven call site
// has one named extension point rather than monkey-patching the
// probe-ledger reader.
//
// Shape alone; the function stays as a type-level reference and is not
// invoked by the CLI today.

/**
 * @typedef {{
 *   reqId: string,
 *   finding: string,
 *   severity?: 'low' | 'medium' | 'high',
 *   hash?: string,
 *   status?: 'open' | 'closed' | 'attested',
 * }} ProbeFinding
 */

/**
 * @typedef {(args: { reqId: string, tree: unknown }) => ProbeFinding[]} ProbeRunner
 */

/**
 * The default "no runner" sentinel. computeReadiness treats a null or
 * absent runner as "do not inject findings"; its result then equals
 * the 0.29.0 result on the same fixture (AC-17504-2).
 *
 * @type {ProbeRunner | null}
 */
export const NO_PROBE_RUNNER = null;

/**
 * Guard that a value is a usable probeRunner function. Pure. Exported
 * so computeReadiness can skip injection cleanly on a non-function
 * (`undefined`, `null`, or a mis-typed value) without throwing.
 *
 * @param {unknown} value
 * @returns {value is ProbeRunner}
 */
export function isProbeRunner(value) {
  return typeof value === 'function';
}
