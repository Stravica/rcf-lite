// Wireframe byte hashing and the external-URL scan for the UX intake
// gate (REQ-189, TAC-4142, ADR-4144, AC-18903-4/5/8). All pure functions
// over strings and byte buffers; no filesystem IO. The CLI verb that
// invokes the discovery check reads the files and hands bytes in.
//
// What this module owns:
//
//   - fileSha256(bytes): sha256 hex over a Buffer or Uint8Array.
//   - discoveryHash(record, wireframes): the review-stamp hash. The
//     canonical JSON of the record WITH the review field stripped
//     (ADR-4120 key-sorted shape, so key order on disk never changes
//     the value), concatenated with the sorted (path, sha256) pairs
//     of every wireframe file; the value the review verb stamps and
//     the reviewed check recomputes (ADR-4144, TAC-4142 interfaces).
//   - scanHtmlForExternalUrls(htmlText): walk the string for href,
//     src, srcset attribute values (true-attribute boundaries only,
//     after whitespace or an opening tag; never after a hyphen as in
//     data-src) and CSS url() or @import targets inside a <style>
//     element or a style="..." attribute, with HTML comments stripped
//     first and HTML character references decoded. Returns the first
//     offending value by document position (earliest offset wins across
//     every carrier) or null when none is found. Headings are never
//     inspected (ADR-4144: hash bytes, never structure).
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
 * Canonicalise a JSON-shaped value to a deterministic string: keys
 * sorted, no whitespace, finite numbers only, undefined omitted from
 * objects and coerced to null in arrays. ADR-4120 shape. Kept local
 * so src/discovery stays free of src/query imports (the TAC isolates
 * discovery from the query layer).
 *
 * @param {unknown} value
 * @returns {string}
 */
