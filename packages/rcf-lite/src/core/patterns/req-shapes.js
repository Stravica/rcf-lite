// REQ-shape seed pattern set - single source of truth for REQ-shape
// classification.
//
// Consumed by `packages/rcf-lite/src/req-detection/classifier.js` (Track C+D
// classifier, elicitation-and-playbook-hardening-0.7.0-spec §4.3), which
// walks each in-scope field (`title`, `description`, `rationale` on the
// REQ, plus parent PRD `intent` / `problem` as fallback context), matches
// against every shape's pattern list, and records the matched signals on
// `req.shapeClassification.signals[]`.
//
// The `webUi` shape imports `UI_SEED_PATTERNS_V1` from
// `./ui-shapes.js` (Track B) so a UI signal is defined in ONE place across
// build's UI-bearing FBS classifier, Track C+D's Web UI REQ classifier and
// Track B's browser-verification invariants. When the UI pattern set moves,
// consumers move together.
//
// Match rules per spec §4.3:
//   - Case-insensitive.
//   - Word-boundary anchored on plain-letter patterns (the matcher wraps
//     each pattern with `\b<pattern>\b`).
//   - `shapes` are non-exclusive: a REQ can carry `[webUi, auth]` (e.g.
//     "sign-in page"). One shape per pattern list; the classifier layers
//     the matches from all lists.

import { UI_SEED_PATTERNS_V1 } from './ui-shapes.js';

/**
 * @typedef {'webUi'|'httpApi'|'auth'|'persistence'|'notifications'} ReqShape
 */

/**
 * @typedef {object} ReqShapeSignalMatch
 * @property {ReqShape} shape
 * @property {string} pattern       source pattern string
 * @property {string} match         exact substring matched
 * @property {number} index         offset inside `text`
 */

// Canonical shape id list. `none` is a legitimate REQ-level verdict but
// carries no pattern set (the classifier records `shapes: []` and derives
// `none` from the empty list); it is included here so downstream schemas
// can reference `SHAPE_KEYS_WITH_NONE` when they need the full enum.
export const SHAPE_KEYS = Object.freeze(['webUi', 'httpApi', 'auth', 'persistence', 'notifications']);
export const SHAPE_KEYS_WITH_NONE = Object.freeze([...SHAPE_KEYS, 'none']);

// Flatten the UI pattern set into a single array of pattern strings so
// the shape-classifier can use the same matcher for every shape. This
// preserves single-source-of-truth (both files reference
// `UI_SEED_PATTERNS_V1`); if Track B evolves the categories the flatten
// picks them up automatically.
function flattenUiSeedPatterns() {
  const patterns = [];
  for (const category of Object.keys(UI_SEED_PATTERNS_V1)) {
    for (const pattern of UI_SEED_PATTERNS_V1[category]) patterns.push(pattern);
  }
  return patterns;
}

// Non-webUi shape patterns. Each entry is a regex source string; the
// matcher wraps with `\b<pattern>\b` and the `gi` flags. Escaping caveats
// for maintainers: `\\s` in a source string escapes to `\s` in the regex;
// literal `.` inside a pattern (`serve.*page`, `webhook.*deliver`) is
// intentional wildcard, not a literal full stop.
const HTTP_API_PATTERNS = Object.freeze([
  'api', 'endpoint', 'REST', 'HTTP method',
  'POST', 'GET', 'PUT', 'DELETE',
  'webhook',
  'json (?:response|body|payload)',
  'rate limit', 'request body',
]);

const AUTH_PATTERNS = Object.freeze([
  'login',
  'sign(?:-|\\s)?in',
  'sign(?:-|\\s)?up',
  'logout',
  'session',
  'token',
  'credential',
  'password',
  'magic(?:-|\\s)?link',
  'api key',
  'authoriz(?:e|ation)',
  'permission',
  'role',
]);

const PERSISTENCE_PATTERNS = Object.freeze([
  'store',
  'storage',
  'persist(?:ed|ent|ing)?',
  'database',
  'table',
  'schema',
  'migration',
  'backup',
  'restore',
  'survives? (?:a )?restart',
  'durable',
]);

const NOTIFICATIONS_PATTERNS = Object.freeze([
  'notify',
  'notification',
  'alert',
  'email',
  'SMS',
  'push notification',
  'slack',
  'webhook.*deliver',
  'reminder',
]);

/**
 * The full REQ-shape seed pattern set. `webUi` is composed from the Track B
 * UI seed set at module load; the other shapes are declared inline. The
 * object is frozen so consumers cannot mutate the shared source.
 *
 * @type {Readonly<Record<ReqShape, readonly string[]>>}
 */
export const REQ_SHAPE_PATTERNS_V1 = Object.freeze({
  webUi: Object.freeze(flattenUiSeedPatterns()),
  httpApi: HTTP_API_PATTERNS,
  auth: AUTH_PATTERNS,
  persistence: PERSISTENCE_PATTERNS,
  notifications: NOTIFICATIONS_PATTERNS,
});

/**
 * Scan `text` against every REQ shape's pattern list and return each match
 * tagged with the shape it fed into. Sentence-level exclusion is NOT
 * applied here (unlike `matchUiSignals`, which filters API/CLI/JSON-response
 * false positives inside the UI classifier); the REQ-shape classifier
 * deliberately over-collects and defers the operator override per spec
 * §4.5.
 *
 * @param {string} text
 * @returns {ReqShapeSignalMatch[]}
 */
export function matchReqShapeSignals(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  /** @type {ReqShapeSignalMatch[]} */
  const results = [];
  for (const shape of Object.keys(REQ_SHAPE_PATTERNS_V1)) {
    for (const pattern of REQ_SHAPE_PATTERNS_V1[shape]) {
      // Leading `\b` only; stem-suffixed forms (`stores`, `logins`,
      // `webhook delivers`) match by design per the over-collect posture.
      const re = new RegExp(`\\b${pattern}`, 'gi');
      let m;
      while ((m = re.exec(text)) !== null) {
        results.push({ shape, pattern, match: m[0], index: m.index });
        if (m.index === re.lastIndex) re.lastIndex += 1;
      }
    }
  }
  results.sort((a, b) => a.index - b.index);
  return results;
}
