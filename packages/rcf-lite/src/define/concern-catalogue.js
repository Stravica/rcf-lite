// Concern catalogue (REQ-174 amendment paragraph; spec 2026-10-01
// section 4 row "D5 catalogue", 0.30.0 PR 6).
//
// Eight concerns keyed by REQ shape. For every REQ in scope, D5's
// crosscut:catalogue check enumerates the applicable (reqShape,
// concern) pairs via this module and asserts a concern-ledger entry
// keyed <REQ>:<concern> exists with disposition applied or waived (a
// waived entry carries a reason).
//
// The catalogue is deliberately keyed on the concern name so a
// shape-wise question like "what concerns apply to this REQ?" is a
// filter against one map, not a scan across eight. The reverse view
// (which shape triggers which concern) is a transpose and lives in
// applicableConcernsFor().
//
// Keys share names with the baseline catalogue
// (packages/rcf-lite/src/core/baseline-catalog) where names coincide:
// `auth` is the only name the two share today (the baseline-AC
// catalogue has no per-concern crosscut keys yet). The gate reader
// composes the ledger key as `<REQ>:<concern>`, so no key translation
// is needed between the two surfaces.
//
// Pure: no I/O, no state, no time. The export is frozen at module
// load so a consumer cannot mutate the shared source.

/**
 * Canonical ordering of concern names (spec section 4 row 'D5
 * catalogue'). Readers that iterate the catalogue use this so display
 * order stays stable.
 *
 * @type {ReadonlyArray<string>}
 */
export const CONCERN_KEYS = Object.freeze([
  'auth',
  'errorEnvelope',
  'loggingAudit',
  'retention',
  'performance',
  'secrets',
  'timeAndTimezone',
  'concurrencyIdempotency',
]);

/**
 * The eight REQ shapes the catalogue reasons over. These are the
 * values a REQ's shapeClassification.shapes array may carry; a REQ
 * may carry more than one. `other` is the catch-all whose only
 * applicable concern today is none.
 *
 * @type {ReadonlyArray<string>}
 */
export const REQ_SHAPES = Object.freeze([
  'auth',
  'httpApi',
  'cliCommand',
  'persistence',
  'batch',
  'externalIntegration',
  'webUi',
  'other',
]);

/**
 * Shape set helper. The `loggingAudit` row below reads "every shape
 * but other"; expressing that once beats enumerating the seven
 * concrete shapes.
 */
const ALL_BUT_OTHER = Object.freeze(REQ_SHAPES.filter((s) => s !== 'other'));

/**
 * Per-concern applicability map keyed by concern name (spec section 4
 * row 'D5 catalogue', verbatim):
 *
 *   auth                   -> auth, httpApi
 *   errorEnvelope          -> httpApi, cliCommand
 *   loggingAudit           -> every REQ shape but other
 *   retention              -> persistence
 *   performance            -> httpApi, batch
 *   secrets                -> auth, externalIntegration
 *   timeAndTimezone        -> persistence, batch
 *   concurrencyIdempotency -> httpApi, persistence
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const CONCERN_APPLICABILITY = Object.freeze({
  auth: Object.freeze(['auth', 'httpApi']),
  errorEnvelope: Object.freeze(['httpApi', 'cliCommand']),
  loggingAudit: ALL_BUT_OTHER,
  retention: Object.freeze(['persistence']),
  performance: Object.freeze(['httpApi', 'batch']),
  secrets: Object.freeze(['auth', 'externalIntegration']),
  timeAndTimezone: Object.freeze(['persistence', 'batch']),
  concurrencyIdempotency: Object.freeze(['httpApi', 'persistence']),
});

/**
 * Which concerns apply to a REQ shape. Reads the per-concern map
 * once and returns the names, in CONCERN_KEYS order, whose shape set
 * contains the input. An unknown shape returns [].
 *
 * @param {string} reqShape
 * @returns {string[]}
 */
export function applicableConcernsFor(reqShape) {
  if (typeof reqShape !== 'string' || reqShape.length === 0) return [];
  const out = [];
  for (const concern of CONCERN_KEYS) {
    const shapes = CONCERN_APPLICABILITY[concern];
    if (shapes && shapes.includes(reqShape)) out.push(concern);
  }
  return out;
}

/**
 * Union of applicable concerns across a set of REQ shapes. A REQ
 * carries an array of shapes (shapeClassification.shapes); the
 * applicable concerns for that REQ are the union of applicableConcerns
 * for each shape, in CONCERN_KEYS order with no duplicates.
 *
 * @param {Iterable<string>} shapes
 * @returns {string[]}
 */
export function applicableConcernsForShapes(shapes) {
  const seen = new Set();
  for (const shape of shapes ?? []) {
    for (const c of applicableConcernsFor(shape)) seen.add(c);
  }
  // Preserve canonical order.
  return CONCERN_KEYS.filter((c) => seen.has(c));
}
