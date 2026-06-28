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
 * Lower-case id for use in anchor hrefs.
 *
 * @param {string} id
 * @returns {string}
 */
export function anchorIdFor(id) {
  return `doc-${String(id).toLowerCase()}`;
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
 * @param {string|undefined} raw
 * @param {object} doc
 * @returns {string}
 */
export function rawJsonDisclosure(raw, doc) {
  const json = raw ?? JSON.stringify(doc, null, 2);
  return `<details class="raw-json"><summary>Show raw JSON</summary><pre>${escapeHtml(json)}</pre></details>`;
}

/**
 * Render a broken-document banner above the rest of a document section.
 *
 * @param {import('../../errors/index.js').RcfError[]} errors
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
