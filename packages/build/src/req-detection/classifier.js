// REQ-shape classifier (Track C+D spec §4.4).
//
// Deterministic keyword-scan over an already-loaded REQ document. Reads
// `title`, `description`, `rationale`, folds the parent PRD's `intent`
// and `problem` as fallback context, and returns a
// `shapeClassification` block per the requirement schema (§3.1). Never
// reads USes or ACs (they may not exist yet and would circularly
// re-trigger the classifier).
//
// Signals come from `matchReqShapeSignals` in core (single source of
// truth; Track B's UI patterns flow through the same file). Multi-shape
// verdicts are legitimate; the classifier records each match tagged with
// the source field it came from.
//
// Content-pending case: a REQ whose `description` is empty at write time
// records `shapes: []`, `reason: content-pending`; the classifier reruns
// on the first `rcf update req --description ...` that adds real content.

import { matchReqShapeSignals, SHAPE_KEYS } from '@stravica-ai/rcf-lite-core/patterns/req-shapes';

/**
 * @typedef {'webUi'|'httpApi'|'auth'|'persistence'|'notifications'} ReqShape
 * @typedef {'webUi'|'httpApi'|'auth'|'persistence'|'notifications'|'none'} ReqShapeWithNone
 * @typedef {'keyword-scan'|'content-pending'|'inheritedFromParent'|'operatorOverride'} ClassifierReason
 */

/**
 * @typedef {object} ReqShapeSignal
 * @property {'title'|'description'|'rationale'} source
 * @property {string} match
 * @property {ReqShape} shape
 */

/**
 * @typedef {object} ReqShapeClassification
 * @property {ReqShapeWithNone[]} shapes
 * @property {ClassifierReason} reason
 * @property {ReqShapeSignal[]} [signals]
 * @property {string} classifiedAt
 * @property {object} [operatorOverride]
 */

const ALLOWED_SOURCES = Object.freeze(['title', 'description', 'rationale']);

/**
 * Compute the shape classification for a REQ. Pure function; does not
 * write to the document. Callers merge the returned block onto the REQ
 * before persisting.
 *
 * @param {object} reqDoc                  the REQ document body
 * @param {object} [opts]
 * @param {object} [opts.parentPrd]        parent PRD body for fallback context
 * @param {Date} [opts.now]                clock injection for tests
 * @returns {ReqShapeClassification}
 */
export function classifyReq(reqDoc, opts = {}) {
  const now = opts.now ?? new Date();
  const isoNow = now.toISOString();

  const title = typeof reqDoc?.title === 'string' ? reqDoc.title : '';
  const description = typeof reqDoc?.description === 'string' ? reqDoc.description : '';
  const rationale = typeof reqDoc?.rationale === 'string' ? reqDoc.rationale : '';

  // Content-pending: the REQ has no real description body yet. Placeholder
  // scaffolds land as "TODO", so treat descriptions that are empty or
  // exactly-a-todo as pending. The classifier re-runs on the next update
  // once the operator or an intake pass fills in real prose.
  const contentPending = description.length === 0 || /^\s*TODO\b/i.test(description);
  if (contentPending) {
    return {
      shapes: [],
      reason: 'content-pending',
      classifiedAt: isoNow,
    };
  }

  const signals = [];

  const primarySources = [
    { source: 'title', text: title },
    { source: 'description', text: description },
    { source: 'rationale', text: rationale },
  ];

  for (const { source, text } of primarySources) {
    if (!ALLOWED_SOURCES.includes(source) || text.length === 0) continue;
    for (const m of matchReqShapeSignals(text)) {
      signals.push({ source, shape: m.shape, match: m.match });
    }
  }

  // Parent PRD fallback: only used to seed additional shapes when the REQ
  // itself did not surface one. Signals are still attributed to the REQ's
  // own fields per the schema enum (title/description/rationale) so the
  // signals array shape stays stable; a shape inherited from the PRD lands
  // in `shapes[]` with no signal row and the classifier reason stays
  // keyword-scan (the signals are still what the REQ said; the parent
  // widens the shape list only when the REQ's own text was silent). This
  // matches spec §4.4 "fallback context" without mixing scopes.
  const parentPrd = opts.parentPrd ?? null;
  const parentText = parentPrd
    ? [parentPrd.intent, parentPrd.problem].filter((s) => typeof s === 'string' && s.length > 0).join(' ')
    : '';
  const parentSignals = parentText.length > 0 ? matchReqShapeSignals(parentText) : [];

  // Merge shapes: any shape the REQ's own text matched, plus any shape
  // the parent PRD adds. Preserved in canonical order.
  const shapesSet = new Set();
  for (const s of signals) shapesSet.add(s.shape);
  for (const m of parentSignals) shapesSet.add(m.shape);

  const shapes = SHAPE_KEYS.filter((s) => shapesSet.has(s));
  const finalShapes = shapes.length === 0 ? ['none'] : shapes;

  const block = {
    shapes: finalShapes,
    reason: 'keyword-scan',
    classifiedAt: isoNow,
  };
  if (signals.length > 0) block.signals = signals;
  return block;
}

/**
 * Merge a fresh classification onto an existing REQ document. Preserves
 * a previous `operatorOverride` block when present, and preserves
 * signals from earlier runs when the new run comes back
 * `content-pending` (never clear real signals with a pending re-run;
 * pending is a "no verdict yet" state, not a delete).
 *
 * @param {object} reqDoc               REQ document to merge onto (not mutated)
 * @param {ReqShapeClassification} block classification from `classifyReq`
 * @returns {object}                     new REQ doc with the merged block
 */
export function mergeClassificationOntoReq(reqDoc, block) {
  const existing = reqDoc?.shapeClassification;
  // On content-pending: only apply if there is no previous verdict.
  if (block.reason === 'content-pending' && existing && existing.reason !== 'content-pending') {
    return reqDoc;
  }
  const next = { ...reqDoc, shapeClassification: { ...block } };
  if (existing?.operatorOverride) {
    next.shapeClassification.operatorOverride = existing.operatorOverride;
    // An operator override wins on the shapes field.
    if (Array.isArray(existing.operatorOverride.newShapes) && existing.operatorOverride.newShapes.length > 0) {
      next.shapeClassification.shapes = [...existing.operatorOverride.newShapes];
    }
  }
  return next;
}

/**
 * Compose an operator override block per spec §4.5. Records both the
 * original classifier shapes and the newly-ruled shapes so the override
 * history is visible to reviewers. Does not mutate the input; returns a
 * new `shapeClassification` block ready to write.
 *
 * @param {object} args
 * @param {ReqShapeWithNone[]} args.originalShapes
 * @param {ReqShapeWithNone[]} args.newShapes
 * @param {string} args.reason
 * @param {ReqShapeSignal[]} [args.signals]
 * @param {Date} [args.now]
 * @returns {ReqShapeClassification}
 */
export function composeOperatorOverride({ originalShapes, newShapes, reason, signals, now = new Date() }) {
  const isoNow = now.toISOString();
  const block = {
    shapes: [...newShapes],
    reason: 'operatorOverride',
    classifiedAt: isoNow,
    operatorOverride: {
      originalShapes: [...originalShapes],
      newShapes: [...newShapes],
      reason,
      ackAt: isoNow,
    },
  };
  if (Array.isArray(signals) && signals.length > 0) block.signals = signals;
  return block;
}
