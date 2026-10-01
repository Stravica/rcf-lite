// Shared pill component (REQ-181, TAC-4127-readiness-view). One module,
// one markup shape: `<span class="rcf-pill rcf-pill--<variant>
// rcf-pill--<normalisedValue>" [title?]>{value}</span>`, or an `<a>`
// with the same classes when `href` is passed. The vocabulary families
// (gate state / level verdict / persona / AC class) all ride the same
// shape so a status reads the same on every tab (AC-18101-1).

import { escapeHtml } from '../doc-renderers/helpers.js';

/**
 * Normalise a value into a kebab-cased class suffix: lowercased with
 * `/`, whitespace and `_` collapsed to `-`. Everything outside
 * `[a-z0-9-]` is stripped. The caller controls what the display label
 * reads; this only touches the class suffix.
 *
 * @param {string} raw
 * @returns {string}
 */
function normaliseValue(raw) {
  const s = String(raw ?? '').toLowerCase().replace(/[\s/_]+/g, '-');
  return s.replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * @param {object} args
 * @param {string} args.value - display label (also drives the class suffix)
 * @param {string} args.variant - vocabulary family (e.g. `gate-state`,
 *   `level-verdict`, `persona`, `ac-class`). Also normalised into the
 *   class suffix for the family.
 * @param {string} [args.title] - optional tooltip text
 * @param {string} [args.href] - optional href; when set, renders an `<a>`
 * @returns {string}
 */
export function pill({ value, variant, title, href }) {
  const valueText = String(value ?? '');
  const variantClass = `rcf-pill--${normaliseValue(variant)}`;
  const valueClass = `rcf-pill--${normaliseValue(valueText)}`;
  const classes = `rcf-pill ${variantClass} ${valueClass}`.trim();
  const titleAttr = typeof title === 'string' && title.length > 0
    ? ` title="${escapeHtml(title)}"`
    : '';
  if (typeof href === 'string' && href.length > 0) {
    return `<a class="${classes}" href="${escapeHtml(href)}"${titleAttr}>${escapeHtml(valueText)}</a>`;
  }
  return `<span class="${classes}"${titleAttr}>${escapeHtml(valueText)}</span>`;
}
