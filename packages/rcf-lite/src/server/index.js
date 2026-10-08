// HTTP + SSE server for the live-view surface. Wires the watch primitive
// to the walker to the SSE hub: any change under `rcf/` triggers a full
// re-walk (D4) and a `tree-update` broadcast (D12). Binds 127.0.0.1 only
// (D11); EADDRINUSE is a hard failure (D10).
//
// Public surface:
//   startServer({ projectRoot, port, host, log, logError, heartbeatMs, watchImpl, renderImpl })
//     -> Promise<{ url, port, close, hub, currentState }>
// close() drains SSE with a `shutdown` event and releases the port. The
// caller (bin/rcf-view.js) is responsible for the 2s force-exit budget
// on top; the server itself does not `process.exit`.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { LIVE_CLIENT_PATH, PAGE_INIT_PATH, STYLE_CSS_PATH, TEST_HOST_CLIENT_PATH, VENDORED_MERMAID_PATH, renderModelToPage } from '../view/index.js';
import { watch as defaultWatch } from '../watch/index.js';
import { createRouter } from './routes.js';
import { createScopeHandler } from './scope-endpoint.js';
import { createSseHub } from './sse.js';

/**
 * @typedef {object} StartServerOptions
 * @property {string} projectRoot
 * @property {number} [port=4373]
 * @property {string} [host='127.0.0.1']
 * @property {number} [heartbeatMs=30000]
 * @property {number} [debounceMs=50]
 * @property {(line: string) => void} [log] - verbose-gated chatty sink;
 *   defaults to a noop so a caller that does not want chatter can omit it.
 * @property {(line: string) => void} [logError] - fatal-error sink that is
 *   always written to, independent of `log`. Issue #333 item 2: the CLI
 *   wires this to stderr unconditionally so a host that spawned
 *   `rcf audit view` without --verbose still sees a dead watcher or a
 *   failed walker. Defaults to `log` for back-compat.
 * @property {typeof defaultWatch} [watchImpl] - injectable watch primitive for tests
 * @property {typeof renderModelToPage} [renderImpl] - injectable walker
 *   for tests; defaults to the real `renderModelToPage`.
 * @property {boolean} [testHost=false] - viewer UI refresh PR 9 (TAC-4134,
 *   ADR-4136): when true, mount the wespa host fixture at /test-host.html
 *   plus its embed-client script at /test-host.js. Off by default so
 *   wespa's proxy allow-list is unaffected.
 */

/**
 * @param {StartServerOptions} args
 * @returns {Promise<{
 *   url: string,
 *   port: number,
 *   host: string,
 *   close: () => Promise<void>,
 *   currentState: () => { version: number, fullPageHtml: string, contentHtml: string } | null,
 *   sse: ReturnType<typeof createSseHub>,
 *   rewalk: () => Promise<void>,
 * }>}
 */

/**
 * Issue #248 (0.28.3): read a shipped static asset once and return
 * `{ buffer, size, contentType }`. Any read failure surfaces here so
 * `startServer` can fail fast with an ioFailure before it binds.
 *
 * @param {string} path
 * @param {string} contentType
 */
async function loadStaticAsset(path, contentType) {
  // Codex P2-1: derive size from the actual captured buffer, not from
  // a parallel stat that could snapshot a different revision if the
  // file is being replaced concurrently. A wrong content-length header
  // would cause truncation or mis-alignment for the entire server
  // lifetime because we cache both values together.
  const buffer = await readFile(path);
  return { buffer, size: buffer.length, contentType };
}

