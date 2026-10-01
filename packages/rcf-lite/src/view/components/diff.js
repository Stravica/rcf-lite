// Shared diff component (REQ-181, TAC-4127-readiness-view). Renders a
// two-column before-and-after of two document bodies for the delta
// list on the Readiness tab. Document-level only in 0.29.0;
// criterion-level before-and-after is deferred per ADR-4127 (open
// question 7 of the DEFINE step 2 spec).

import { escapeHtml } from '../doc-renderers/helpers.js';

/**
 * Render a two-column before-and-after. Either side may be null or a
 * string. When null, the column shows an `(absent)` placeholder so an
 * added document still renders.
 *
 * @param {string | null | undefined} before - serialised before body
 * @param {string | null | undefined} after - serialised after body
 * @returns {string}
 */
export function diff(before, after) {
  const beforeHtml = typeof before === 'string' && before.length > 0
    ? `<pre class="rcf-diff__pre">${escapeHtml(before)}</pre>`
    : `<p class="rcf-diff__absent"><em>(absent)</em></p>`;
  const afterHtml = typeof after === 'string' && after.length > 0
    ? `<pre class="rcf-diff__pre">${escapeHtml(after)}</pre>`
    : `<p class="rcf-diff__absent"><em>(absent)</em></p>`;
  return `<div class="rcf-diff">`
    + `<div class="rcf-diff__col rcf-diff__col--before"><h5>Before</h5>${beforeHtml}</div>`
    + `<div class="rcf-diff__col rcf-diff__col--after"><h5>After</h5>${afterHtml}</div>`
    + `</div>`;
}
