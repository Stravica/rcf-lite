// HTTP route table for the live-view server. Routes served:
// GET /              -> rendered page (text/html)
// GET /events        -> SSE stream (text/event-stream)
// GET /style.css     -> shipped stylesheet
// GET /mermaid.min.js-> vendored mermaid runtime
// GET /live-client.js-> phase 3.8 live client script
// GET /page-init.js  -> viewer UI refresh PR 1 shell / router script
//                      (Dex / wespa 2026-10-02 #263; release-noted so
//                      the proxy's route allow-list is extended).
// GET /scope.json    -> deep-link scope resolver (w-2026-08-30-dave-020)
// GET /index.json    -> viewer UI refresh PR 7 ID lookup index built
//                      from BuiltTreeModel on every rewalk; `{ rows }`
//                      with one row per document id plus one per AC
//                      (ADR-4134; release-noted).
// GET /_fixtures/components -> viewer UI refresh PR 2 component
//                      fixture page (release-noted). Static page, no
//                      live-walk coupling, so it is always available
//                      even before the first rewalk completes.
// GET /test-host.html -> viewer UI refresh PR 9 wespa host fixture
//                      page (TAC-4134, ADR-4136). Only served when
//                      `deps.testHost === true`; 404 otherwise so
//                      wespa's reverse-proxy allow-list is unaffected.
//                      Mimics the wespa shell (56px header, resizable
//                      sidebar) and iframes the viewer at `./?embed=1
//                      &theme=light`. Test-suite proof only; not a
//                      shipped UI.
// GET /test-host.js  -> viewer UI refresh PR 9 wespa host fixture
//                      client script. Same testHost gate as the HTML.
// Everything else -> 404 text/plain.
//
// No CORS headers, no cache headers on static assets beyond what the
// browser derives from same-origin/localhost trust (D5, D11).

import { readFile, stat } from 'node:fs/promises';

import { renderComponentsFixturePage } from '../view/components-fixture.js';
import { renderTestHostPage } from '../view/test-host/fixture.js';
// FBS-207 (TAC-4136, ADR-4140): the viewer's three JSON query routes
// call the same pure composers the CLI calls, from the walked tree
// kept on `state`. Admissibility bypass: these routes do NOT call
// `runWithAdmissibilityGate` (the CLI coverage, impact and trace
// verbs do not either; issues 316 and 317). Only readiness and
// freeze consult that gate.
import { classifyCoverageScope, computeCoverage } from '../query/coverage.js';
import { computeImpact } from '../query/impact.js';
import { computeTrace, kindOf } from '../query/trace.js';

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
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};

/**
 * @typedef {object} RouterDeps
 * @property {() => { fullPageHtml: string, contentHtml: string, version: number, indexJson?: string } | null} currentState
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
    if (path === '/page-init.js') {
      serveAsset(res, deps.pageInitAsset, deps.pageInitPath, MIME.js).catch((err) => fail(res, err));
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
    if (path === '/_fixtures/components') {
      res.writeHead(200, { 'content-type': MIME.html, 'cache-control': 'no-store' });
      res.end(renderComponentsFixturePage());
      return;
    }
    if (path === '/test-host.html' && deps.testHost) {
      // Viewer UI refresh PR 9 (TAC-4134, ADR-4136): the wespa host
      // fixture is only mounted when the server was started with
      // testHost: true. No X-Frame-Options, no CSP; the viewer's
      // framing lint asserts the same on GET /.
      res.writeHead(200, { 'content-type': MIME.html, 'cache-control': 'no-store' });
      res.end(renderTestHostPage());
      return;
    }
    if (path === '/test-host.js' && deps.testHost) {
      serveAsset(res, deps.testHostClientAsset, deps.testHostClientPath, MIME.js).catch((err) => fail(res, err));
      return;
    }
    if (path === '/index.json') {
      // Viewer UI refresh PR 7 (TAC-4132, ADR-4134): the ID lookup
      // index is built once per rewalk and lives on `state.indexJson`
      // as a pre-stringified payload, so this handler never touches
      // disk and content-length matches the exact bytes served.
      const state = deps.currentState();
      if (!state || typeof state.indexJson !== 'string') {
        res.writeHead(503, { 'content-type': MIME.txt });
        res.end('view server initialising\n');
        return;
      }
      const body = state.indexJson;
      res.writeHead(200, {
        'content-type': MIME.json,
        'content-length': String(Buffer.byteLength(body)),
        'cache-control': 'no-store',
      });
      res.end(body);
      return;
    }
    if (path === '/trace.json') {
      handleQueryRoute(req, res, deps, url, 'trace');
      return;
    }
    if (path === '/impact.json') {
      handleQueryRoute(req, res, deps, url, 'impact');
      return;
    }
    if (path === '/coverage.json') {
      handleQueryRoute(req, res, deps, url, 'coverage');
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

/**
 * FBS-207 (TAC-4136 interfaces[GET /trace.json], [GET /impact.json],
 * [GET /coverage.json], [QueryRouteError]): one handler per route that
 * reads deps.currentState(), returns 503 before the first walk, 404 or
 * 400 QueryRouteError on known failures, and application/json with
 * cache-control: no-store on success. The three routes NEVER call
 * runWithAdmissibilityGate (admissibility bypass stated in TAC-4136:
 * the CLI coverage, impact and trace verbs do not either, so a tree
 * that fails admissibility still answers these three). Nothing is
 * written under rcf/.
 *
 * Memoised per (version, route, pivot, direction|scope) in deps.query
 * Cache, which the server replaces wholesale on every rewalk. The
 * cached entry is the response body string so a repeated request
 * writes bytes without recomputing or re-stringifying.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {RouterDeps & { queryCache?: {
 *   get(key: string): string | undefined,
 *   set(key: string, value: string): void,
 *   has(key: string): boolean,
 *   size(): number,
 * }}} deps
 * @param {URL} url
 * @param {'trace' | 'impact' | 'coverage'} route
 */
