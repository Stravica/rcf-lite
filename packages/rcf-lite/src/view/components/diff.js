// Shared diff component (REQ-181, TAC-4127-readiness-view). Renders a
// two-column before-and-after of two document bodies for the delta
// list on the Readiness tab. Document-level only in 0.29.0;
// criterion-level before-and-after is deferred per ADR-4127 (open
// question 7 of the DEFINE step 2 spec).
//
// Each side may be:
//   - null / undefined    renders an `(absent)` placeholder
//   - a string            renders as a <pre> body
//   - an object           `{ hash?, text?, note? }` renders an optional
//                         short-hash subtitle, then `text` as a <pre>
//                         body, OR `note` as a muted <p>, OR the
//                         `(absent)` placeholder when both are empty.
// The object form is what the Readiness tab's hash-only document-level
// diff passes in 0.29.0: the frozen body is not persisted in the freeze
// record, so the before column renders the frozen short-hash + a
// "frozen body not captured" note; the after column renders the
// current short-hash + the serialised current body.

import { escapeHtml } from '../doc-renderers/helpers.js';

/**
 * @typedef {object} DiffSide
 * @property {string} [hash]   full-length hash (e.g. 'sha256:abc...'),
 *   rendered as the short form in a subtitle
 * @property {string} [text]   serialised body
 * @property {string} [note]   muted note shown when `text` is absent
 */

/**
 * @param {string | DiffSide | null | undefined} before
 * @param {string | DiffSide | null | undefined} after
 * @returns {string}
 */
export function diff(before, after) {
  return `<div class="rcf-diff">`
    + `<div class="rcf-diff__col rcf-diff__col--before"><h5>Before</h5>${renderSide(before)}</div>`
    + `<div class="rcf-diff__col rcf-diff__col--after"><h5>After</h5>${renderSide(after)}</div>`
    + `</div>`;
}

function renderSide(side) {
  if (typeof side === 'string') {
    return side.length > 0
      ? `<pre class="rcf-diff__pre">${escapeHtml(side)}</pre>`
      : `<p class="rcf-diff__absent"><em>(absent)</em></p>`;
  }
  if (side && typeof side === 'object') {
    const parts = [];
    if (typeof side.hash === 'string' && side.hash.length > 0) {
      parts.push(`<p class="rcf-diff__hash"><code>${escapeHtml(shortHash(side.hash))}</code></p>`);
    }
    if (typeof side.text === 'string' && side.text.length > 0) {
      parts.push(`<pre class="rcf-diff__pre">${escapeHtml(side.text)}</pre>`);
    } else if (typeof side.note === 'string' && side.note.length > 0) {
      parts.push(`<p class="rcf-diff__note"><em>${escapeHtml(side.note)}</em></p>`);
    } else if (typeof side.hash !== 'string' || side.hash.length === 0) {
      parts.push(`<p class="rcf-diff__absent"><em>(absent)</em></p>`);
    }
    return parts.join('');
  }
  return `<p class="rcf-diff__absent"><em>(absent)</em></p>`;
}

function shortHash(hash) {
  if (typeof hash !== 'string') return '';
  const colonIdx = hash.indexOf(':');
  const body = colonIdx >= 0 ? hash.slice(colonIdx + 1) : hash;
  const short = body.slice(0, 7);
  const prefix = colonIdx >= 0 ? `${hash.slice(0, colonIdx)}:` : '';
  return `${prefix}${short}`;
}
