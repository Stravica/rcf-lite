// Composite id splitter for the Readiness blocking table (TAC-4135
// splitCompositeId, ADR-4139; FBS-204, US-18003 AC-18003-4).
//
// Failing items in `stages[].checks[].failing[]` and in
// `levels.*.blockedBy[].ids[]` sometimes carry a composite id of the
// shape `<docId>:<fragment>` (for example "AC-060-3:userID" or
// "TAC-4122-define-gates:checkPersona"). The blocking table needs the
// document part on its own so the row's link resolves through
// findByDocId; the fragment stays visible so the row still names the
// exact failing nib. Split on the first colon so the fragment keeps
// its own colons (TAD-001:security:foo splits to docId=TAD-001,
// fragment=security:foo).
//
// Pure, no I/O. Returns { docId, fragment } where `fragment` is '' when
// no colon is present. A null / non-string input yields { docId: '',
// fragment: '' } so callers can wrap defensively.

/**
 * @typedef {object} SplitId
 * @property {string} docId     the resolvable document id (part before the first colon)
 * @property {string} fragment  the remainder (empty when there was no colon)
 */

/**
 * Split a composite failing id on the FIRST colon.
 *
 * @param {string | null | undefined} id
 * @returns {SplitId}
 */
export function splitCompositeId(id) {
  if (typeof id !== 'string' || id.length === 0) return { docId: '', fragment: '' };
  const i = id.indexOf(':');
  if (i === -1) return { docId: id, fragment: '' };
  return { docId: id.slice(0, i), fragment: id.slice(i + 1) };
}
