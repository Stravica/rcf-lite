// JSON formatter for the build verb (Phase 6 §D14). Envelope shapes
// are stable-by-convention, same contract discipline as Phase 5 D15:
// no in-place reshape without a new flag or subcommand. These
// envelopes are the Phase 7 MCP layer's anchor. camelCase throughout;
// serialisation via JSON.stringify with construction-ordered keys
// (§D10 determinism).

/**
 * Format a build result as a JSON envelope.
 *
 * @param {object} result - QueueResult | BundleResult | next-mode empty envelope
 * @param {('queue'|'bundle'|'next')} mode
 * @returns {string}
 */
export function formatJson(result, mode) {
  const envelope = { ok: true, mode, ...result };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}
