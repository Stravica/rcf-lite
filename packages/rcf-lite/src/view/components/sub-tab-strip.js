// Shared SubTabStrip (viewer UI refresh PR 2, design doc section 4):
// the one-row chip strip that sits inside a tab panel and switches
// sub-views (Build tab's Specs | DAG in PR 5-6). Writes `sub=` into
// the owning tab's hash slot via the `hashKey` argument; the Router
// in page-init.js owns the read.
//
// Markup shape:
//   <nav class="rcf-subtabs subtabs" aria-label="Sub-sections"
//        data-rcf-subtabstrip="{hashKey}">
//     <button type="button" role="tab" data-sub="{item.key}"
//             aria-selected="true|false">{item.label}</button>
//     ...
//   </nav>

import { escapeHtml } from '../doc-renderers/helpers.js';

/**
 * @typedef {object} SubTabItem
 * @property {string} key                   value written into `sub=`
 * @property {string} label
 * @property {string} [controls]            optional id of the panel this item controls
 */

/**
 * @param {object} args
 * @param {string} args.hashKey             owning tab (e.g. "build")
 * @param {SubTabItem[]} args.items
 * @param {string} [args.active]            key of the item to mark as active
 * @returns {string}
 */
export function renderSubTabStrip({ hashKey, items, active }) {
  const effectiveActive = active ?? (items[0]?.key ?? '');
  const buttons = items.map((item) => {
    const isActive = item.key === effectiveActive;
    const controlsAttr = item.controls
      ? ` aria-controls="${escapeHtml(item.controls)}"`
      : '';
    return `<button type="button" role="tab" data-sub="${escapeHtml(item.key)}"${controlsAttr} aria-selected="${isActive ? 'true' : 'false'}">${escapeHtml(item.label)}</button>`;
  }).join('\n    ');
  return `<nav class="rcf-subtabs subtabs" role="tablist" aria-label="Sub-sections" data-rcf-subtabstrip="${escapeHtml(hashKey)}">
    ${buttons}
  </nav>`;
}
