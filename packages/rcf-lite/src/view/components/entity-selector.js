// Shared EntitySelector (viewer UI refresh PR 3, decision 4): replaces
// the PRD's 109 inline requirement links with a compact header showing
// the total, a type-ahead jump input, and a row of area chips with
// counts that deep-link into the Requirements tab filtered by domain.
// Pure HTML string helper; the type-ahead behaviour (filter the list,
// Enter to jump) is wired by page-init.js.
//
// Markup shape:
//
//   <div class="rcf-entity-selector" data-rcf-entity-selector="requirements"
//        data-tab="requirements">
//     <div class="rcf-entity-selector-head">
//       <span class="rcf-entity-selector-total">109 requirements in 21 areas</span>
//     </div>
//     <div class="rcf-entity-selector-jump">
//       <input class="rcf-entity-selector-input" type="search"
//              placeholder="..." autocomplete="off"
//              aria-label="Jump to a requirement by id or title">
//       <div class="rcf-entity-selector-results" hidden></div>
//     </div>
//     <div class="rcf-entity-selector-facets" aria-label="Areas">
//       <a class="rcf-entity-selector-chip" href="#tab=requirements&domain=platform"
//          data-facet-key="domain" data-facet-value="platform">
//         platform <span class="rcf-badge rcf-badge--count"><span class="rcf-badge-value">17</span></span>
//       </a>
//       ...
//     </div>
//   </div>
//
// The payload (every entity's id, title, facet value) is serialised
// into a `<script type="application/json" class="rcf-entity-selector-data">`
// sibling so the jump input can filter without a network call.
// Decision 11 names `#entity=<id>` as the deep link target so a jump
// writes `#tab=<targetTab>&entity=<id>` (preserving the host query via
// the existing urlWithHash helper).

import { escapeHtml } from '../doc-renderers/helpers.js';
import { renderBadge } from './badge.js';

/**
 * @typedef {object} EntitySelectorItem
 * @property {string} id              document id (e.g. "REQ-002")
 * @property {string} title           display title
 * @property {string} [facet]         facet value (e.g. "platform")
 */

/**
 * @typedef {object} EntitySelectorFacet
 * @property {string} value           facet value (e.g. "platform")
 * @property {number} count           count of items in this facet
 * @property {string} [label]         optional display label (defaults to value)
 */

/**
 * @param {object} args
 * @param {string} args.hashKey                            selector slot name (e.g. "requirements")
 * @param {string} args.targetTab                          tab name used in hash writes (e.g. "requirements")
 * @param {string} args.facetKey                           hash key for area chips (e.g. "domain")
 * @param {EntitySelectorItem[]} args.items                every entity (for the jump input)
 * @param {EntitySelectorFacet[]} [args.facets]            ordered facet chips (if omitted, derived from items)
 * @param {string} [args.totalLabel]                       pre-rendered total line (e.g. "109 requirements in 21 areas")
 * @param {string} [args.placeholder]                      input placeholder
 * @param {string} [args.chipsLabel]                       muted lead-in above the chip row
 * @returns {string}
 */
export function renderEntitySelector({
  hashKey,
  targetTab,
  facetKey,
  items,
  facets,
  totalLabel,
  placeholder = 'Jump to an entity by id or title',
  chipsLabel = 'By area (click to open the tab filtered):',
}) {
  const safeItems = Array.isArray(items) ? items : [];
  const resolvedFacets = Array.isArray(facets) && facets.length > 0
    ? facets
    : deriveFacets(safeItems);
  const total = totalLabel
    ?? `${safeItems.length} ${safeItems.length === 1 ? 'item' : 'items'} in ${resolvedFacets.length} ${resolvedFacets.length === 1 ? 'area' : 'areas'}`;

  const chipBlocks = resolvedFacets.map((f) => {
    const label = f.label ?? f.value;
    const hash = `#tab=${encodeURIComponent(targetTab)}&${encodeURIComponent(facetKey)}=${encodeURIComponent(f.value)}`;
    const count = renderBadge({ value: f.count, variant: 'count' });
    return `<a class="rcf-entity-selector-chip" href="${escapeHtml(hash)}" data-facet-key="${escapeHtml(facetKey)}" data-facet-value="${escapeHtml(f.value)}"><span class="rcf-entity-selector-chip-label">${escapeHtml(label)}</span> ${count}</a>`;
  }).join('\n        ');

  const payload = JSON.stringify(safeItems.map((it) => ({
    id: it.id,
    title: it.title ?? '',
    facet: it.facet ?? '',
  })));
  // JSON embedded inside a <script type="application/json"> block:
  // encode </ to the escape sequence \u003c/ so an interior </script>
  // in a title can never close the host script tag. HTML comment
  // openers get the same treatment.
  const encodedPayload = payload
    .replace(/<\//g, '\\u003c/')
    .replace(/<!--/g, '\\u003c!--');

  return `<div class="rcf-entity-selector" data-rcf-entity-selector="${escapeHtml(hashKey)}" data-target-tab="${escapeHtml(targetTab)}" data-facet-key="${escapeHtml(facetKey)}">
      <div class="rcf-entity-selector-head">
        <span class="rcf-entity-selector-total">${escapeHtml(total)}</span>
      </div>
      <div class="rcf-entity-selector-jump">
        <input class="rcf-entity-selector-input" type="search" placeholder="${escapeHtml(placeholder)}" autocomplete="off" aria-label="${escapeHtml(placeholder)}">
        <div class="rcf-entity-selector-results" hidden role="listbox"></div>
      </div>
      <div class="rcf-entity-selector-facets-lead muted small">${escapeHtml(chipsLabel)}</div>
      <div class="rcf-entity-selector-facets" aria-label="Areas">
        ${chipBlocks}
      </div>
      <script type="application/json" class="rcf-entity-selector-data">${encodedPayload}</script>
    </div>`;
}

/**
 * Derive facet chips (value + count) from the item list when the caller
 * does not pass an explicit facet order. Facets sort by count desc,
 * then by value asc. Items with an empty facet are dropped.
 *
 * @param {EntitySelectorItem[]} items
 * @returns {EntitySelectorFacet[]}
 */
function deriveFacets(items) {
  const counts = new Map();
  for (const it of items) {
    const v = it.facet;
    if (typeof v !== 'string' || v.length === 0) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const out = [];
  for (const [value, count] of counts.entries()) out.push({ value, count });
  out.sort((a, b) => (b.count - a.count) || a.value.localeCompare(b.value));
  return out;
}
