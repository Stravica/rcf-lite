// Pure EVAL-coverage compute. Given a walker-produced TreeModel, walk
// the REQ chain (PRD -> REQ -> US -> AC) and report, per AC, whether
// its `determinism` classification requires an EVAL, whether an EVAL
// binds it, and whether that EVAL is "resolving" per the spec (a
// non-superseded EVAL whose most recent runRecord[] entry is not
// `pending`).
//
// spec: `projects/rcf-lite-wsd/specs/rcf-eval-node-spec-2026-09-04.md`
// sections 2.3 and 4. Determinism absence resolves to `deterministic`;
// deterministic ACs are never gated by this audit. `--strict` refuses
// only when a nonDeterministic AC lacks a resolving EVAL. Presence of
// an EVAL on a deterministic AC is reported as `covered-optional`,
// never as a defect.
//
// This module is pure and synchronous; the CLI layer walks the tree
// and formats.

/**
 * @typedef {import('#core/store/walker.js').TreeModel} TreeModel
 */

/**
 * @typedef {'deterministic'|'nonDeterministic'} Determinism
 */

/**
 * @typedef {'resolving'|'pending'|'superseded'|'absent'} EvalStatus
 */

/**
 * @typedef {object} AcEvalStatus
 * @property {string} acId
 * @property {string} usId
 * @property {Determinism} determinism - absence resolves to 'deterministic'
 * @property {EvalStatus} evalStatus
 * @property {string|null} evalId - the resolving EVAL, if any; else null
 * @property {string[]} evalIds - all EVALs whose acIds[] name this AC
 * @property {'covered'|'covered-optional'|'missing'|'not-required'} outcome
 *   - 'covered': nonDeterministic + resolving EVAL
 *   - 'covered-optional': deterministic + resolving EVAL (informational)
 *   - 'missing': nonDeterministic + no resolving EVAL
 *   - 'not-required': deterministic + no EVAL
 */

/**
 * @typedef {object} EvalCoverageReport
 * @property {AcEvalStatus[]} acs - flat per-AC entries within scope
 * @property {number} nonDeterministicCount
 * @property {number} coveredCount - nonDeterministic with resolving EVAL
 * @property {number} missingCount - nonDeterministic without resolving EVAL
 * @property {boolean} ok - true when strict-gate passes: missingCount === 0
 * @property {string|null} scopeId - null when tree-wide
 */

/**
 * Determine the resolving status for one EVAL doc.
 *
 * Per spec 2.3, a "resolving" EVAL is:
 *   - status is not 'superseded'
 *   - runRecord[] has at least one entry whose verdict is not 'pending'
 *
 * @param {object} evalDoc
 * @returns {EvalStatus}
 */
export function classifyEvalDoc(evalDoc) {
  if (!evalDoc || typeof evalDoc !== 'object') return 'absent';
  if (evalDoc.status === 'superseded') return 'superseded';
  const records = Array.isArray(evalDoc.runRecord) ? evalDoc.runRecord : [];
  if (records.length === 0) return 'pending';
  // Latest record wins. `runAt` sorts lexicographically for ISO timestamps.
  const sorted = [...records].sort((a, b) => (a?.runAt ?? '').localeCompare(b?.runAt ?? ''));
  const latest = sorted[sorted.length - 1];
  if (!latest || latest.verdict === 'pending') return 'pending';
  return 'resolving';
}

/**
 * @param {TreeModel} tree
 * @param {object} [opts]
 * @param {string|null} [opts.scopeId] - optional PRD / REQ / US id to scope
 * @returns {EvalCoverageReport}
 */
export function computeEvalCoverage(tree, { scopeId = null } = {}) {
  const usIds = collectScopedUsIds(tree, scopeId);
  const acs = [];
  for (const usId of usIds) {
    const us = tree.byId.get(usId);
    if (!us) continue;
    for (const ac of us.acceptanceCriteria ?? []) {
      const determinism = ac.determinism === 'nonDeterministic'
        ? 'nonDeterministic'
        : 'deterministic';
      const evalIds = tree.evalByAcId?.get(ac.id) ?? [];
      let outcome;
      let evalStatus;
      let resolvingId = null;
      if (evalIds.length === 0) {
        evalStatus = 'absent';
        outcome = determinism === 'nonDeterministic' ? 'missing' : 'not-required';
      } else {
        // Pick the best status across bound EVALs. `resolving` beats
        // `pending` beats `superseded`.
        let bestRank = -1;
        for (const evalId of evalIds) {
          const evalDoc = tree.byId.get(evalId);
          const cls = classifyEvalDoc(evalDoc);
          const rank = cls === 'resolving' ? 3 : cls === 'pending' ? 2 : cls === 'superseded' ? 1 : 0;
          if (rank > bestRank) {
            bestRank = rank;
            evalStatus = cls;
            if (cls === 'resolving') resolvingId = evalId;
          }
        }
        if (evalStatus === 'resolving') {
          outcome = determinism === 'nonDeterministic' ? 'covered' : 'covered-optional';
        } else {
          outcome = determinism === 'nonDeterministic' ? 'missing' : 'not-required';
        }
      }
      acs.push({
        acId: ac.id,
        usId,
        determinism,
        evalStatus,
        evalId: resolvingId,
        evalIds,
        outcome,
      });
    }
  }
  const nonDeterministicCount = acs.filter((a) => a.determinism === 'nonDeterministic').length;
  const missingCount = acs.filter((a) => a.outcome === 'missing').length;
  const coveredCount = nonDeterministicCount - missingCount;
  return {
    acs,
    nonDeterministicCount,
    coveredCount,
    missingCount,
    ok: missingCount === 0,
    scopeId,
  };
}

/**
 * Resolve the scope positional to the US ids it covers.
 *
 * @param {TreeModel} tree
 * @param {string|null} scopeId
 * @returns {string[]} US ids sorted ascending
 */
function collectScopedUsIds(tree, scopeId) {
  const allUs = tree.userStories ?? [];
  if (!scopeId) return allUs.map((u) => u.usId).sort();
  const kind = tree.kindById.get(scopeId);
  if (kind === 'userStory') return [scopeId];
  if (kind === 'req') return allUs.filter((u) => u.reqId === scopeId).map((u) => u.usId).sort();
  if (kind === 'prd') {
    const reqIds = new Set((tree.requirements ?? []).filter((r) => r.prdId === scopeId).map((r) => r.reqId));
    return allUs.filter((u) => reqIds.has(u.reqId)).map((u) => u.usId).sort();
  }
  return [];
}
