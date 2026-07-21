// HTTP + SSE server for the live-view surface. Wires the watch primitive
// to the walker to the SSE hub: any change under `rcf/` triggers a full
// re-walk (D4) and a `tree-update` broadcast (D12). Binds 127.0.0.1 only
// (D11); EADDRINUSE is a hard failure (D10).
//
// Public surface:
//   startServer({ projectRoot, port, host, log, heartbeatMs, watchImpl })
//     -> Promise<{ url, port, close, hub, currentState }>
// close() drains SSE with a `shutdown` event and releases the port. The
// caller (bin/rcf-view.js) is responsible for the 2s force-exit budget
// on top; the server itself does not `process.exit`.

import { createServer } from 'node:http';
import { join } from 'node:path';

import { LIVE_CLIENT_PATH, STYLE_CSS_PATH, VENDORED_MERMAID_PATH, renderModelToPage } from '../view/index.js';
import { watch as defaultWatch } from '../watch/index.js';
import { createRouter } from './routes.js';
import { createSseHub } from './sse.js';

/**
 * @typedef {object} StartServerOptions
 * @property {string} projectRoot
 * @property {number} [port=4373]
 * @property {string} [host='127.0.0.1']
 * @property {number} [heartbeatMs=30000]
 * @property {number} [debounceMs=50]
 * @property {(line: string) => void} [log] - stderr sink
 * @property {typeof defaultWatch} [watchImpl] - injectable watch primitive for tests
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
export async function startServer(args) {
  const projectRoot = args.projectRoot;
  const port = typeof args.port === 'number' ? args.port : 4373;
  const host = typeof args.host === 'string' ? args.host : '127.0.0.1';
  const heartbeatMs = typeof args.heartbeatMs === 'number' ? args.heartbeatMs : 30000;
  const debounceMs = typeof args.debounceMs === 'number' ? args.debounceMs : 50;
  const log = typeof args.log === 'function' ? args.log : () => {};
  const watchImpl = typeof args.watchImpl === 'function' ? args.watchImpl : defaultWatch;

  /** @type {{ version: number, fullPageHtml: string, contentHtml: string, errors: import('@stravica-ai/rcf-lite-core/errors').RcfError[] } | null} */
  let state = null;
  let version = 0;
  let rewalkInFlight = null;
  let closed = false;

  const sse = createSseHub({ heartbeatMs, log });

  async function rewalk() {
    if (closed) return;
    if (rewalkInFlight) {
      // Coalesce concurrent walks. The trailing one will pick up the
      // final on-disk state; a middle one adds nothing.
      return rewalkInFlight;
    }
    rewalkInFlight = (async () => {
      try {
        const result = await renderModelToPage({ projectRoot });
        if (closed) return;
        version += 1;
        state = {
          version,
          fullPageHtml: result.fullPageHtml,
          contentHtml: result.contentHtml,
          errors: result.errors,
        };
        sse.broadcast('tree-update', { version, contentHtml: result.contentHtml });
        if (result.errors && result.errors.length > 0) {
          sse.broadcast('walker-error', { errors: result.errors });
        }
      } catch (err) {
        log(`[server] walker failed: ${/** @type {Error} */ (err).message}`);
        sse.broadcast('walker-error', {
          errors: [{ kind: 'ioFailure', message: /** @type {Error} */ (err).message }],
        });
      } finally {
        rewalkInFlight = null;
      }
    })();
    return rewalkInFlight;
  }

  // Initial walk before we bind, so the first HTTP GET / has content ready
  // and the first SSE connect gets a real payload.
  await rewalk();

  const router = createRouter({
    currentState: () => state,
    sse,
    stylePath: STYLE_CSS_PATH,
    mermaidPath: VENDORED_MERMAID_PATH,
    liveClientPath: LIVE_CLIENT_PATH,
  });

  const server = createServer(router);

  // Watcher: any .json change under rcf/ triggers a re-walk. Debounced
  // per D4. Non-JSON files are filtered in the primitive itself.
  const watchDir = join(projectRoot, 'rcf');
  const watcher = watchImpl({
    paths: [watchDir],
    onChange: () => { rewalk().catch(() => {}); },
    debounceMs,
    onError: (err) => { log(`[watch] ${err.message}`); },
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
  };
}
