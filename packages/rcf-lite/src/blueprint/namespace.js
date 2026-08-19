// Namespacing rules for blueprint-contributed doc ids.
//
// Two families, per the 0.4.4 schemas grammar (see docs/id-conventions.md
// in @stravica-ai/rcf-schemas):
//
// - Prefix families (REQ, US, PRD, BS, TAD, TS): the blueprint slug is
//   attached as a lowercase kebab-slug PREFIX joined by `-` to the
//   family prefix. `REQ-001` under blueprint `spa` becomes `spa-REQ-001`.
//   Schema pattern (common.reqId etc.):
//     ^([a-z][a-z0-9]*(?:-[a-z0-9]+)*-)?<PREFIX>-\d{3,}$
//
// - Suffix families (ADR, TAC, FBS, CN): the blueprint slug is attached
//   as a lowercase kebab-slug SUFFIX joined by `-` to the numeric tail.
//   `ADR-005` under blueprint `spa` becomes `ADR-005-spa`; a longer
//   slug segment (`spa-theme`) becomes `ADR-005-spa-theme`. Schema
//   pattern (common.adrId etc.):
//     ^<PREFIX>-\d{3,}(-[a-z0-9]+(?:-[a-z0-9]+)*)?$
//
// - AC and TC: not namespaced. AC ids are anchored to their parent US
//   (whose id is prefix-namespaced) and TC ids are anchored to their
//   parent TS (ditto). The 0.4.4 schemas intentionally left AC/TC
//   patterns unchanged.
//
// This module is pure: no I/O, no wall clock.

const PREFIX_FAMILIES = new Set(['REQ', 'US', 'PRD', 'BS', 'TAD', 'TS']);
const SUFFIX_FAMILIES = new Set(['ADR', 'TAC', 'FBS', 'CN']);
const UNNAMESPACED_FAMILIES = new Set(['AC', 'TC']);

const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// Precompiled per-family regexes. Prefix families are anchored so the
// optional slug prefix is captured cleanly; suffix families capture the
// optional slug suffix.
const PREFIX_REGEXES = new Map();
for (const family of PREFIX_FAMILIES) {
  PREFIX_REGEXES.set(family, new RegExp(`^(?:([a-z][a-z0-9]*(?:-[a-z0-9]+)*)-)?${family}-(\\d{3,})$`));
}
const SUFFIX_REGEXES = new Map();
for (const family of SUFFIX_FAMILIES) {
  SUFFIX_REGEXES.set(family, new RegExp(`^${family}-(\\d{3,})(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$`));
}
const UNNAMESPACED_REGEXES = new Map([
  ['AC', /^AC-(\d{3,})(?:-(\d+))?$/],
  ['TC', /^TC-(\d{3,})-([a-z0-9-]+)$/],
]);

/**
 * Split an id into { family, prefixSlug, digits, suffixSlug }. Returns
 * null when the id matches no known family pattern.
 *
 * @param {string} id
 * @returns {{ family: string, prefixSlug: string|null, digits: string, suffixSlug: string|null } | null}
 */
export function parseIdParts(id) {
  if (typeof id !== 'string' || !id.length) return null;
  // Suffix families are checked first (they never carry a leading slug),
  // then prefix families, then unnamespaced families. Deterministic per-
  // pattern lookup, no ordering ambiguity across families of the same
  // prefix length.
  for (const [family, regex] of SUFFIX_REGEXES) {
    const match = id.match(regex);
    if (match) return { family, prefixSlug: null, digits: match[1], suffixSlug: match[2] ?? null };
  }
  for (const [family, regex] of PREFIX_REGEXES) {
    const match = id.match(regex);
    if (match) return { family, prefixSlug: match[1] ?? null, digits: match[2], suffixSlug: null };
  }
  for (const [family, regex] of UNNAMESPACED_REGEXES) {
    const match = id.match(regex);
    if (match) return { family, prefixSlug: null, digits: match[1], suffixSlug: null };
  }
  return null;
}

/**
 * Which namespacing style applies to a given id.
 *
 * @param {string} id
 * @returns {'prefix' | 'suffix' | 'none' | null}
 */
export function namespaceStyleFor(id) {
  const parts = parseIdParts(id);
  if (!parts) return null;
  if (PREFIX_FAMILIES.has(parts.family)) return 'prefix';
  if (SUFFIX_FAMILIES.has(parts.family)) return 'suffix';
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

export const _internal = { PREFIX_FAMILIES, SUFFIX_FAMILIES, UNNAMESPACED_FAMILIES, SLUG_PATTERN };