function handleQueryRoute(req, res, deps, url, route) {
  const state = deps.currentState();
  // AC-208-7: 503 "view server initialising" before the first walk
  // completes, exactly as /index.json answers today.
  if (!state || !state.tree) {
    res.writeHead(503, { 'content-type': MIME.txt });
    res.end('view server initialising\n');
    return;
  }

  // AC-208-1: for /trace.json the query id and direction come from
  // the URL. Default direction is forward (matches the CLI default).
  const id = url.searchParams.get('id');
  const direction = url.searchParams.get('direction') ?? 'forward';
  const scope = url.searchParams.get('scope');

  if (route === 'trace' || route === 'impact') {
    // AC-208-4 unknown-id: an id missing or not found in the tree is
    // 404 with QueryRouteError.error "unknown-id" and the request id
    // echoed back (missing is echoed as null).
    if (!id) {
      sendQueryError(res, 404, { error: 'unknown-id', id: null });
      return;
    }
    if (!kindOf(state.tree, id)) {
      sendQueryError(res, 404, { error: 'unknown-id', id });
      return;
    }
  }
  if (route === 'trace') {
    // AC-208-4 bad-direction: anything outside forward | back | both
    // is 400 with QueryRouteError.error "bad-direction".
    if (direction !== 'forward' && direction !== 'back' && direction !== 'both') {
      sendQueryError(res, 400, { error: 'bad-direction', id, direction });
      return;
    }
  }
  if (route === 'coverage' && scope !== null) {
    // AC-208-4 bad-scope: a scope positional that is below AC or
    // unknown is 400 with QueryRouteError.error "bad-scope". Reuses
    // the exact classifier the CLI uses (src/cli/coverage.js).
    const classification = classifyCoverageScope(state.tree, scope);
    if (classification !== 'valid') {
      sendQueryError(res, 400, { error: 'bad-scope', scope });
      return;
    }
  }

  // AC-208-6: memo key covers the state version and the route-shaped
  // request params so each (version, pivot, direction|scope) computes
  // once and serves from the memo thereafter. The cache is replaced
  // wholesale on each rewalk, so a new version never serves a prior
  // version's bytes.
  const key = route === 'trace'
    ? `${state.version}:trace:${id}:${direction}`
    : route === 'impact'
      ? `${state.version}:impact:${id}:-`
      : `${state.version}:coverage:-:${scope ?? ''}`;

  const cache = deps.queryCache;
  let body = cache && cache.has(key) ? cache.get(key) : null;
  if (body === null || body === undefined) {
    let result;
    try {
      if (route === 'trace') {
        result = computeTrace(state.tree, { id, direction });
      } else if (route === 'impact') {
        result = computeImpact(state.tree, { id });
      } else {
        // AC-208-3: strict per-AC coverage, with the CLI's optional
        // scope narrowing. testPointers are the resolved map the
        // walker produced (fail-closed when missing per
        // computeCoverage's doc).
        result = computeCoverage(state.tree, {
          strict: true,
          scopeId: scope,
          testPointers: state.testPointers,
        });
      }
    } catch (err) {
      fail(res, err);
      return;
    }
    body = JSON.stringify(result);
    if (cache) cache.set(key, body);
  }

  // AC-208-1 / -2 / -3: application/json with cache-control: no-store,
  // computed from the current state and served relative to the mount.
  res.writeHead(200, {
    'content-type': MIME.json,
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
  });
  res.end(body);
}

/**
 * FBS-207 (TAC-4136 QueryRouteError): the three routes share one JSON
 * error body `{error, id?, direction?, scope?}`, with request echo for
 * only the fields that were present. 404 for unknown-id, 400 for the
 * two usage errors.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {404 | 400} status
 * @param {{error: 'unknown-id' | 'bad-direction' | 'bad-scope', id?: string | null, direction?: string, scope?: string}} payload
 */
function sendQueryError(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': MIME.json,
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
  });
  res.end(body);
}
