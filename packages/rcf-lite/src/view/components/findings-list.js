// Shared findings-list component (REQ-181, TAC-4127-readiness-view).
// Renders a heading with a count badge plus an unordered list of
// `{ id, why, href? }` items. Ids are capped at 20, and the tail
// becomes a `... N more suppressed` line so a huge failing list stays
// legible. Pure; no I/O. (AC-18101-2.)

import { escapeHtml } from '../doc-renderers/helpers.js';

/**
 * @typedef {object} FindingsListItem
 * @property {string} id - document id (also the anchor label)
 * @property {string} [why] - one-line reason
 * @property {string} [href] - override anchor target; defaults to `#<id>`
 */

/**
 * @param {object} args
 * @param {string} args.heading - section heading text (plain)
 * @param {number} args.count - the total count to show in the badge
 *   (may exceed `items.length`; the component renders the suppressed
 *   tail from the delta)
 * @param {FindingsListItem[]} args.items - items to render (will be
 *   capped at the display limit)
 * @returns {string}
 */
export function findingsList({ heading, count, items }) {
  const cap = 20;
  const list = Array.isArray(items) ? items : [];
  const total = typeof count === 'number' && Number.isFinite(count) ? count : list.length;
  const shown = list.slice(0, cap);
  const liHtml = shown.map((item) => {
    const id = String(item?.id ?? '');
    const anchorHref = typeof item?.href === 'string' && item.href.length > 0
      ? item.href
      : `#${id}`;
    const why = typeof item?.why === 'string' && item.why.length > 0
      ? `: ${escapeHtml(item.why)}`
      : '';
    return `<li><a href="${escapeHtml(anchorHref)}">${escapeHtml(id)}</a>${why}</li>`;
  }).join('');
  const suppressedCount = Math.max(0, total - shown.length);
  const suppressedLi = suppressedCount > 0
    ? `<li class="rcf-findings-list__suppressed"><em>... ${suppressedCount} more suppressed</em></li>`
    : '';
  return `<div class="rcf-findings-list">`
    + `<h4>${escapeHtml(heading)} <span class="rcf-findings-list__count">${total}</span></h4>`
    + `<ul>${liHtml}${suppressedLi}</ul>`
    + `</div>`;
}
