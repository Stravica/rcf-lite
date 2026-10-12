// Verification scope (ADR-4147, US-16504). `rcf verify run` verifies the
// whole acceptance contract by default; `--fbs <id>` (repeatable) narrows
// it to the acceptance criteria bound to the named FBS items. Finalise
// passes its own FBS by default so finalising one build unit costs one
// unit's verification; `--all` on finalise passes no filter.
//
// Pure over the chain reader's output: the FBS binding is read off the
// `fbsItems` the reader already surfaces, never by re-opening the tree.
// Errors are data (RcfError) so the CLI maps them to usage exits and the
// MCP tool to an isError result.

import { rcfError } from '#core/errors';

/** The scope label a report carries when no filter was applied. */
export const CHAIN_SCOPE = 'chain';

/**
 * Normalise a `--fbs` option value list: repeatable flags and comma lists
 * both collapse to a de-duplicated array of trimmed ids in first-seen
 * order. Returns an empty array for no filter.
 *
 * @param {string[] | string | undefined} raw
 * @returns {string[]}
 */
export function normaliseFbsIds(raw) {
  const values = raw === undefined || raw === null ? [] : (Array.isArray(raw) ? raw : [raw]);
  const out = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    for (const part of value.split(',')) {
      const id = part.trim();
      if (id.length > 0 && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/**
 * Build the scope label a report records: `chain` when no filter was
 * applied, otherwise `fbs:<id>[,<id>...]` in the order given.
 *
 * @param {string[]} fbsIds
 * @returns {string}
 */
export function scopeLabel(fbsIds) {
  return fbsIds.length === 0 ? CHAIN_SCOPE : `fbs:${fbsIds.join(',')}`;
}

/**
 * Resolve the verification scope over a chain read-out.
 *
 * With no filter the whole acceptance contract is in scope. With a filter,
 * every id must name an FBS on the chain (an unknown id is a usage error
 * naming it) and the union of the named items' bound criteria must be
 * non-empty (an FBS with no bound criteria has nothing to verify and is
 * refused with a plain message rather than reported as a vacuous pass).
 * Scoped ACs keep the chain reader's order.
 *
 * @param {object} args
 * @param {{ acs: object[], fbsItems?: Array<{ fbsId: string, acIds: string[] }> }} args.chain
 * @param {string[] | string | undefined} [args.fbsIds]
 * @returns {{ acs: object[], fbsIds: string[], scope: string, acCount: number } | import('#core/errors').RcfError}
 */
export function resolveScope({ chain, fbsIds } = {}) {
  const ids = normaliseFbsIds(fbsIds);
  const allAcs = Array.isArray(chain?.acs) ? chain.acs : [];
  if (ids.length === 0) {
    return { acs: allAcs, fbsIds: [], scope: CHAIN_SCOPE, acCount: allAcs.length };
  }
  const fbsItems = Array.isArray(chain?.fbsItems) ? chain.fbsItems : [];
  const byId = new Map(fbsItems.map((f) => [f.fbsId, f]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    return rcfError({
      kind: 'usage',
      field: 'fbs',
      message: `--fbs names ${unknown.length === 1 ? 'an FBS' : 'FBS items'} not on this chain: ${unknown.join(', ')}. Check the id with rcf build queue.`,
    });
  }
  const bound = new Set();
  for (const id of ids) {
    for (const acId of byId.get(id).acIds ?? []) bound.add(acId);
  }
  const acs = allAcs.filter((ac) => bound.has(ac.acId));
  if (acs.length === 0) {
    const what = ids.length === 1 ? ids[0] : ids.join(', ');
    return rcfError({
      kind: 'usage',
      field: 'fbs',
      message: `${what} has no bound acceptance criteria; there is nothing to verify. Bind at least one AC to the FBS (acIds) before verifying or finalising it.`,
    });
  }
  return { acs, fbsIds: ids, scope: scopeLabel(ids), acCount: acs.length };
}
