// Id normalisation + family grammar. This module owns THE grammar for
// RCF document ids: schema-family membership, filename-stem -> canonical-id
// inversion, and family -> tree location. The walker (walker.js), the
// document loader (loader.js) and the blueprint namespace helpers
// (src/blueprint/namespace.js) all consume the primitives defined here so
// the regexes live in exactly one place.
//
// Two schema families, per @stravica-ai/rcf-schemas 0.4.4 (see
// docs/id-conventions.md):
//
//  - Prefix families (REQ, US, PRD, BS, TAD, TS) admit an optional
//    lowercase kebab-slug PREFIX joined by `-` to the family prefix.
//    `REQ-001` under blueprint `spa` becomes `spa-REQ-001`.
//    Schema pattern (common.reqId etc.):
//      ^([a-z][a-z0-9]*(?:-[a-z0-9]+)*-)?<PREFIX>-\d{3,}$
//
//  - Suffix families (ADR, TAC, FBS, CN) admit an optional lowercase
//    kebab-slug SUFFIX joined by `-` to the numeric tail. `ADR-005`
//    under blueprint `spa` becomes `ADR-005-spa`.
//    Schema pattern (common.adrId etc.):
//      ^<PREFIX>-\d{3,}(-[a-z0-9]+(?:-[a-z0-9]+)*)?$
//
//  - Unnamespaced families (AC, TC) live inline under their parent
//    documents and never appear as top-level files under rcf/.
//
// The RCF id patterns admit a variable-width numeric run
// (`^REQ-\d{3,}$`, `^AC-\d{3,}(-\d+)?$`, ...), so `REQ-001` and
// `REQ-0001` are BOTH legal and BOTH name requirement number 1.
// `normaliseId` / `sameId` collapse those spellings for the walker's
// `globallyUniqueIds` rule and the writer's id allocator; that identity
// pass runs independently of the family grammar above.

// ---------------------------------------------------------------------------
// Family membership (the single source for downstream re-exports)
// ---------------------------------------------------------------------------

export const PREFIX_FAMILIES = Object.freeze(['REQ', 'US', 'PRD', 'BS', 'TAD', 'TS']);
export const SUFFIX_FAMILIES = Object.freeze(['ADR', 'TAC', 'FBS', 'CN']);
export const UNNAMESPACED_FAMILIES = Object.freeze(['AC', 'TC']);

export const PREFIX_FAMILY_SET = new Set(PREFIX_FAMILIES);
export const SUFFIX_FAMILY_SET = new Set(SUFFIX_FAMILIES);
export const UNNAMESPACED_FAMILY_SET = new Set(UNNAMESPACED_FAMILIES);

export const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// Precompiled per-family regexes. Prefix families are anchored so the
// optional slug prefix is captured cleanly; suffix families capture the
// optional slug suffix. Suffix families are consulted first because they
// never carry a leading slug -- see parseIdParts.
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

// Lowercase counterparts for stem-to-canonical inversion. Filenames on
// disk are lower-case kebab (blueprint apply -> destPathFor -> toLowerCase),
// and the same lowercase pattern is what the CLI init writer produces.
const PREFIX_STEM_REGEXES = new Map();
for (const family of PREFIX_FAMILIES) {
  PREFIX_STEM_REGEXES.set(family, new RegExp(`^(?:([a-z][a-z0-9]*(?:-[a-z0-9]+)*)-)?${family.toLowerCase()}-(\\d{3,})$`));
}
const SUFFIX_STEM_REGEXES = new Map();
for (const family of SUFFIX_FAMILIES) {
  SUFFIX_STEM_REGEXES.set(family, new RegExp(`^${family.toLowerCase()}-(\\d{3,})(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$`));
}

// Family -> tree location. Root families (PRD/TAD/BS) live at rcf/ root
// as single files; child families live one per JSON file under a subdir;
// AC/TC live inline under their parents and never resolve to a top-level
// file, so their entry is absent.
const FAMILY_TO_LOCATION = new Map([
  ['REQ', { kind: 'req', subdir: 'requirements', rootFile: null }],
  ['US', { kind: 'userStory', subdir: 'user-stories', rootFile: null }],
  ['TAC', { kind: 'tac', subdir: 'tacs', rootFile: null }],
  ['ADR', { kind: 'adr', subdir: 'adrs', rootFile: null }],
  ['FBS', { kind: 'fbs', subdir: 'fbs', rootFile: null }],
  ['TS', { kind: 'testSuite', subdir: 'test-suites', rootFile: null }],
  ['CN', { kind: 'codeNode', subdir: 'code-nodes', rootFile: null }],
  ['PRD', { kind: 'prd', subdir: null, rootFile: 'prd.json' }],
  ['TAD', { kind: 'tad', subdir: null, rootFile: 'tad.json' }],
  ['BS', { kind: 'buildSequence', subdir: null, rootFile: 'build-sequence.json' }],
]);

