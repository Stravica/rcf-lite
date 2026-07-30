// Marker constants for the agent-instructions managed block (0.6.0
// spec §2.5, D-7). Extracted to a single module so a marker rename in
// six months lands in one place, not scattered across agent-setup,
// doctor, MCP funnel and tests. Drift between two definitions is the
// exact bug the strand-1 legacy-markers migration exists to prevent.
//
// The legacy pair (`<!-- rcf:begin -->` / `<!-- rcf:end -->`) is also
// exported so callers that need to recognise the pre-0.6.0 marker
// generation (the MCP setup funnel, doctor's `legacy-markers` check)
// have a single source of truth for its shape too.
//
// The managed-gitignore module owns its own marker constants in
// `managed-gitignore.js` (disjoint namespace: gitignore uses `#`
// comments rather than HTML comments).

/** The 0.6.0+ managed-block markers `rcf init` writes into agent-instructions files. */
export const MARKER_BEGIN = '<!-- rcf:managed:begin -->';
export const MARKER_END = '<!-- rcf:managed:end -->';

/** Pre-0.6.0 marker generation; kept for the transitional `hasAgentMarker` recogniser and doctor's `legacy-markers` check. */
export const LEGACY_MARKER_BEGIN = '<!-- rcf:begin -->';
export const LEGACY_MARKER_END = '<!-- rcf:end -->';

/**
 * Compose the replace-in-place regex for the current-marker managed
 * block. Non-greedy match between MARKER_BEGIN and MARKER_END so a file
 * with structural corruption (unpaired markers, duplicate blocks) does
 * not silently swallow arbitrary regions - doctor detects those states
 * explicitly and refuses to --fix them.
 *
 * @returns {RegExp}
 */
export function markerRegex() {
  return new RegExp(`${escapeRegex(MARKER_BEGIN)}[\\s\\S]*?${escapeRegex(MARKER_END)}`);
}

/**
 * Same shape as `markerRegex` for the legacy pair. Used by doctor's
 * `legacy-markers` --fix path and by the transitional migration.
 *
 * @returns {RegExp}
 */
export function legacyMarkerRegex() {
  return new RegExp(`${escapeRegex(LEGACY_MARKER_BEGIN)}[\\s\\S]*?${escapeRegex(LEGACY_MARKER_END)}`);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
