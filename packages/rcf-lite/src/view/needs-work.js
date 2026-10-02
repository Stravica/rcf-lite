// Viewer UI refresh PR 3 (decision 3, decision 14): compute the set of
// REQ ids that still "need work" from the readiness result. The source
// is the readiness result the server already carries on `model.readiness`
// (built once per rewalk by `computeReadiness`), so we never re-run gates
// in the client and never recompute them from the tree.
//
// The design doc section 8 names the three PO-persona checks that call
// out specific REQ ids: `skeleton:reqIntent` (requirement needs a plain
// description), `stories:reqHasUs` (who uses this requirement, what do
// they do), and `skeleton:resolvedBy` (brief kinds that could become a
// REQ). The first two name REQ ids directly on the blocker's `ids`
// array. `skeleton:resolvedBy` names brief statement ids (SK-x), not
// REQ ids, so it is informational for the Requirements tab and only
// gets picked up when the suggestion names a REQ. Any REQ id that ends
// up in any of the above blocker lists is in the Needs-work set.
//
// Decision 14: Requirements is the engineer view at all times. The
// Needs-work chip uses engineer-plain language (no PO phrasebook text);
// the data behind it is still the PO blockers so a product-owner and
// an engineer looking at the same tree see the same "still needs work"
// requirements.

const NEEDS_WORK_CHECKS = new Set([
  'skeleton:reqIntent',
  'stories:reqHasUs',
  'skeleton:resolvedBy',
]);

/**
 * @param {import('../query/readiness.js').ReadinessResult | null | undefined} readiness
 * @returns {Set<string>}  REQ ids that still need work
 */
export function computeReqNeedsWorkIds(readiness) {
  /** @type {Set<string>} */
  const out = new Set();
  if (!readiness) return out;
  const level = readiness.levels?.intentComplete;
  if (!level || !Array.isArray(level.blockedBy)) return out;
  for (const blocker of level.blockedBy) {
    if (!blocker || !NEEDS_WORK_CHECKS.has(blocker.check)) continue;
    const ids = Array.isArray(blocker.ids) ? blocker.ids : [];
    for (const id of ids) {
      if (typeof id === 'string' && id.startsWith('REQ-')) out.add(id);
    }
  }
  return out;
}

/**
 * Return a short, engineer-plain reason for a REQ being in the needs-
 * work set. Decision 14 keeps PO phrasebook text out of the Requirements
 * tab, so we map the check name to a terse engineer-facing label rather
 * than reproducing CHECK_QUESTION. Returns null when the REQ is not in
 * any needs-work check.
 *
 * @param {import('../query/readiness.js').ReadinessResult | null | undefined} readiness
 * @param {string} reqId
 * @returns {string | null}
 */
export function needsWorkReasonFor(readiness, reqId) {
  if (!readiness) return null;
  const level = readiness.levels?.intentComplete;
  if (!level || !Array.isArray(level.blockedBy)) return null;
  const reasons = [];
  for (const blocker of level.blockedBy) {
    if (!blocker || !NEEDS_WORK_CHECKS.has(blocker.check)) continue;
    const ids = Array.isArray(blocker.ids) ? blocker.ids : [];
    if (!ids.includes(reqId)) continue;
    reasons.push(REASON_BY_CHECK[blocker.check] ?? blocker.check);
  }
  if (reasons.length === 0) return null;
  return reasons.join('; ');
}

const REASON_BY_CHECK = {
  'skeleton:reqIntent': 'missing plain description or domain',
  'stories:reqHasUs': 'no user story yet',
  'skeleton:resolvedBy': 'resolved-by target still open',
};