function canonicaliseJson(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'undefined') return '';
  if (Array.isArray(value)) {
    const parts = [];
    for (const el of value) parts.push(el === undefined ? 'null' : canonicaliseJson(el));
    return `[${parts.join(',')}]`;
  }
  if (t === 'object') {
    const keys = Object.keys(/** @type {object} */ (value)).sort();
    const parts = [];
    for (const k of keys) {
      const v = (/** @type {Record<string, unknown>} */ (value))[k];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${canonicaliseJson(v)}`);
    }
    return `{${parts.join(',')}}`;
  }
  return 'null';
}

/**
 * discoveryHash(record, wireframes): the review-stamp hash.
 *
 * The record is canonicalised with its review field removed (so a
 * review can be recorded without changing the hash it stamps) through
 * the ADR-4120 key-sorted serialiser so the hash is deterministic
 * byte-for-byte regardless of key order on disk. The wireframe pairs
 * are sorted by path so insertion order on disk never changes the
 * value.
 *
 * @param {import('./record.js').JourneyRecord} record
 * @param {Array<{ path: string, sha256: string }>} wireframes
 * @returns {string}
 */
export function discoveryHash(record, wireframes) {
  const { review: _review, ...rest } = record;
  const recordCanonical = canonicaliseJson(rest);
  const sorted = [...wireframes].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const h = createHash('sha256');
  h.update(recordCanonical);
  for (const w of sorted) h.update(`\n${w.path} ${w.sha256}`);
  return h.digest('hex');
}

// Attribute scan: match href/src/srcset only on a true attribute
// boundary. A character class before the name is used instead of \b
// because \b sees any non-word character (including '-') as a boundary,
// which would make 'data-src' match 'src'. We require the previous
// character to be either the start of the string or whitespace or '<'
// or '/' (ie never a word character and never a hyphen).
const ATTR_RE = /(?:^|[\s<\/])(href|src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+))/gi;
// Values inside url(...) may be quoted or unquoted; whitespace is
// permitted on either side of the value (CSS allows url( "x" )).
const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
// @import may be url(...) or a bare string; whitespace tolerant.
const CSS_IMPORT_RE = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^;\s)]+))/gi;
// HTML comments are stripped before the attribute scan runs.
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
// A <style>...</style> block or a style="..." attribute value: the
// only two places CSS legally sits in an HTML document. We scan CSS
// url()/@import only inside these.
const STYLE_ELEMENT_RE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const STYLE_ATTR_RE = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const EXTERNAL_RE = /^(?:https?:|\/\/)/i;

/**
 * Decode HTML character references (&#NN;, &#xHH;, and the five named
 * references that can legally appear in an attribute or CSS value).
 * The spec admits many named references; attribute values seldom use
 * more than these, and a reader of a wireframe URL will not care about
 * the long tail. Decoding is pre-match so an attacker cannot smuggle
 * an external URL past the scan by entity-encoding the leading h.
 *
 * @param {string} raw
 * @returns {string}
 */
function decodeHtmlEntities(raw) {
  return raw.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, inner) => {
    if (inner[0] === '#') {
      const cp = inner[1] === 'x' || inner[1] === 'X'
        ? parseInt(inner.slice(2), 16)
        : parseInt(inner.slice(1), 10);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return '';
      try { return String.fromCodePoint(cp); } catch { return ''; }
    }
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    return named[inner.toLowerCase()] ?? '';
  });
}

/**
 * Replace every character of a matched span with a single space so
 * document offsets are preserved for the attribute scan but the
 * contents are no longer treated as live markup.
 *
 * @param {string} src
 * @param {RegExp} re  - must have the global flag
 * @returns {string}
 */
function blankMatches(src, re) {
  re.lastIndex = 0;
  return src.replace(re, (m) => ' '.repeat(m.length));
}

/**
 * Return the first external URL found in an HTML string, or null if
 * none. External means a value starting http:, https: or // in any of:
 *
 *   - a true href/src/srcset attribute (never a hyphenated name like
 *     data-src);
 *   - a CSS url() or @import target inside a <style> element or a
 *     style="..." attribute (never url() text in body prose).
 *
 * HTML comments are stripped first (so a commented-out tag never
 * trips the scan) and HTML character references are decoded before
 * the external test (so &#104;ttps: cannot smuggle past). Leading or
 * trailing whitespace on a value is trimmed.
 *
 * When several URLs are external, the one whose match offset is
 * earliest in the (comment-stripped) document is returned.
 *
 * srcset is a comma-separated list of "<url> <descriptor>" entries;
 * each comma-separated piece's leading token is scanned.
 *
 * @param {string} htmlText
 * @returns {string | null}
 */
export function scanHtmlForExternalUrls(htmlText) {
  if (typeof htmlText !== 'string' || htmlText.length === 0) return null;

  // Strip comments by replacing with same-length whitespace so later
  // regex offsets still point at real document positions.
  const stripped = blankMatches(htmlText, HTML_COMMENT_RE);

  /** @type {Array<{ index: number, url: string }>} */
  const hits = [];

  // Attribute scan over the whole stripped document. Catches href on
  // <link>, <a> and friends; src on <script>, <img>, <iframe>,
  // <source>, <video>, <audio>; srcset on <img> and <source>. Hyphen-
  // prefixed names (data-src, hx-src, aria-src) are excluded by the
  // boundary class.
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(stripped)) !== null) {
    const attr = m[1].toLowerCase();
    const raw = m[2] ?? m[3] ?? m[4] ?? '';
    const value = decodeHtmlEntities(raw).trim();
    const idx = m.index;
    if (attr === 'srcset') {
      // Comma-separated candidates; the url is the first whitespace-
      // delimited token of each. The first external candidate wins
      // within the srcset, with the srcset's own match index.
      for (const candidate of value.split(',')) {
        const url = candidate.trim().split(/\s+/)[0] ?? '';
        if (EXTERNAL_RE.test(url)) { hits.push({ index: idx, url }); break; }
      }
    } else if (EXTERNAL_RE.test(value)) {
      hits.push({ index: idx, url: value });
    }
  }

  // CSS scan: ONLY inside <style>...</style> and style="..." so URL
  // text appearing in body prose (e.g. "<p>see url(https://x)</p>") is
  // never flagged. For each CSS region we scan url() and @import and
  // offset the match back into the enclosing document position.
  const scanCss = (/** @type {string} */ css, /** @type {number} */ base) => {
    CSS_URL_RE.lastIndex = 0;
    let cm;
    while ((cm = CSS_URL_RE.exec(css)) !== null) {
      const raw = (cm[1] ?? cm[2] ?? cm[3] ?? '').trim();
      const value = decodeHtmlEntities(raw).trim();
      if (EXTERNAL_RE.test(value)) hits.push({ index: base + cm.index, url: value });
    }
    CSS_IMPORT_RE.lastIndex = 0;
    while ((cm = CSS_IMPORT_RE.exec(css)) !== null) {
      const raw = (cm[1] ?? cm[2] ?? cm[3] ?? '').trim();
      const value = decodeHtmlEntities(raw).trim();
      if (EXTERNAL_RE.test(value)) hits.push({ index: base + cm.index, url: value });
    }
  };

  STYLE_ELEMENT_RE.lastIndex = 0;
  while ((m = STYLE_ELEMENT_RE.exec(stripped)) !== null) {
    // m.index is the <style ... > start; the inner CSS begins after the
    // opening tag. We approximate the inner-start as the index past the
    // first '>' of the tag so url() offsets reflect the real document
    // position.
    const openEnd = stripped.indexOf('>', m.index);
    const base = openEnd >= 0 ? openEnd + 1 : m.index;
    scanCss(m[1], base);
  }
  STYLE_ATTR_RE.lastIndex = 0;
  while ((m = STYLE_ATTR_RE.exec(stripped)) !== null) {
    const raw = m[1] ?? m[2] ?? m[3] ?? '';
    const value = decodeHtmlEntities(raw);
    scanCss(value, m.index);
  }

  if (hits.length === 0) return null;
  hits.sort((a, b) => a.index - b.index);
  return hits[0].url;
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
