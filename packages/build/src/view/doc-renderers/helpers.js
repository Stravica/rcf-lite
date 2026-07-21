// Small helpers shared across the per-document renderers. Vanilla template
// strings; no template engine.

/**
 * HTML-escape a string for safe injection between tags.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Return the raw document id as an anchor id. Phase 3.2 unified the anchor
 * convention around the display id (e.g. "REQ-002") so Mermaid click targets
 * and internal doc links resolve to the same DOM node.
 *
 * @param {string} id
 * @returns {string}
 */
export function anchorIdFor(id) {
  return String(id);
}

/**
 * Render an `<a>` link to the section of another document.
 *
 * @param {string} id
 * @param {string} [label]
 * @returns {string}
 */
export function docLink(id, label) {
  return `<a href="#${anchorIdFor(id)}">${escapeHtml(label ?? id)}</a>`;
}

/**
 * Render a list of ids as comma-separated doc links.
 *
 * @param {string[] | undefined} ids
 * @returns {string}
 */
export function docLinkList(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return '<em>none</em>';
  return ids.map((id) => docLink(id)).join(', ');
}

/**
 * Render a paragraph if value is present.
 *
 * @param {string} label
 * @param {unknown} value
 * @returns {string}
 */
export function fieldPara(label, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
}

/**
 * Render an unordered list if items are present.
 *
 * @param {string} label
 * @param {string[] | undefined} items
 * @returns {string}
 */
export function fieldList(label, items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const li = items.map((s) => `<li>${escapeHtml(s)}</li>`).join('');
  return `<section class="field-list"><h4>${escapeHtml(label)}</h4><ul>${li}</ul></section>`;
}

/**
 * Render the "Show raw JSON" disclosure block for a document.
 *
 * Phase 3.8 D13b: the raw-JSON disclosure now carries a stable
 * `data-doc-id="{parentDocId}::raw"` attribute so the live-client can
 * persist its open state across SSE swaps and page reloads. The main
 * doc-details already get a `data-doc-id` via `detailsWrap`; this closes
 * the last state-persistence gap.
 *
 * @param {string|undefined} raw
 * @param {object} doc
 * @param {string} parentDocId - the enclosing doc's display id (e.g. "REQ-002")
 * @returns {string}
 */
export function rawJsonDisclosure(raw, doc, parentDocId) {
  const json = raw ?? JSON.stringify(doc, null, 2);
  const rawId = `${parentDocId ?? 'doc'}::raw`;
  return `<details class="raw-json" data-doc-id="${escapeHtml(rawId)}"><summary>Show raw JSON</summary><pre>${escapeHtml(json)}</pre></details>`;
}

/**
 * Render a broken-document banner above the rest of a document section.
 *
 * @param {import('@stravica-ai/rcf-lite-core/errors').RcfError[]} errors
 * @returns {string}
 */
export function brokenBanner(errors) {
  if (!errors || errors.length === 0) return '';
  const items = errors
    .map((e) => `<li><code>${escapeHtml(e.kind)}</code> ${escapeHtml(e.message)}</li>`)
    .join('');
  return `
<aside class="broken" role="alert">
  <p><strong>Broken document</strong> - schema validation or reference failure.</p>
  <ul>${items}</ul>
</aside>`.trim();
}

/**
 * Render a broken-reference placeholder when a referenced id has no file.
 *
 * @param {string} id
 * @returns {string}
 */
export function brokenReferenceSection(id) {
  const anchor = anchorIdFor(id);
  return `
<article id="${anchor}" class="doc broken-doc">
  <h3>${escapeHtml(id)} - broken reference</h3>
  <aside class="broken" role="alert">
    <p>Referenced by a parent document but no file was found at the expected path.</p>
  </aside>
</article>`.trim();
}

/**
 * Wrap a doc's rendered body in a `<details data-doc-id>` so it can be
 * drilled-in from the tab tree. Closed by default. The `data-doc-id`
 * attribute is what the hash-routing script targets.
 *
 * @param {object} args
 * @param {string} args.id - display doc id (e.g. "REQ-001")
 * @param {string} args.summary - short label shown in the summary line
 * @param {string} args.className - class applied to the details wrapper
 * @param {string} args.body - the rendered body HTML
 * @param {string} [args.status] - optional doc status, rendered as a pill
 * @returns {string}
 */
export function detailsWrap({
  id, summary, className, body, status,
}) {
  const statusPill = status
    ? `<span class="status ${escapeHtml(status)}">${escapeHtml(status)}</span>`
    : '';
  return `
<details class="doc-details ${className}" data-doc-id="${escapeHtml(id)}">
  <summary><span class="summary-label">${escapeHtml(summary)}</span>${statusPill}</summary>
  ${body}
</details>`.trim();
}
