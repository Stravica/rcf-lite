// Wireframe byte hashing and the external-URL scan for the UX intake
// gate (REQ-189, TAC-4142, ADR-4144, AC-18903-4/5/8). All pure functions
// over strings and byte buffers; no filesystem IO. The CLI verb that
// invokes the discovery check reads the files and hands bytes in.
//
// What this module owns:
//
//   - fileSha256(bytes): sha256 hex over a Buffer or Uint8Array.
//   - discoveryHash(record, wireframes): the review-stamp hash. The
//     canonical JSON of the record WITH the review field stripped,
//     concatenated with the sorted (path, sha256) pairs of every
//     wireframe file; the value the review verb stamps and the
//     reviewed check recomputes (ADR-4144, TAC-4142 interfaces).
//   - scanHtmlForExternalUrls(htmlText): walk the string for href,
//     src, srcset attribute values and CSS url() or @import targets
//     (in a <style> element or a style="..." attribute) and return
//     the first value that starts http:, https: or //, or null when
//     none is found. Headings are never inspected (ADR-4144: hash
//     bytes, never structure).
//   - checkWireframeFormat({ extension, asBuilt }): map a lowercased
//     extension and the record.asBuilt flag to { ok } or { ok: false,
//     rule: <string> }. .md and .html are accepted on any record,
//     .png only when asBuilt is true, every other extension is
//     refused.
//
// Node built-ins only.

import { createHash } from 'node:crypto';

/** The three admitted wireframe extensions. */
export const WIREFRAME_EXTENSIONS = /** @type {const} */ (['.md', '.html', '.png']);

/**
 * sha256 hex of a byte sequence.
 *
 * @param {Buffer | Uint8Array} bytes
 * @returns {string}
 */
export function fileSha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * discoveryHash(record, wireframes): the review-stamp hash.
 *
 * The record is serialised with its review field removed (so a review
 * can be recorded without changing the hash it stamps), through the
 * same 2-space-indented JSON writeJourneyRecord uses so the hash is
 * deterministic byte-for-byte across machines. The wireframe pairs
 * are sorted by path so insertion order on disk never changes the
 * value.
 *
 * @param {import('./record.js').JourneyRecord} record
 * @param {Array<{ path: string, sha256: string }>} wireframes
 * @returns {string}
 */
export function discoveryHash(record, wireframes) {
  const { review: _review, ...rest } = record;
  const recordCanonical = `${JSON.stringify(rest, null, 2)}\n`;
  const sorted = [...wireframes].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const h = createHash('sha256');
  h.update(recordCanonical);
  for (const w of sorted) h.update(`\n${w.path} ${w.sha256}`);
  return h.digest('hex');
}

const ATTR_RE = /\b(?:href|src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+))/gi;
const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)/gi;
const CSS_IMPORT_RE = /@import\s+(?:url\()?\s*(?:"([^"]*)"|'([^']*)'|([^;\s)]+))/gi;
const EXTERNAL_RE = /^(?:https?:|\/\/)/i;

/**
 * Return the first external URL found in an HTML string, or null if
 * none. External means a value starting http:, https: or // in any
 * of href, src, srcset attribute values, or CSS url() / @import
 * targets (in a <style> element OR in a style="..." attribute).
 *
 * srcset is a comma-separated list of "<url> <descriptor>" entries;
 * each comma-separated piece's leading token is scanned.
 *
 * @param {string} htmlText
 * @returns {string | null}
 */
export function scanHtmlForExternalUrls(htmlText) {
  if (typeof htmlText !== 'string' || htmlText.length === 0) return null;
  // Attribute scan over the whole document. Catches href on <link>,
  // <a> and friends; src on <script>, <img>, <iframe>, <source>,
  // <video>, <audio>; srcset on <img> and <source>.
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(htmlText)) !== null) {
    // Which group matched tells us the quoting style, but the value
    // is the same for the scan.
    const value = m[1] ?? m[2] ?? m[3] ?? '';
    const attr = m[0].slice(0, m[0].indexOf('=')).trim().toLowerCase();
    if (attr === 'srcset') {
      // Comma-separated candidates; the url is the first whitespace-
      // delimited token of each.
      for (const candidate of value.split(',')) {
        const url = candidate.trim().split(/\s+/)[0] ?? '';
        if (EXTERNAL_RE.test(url)) return url;
      }
    } else if (EXTERNAL_RE.test(value)) {
      return value;
    }
  }
  // CSS url() and @import scan over the whole document; this picks up
  // both <style>...</style> blocks and style="..." attribute values
  // in one pass (we never try to isolate CSS context because any url()
  // outside CSS context cannot appear in valid HTML, so a false
  // positive here would be on invalid markup).
  CSS_URL_RE.lastIndex = 0;
  while ((m = CSS_URL_RE.exec(htmlText)) !== null) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (EXTERNAL_RE.test(raw)) return raw;
  }
  CSS_IMPORT_RE.lastIndex = 0;
  while ((m = CSS_IMPORT_RE.exec(htmlText)) !== null) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (EXTERNAL_RE.test(raw)) return raw;
  }
  return null;
}

/**
 * checkWireframeFormat({ extension, asBuilt }): is this wireframe
 * extension admitted on this record?
 *
 * Returns { ok: true } on pass, or { ok: false, rule } on refusal.
 * `rule` is a short machine-grep-able tag ('extensionOutsideSet' or
 * 'pngOnlyAsBuilt').
 *
 * @param {object} args
 * @param {string} args.extension - the extname of the wireframe path, lower-cased, including the dot (e.g. '.md')
 * @param {boolean} args.asBuilt - the record's asBuilt flag
 * @returns {{ ok: true } | { ok: false, rule: 'extensionOutsideSet' | 'pngOnlyAsBuilt' }}
 */
export function checkWireframeFormat({ extension, asBuilt }) {
  const ext = typeof extension === 'string' ? extension.toLowerCase() : '';
  if (!WIREFRAME_EXTENSIONS.includes(/** @type {any} */ (ext))) {
    return { ok: false, rule: 'extensionOutsideSet' };
  }
  if (ext === '.png' && asBuilt !== true) {
    return { ok: false, rule: 'pngOnlyAsBuilt' };
  }
  return { ok: true };
}
