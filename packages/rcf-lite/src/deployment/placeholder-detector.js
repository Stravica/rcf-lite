// Canonical placeholder-credential-shape detector for the deployment-gate
// class cure (spa-US-1132 / TAC-210, w-2026-08-24-006).
//
// The watchpost first production review (w-2026-08-24-005) shipped with
// RESEND_API_KEY set to a placeholder value; the only login path (magic-link
// email) was inert; sign-off still said DEPLOYED. The gap was filed as a
// "quirk" note in status.md rather than blocked at gate time. This module
// owns the one canonical placeholder shape catalogue rcf-lite ships so
// downstream projects (via TAC-210 realisations) apply the same detector
// - extending the ruleset is a rcf-lite minor bump, never a per-project
// reinvention.
//
// The catalogue is deliberately narrow: only credential-shape strings a
// developer would reasonably type as a stand-in ("YOUR_API_KEY_HERE",
// "changeme", "xxx", empty). It does NOT try to classify all bad values;
// entropy checks, provider-specific prefix rules, and format regexes live
// in project-authored probes. This catalogue is what would have refused
// the watchpost RESEND_API_KEY at gate time.

/**
 * @typedef {object} PlaceholderMatch
 * @property {'empty'|'single-dash'|'null-token'|'you-here'|'named-stand-in'|'repeat-char'} pattern
 *   The named pattern that matched. Callers surface this on their report
 *   so a refusal message can name why.
 */

/**
 * @typedef {object} PlaceholderVerdict
 * @property {boolean} isPlaceholder     true when the value matches a placeholder shape
 * @property {PlaceholderMatch['pattern']} [pattern]  the matched pattern name, when isPlaceholder is true
 * @property {string} [reason]           a short refusal-message-ready reason string
 */

// Case-insensitive named stand-ins a developer would reasonably type. The
// set is intentionally small; adding to it is a rcf-lite minor bump, and
// the additions land in ONE place downstream projects inherit.
const NAMED_STAND_INS = new Set([
  'changeme',
  'placeholder',
  'example',
  'test',
  'dummy',
  'fake',
  'todo',
  'tbd',
  'sample',
  'default',
]);

// `YOUR_X_HERE`, `your-key-here`, etc. Case-insensitive.
const YOU_HERE_RE = /^your[_-].+[_-]here$/i;

// Repeated single characters ("xxxx", "----", "0000") of length >= 3, or
// the literal "xxx+" family common in scaffolds.
const REPEAT_CHAR_RE = /^(.)\1{2,}$/;

// Literal null-token strings that leak in when a resolver hands back a
// nullish value stringified. `.env` files stringify unset values to the
// empty string, but a JS resolver that String()s an undefined lands
// "undefined" in the ship environment - that IS a placeholder, not a
// live credential.
const NULL_TOKENS = new Set(['null', 'undefined', 'none']);

/**
 * Detect whether `value` matches a placeholder-shape a credential value
 * would never legitimately hold. Deterministic; case-insensitive against
 * the named-stand-in catalogue and the `YOUR_X_HERE` pattern.
 *
 * The intent is a hard refusal filter, not a heuristic: every match is
 * something a developer typed as a stand-in and forgot to replace. False
 * positives are vanishingly unlikely; the shortest name-family entry is
 * six characters ("dummy" being five is the shortest, and no real credential
 * is a five-character English word); the repeat-char rule requires length
 * >= 3 so a two-character hash prefix does not match.
 *
 * @param {unknown} value  the raw credential-field value at ship time
 * @returns {PlaceholderVerdict}
 */
export function detectPlaceholderCredentialShape(value) {
  // Non-strings are not credentials the shipped runtime carries; skip.
  if (typeof value !== 'string') {
    return { isPlaceholder: false };
  }
  const raw = value;
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { isPlaceholder: true, pattern: 'empty', reason: 'empty or whitespace-only credential value' };
  }
  if (trimmed === '-' || trimmed === '_') {
    return { isPlaceholder: true, pattern: 'single-dash', reason: `credential value is the single-character stand-in "${trimmed}"` };
  }
  const lower = trimmed.toLowerCase();
  if (NULL_TOKENS.has(lower)) {
    return { isPlaceholder: true, pattern: 'null-token', reason: `credential value is the literal null-token string "${trimmed}"` };
  }
  if (YOU_HERE_RE.test(trimmed)) {
    return { isPlaceholder: true, pattern: 'you-here', reason: `credential value matches the YOUR_X_HERE scaffold pattern: "${trimmed}"` };
  }
  if (NAMED_STAND_INS.has(lower)) {
    return { isPlaceholder: true, pattern: 'named-stand-in', reason: `credential value is the named stand-in "${trimmed}"` };
  }
  if (REPEAT_CHAR_RE.test(trimmed)) {
    return { isPlaceholder: true, pattern: 'repeat-char', reason: `credential value is a repeated-single-character stand-in "${trimmed}"` };
  }
  return { isPlaceholder: false };
}

/**
 * The catalogue's stable identifier. Downstream probes surface this on
 * their report so the gate-failure trail names which detector version
 * refused the value. Extending the catalogue bumps this constant.
 */
export const PLACEHOLDER_DETECTOR_VERSION = '1.0.0';
