// Shared DocRow collapsible (viewer UI refresh PR 2, decision 2 / w-
// 2026-10-02-dave-010): one markup shape for every per-document row on
// every list tab (REQ, US, TAC, ADR, FBS). Closed by default, hidden-
// by-filter via `[hidden]`, deep-link-navigable via `data-doc-id` and
// the raw document id as the anchor.
//
// Shape:
//   <details class="rcf-row doc-row {className}" data-doc-id="{id}" [open]>
//     <summary>
//       <span class="id">{id}</span>
//       <span class="title">{title}</span>
//       <span class="meta">{meta badges / pill}</span>
//     </summary>
//     <div class="rcf-row-body body">
//       {body}
//     </div>
//   </details>
//
// The .doc-row prefix lets later tab-side migrations (PR 3-6) swap
// `detailsWrap` for `renderDocRow` while leaving the existing CSS
// selectors (`details.doc-details`) alone until each tab lands. PR 2
// ships the markup and the matching .rcf-row stylesheet rules; no tab
// is cut over here. The fixture page (/_fixtures/components) is where
// the component is exercised in isolation.

import { escapeHtml } from '../doc-renderers/helpers.js';

/**
 * @param {object} args
 * @param {string} args.id                    display doc id (e.g. "REQ-002")
 * @param {string} args.title                 one-line label (right of the id)
 * @param {string} [args.body]                rendered body HTML (empty for a header-only row)
 * @param {string} [args.className]           extra class applied to the <details>
 * @param {boolean} [args.open]               initial open state (default: closed)
 * @param {string} [args.dataDocId]           override the id used for `data-doc-id` (defaults to args.id)
 * @param {string} [args.meta]                pre-rendered meta HTML (badges + pill) shown right of the title
 * @returns {string}
 */
export function renderDocRow({
  id,
  title,
  body = '',
  className = '',
  open = false,
  dataDocId,
  meta = '',
}) {
  const classes = ['rcf-row', 'doc-row'];
  if (className) classes.push(String(className));
  const openAttr = open ? ' open' : '';
  const anchorId = dataDocId ?? id;
  return `<details class="${classes.join(' ')}" data-doc-id="${escapeHtml(anchorId)}"${openAttr}>
  <summary>
    <span class="id">${escapeHtml(id)}</span>
    <span class="title">${escapeHtml(title ?? '')}</span>
    ${meta ? `<span class="meta">${meta}</span>` : ''}
  </summary>
  <div class="rcf-row-body body">
    ${body}
  </div>
</details>`;
}