// ---------------------------------------------------------------------------
// Family grammar
// ---------------------------------------------------------------------------

/**
 * Split an id into { family, prefixSlug, digits, suffixSlug }. Returns
 * null when the id matches no known family pattern. The public blueprint
 * surface (`src/blueprint/namespace.js`) re-exports this so callers keep
 * a single import path even though the grammar lives here.
 *
 * @param {unknown} id
 * @returns {{ family: string, prefixSlug: string|null, digits: string, suffixSlug: string|null } | null}
 */
export function parseIdParts(id) {
  if (typeof id !== 'string' || id.length === 0) return null;
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
 * Location of a family in the rcf/ tree, or null when the family is not
 * addressable as a top-level file (AC / TC).
 *
 * @param {string} family
 * @returns {{ kind: string, subdir: string|null, rootFile: string|null } | null}
 */
export function familyLocation(family) {
  return FAMILY_TO_LOCATION.get(family) ?? null;
}

/**
 * Canonicalise a lowercase filename stem to its id form: upper-case ONLY
 * the family segment, leaving any slug prefix / suffix verbatim (they are
 * lower-case kebab by schema construction, matching the on-disk stem).
 *
 * Understands both id families:
 *   spa-req-001         -> spa-REQ-001    (prefix family, slug 'spa')
 *   req-001             -> REQ-001        (prefix family, no slug)
 *   adr-005-spa         -> ADR-005-spa    (suffix family, slug 'spa')
 *   adr-005             -> ADR-005        (suffix family, no slug)
 *   fbs-004-user-login  -> FBS-004-user-login
 *
 * Returns null when the stem matches no known family pattern; the walker
 * folds defensively in that case so an unrecognised stem surfaces via the
 * downstream load error, not a crash.
 *
 * @param {unknown} stem
 * @returns {string|null}
 */
export function canonicaliseStem(stem) {
  if (typeof stem !== 'string' || stem.length === 0) return null;
  // Suffix families first (mirrors parseIdParts: they never carry a
  // leading slug, so their prefix segment is unambiguous).
  for (const [family, regex] of SUFFIX_STEM_REGEXES) {
    const match = stem.match(regex);
    if (match) return match[2] ? `${family}-${match[1]}-${match[2]}` : `${family}-${match[1]}`;
  }
  for (const [family, regex] of PREFIX_STEM_REGEXES) {
    const match = stem.match(regex);
    if (match) return match[1] ? `${match[1]}-${family}-${match[2]}` : `${family}-${match[2]}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Numeric identity (leading-zero-tolerant). Independent of the family
// grammar above -- REQ-001 and REQ-0001 are one id whether or not the
// blueprint machinery is in play.
// ---------------------------------------------------------------------------

/**
 * Strip leading zeros from a run of digits without going through Number
 * (precision-safe for arbitrarily long numeric segments).
 *
 * @param {string} digits
 * @returns {string}
 */
function stripLeadingZeros(digits) {
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  return trimmed.length > 0 ? trimmed : '0';
}

/**
 * Canonical form of an RCF id for identity comparison. Two ids are the
 * same id if and only if their normalised forms are equal.
 *
 * @param {unknown} id
 * @returns {string} normalised id, or '' when the input is not a string
 */
export function normaliseId(id) {
  if (typeof id !== 'string') return '';
  return id
    .split('-')
    .map((segment) => (/^\d+$/.test(segment) ? stripLeadingZeros(segment) : segment))
    .join('-');
}

/**
 * Identity comparison for two RCF ids, tolerant of leading-zero spelling.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function sameId(a, b) {
  const na = normaliseId(a);
  return na.length > 0 && na === normaliseId(b);
}

/**
 * Numeric value of an id's first numeric segment after the prefix, or
 * null when the id does not match `<PREFIX>-<digits>`. Used by the
 * allocator to reason about id numbers independently of their spelling.
 *
 * @param {unknown} id
 * @param {string} prefix - e.g. 'REQ', 'US'
 * @returns {number|null}
 */
export function idNumber(id, prefix) {
  if (typeof id !== 'string') return null;
  const m = new RegExp(`^${prefix}-(\\d+)(?:-|$)`).exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}