export async function startServer(args) {
  const projectRoot = args.projectRoot;
  const port = typeof args.port === 'number' ? args.port : 4373;
  const host = typeof args.host === 'string' ? args.host : '127.0.0.1';
  const heartbeatMs = typeof args.heartbeatMs === 'number' ? args.heartbeatMs : 30000;
  const debounceMs = typeof args.debounceMs === 'number' ? args.debounceMs : 50;
  const log = typeof args.log === 'function' ? args.log : () => {};
  // Issue #333 item 2: fatal watcher/walker exceptions always surface to
  // stderr regardless of --verbose; chatty per-event lines stay gated on
  // `log`. Callers that pass only `log` keep the pre-fix behaviour (one
  // sink for both chatty and fatal), which the back-compat test asserts.
  const logError = typeof args.logError === 'function' ? args.logError : log;
  const watchImpl = typeof args.watchImpl === 'function' ? args.watchImpl : defaultWatch;
  // Issue #333 item 1: tests inject a controllable render promise to
  // observe the trailing-rewalk coalescing without racing a real walk.
  const renderImpl = typeof args.renderImpl === 'function' ? args.renderImpl : renderModelToPage;
  const testHost = args.testHost === true;

  /** @type {{ version: number, fullPageHtml: string, contentHtml: string, errors: import('#core/errors').RcfError[], tree?: import('#core/store/walker.js').TreeModel, testPointers?: Map<string, import('#core/store/tp-resolve.js').TestPointerResolution> } | null} */
  let state = null;
  let version = 0;
  let rewalkInFlight = null;
  // Issue #333 item 1: a change that arrives while a walk is in flight
  // queues exactly one trailing walk so the post-in-flight on-disk state
  // is picked up; any number of changes during the in-flight walk collapse
  // onto that single trailing walk (never dropped, never re-run per call).
  let rewalkTrailing = false;
  let closed = false;

  const sse = createSseHub({ heartbeatMs, log });

  // FBS-207 (TAC-4136 queryCache + AC-208-6): per-version memo for the
  // three JSON query routes keyed by `${version}:${route}:${pivot}:${d
  // irection|scope}`. Replaced wholesale on every rewalk so a new tree
  // never serves stale compute. One compute per key per version; never
  // persisted; never written under rcf/. Page-lifetime: a reconnected
  // client sees a fresh cache.
  /** @type {Map<string, string>} */
  let queryCache = new Map();

  async function runWalk() {
    try {
      const result = await renderImpl({ projectRoot });
      if (closed) return;
      version += 1;
      state = {
        version,
        fullPageHtml: result.fullPageHtml,
        contentHtml: result.contentHtml,
        errors: result.errors,
        pmPartials: result.pmPartials,
        // Viewer UI refresh PR 7 (TAC-4132, ADR-4134): the ID lookup
        // index is built once per rewalk and snapshotted on `state`
        // so `GET /index.json` serves from memory and the SSE
        // `tree-update` version lets the client invalidate its cache.
        indexJson: result.indexJson,
        // FBS-207 (TAC-4136, AC-208-6): the walked tree and resolved
        // test-pointer map snapshotted on state so /trace.json,
        // /impact.json and /coverage.json compute from the same tree
        // the page was rendered from. `tree` was already produced by
        // renderModelToPage; the server now carries it onto state.
        tree: result.tree,
        testPointers: result.testPointers,
      };
      // FBS-207 (AC-208-6): a new version drops every previous
      // version's compute entries wholesale, as TAC-4136 specifies.
      queryCache = new Map();
      sse.broadcast('tree-update', { version, contentHtml: result.contentHtml });
      if (result.errors && result.errors.length > 0) {
        sse.broadcast('walker-error', { errors: result.errors });
      }
    } catch (err) {
      // Fatal walker exception: always to stderr via `logError` so a
      // host spawning `rcf audit view` without --verbose still sees it
      // (issue #333 item 2).
      logError(`[server] walker failed: ${/** @type {Error} */ (err).message}`);
      sse.broadcast('walker-error', {
        errors: [{ kind: 'ioFailure', message: /** @type {Error} */ (err).message }],
      });
    } finally {
      const trailing = rewalkTrailing;
      rewalkTrailing = false;
      rewalkInFlight = trailing && !closed ? runWalk() : null;
    }
  }

  function rewalk() {
    if (closed) return Promise.resolve();
    if (rewalkInFlight) {
      // A walk is already running. Flag that a trailing walk is wanted
      // and return a promise that resolves when the trailing walk (not
      // the in-flight one) has completed. Any concurrent callers coalesce
      // onto the same trailing walk - the final on-disk state wins.
      rewalkTrailing = true;
      return rewalkInFlight.then(() => rewalkInFlight ?? undefined);
    }
    rewalkInFlight = runWalk();
    return rewalkInFlight;
  }

  // Initial walk before we bind, so the first HTTP GET / has content ready
  // and the first SSE connect gets a real payload.
  await rewalk();

  // Issue #248 (0.28.3): snapshot the shipped static assets at startup
  // so a checkout branch switch during the server's lifetime cannot
  // change what gets served. The tree walker is the only path that
  // re-reads disk on rcf/ change; every other asset is fixed at boot.
  const [styleAsset, mermaidAsset, liveClientAsset, pageInitAsset, testHostClientAsset] = await Promise.all([
    loadStaticAsset(STYLE_CSS_PATH, 'text/css; charset=utf-8'),
    loadStaticAsset(VENDORED_MERMAID_PATH, 'application/javascript; charset=utf-8'),
    loadStaticAsset(LIVE_CLIENT_PATH, 'application/javascript; charset=utf-8'),
    loadStaticAsset(PAGE_INIT_PATH, 'application/javascript; charset=utf-8'),
    // Viewer UI refresh PR 9 (TAC-4134): the wespa host fixture client
    // only loads when testHost is on. Keeping the read behind the gate
    // means a startup under default options never touches the file.
    testHost
      ? loadStaticAsset(TEST_HOST_CLIENT_PATH, 'application/javascript; charset=utf-8')
      : Promise.resolve(null),
  ]);

  const scopeHandler = createScopeHandler({ projectRoot });
  const router = createRouter({
    currentState: () => state,
    sse,
    // FBS-207 (TAC-4136): the three JSON query routes share one page-
    // lifetime memo held on the server closure; the router reads and
    // writes it through this handle. Replaced wholesale on each
    // rewalk, above.
    queryCache: {
      get: (key) => queryCache.get(key),
      set: (key, value) => { queryCache.set(key, value); },
      has: (key) => queryCache.has(key),
      size: () => queryCache.size,
    },
    // Snapshotted assets take precedence; the legacy path props are
    // still passed so tests that mount the router directly with a
    // path (no asset load) keep working.
    styleAsset,
    mermaidAsset,
    liveClientAsset,
    pageInitAsset,
    stylePath: STYLE_CSS_PATH,
    mermaidPath: VENDORED_MERMAID_PATH,
    liveClientPath: LIVE_CLIENT_PATH,
    pageInitPath: PAGE_INIT_PATH,
    scope: scopeHandler,
    testHost,
    testHostClientAsset,
    testHostClientPath: testHost ? TEST_HOST_CLIENT_PATH : undefined,
  });

  const server = createServer(router);

  // Watcher: any .json change under rcf/ triggers a re-walk. Debounced
  // per D4. Non-JSON files are filtered in the primitive itself.
  const watchDir = join(projectRoot, 'rcf');
  const watcher = watchImpl({
    paths: [watchDir],
    onChange: () => { rewalk().catch(() => {}); },
    debounceMs,
    onError: (err) => { logError(`[watch] ${err.message}`); },
  });

  // Bind. EADDRINUSE surfaces as a rejected Promise so the caller can
  // print a clear message and exit 2 (D10). On bind failure we also tear
  // down the watcher and close the (unbound) http.Server so the process
  // has no lingering handles.
  try {
    await new Promise((resolve, reject) => {
      function onError(err) {
        server.off('listening', onListening);
        reject(err);
      }
      function onListening() {
        server.off('error', onError);
        resolve();
      }
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  } catch (err) {
    try { watcher.close(); } catch { /* swallow */ }
    try { sse.close(); } catch { /* swallow */ }
    try { server.close(); } catch { /* swallow */ }
    throw err;
  }

  const boundPort = /** @type {import('node:net').AddressInfo} */ (server.address()).port;

  async function close() {
    if (closed) return;
    closed = true;
    try { watcher.close(); } catch { /* swallow */ }
    await sse.drain('shutdown');
    // Kick any lingering keep-alive sockets out first so `server.close()`
    // resolves quickly. Node 18.2+ exposes both APIs.
    try { server.closeIdleConnections?.(); } catch { /* swallow */ }
    try { server.closeAllConnections?.(); } catch { /* swallow */ }
    await new Promise((resolve) => {
      let done = false;
      server.close(() => { if (!done) { done = true; resolve(); } });
      // Backstop: never let the promise hang beyond the bin's 2s budget.
      const t = setTimeout(() => {
        if (done) return;
        done = true;
        try { server.closeAllConnections?.(); } catch { /* swallow */ }
        resolve();
      }, 500);
      if (typeof t.unref === 'function') t.unref();
    });
  }

  return {
    url: `http://${host}:${boundPort}/`,
    port: boundPort,
    host,
    close,
    currentState: () => state,
    sse,
    rewalk,
    // FBS-207 (TAC-4136, AC-208-6 test seam): read-only probe on the
    // page-lifetime memo. Lets the AC-208-6 integration test prove the
    // rewalk cache SWAP (not just a version-prefixed key change) by
    // observing size before and after an explicit `rewalk()`.
    queryCacheSize: () => queryCache.size,
  };
}
