// Three embedding lints (viewer UI refresh PR 9; TAC-4134, ADR-4136).
// Pure assertions each caller composes into whatever test harness it
// owns; test/view/wespa-host-fixture.test.js is the suite caller.
//
// (1) assertFramingHeaders(response)
//     Refuses on X-Frame-Options, on CSP frame-ancestors that forbids
//     same-origin, or on any header the viewer sets that would block
//     wespa's same-origin iframe mount. The viewer today sets neither,
//     so a passing run proves the browser accepts the iframe.
//
// (2) assertNoTargetTop(renderedHtml)
//     Greps the server-rendered HTML for target="_top" and target='_top'
//     and refuses on any match. Dex's contract (section 9) bans
//     target="_top" links so a legitimate in-iframe navigation never
//     breaks the embedding host out of its box.
//
// (3) assertLocalStorageNamespace(sourceTreeRoot)
//     Walks every .js file under sourceTreeRoot/src/view (excluding
//     vendored and .min.js) and asserts every localStorage.* and shared
//     storage.* call site uses a key literal starting with
//     "rcf-view:v1:" (or references STORAGE_NS declared equal to that
//     prefix). Dex's contract (section 9) requires the viewer namespace
//     every localStorage key because the viewer shares localStorage
//     with the wespa SPA.

import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const STORAGE_NS = 'rcf-view:v1:';

/**
 * @param {{ headers: Headers | Record<string, string> | Map<string, string> }} response
 * @returns {{ ok: true, headers: { xFrameOptions: null, csp: string | null } } | { ok: false, reason: string }}
 */
export function assertFramingHeaders(response) {
  const headers = response && response.headers;
  if (!headers) return { ok: false, reason: 'no headers on response' };
  const get = pickHeaderGetter(headers);
  const xFrameOptions = get('x-frame-options');
  if (xFrameOptions !== null && xFrameOptions !== undefined && String(xFrameOptions).trim() !== '') {
    return { ok: false, reason: `X-Frame-Options present: ${xFrameOptions}` };
  }
  const csp = get('content-security-policy');
  if (csp) {
    const directive = parseCspFrameAncestors(String(csp));
    if (directive !== null && !directive.allowsSameOrigin) {
      return { ok: false, reason: `CSP frame-ancestors forbids same-origin: ${directive.raw}` };
    }
  }
  return { ok: true, headers: { xFrameOptions: null, csp: csp ?? null } };
}

/**
 * @param {string} renderedHtml
 * @returns {{ ok: true, count: 0 } | { ok: false, count: number, matches: string[] }}
 */
export function assertNoTargetTop(renderedHtml) {
  if (typeof renderedHtml !== 'string') {
    return { ok: false, count: 1, matches: ['non-string input'] };
  }
  const matches = [];
  const re = /target\s*=\s*(?:"_top"|'_top'|_top\b)/gi;
  let m;
  while ((m = re.exec(renderedHtml)) !== null) {
    matches.push(m[0]);
  }
  if (matches.length === 0) return { ok: true, count: 0 };
  return { ok: false, count: matches.length, matches };
}

/**
 * @param {string} sourceTreeRoot - absolute path to the package root
 *   (e.g. packages/rcf-lite). The lint walks sourceTreeRoot/src/view.
 * @returns {Promise<{ ok: true, scanned: number } | { ok: false, violations: Array<{ file: string, line: number, snippet: string, key: string }> }>}
 */
export async function assertLocalStorageNamespace(sourceTreeRoot) {
  const viewRoot = join(sourceTreeRoot, 'src', 'view');
  const files = await listJsFiles(viewRoot);
  const violations = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const re = /(?:localStorage|storage|sessionStorage)\s*\.\s*(?:setItem|getItem|removeItem)\s*\(\s*([^,)]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const argExpr = m[1].trim();
      const key = resolveKeyLiteral(argExpr, text);
      if (key === null) continue;
      if (!key.startsWith(STORAGE_NS)) {
        const line = text.slice(0, m.index).split('\n').length;
        violations.push({ file, line, snippet: m[0], key });
      }
    }
  }
  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, scanned: files.length };
}

