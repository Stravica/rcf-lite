// JSON formatter for coverage / trace / impact result envelopes.
// Phase 5 §D15: shape is stable-by-convention. Downstream consumers
// (Phase 7 MCP layer) will consume these envelopes; no in-place
// reshape without a version bump.
//
// The `verb` tag is currently unused - every envelope is already
// self-describing (`ok`, `pivot`, `direction`, etc.) - but it's
// retained on the API so future formatter dispatch stays uniform
// across the three verbs.

/**
 * Format a query result as a JSON envelope.
 *
 * @param {object} result - CoverageResult | TraceResult | ImpactResult
 * @param {string} verb - 'coverage' | 'trace' | 'impact'
 * @returns {string}
 */
export function formatJson(result, verb) {
  void verb;
  return `${JSON.stringify(result, null, 2)}\n`;
}
