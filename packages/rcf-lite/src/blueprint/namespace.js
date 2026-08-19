// Namespacing rules for blueprint-contributed doc ids.
//
// THE id grammar (family membership, regex shapes, filename inversion)
// lives in `../core/store/ids.js` -- one implementation shared by the
// blueprint stamper, the walker (idFromFilenameStem) and the loader
// (pathForId). This module carries the blueprint-facing helpers on top
// of that grammar (stampId / isNamespacedFor / namespaceStyleFor) and
// re-exports parseIdParts so the public blueprint surface stays stable.
//
// Two families, per the 0.4.4 schemas grammar (see docs/id-conventions.md
// in @stravica-ai/rcf-schemas):
//
// - Prefix families (REQ, US, PRD, BS, TAD, TS): the blueprint slug is
//   attached as a lowercase kebab-slug PREFIX joined by `-` to the
//   family prefix. `REQ-001` under blueprint `spa` becomes `spa-REQ-001`.
//
// - Suffix families (ADR, TAC, FBS, CN): the blueprint slug is attached
//   as a lowercase kebab-slug SUFFIX joined by `-` to the numeric tail.
//   `ADR-005` under blueprint `spa` becomes `ADR-005-spa`; a longer slug
//   segment (`spa-theme`) becomes `ADR-005-spa-theme`.
//
// - AC and TC: not namespaced. AC ids are anchored to their parent US
//   (whose id is prefix-namespaced) and TC ids are anchored to their
//   parent TS (ditto). The 0.4.4 schemas intentionally left AC/TC
//   patterns unchanged.
//
// Ownership determination is NOT a grammar concern. String grammar is
// only used here to STAMP a bare id at first apply; ownership of an
// already-written contribution is answered by the manifest's
// appliedBlueprintRecord.contributions[] list -- the authoritative
// record of exactly which ids a given applied blueprint owns. See
// `apply.js` (overwrite guard, cross-claim check) and `remove.js`
// (referring-doc scan) for the record-consulting call-sites.
//
// This module is pure: no I/O, no wall clock.

import {
  PREFIX_FAMILY_SET,
  SLUG_PATTERN,
  SUFFIX_FAMILY_SET,
  UNNAMESPACED_FAMILY_SET,
  parseIdParts,
} from '../core/store/ids.js';

// Re-exported so `import { parseIdParts } from '../blueprint/namespace.js'`
// (and the transitive `blueprint/index.js` re-export) keep working. The
// implementation lives in core.
export { parseIdParts };

/**
 * Which namespacing style applies to a given id.
 *
 * @param {string} id
 * @returns {'prefix' | 'suffix' | 'none' | null}
 */
export function namespaceStyleFor(id) {
  const parts = parseIdParts(id);
  if (!parts) return null;
  if (PREFIX_FAMILY_SET.has(parts.family)) return 'prefix';
  if (SUFFIX_FAMILY_SET.has(parts.family)) return 'suffix';
  return 'none';
}

/**
 * Stamp an id with a blueprint namespace at FIRST APPLY.
 *
 * Contract:
 *   - Bare family+digits ids (`REQ-001`, `ADR-005`) get the slug written
 *     as prefix (prefix families) or suffix (suffix families).
 *   - Ids that already carry a slug segment are accepted VERBATIM: the
 *     blueprint author's declared contribution list is the truth for
 *     what that blueprint owns. String grammar does not veto (`stampId`
 *     used to refuse `ADR-201-spa-theme` under slug `spa` on the basis
 *     that `spa-theme` != `spa`, which broke every blueprint whose
 *     suffix-family ids carried a semantic tail after the slug).
 *   - AC and TC pass through unchanged (no namespacing family).
 *   - An id that matches no family pattern, or a slug that is not a
 *     valid kebab, is refused.
 *
 * Cross-blueprint claims (`spa-theme-REQ-001` declared under blueprint
 * `spa` where `spa-theme` is also applied) are caught by the manifest-
 * record consulted at write time (`apply.js` overwrite guard +
 * cross-claim detector). String parsing here is deliberately not a
 * trust surface.
 *
 * @param {string} id - canonical id (either bare `REQ-001` or already
 *                      namespaced `spa-REQ-001` / `ADR-201-spa-theme`)
 * @param {string} slug - blueprint slug (must be well-formed kebab)
 * @returns {{ id: string } | { error: string }}
 */
export function stampId(id, slug) {
  if (!SLUG_PATTERN.test(slug)) {
    return { error: `stampId: slug '${slug}' is not a valid kebab slug` };
  }
  const parts = parseIdParts(id);
  if (!parts) return { error: `stampId: id '${id}' does not match any known family pattern` };
  const style = namespaceStyleFor(id);
  if (style === 'none') return { id };
  if (style === 'prefix') {
    if (parts.prefixSlug === null) return { id: `${slug}-${parts.family}-${parts.digits}` };
    // Already carries a prefix segment. Trust the declaration -- see
    // module doc block. Any resulting cross-claim will surface at the
    // manifest-record check in apply.js, not here.
    return { id };
  }
  // suffix
  if (parts.suffixSlug === null) return { id: `${parts.family}-${parts.digits}-${slug}` };
  // Already carries a suffix segment. Trust the declaration (same
  // reasoning as the prefix branch above).
  return { id };
}

/**
 * GRAMMAR predicate: does the id's parsed slug segment equal `slug`?
 *
 * This is NOT an ownership check. Ownership of an applied contribution
 * is answered by the manifest's appliedBlueprintRecord.contributions[]
 * list (see `apply.js` overwrite guard and `remove.js` referring-doc
 * scan). `isNamespacedFor` retains exact-slug grammar semantics for
 * external consumers (docs generators, id-audit tooling) but must NOT
 * be used to authorise a write or a delete -- for slug+tail ids like
 * `ADR-201-spa-theme` the parsed suffix is `spa-theme`, which returns
 * false for a legitimate `spa`-owned contribution whose author put a
 * semantic tail after the slug. That misread is the exact reason the
 * ownership call-sites were routed off this predicate.
 *
 * @param {string} id
 * @param {string} slug
 * @returns {boolean}
 */
export function isNamespacedFor(id, slug) {
  const parts = parseIdParts(id);
  if (!parts) return false;
  const style = namespaceStyleFor(id);
  if (style === 'prefix') return parts.prefixSlug === slug;
  if (style === 'suffix') return parts.suffixSlug === slug;
  return false;
}

export const _internal = {
  PREFIX_FAMILIES: PREFIX_FAMILY_SET,
  SUFFIX_FAMILIES: SUFFIX_FAMILY_SET,
  UNNAMESPACED_FAMILIES: UNNAMESPACED_FAMILY_SET,
  SLUG_PATTERN,
};
