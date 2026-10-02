// Shared Badge component (viewer UI refresh PR 2, design doc section 4):
// a small, muted count or facet marker used in a DocRow's `meta` slot or
// anywhere else a numeric count / tag needs to ride beside a label. One
// markup shape, variant-driven styling:
//
//   <span class="rcf-badge rcf-badge--{variant}" [title?]>
//     [label] [value]
//   </span>
//
// Variants (and intent):
//   - count   : plain muted count ("3 US", "7 AC"); the default
//   - facet   : neutral tag chip (status filter facets, area labels)
//   - accent  : primary / link-coloured accent (buildable-now, open tally)
//
// `label` is optional and renders muted-left-of value when both are
// present ("US 3" -> label="US", value=3). An explicit `title` surfaces
// as a tooltip; the Pill component (shared PR 0.29) still handles
// pill-shaped status rendering.

import { escapeHtml } from '../doc-renderers/helpers.js';

const VARIANTS = new Set(['count', 'facet', 'accent']);

/**
 * @param {object} args
 * @param {string|number} args.value
 * @param {string} [args.label]
 * @param {string} [args.variant]  one of count | facet | accent (default: count)
 * @param {string} [args.title]
 * @returns {string}
 */
export function renderBadge({ value, label, variant = 'count', title }) {
  const v = VARIANTS.has(variant) ? variant : 'count';
  const classes = ['rcf-badge', `rcf-badge--${v}`];
  const titleAttr = typeof title === 'string' && title.length > 0
    ? ` title="${escapeHtml(title)}"`
    : '';
  const labelHtml = label ? `<span class="rcf-badge-label">${escapeHtml(label)}</span>` : '';
  const valueHtml = `<span class="rcf-badge-value">${escapeHtml(String(value ?? ''))}</span>`;
  return `<span class="${classes.join(' ')}"${titleAttr}>${labelHtml}${valueHtml}</span>`;
}
