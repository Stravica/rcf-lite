// HTTP route table for the live-view server. Only five routes are served:
// GET /              -> rendered page (text/html)
// GET /events        -> SSE stream (text/event-stream)
// GET /style.css     -> shipped stylesheet
// GET /mermaid.min.js-> vendored mermaid runtime
// GET /live-client.js-> phase 3.8 live client script
// Everything else -> 404 text/plain.
//
// No CORS headers, no cache headers on static assets beyond what the
// browser derives from same-origin/localhost trust (D5, D11).

import { readFile, stat } from 'node:fs/promises';

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
      serveFile(res, deps.stylePath, MIME.css).catch((err) => fail(res, err));
      return;
    }
    if (path === '/mermaid.min.js') {
      serveFile(res, deps.mermaidPath, MIME.js).catch((err) => fail(res, err));
      return;
    }
    if (path === '/live-client.js') {
      serveFile(res, deps.liveClientPath, MIME.js).catch((err) => fail(res, err));
      return;
    }

    res.writeHead(404, { 'content-type': MIME.txt });
    res.end('not found\n');
  };
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