/**
 * Pick a case-insensitive header getter that works whether headers is
 * a Headers object, a Map, or a plain record.
 *
 * @param {Headers | Map<string, string> | Record<string, string>} headers
 * @returns {(name: string) => string | null | undefined}
 */
function pickHeaderGetter(headers) {
  if (typeof headers.get === 'function') return (name) => headers.get(name);
  const map = /** @type {Record<string, string>} */ (headers);
  return (name) => {
    for (const k of Object.keys(map)) {
      if (k.toLowerCase() === name.toLowerCase()) return map[k];
    }
    return null;
  };
}

/**
 * Parse a CSP header string for a frame-ancestors directive. If the
 * directive is present, return `{ allowsSameOrigin, raw }` where
 * allowsSameOrigin is true if the directive contains 'self',
 * window.location.origin, or '*'. Null if the directive is absent (no
 * opinion on framing).
 *
 * @param {string} csp
 * @returns {{ allowsSameOrigin: boolean, raw: string } | null}
 */
function parseCspFrameAncestors(csp) {
  const parts = csp.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!/^frame-ancestors\b/i.test(trimmed)) continue;
    const value = trimmed.slice('frame-ancestors'.length).trim();
    if (value.length === 0) return { allowsSameOrigin: false, raw: trimmed };
    const tokens = value.split(/\s+/);
    const allowsSameOrigin = tokens.some((t) => (
      t === "'self'" || t === '*' || /^https?:\/\//i.test(t)
    ));
    return { allowsSameOrigin, raw: trimmed };
  }
  return null;
}

/**
 * Resolve a storage key argument expression to its literal string if
 * possible. Returns null when the key is dynamic (we only lint literals,
 * since a dynamic key already has to be composed from a literal prefix
 * further up the file to pin the namespace).
 *
 * Accepts:
 *   - "rcf-view:v1:openDetails"
 *   - 'rcf-view:v1:openDetails'
 *   - STORAGE_OPEN            -> resolves if `var STORAGE_OPEN = STORAGE_NS + 'openDetails';` or similar
 *   - STORAGE_NS + 'something'
 *
 * @param {string} argExpr - the trimmed argument expression as source
 * @param {string} fileText - the full file text (for const resolution)
 * @returns {string | null}
 */
function resolveKeyLiteral(argExpr, fileText) {
  const strLit = argExpr.match(/^(['"`])((?:\\.|(?!\1).)*)\1/);
  if (strLit) return strLit[2];
  const addLit = argExpr.match(/^([A-Z_][A-Z0-9_]*)\s*\+\s*(['"`])((?:\\.|(?!\2).)*)\2/);
  if (addLit) {
    const base = resolveIdentifier(addLit[1], fileText);
    if (base === null) return null;
    return base + addLit[3];
  }
  const ident = argExpr.match(/^([A-Z_][A-Z0-9_]*)$/);
  if (ident) {
    return resolveIdentifier(ident[1], fileText);
  }
  return null;
}

/**
 * Resolve a module-level `var X = '...';` or `var X = Y + '...';`
 * declaration to its literal string.
 *
 * @param {string} name
 * @param {string} fileText
 * @returns {string | null}
 */
function resolveIdentifier(name, fileText) {
  const re = new RegExp(`(?:var|let|const)\\s+${name}\\s*=\\s*([^;\\n]+)[;\\n]`);
  const m = fileText.match(re);
  if (!m) return null;
  return resolveKeyLiteral(m[1].trim(), fileText);
}

/**
 * Walk a directory recursively and return every `.js` file path, excluding
 * `vendored/` subtrees and `.min.js` artefacts.
 *
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listJsFiles(dir) {
  const out = [];
  async function walk(d) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return;
      throw err;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'vendored') continue;
        await walk(full);
      } else if (e.isFile()) {
        if (extname(e.name) !== '.js') continue;
        if (e.name.endsWith('.min.js')) continue;
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out;
}
