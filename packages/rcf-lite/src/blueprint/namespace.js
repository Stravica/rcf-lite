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
 * Stamp an id with a blueprint namespace. Idempotent: an id already
 * namespaced for the same slug is returned unchanged. Refuses to
 * re-stamp when the id already carries a different namespace slug.
 *
 * @param {string} id - canonical id (either bare `REQ-001` or already
 *                      namespaced `spa-REQ-001`)
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
    if (parts.prefixSlug === slug) return { id };
    return { error: `stampId: id '${id}' already carries prefix namespace '${parts.prefixSlug}'; cannot re-stamp as '${slug}'` };
  }
  // suffix
  if (parts.suffixSlug === null) return { id: `${parts.family}-${parts.digits}-${slug}` };
  if (parts.suffixSlug === slug || parts.suffixSlug.startsWith(`${slug}-`)) return { id };
  return { error: `stampId: id '${id}' already carries suffix namespace '${parts.suffixSlug}'; cannot re-stamp as '${slug}'` };
}

/**
 * True when the id is a blueprint-namespaced id for the given slug.
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
  if (style === 'suffix') return parts.suffixSlug === slug || (parts.suffixSlug ?? '').startsWith(`${slug}-`);
  return false;
}

export const _internal = {
  PREFIX_FAMILIES: PREFIX_FAMILY_SET,
  SUFFIX_FAMILIES: SUFFIX_FAMILY_SET,
  UNNAMESPACED_FAMILIES: UNNAMESPACED_FAMILY_SET,
  SLUG_PATTERN,
};
