// UI seed pattern set - single source of truth for UI-shape detection.
//
// Consumed by:
//   - `packages/build/src/ui-detection/classifier.js` (Track B UI-bearing FBS
//     classifier, ui-design-gate-0.7.0-spec §4.3).
//   - `packages/core/src/patterns/req-shapes.js` (Track C+D REQ-shape
//     classifier's `webUi` shape, elicitation-and-playbook-hardening-0.7.0
//     spec §4.3, which requires this file as its single source of truth for
//     the Web UI signal).
//
// The pattern set is data, not a classifier: consumers own the "what field
// did the signal come from" packaging and the shape of the returned
// `signals[]` array on the FBS / REQ `*Classification` block. This module
// exposes the categorised keyword sets plus a convenience matcher.
//
// Match rules per spec §4.3:
//   - Case-insensitive.
//   - Word-boundary anchored so `nav` does not match inside `navigate` when
//     the word-boundary hits (regex `\b` handles that).
//   - Any single match triggers the classifier's `ui` verdict (match count
//     is not a threshold; false positives are cheap, false negatives are the
//     failure mode).
//   - Sentences containing an excluded phrase from `UI_EXCLUDED_PHRASES`
//     have their signals suppressed (avoids the API-endpoint / CLI /
//     JSON-response false positive class); ambiguous cases favour `ui`.

/**
 * @typedef {'explicitUiNouns'|'htmlRenderVerbs'|'responseShapeSignals'|'authFlowSignals'|'accessibilitySignals'} UiSeedCategory
 */

/**
 * @typedef {object} UiSignalMatch
 * @property {UiSeedCategory} category
 * @property {string} pattern      the source pattern string that matched
 * @property {string} match        the exact substring the pattern captured
 * @property {number} index        offset of the match inside `text`
 */

// Categorised keyword sets. Each entry is a regex source string (no flags,
// no anchors); the matcher below wraps them with `\b<source>\b` and the
// `gi` flags at scan time so consumers cannot accidentally use the raw
// source without word boundaries.
export const UI_SEED_PATTERNS_V1 = Object.freeze({
  explicitUiNouns: Object.freeze([
    'web ui', 'browser', 'page', 'dashboard', 'admin', 'screen', 'form',
    'route', 'nav', 'navigation', 'layout', 'style', 'theme',
    'dark mode', 'light mode',
    'component', 'button', 'table', 'badge', 'header', 'footer',
    'sidebar', 'modal', 'tooltip',
  ]),
  htmlRenderVerbs: Object.freeze([
    'render(?:ed|s|ing)?',
    'display(?:ed|s|ing)?',
    'shows?',
    'visible',
    'see(?:s|ing)?',
    'click(?:s|ed|ing)?',
    'tap(?:s|ped|ping)?',
  ]),
  responseShapeSignals: Object.freeze([
    'HTML',
    'markup',
    'template',
    'view',
    'serve.*page',
    'content-type.*text/html',
  ]),
  authFlowSignals: Object.freeze([
    'login form',
    'sign(?:-|\\s)?in page',
    'logout button',
    'password reset page',
    'magic(?:-|\\s)?link (?:page|landing)',
  ]),
  accessibilitySignals: Object.freeze([
    'contrast',
    'WCAG',
    'screen reader',
    'keyboard nav',
    'focus ring',
    'aria-',
  ]),
});

// Sentences containing any of these phrases have their UI signals
// suppressed. Guards against the API-endpoint / CLI / JSON-response false
// positive class named in spec §4.3.
export const UI_EXCLUDED_PHRASES = Object.freeze([
  'API endpoint',
  'CLI command',
  'shell prompt',
  'JSON response',
]);

// Split `text` into rough sentence-shaped chunks. Boundary is `.!?` plus a
// line break; keeps the trailing terminator with the sentence so length /
// index stays useful for downstream reporting. Deliberately unaware of
// English abbreviations (`e.g.`, `i.e.`, `Dr.`); the excluded-phrase filter
// is intended as a coarse noise gate, not a linguistic parser.
function splitIntoSentences(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const chunks = [];
  const re = /[^.!?\n]+[.!?\n]?/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const chunk = match[0];
    const start = match.index;
    const end = start + chunk.length;
    const trimmed = chunk.trim();
    if (trimmed.length > 0) chunks.push({ text: chunk, start, end });
  }
  return chunks;
}

function sentenceContainsExcluded(sentence) {
  const lower = sentence.toLowerCase();
  for (const phrase of UI_EXCLUDED_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) return true;
  }
  return false;
}

/**
 * Scan `text` against `UI_SEED_PATTERNS_V1` and return every match, in
 * document order, with the pattern that produced it. Sentences containing
 * any `UI_EXCLUDED_PHRASES` phrase are skipped in full per spec §4.3.
 *
 * @param {string} text
 * @returns {UiSignalMatch[]}
 */
export function matchUiSignals(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  /** @type {UiSignalMatch[]} */
  const results = [];
  const sentences = splitIntoSentences(text);
  // Fall back to the whole text as a single "sentence" when the regex
  // parse produced nothing (e.g. a text without terminators).
  if (sentences.length === 0) sentences.push({ text, start: 0, end: text.length });
  for (const sentence of sentences) {
    if (sentenceContainsExcluded(sentence.text)) continue;
    for (const category of Object.keys(UI_SEED_PATTERNS_V1)) {
      for (const pattern of UI_SEED_PATTERNS_V1[category]) {
        // Leading `\b` prevents matching inside a longer word (e.g. `nav`
        // inside `navigate`); NO trailing `\b`, so stem-suffixed forms
        // (`shows`, `dashboards`, `delivers`) still match. Spec §4.3
        // over-collects by design; false-positive cost is one operator
        // override, false-negative cost is a dated UI shipping unnoticed.
        const re = new RegExp(`\\b${pattern}`, 'gi');
        let m;
        while ((m = re.exec(sentence.text)) !== null) {
          results.push({
            category,
            pattern,
            match: m[0],
            index: sentence.start + m.index,
          });
          if (m.index === re.lastIndex) re.lastIndex += 1; // safety for zero-width
        }
      }
    }
  }
  // Document-order stable sort (matches happen sentence-by-sentence, then
  // pattern-by-pattern; sort restores overall offset order).
  results.sort((a, b) => a.index - b.index);
  return results;
}
