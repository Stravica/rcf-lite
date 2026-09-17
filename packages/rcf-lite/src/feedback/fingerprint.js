// Feedback fingerprint (TAC-4104-feedback-fingerprint, ADR-4102).
// Deterministic 12-hex fingerprint per entry that keys the same-defect
// fold when the submit path (slice 4) files issues.
//
// Canonical input (design section 6):
//   sha-256("<kind>|<targetKey>|<anchor>|<symptomClass>") -> first 12 hex
// where
//   - targetKey is the effective slug for blueprints (no version) or
//     the verb path for core; a target that came in as
//     `prefix:slug` is normalised to `prefix-slug`.
//   - anchor is upper-cased, or `-` when absent.
//   - symptomClass is one of the closed enum.
//
// Fallback (when the entry has no anchor): the canonical input becomes
//   sha-256("<kind>|<targetKey>|<symptomClass>|<normalisedTitle>")
// where normalisedTitle is the first eight tokens of the title
// lower-cased, punctuation stripped and stop-words removed.
//
// Blueprint version is not part of the fingerprint (§6, §9) so a
// defect that persists across versions folds into one issue with the
// versions in the comments.

import { createHash } from 'node:crypto';

/** Length of the truncated fingerprint (hex chars). */
export const FINGERPRINT_HEX_LEN = 12;

/** Cheap English stop-word list used by the fallback title tokeniser. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'in', 'on', 'at',
  'to', 'for', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'it', 'this', 'that', 'these', 'those', 'as', 'by', 'with', 'from',
  'into', 'over', 'under', 'up', 'down', 'not', 'no', 'do', 'does',
  'did', 'has', 'have', 'had',
]);

/**
 * Compute an entry fingerprint. Accepts the entry shape written by
 * `rcf feedback add` (see src/feedback/store.js FeedbackEntry) and
 * emits a 12-hex string keyed on the fields listed above.
 *
 * @param {object} entry
 * @returns {string} 12 lower-case hex chars
 */
export function fingerprint(entry) {
  const input = fingerprintInput(entry);
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, FINGERPRINT_HEX_LEN);
}

/**
 * Return the exact canonical string that hashes to the fingerprint.
 * Exposed for the disclosure line on `preview` and for the test
 * corpus, so a maintainer can reproduce the value by hand.
 *
 * @param {object} entry
 * @returns {string}
 */
export function fingerprintInput(entry) {
  const kind = String(entry?.kind ?? '').toLowerCase();
  const targetKey = deriveTargetKey(entry);
  const anchor = normaliseAnchor(entry?.anchor);
  const symptomClass = String(entry?.symptomClass ?? 'other');
  if (anchor === '-') {
    const normalisedTitle = normaliseTitle(entry?.title ?? '');
    return `${kind}|${targetKey}|${symptomClass}|${normalisedTitle}`;
  }
  return `${kind}|${targetKey}|${anchor}|${symptomClass}`;
}

/**
 * Derive the targetKey portion of the canonical input.
 *
 *   blueprint: effectiveSlug from the entry.target if present, else
 *              a normalised form of the ref (`wsd:std-error-envelope`
 *              becomes `wsd-std-error-envelope`; already-dashed
 *              refs pass through unchanged).
 *   core:      the verb path from entry.target.ref, lower-cased with
 *              whitespace collapsed to single spaces.
 *
 * @param {object} entry
 * @returns {string}
 */
export function deriveTargetKey(entry) {
  const t = entry?.target ?? {};
  const kind = String(entry?.kind ?? '').toLowerCase();
  if (kind === 'blueprint') {
    if (typeof t.effectiveSlug === 'string' && t.effectiveSlug.length > 0) {
      return t.effectiveSlug;
    }
    const ref = String(t.ref ?? '');
    if (ref.includes(':')) return ref.replace(':', '-');
    return ref;
  }
  const ref = String(t.ref ?? '');
  return ref.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Normalise the anchor: upper-case, trim; return `-` when the value
 * is nullish, empty or whitespace-only.
 *
 * @param {string | null | undefined} anchor
 * @returns {string}
 */
export function normaliseAnchor(anchor) {
  if (anchor == null) return '-';
  const trimmed = String(anchor).trim();
  if (trimmed === '') return '-';
  return trimmed.toUpperCase();
}

/**
 * Normalise a title for the fallback fingerprint: lower-case, strip
 * punctuation, remove stop-words, keep the first eight remaining
 * tokens joined by single spaces.
 *
 * @param {string} title
 * @returns {string}
 */
export function normaliseTitle(title) {
  // F-slice-2-11: normalise every non-ASCII dash variant (em, en,
  // figure, horizontal bar, hyphen, non-breaking hyphen, minus) to
  // an ASCII hyphen first, then strip ALL punctuation including
  // ASCII hyphens. "probe-fails" and its em-dash sibling
  // "probe—fails" then hash the same.
  const dashNormalised = String(title ?? '').replace(/[‐-―−-]/g, ' ');
  const lowered = dashNormalised.toLowerCase();
  const cleaned = lowered.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned === '') return '';
  const tokens = cleaned.split(' ').filter((t) => t.length > 0 && !STOP_WORDS.has(t));
  return tokens.slice(0, 8).join(' ');
}
