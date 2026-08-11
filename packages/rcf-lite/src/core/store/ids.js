// Id normalisation. The RCF id patterns in `@stravica-ai/rcf-schemas`
// admit a variable-width numeric run (`^REQ-\d{3,}$`, `^US-\d{3,}$`,
// `^AC-\d{3,}(-\d+)?$`, ...), so `REQ-001` and `REQ-0001` are BOTH legal
// and BOTH name requirement number 1. The schema is right to permit the
// widths -- an id space that outgrows three digits has to be expressible
// -- but two spellings of one number are one identity, not two.
//
// This module owns the single definition of "the same id" used by the
// walker's uniqueness rule (`globallyUniqueIds`) and by the writer's id
// allocator. Both sides MUST agree: detection that normalises while
// allocation does not just moves the collision one step later.
//
// Normalisation is per hyphen-delimited segment and only touches
// segments that are entirely digits:
//
//   REQ-001      -> REQ-1
//   REQ-0001     -> REQ-1        (collides with REQ-001, correctly)
//   AC-101-01    -> AC-101-1     (collides with AC-101-1, correctly)
//   TC-001-step2 -> TC-1-step2   (the slug segment is left alone)
//
// Leaving non-numeric segments untouched is deliberate: a TC slug like
// `step02` is a word, not a number, and must not be folded into `step2`.

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
