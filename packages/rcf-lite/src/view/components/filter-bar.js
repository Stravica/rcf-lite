// Shared FilterBar (viewer UI refresh PR 2, decision 3): sticky bar
// under the tabstrip with a text query, facet selects, toggles, a live
// row count and an Expand / Collapse all control. Filter state lives
// in the hash so a filtered view is a link; the hashKey argument lets
// each tab own its own slice of the hash namespace (e.g. "requirements"
// writes #tab=requirements&q=...&area=...).
//
// Markup shape:
//
//   <div class="rcf-filterbar filterbar" data-rcf-filterbar="{hashKey}">
//     <input type="search" class="rcf-filter-text" placeholder="...">
//     <select class="rcf-filter-select" data-filter-key="area">...</select>
//     <label class="rcf-filter-toggle">
//       <input type="checkbox" data-filter-key="needsWork"> Needs work
//     </label>
//     <span class="rcf-filter-count count">N of M visible</span>
//     <button type="button" class="rcf-filter-expand linkish">Expand all</button>
//   </div>
//
// PR 2 ships the markup helper only; the hash-sync + list-filter wiring
// lives in page-init.js and ships with the first list tab that adopts
// FilterBar (PR 3, Requirements). The helper is pure HTML and has no
// behaviour of its own, so a later tab can mount it without a Router
// handshake.

import { escapeHtml } from '../doc-renderers/helpers.js';

/**
 * @typedef {object} FilterSelectSpec
 * @property {string} key                   facet key (e.g. "area", "status")
 * @property {string} label                 visible label
 * @property {Array<{ value: string, label: string }>} options
 * @property {string} [value]               initial selected value
 */

/**
 * @typedef {object} FilterToggleSpec
 * @property {string} key                   toggle key (e.g. "needsWork")
 * @property {string} label                 visible label
 * @property {boolean} [checked]            initial state
 */

/**
 * @param {object} args
 * @param {string} args.hashKey                              owning tab, used as the hash namespace
 * @param {string} [args.placeholder]                        text input placeholder
 * @param {string} [args.text]                               initial text value
 * @param {FilterSelectSpec[]} [args.selects]
 * @param {FilterToggleSpec[]} [args.toggles]
 * @param {{ visible: number, total: number }} [args.count]  initial count readout
 * @param {boolean} [args.showExpandAll]                     render the Expand / Collapse control
 * @returns {string}
 */
export function renderFilterBar({
  hashKey,
  placeholder = 'Search this list',
  text = '',
  selects = [],
  toggles = [],
  count,
  showExpandAll = true,
}) {
  const selectBlocks = selects.map((s) => {
    const options = (s.options ?? []).map((o) => {
      const selected = o.value === s.value ? ' selected' : '';
      return `<option value="${escapeHtml(o.value)}"${selected}>${escapeHtml(o.label)}</option>`;
    }).join('');
    return `<label class="rcf-filter-label">
      <span>${escapeHtml(s.label)}</span>
      <select class="rcf-filter-select" data-filter-key="${escapeHtml(s.key)}">${options}</select>
    </label>`;
  }).join('\n    ');

  const toggleBlocks = toggles.map((t) => {
    const checked = t.checked ? ' checked' : '';
    return `<label class="rcf-filter-toggle">
      <input type="checkbox" data-filter-key="${escapeHtml(t.key)}"${checked}>
      <span>${escapeHtml(t.label)}</span>
    </label>`;
  }).join('\n    ');

  const countBlock = count
    ? `<span class="rcf-filter-count count">${escapeHtml(String(count.visible))} of ${escapeHtml(String(count.total))} visible</span>`
    : '';

  const expandBlock = showExpandAll
    ? `<button type="button" class="rcf-filter-expand linkish" data-expand-state="collapsed">Expand all</button>`
    : '';

  return `<div class="rcf-filterbar filterbar" data-rcf-filterbar="${escapeHtml(hashKey)}">
    <input type="search" class="rcf-filter-text" value="${escapeHtml(text)}" placeholder="${escapeHtml(placeholder)}">
    ${selectBlocks}
    ${toggleBlocks}
    ${countBlock}
    ${expandBlock}
  </div>`;
}
