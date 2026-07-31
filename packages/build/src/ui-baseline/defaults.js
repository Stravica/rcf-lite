// Ruled UI-baseline defaults (ui-design-gate-0.7.0-spec §6.1).
//
// Every value is Baz-ruled (Entry 5 of the 2026-07-29 cold-run operator
// feedback log) or a §4.3 mandate from the review-phase analysis. The
// `rcf ui-baseline init` verb presents these values as the defaults;
// the operator accepts (silence is NOT an opt-out) or overrides with a
// reason via `operatorOptOuts[]` (spec §6.2).
//
// Editing this catalogue is a spec-level change: baseline evolution
// happens via `rcf ui-baseline opt-out` per project, or a new spec
// revision.

/**
 * @typedef {object} UiBaselineFieldSpec
 * @property {string} path       dot-path into `uiBaseline.defaults` (for opt-out records + refusal messages)
 * @property {*} value           the ruled value (the "present as default" for interactive init)
 * @property {string} label      operator-facing short label (used in the summary screen)
 * @property {string} rulingSource brief citation for provenance
 */

/**
 * The v1 defaults catalogue. Ordered for stable presentation on the
 * interactive summary screen: theme + layout first (most visible),
 * then contrast + a11y, then typography + interaction, then auth flow.
 * @type {UiBaselineFieldSpec[]}
 */
export const UI_BASELINE_DEFAULTS_V1 = Object.freeze([
  { path: 'themeMode', value: 'light-default-with-toggle', label: 'Theme mode', rulingSource: 'Baz Entry 5' },
  { path: 'sharedLayoutModule', value: 'src/ui/layout.ts', label: 'Shared layout module', rulingSource: 'Baz Entry 5 + review-phase mandate 3' },
  { path: 'designTokensModule', value: 'src/ui/tokens.ts', label: 'Design tokens module', rulingSource: 'review-phase mandate 1' },
  { path: 'noHexInViewFiles', value: true, label: 'No hex literals in view files', rulingSource: 'review-phase mandate 1' },
  { path: 'contrastTarget', value: 'WCAG AA', label: 'Contrast target', rulingSource: 'Baz Entry 5 + review-phase mandate 6' },
  { path: 'contrastTestBeforePalette', value: true, label: 'Contrast test authored before palette', rulingSource: 'review-phase mandate 10' },
  { path: 'focusRingsRequired', value: true, label: 'Focus rings required', rulingSource: 'review-phase mandate 6' },
  { path: 'hoverStatesRequired', value: true, label: 'Hover states required', rulingSource: 'review-phase mandate 8' },
  { path: 'componentVocabulary.declaredComponents', value: ['Button', 'Input', 'Card', 'Badge', 'Table', 'Notice'], label: 'Component vocabulary', rulingSource: 'review-phase mandate 5' },
  { path: 'componentVocabulary.singleBadgeShape', value: true, label: 'Single badge shape', rulingSource: 'review-phase mandate 5' },
  { path: 'typography.baseFontStack', value: 'system-ui', label: 'Base font stack', rulingSource: 'review-phase mandate 7' },
  { path: 'typography.bodyLineHeight', value: 1.5, label: 'Body line height', rulingSource: 'review-phase mandate 7' },
  { path: 'typography.headingLineHeight', value: 1.25, label: 'Heading line height', rulingSource: 'review-phase mandate 7' },
  { path: 'typography.proseMaxWidth', value: '72ch', label: 'Prose max width', rulingSource: 'review-phase mandate 7' },
  { path: 'interactionDefaults.loadingIndicatorOnFetch', value: true, label: 'Loading indicator on fetch', rulingSource: 'review-phase mandate 8' },
  { path: 'interactionDefaults.disabledStateVisuallyDistinct', value: true, label: 'Disabled state visually distinct', rulingSource: 'review-phase mandate 8' },
  { path: 'authFlow.htmlLoginPageRequired', value: true, label: 'HTML login page required', rulingSource: 'review-phase mandate 9 + Baz "real login flow"' },
  { path: 'authFlow.smokeChecksRequired', value: true, label: 'Auth-REQ smoke checks required', rulingSource: 'review-phase recommendation 9' },
]);

/**
 * Deep-set a value at a dot-path on a plain object. Intermediate
 * objects are created as needed. Arrays are copied (not shared with
 * the caller). Returns the mutated top-level object for chaining.
 *
 * @param {object} obj
 * @param {string} path  dot-path (e.g. `componentVocabulary.declaredComponents`)
 * @param {*} value
 * @returns {object}
 */
export function deepSet(obj, path, value) {
  const parts = String(path).split('.');
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (typeof cursor[key] !== 'object' || cursor[key] === null || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  const last = parts[parts.length - 1];
  cursor[last] = Array.isArray(value) ? [...value] : value;
  return obj;
}

/**
 * Deep-get a value at a dot-path. Returns `undefined` when any
 * intermediate segment is absent.
 *
 * @param {object} obj
 * @param {string} path
 * @returns {*}
 */
export function deepGet(obj, path) {
  const parts = String(path).split('.');
  let cursor = obj;
  for (const key of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

/**
 * Compose the ruled defaults object from the v1 catalogue. Every field
 * carries its Baz-ruled value; caller overrides land under
 * `operatorOptOuts[]` on the surrounding record.
 *
 * @param {object} [overrides]  dot-path -> value overrides (used by preflight seam pickup)
 * @returns {object}
 */
export function composeDefaults(overrides = {}) {
  const out = {};
  for (const spec of UI_BASELINE_DEFAULTS_V1) {
    deepSet(out, spec.path, spec.value);
  }
  for (const [path, value] of Object.entries(overrides ?? {})) {
    deepSet(out, path, value);
  }
  return out;
}

/**
 * True when the given dot-path is a known baseline field. Used by
 * `rcf ui-baseline opt-out` to refuse writes to non-existent fields.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isKnownBaselinePath(path) {
  return UI_BASELINE_DEFAULTS_V1.some((s) => s.path === path);
}
