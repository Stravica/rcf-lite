// HTTP route table for the live-view server. Routes served:
// GET /              -> rendered page (text/html)
// GET /events        -> SSE stream (text/event-stream)
// GET /style.css     -> shipped stylesheet
// GET /mermaid.min.js-> vendored mermaid runtime
// GET /live-client.js-> phase 3.8 live client script
// GET /scope.json    -> deep-link scope resolver (w-2026-08-30-dave-020)
// Everything else -> 404 text/plain.
//
// No CORS headers, no cache headers on static assets beyond what the
// browser derives from same-origin/localhost trust (D5, D11).

import { readFile, stat } from 'node:fs/promises';

// Issue #248 (0.28.3): the shipped static assets (style.css,
// mermaid.min.js, live-client.js) MUST be resolved once at server
// startup, not read from disk on every HTTP request. If the checkout
// switches branches or the file mutates while the server runs, per-
// request reads return the new bytes even though the HTML that
// references them was rendered from a walk taken at startup. The
// asymmetry produced the 2026-09-22 Product Map "unstyled preview"
// regression: HTML from the store walker was old, style.css was
// current, and the browser combined them.
//
// `deps.styleAsset`, `deps.mermaidAsset` and `deps.liveClientAsset`
// carry `{ buffer, size, contentType }` snapshotted at startup. The
// legacy `stylePath`/`mermaidPath`/`liveClientPath` props are kept
// for backwards compatibility with tests that pass a path; the
// router reads on-demand in that fallback path.

const MIME = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};

/**
 * @typedef {object} RouterDeps
 * @property {() => { fullPageHtml: string, contentHtml: string, version: number } | null} currentState
 * @property {ReturnType<typeof import('./sse.js').createSseHub>} sse
 * @property {string} stylePath
 * @property {string} mermaidPath
 * @property {string} liveClientPath
 * @property {((req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>|void)} [scope]
 *           Deep-link scope handler (w-2026-08-30-dave-020). Optional so
 *           the router stays usable in tests that mount only the static
 *           routes without a project root.
 */

/**
 * Create a request handler bound to the current state provider and the
 * SSE hub. The returned function has signature `(req, res) -> void` and
 * is ready to pass into `http.createServer`.
 *
 * @param {RouterDeps} deps
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createRouter(deps) {
  return function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': MIME.txt, allow: 'GET, HEAD' });
      res.end('method not allowed\n');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (path === '/' || path === '/index.html') {
      const state = deps.currentState();
      if (!state) {
        res.writeHead(503, { 'content-type': MIME.txt });
        res.end('view server initialising\n');
        return;
      }
      res.writeHead(200, { 'content-type': MIME.html });
      res.end(state.fullPageHtml);
      return;
    }
    if (path === '/events') {
      const state = deps.currentState();
      const payload = state ? { version: state.version, contentHtml: state.contentHtml } : null;
      deps.sse.handle(req, res, payload);
      return;
    }
    if (path === '/style.css') {
      serveAsset(res, deps.styleAsset, deps.stylePath, MIME.css).catch((err) => fail(res, err));
      return;
    }
    if (path === '/mermaid.min.js') {
      serveAsset(res, deps.mermaidAsset, deps.mermaidPath, MIME.js).catch((err) => fail(res, err));
      return;
    }
    if (path === '/live-client.js') {
      serveAsset(res, deps.liveClientAsset, deps.liveClientPath, MIME.js).catch((err) => fail(res, err));
      return;
    }
    if (path.startsWith('/product-map/')) {
      const state = deps.currentState();
      if (!state || !state.pmPartials) {
        res.writeHead(503, { 'content-type': MIME.txt });
        res.end('view server initialising\n');
        return;
      }
      const group = path.slice('/product-map/'.length);
      const html = state.pmPartials[group];
      if (typeof html !== 'string') {
        res.writeHead(404, { 'content-type': MIME.txt });
        res.end('unknown grouping\n');
        return;
      }
      res.writeHead(200, { 'content-type': MIME.html, 'cache-control': 'no-store' });
      res.end(html);
      return;
    }
    if (path === '/scope.json') {
      if (typeof deps.scope !== 'function') {
        res.writeHead(404, { 'content-type': MIME.txt });
        res.end('not found\n');
        return;
      }
      Promise.resolve(deps.scope(req, res)).catch((err) => fail(res, err));
      return;
    }

    res.writeHead(404, { 'content-type': MIME.txt });
    res.end('not found\n');
  };
}

/**
 * Issue #248 (0.28.3): serve a snapshotted asset when the server has
 * one, otherwise fall through to the legacy per-request read. The
 * happy path never touches the filesystem after startup, so a checkout
 * switch during the server's lifetime cannot change what gets served.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {{ buffer: Buffer, size: number, contentType?: string } | undefined | null} asset
 * @param {string | undefined} fallbackPath
 * @param {string} contentType
 */
async function serveAsset(res, asset, fallbackPath, contentType) {
  if (asset && asset.buffer) {
    res.writeHead(200, {
      'content-type': asset.contentType ?? contentType,
      'content-length': String(asset.size),
    });
    res.end(asset.buffer);
    return;
  }
  if (fallbackPath) {
    await serveFile(res, fallbackPath, contentType);
    return;
  }
  res.writeHead(404, { 'content-type': MIME.txt });
  res.end('not found\n');
}

async function serveFile(res, path, contentType) {
  let body;
  let size;
  try {
    const [buf, s] = await Promise.all([readFile(path), stat(path)]);
    body = buf;
    size = s.size;
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      res.writeHead(404, { 'content-type': MIME.txt });
      res.end('not found\n');
      return;
    }
    throw err;
  }
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': String(size),
  });
  res.end(body);
}

function fail(res, err) {
  try {
    res.writeHead(500, { 'content-type': MIME.txt });
    res.end(`internal error: ${err && err.message ? err.message : 'unknown'}\n`);
  } catch { /* swallow */ }
}
