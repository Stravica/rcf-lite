// Sample-app fixture for the application-empty-error-states probe pack.
//
// Dependency-free Node HTTP server. Realises the eight named empty
// and error states honestly under /probe/<state> routes so every
// pack check can run against a real DOM. Break switches drive the
// negative runs from a single boot:
//
//   ?break=stack-trace     re-adds a stack trace on the 500 surface
//                          (AC-22103-1 must fail)
//   ?break=leak-id         re-adds a resource id on the forbidden
//                          and permission-denied surfaces
//                          (AC-22102-1 or AC-22104-1 must fail)
//   ?break=no-recovery     drops the [data-recovery="create"] on
//                          the empty-list surface (AC-22106-1 must
//                          fail)
//   ?break=no-live-region  drops the polite live-region wrapper on
//                          the reconnect route (AC-22105-1 must
//                          fail on the reconnect leg)
//
// PORT env picks the bind port (default 3000). Never binds 4200 (Dave's
// live workspace uses that port). Prints LISTENING <port> once bound.
//
// Exports startServer({ port }) so the anatomy test can drive the
// same shell without spawning a child process.

import http from 'node:http';
import { URL } from 'node:url';

// Pre-seeded buffered write the pack observes on the offline
// route. Idempotency token and monotonic sequence per TAC-2303.
const SEED_OFFLINE_BUFFER = [
  { idempotencyToken: 'idempotency-token-seed-write-1', payload: { kind: 'note', body: 'offline draft' }, sequence: 1 },
];

// Eight named states the fixture serves. Kept as a constant so the
// anatomy test can enumerate them.
export const NAMED_STATES = [
  'not-found',
  'forbidden',
  'server-error',
  'offline',
  'permission-denied',
  'empty-list',
  'no-search-results',
  'error-boundary',
];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function shellHead(title) {
  return `<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 0; color: #111; }
  main { padding: 1.25rem 1.5rem; max-width: 720px; }
  [data-surface] { padding: 1rem; border-radius: 4px; }
  [data-surface="not-found"] { background: #f6f7f9; border: 1px solid #ccc; }
  [data-surface="forbidden"], [data-surface="permission-denied"] { background: #fff8e5; border: 1px solid #d4a72c; }
  [data-surface="server-error"], [data-surface="error-boundary"] { background: #fdecea; border: 1px solid #d93025; }
  [data-surface="offline"] { background: #eef1f5; border: 1px solid #4a5b7a; }
  [data-surface="empty-list"], [data-surface="no-search-results"] { background: #f0f4ee; border: 1px solid #6a8b4a; }
  [data-visual="empty-list"], [data-visual="no-search-results"] { padding: 0.75rem; border-radius: 4px; background: #fff; margin-top: 0.5rem; }
  a, button { color: #0645ad; }
  button { cursor: pointer; padding: 0.35rem 0.75rem; }
  [data-live-region="polite"] { position: absolute; left: -9999px; top: -9999px; }
  [data-banner="offline"] { padding: 0.5rem 0.75rem; background: #4a5b7a; color: white; border-radius: 4px; margin-bottom: 0.5rem; }
</style>`;
}

function notFoundPage() {
  const heading = 'Widget not found';
  return `<!doctype html><html lang="en"><head>${shellHead('Not found - Sample app')}</head><body>
<main>
<section data-surface="not-found" role="region" aria-labelledby="notFoundHeading">
  <h1 id="notFoundHeading">${escapeHtml(heading)}</h1>
  <p>The widget you asked for is not on this workspace.</p>
  <p><a href="/probe/widgets" data-recovery="parent-surface">Back to widgets</a></p>
  <form action="/probe/search" method="get" data-recovery="search">
    <label for="q">Search widgets</label>
    <input id="q" name="q" type="search" placeholder="Search widgets">
    <button type="submit">Search</button>
  </form>
</section>
</main>
</body></html>`;
}

function forbiddenPage({ leakId }) {
  const leakBlock = leakId
    ? '<p data-leak="resource-id">Attempted resource id: widget-2039-alpha (leaked for the break switch).</p>'
    : '';
  return `<!doctype html><html lang="en"><head>${shellHead('Access denied')}</head><body>
<main>
<section data-surface="forbidden" role="region" aria-labelledby="forbiddenHeading">
  <h1 id="forbiddenHeading">Access denied</h1>
  <p>You do not have scope on this workspace. Ask an existing admin to grant you access.</p>
  <button type="button" data-action="request-access" aria-label="Request access to this workspace">Request access</button>
  ${leakBlock}
</section>
<div data-live-region="polite" role="status" aria-live="polite"></div>
</main>
</body></html>`;
}

function serverErrorPage({ break_ }) {
  const stackBlock = break_ === 'stack-trace'
    ? `<pre data-leak="stack">Error: connection reset
    at handleWidget (/opt/app/src/handlers/widget.js:44:11)
    at process.env.NODE_ENV=production
    at handleRequest (node_modules/express/lib/router/layer.js:95:5)</pre>`
    : '';
  return `<!doctype html><html lang="en"><head>${shellHead('Something went wrong')}</head><body>
<main>
<section data-surface="server-error" role="region" aria-labelledby="serverErrorHeading">
  <h1 id="serverErrorHeading">Something went wrong</h1>
  <p>The server hit an internal failure. Retry in a moment or contact support if the failure persists.</p>
  <button type="button" data-recovery="retry" aria-label="Retry the failed request">Retry</button>
  ${stackBlock}
</section>
</main>
</body></html>`;
}

function permissionDeniedPage({ leakId }) {
  const cause = leakId ? 'admin scope required for resource widget-2039-alpha' : 'admin scope required';
  return `<!doctype html><html lang="en"><head>${shellHead('Permission denied')}</head><body>
<main>
<section data-surface="permission-denied" role="region" aria-labelledby="permDeniedHeading">
  <h1 id="permDeniedHeading">Permission denied</h1>
  <p>You reached this route but your role does not cover the operation.</p>
  <p><span data-cause>${escapeHtml(cause)}</span></p>
  <button type="button" data-action="request-access" aria-label="Request the admin scope">Request access</button>
</section>
</main>
</body></html>`;
}

function offlinePage({ reconnect, break_ }) {
  // Seed the buffer so the pack can observe it on the initial GET.
  const seed = JSON.stringify(SEED_OFFLINE_BUFFER);
  const liveText = reconnect ? 'Reconnected. Flushing 1 buffered write.' : '';
  const liveWrapper = reconnect && break_ === 'no-live-region'
    ? ''
    : `<div data-live-region="polite" role="status" aria-live="polite">${escapeHtml(liveText)}</div>`;
  return `<!doctype html><html lang="en"><head>${shellHead('Offline')}</head><body>
<main>
<section data-surface="offline" role="region" aria-labelledby="offlineHeading">
  <h1 id="offlineHeading">Working offline</h1>
  <p data-banner="offline">You are offline. Writes are buffering locally and will flush when the network returns.</p>
  <p>Buffered writes: <span id="bufferCount">1</span></p>
</section>
${liveWrapper}
<script>
  window.__offlineBuffer = ${seed};
</script>
</main>
</body></html>`;
}

function emptyListPage({ break_ }) {
  const createControl = break_ === 'no-recovery'
    ? ''
    : '<a href="/probe/widgets/new" data-recovery="create">Create a widget</a>';
  return `<!doctype html><html lang="en"><head>${shellHead('No widgets yet')}</head><body>
<main>
<section data-surface="empty-list" role="region" aria-labelledby="emptyListHeading">
  <h1 id="emptyListHeading">No widgets yet</h1>
  <div data-visual="empty-list">
    <p>This workspace has no widgets yet. Create the first one to see it listed here.</p>
    ${createControl}
  </div>
</section>
</main>
</body></html>`;
}

function noSearchResultsPage({ q }) {
  const query = typeof q === 'string' && q.length > 0 ? q : '';
  return `<!doctype html><html lang="en"><head>${shellHead('No matches')}</head><body>
<main>
<section data-surface="no-search-results" role="region" aria-labelledby="noSearchHeading">
  <h1 id="noSearchHeading">No matches</h1>
  <div data-visual="no-search-results">
    <p>No widgets match your query <span data-query>${escapeHtml(query)}</span>.</p>
    <form action="/probe/search" method="get">
      <button type="submit" name="q" value="" data-recovery="clear-filters">Clear filters</button>
    </form>
  </div>
</section>
</main>
</body></html>`;
}

function errorBoundaryPage({ crash }) {
  const errorBlock = crash
    ? '<p>A widget component threw during render. The boundary caught the failure.</p>'
    : '<p>Nothing crashed. Add ?crash=1 to drive the boundary.</p>';
  const region = crash
    ? `<section data-surface="error-boundary" role="alert" aria-labelledby="errorBoundaryHeading">
  <h1 id="errorBoundaryHeading">Widget failed to render</h1>
  ${errorBlock}
  <button type="button" data-recovery="retry" aria-label="Retry the widget render">Retry</button>
</section>`
    : '<section><p>error-boundary standby</p></section>';
  return `<!doctype html><html lang="en"><head>${shellHead('Widget failed to render')}</head><body>
<main>
${region}
</main>
</body></html>`;
}

function htmlResponse(res, body, status) {
  const payload = body;
  res.writeHead(status ?? 200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// A default break can be forced across every request via the
// EMPTY_ERROR_STATES_BREAK env variable. This lets the pack drive the
// negative runs on plain /probe/<state> paths without needing to
// append a per-request query. The per-request `?break=` still wins
// when both are set.
const DEFAULT_BREAK = process.env.EMPTY_ERROR_STATES_BREAK || null;

function requestHandler(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const break_ = reqUrl.searchParams.get('break') || DEFAULT_BREAK;

  if (req.method === 'POST' && reqUrl.pathname === '/api/request-access') {
    return jsonResponse(res, 200, { ok: true });
  }
  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { error: 'method not allowed' });
  }
  const path = reqUrl.pathname;
  const state = reqUrl.searchParams.get('state');
  const chosen = state && NAMED_STATES.includes(state) ? `/probe/${state}` : path;
  switch (chosen) {
    case '/':
    case '/probe':
      return htmlResponse(res, indexPage(), 200);
    case '/probe/not-found':
      return htmlResponse(res, notFoundPage(), 404);
    case '/probe/forbidden':
      return htmlResponse(res, forbiddenPage({ leakId: break_ === 'leak-id' }), 403);
    case '/probe/server-error':
      return htmlResponse(res, serverErrorPage({ break_ }), 500);
    case '/probe/permission-denied':
      return htmlResponse(res, permissionDeniedPage({ leakId: break_ === 'leak-id' }), 403);
    case '/probe/offline':
      return htmlResponse(res, offlinePage({ reconnect: reqUrl.searchParams.get('reconnect') === '1', break_ }), 200);
    case '/probe/empty-list':
      return htmlResponse(res, emptyListPage({ break_ }), 200);
    case '/probe/search':
      return htmlResponse(res, noSearchResultsPage({ q: reqUrl.searchParams.get('q') ?? '' }), 200);
    case '/probe/error-boundary':
      return htmlResponse(res, errorBoundaryPage({ crash: reqUrl.searchParams.get('crash') === '1' }), 200);
    case '/probe/widgets':
      return htmlResponse(res, parentSurfacePage(), 200);
    default:
      return htmlResponse(res, notFoundPage(), 404);
  }
}

function indexPage() {
  const links = NAMED_STATES.map((s) => `<li><a href="/probe/${s}">${escapeHtml(s)}</a></li>`).join('');
  return `<!doctype html><html lang="en"><head>${shellHead('empty-error-states fixture')}</head><body>
<main>
<h1>Sample app for application-empty-error-states</h1>
<p>Every named state is served under /probe/&lt;name&gt;. Add ?break=&lt;switch&gt; to drive a negative run. See README for the full switch list.</p>
<ul>${links}</ul>
</main>
</body></html>`;
}

function parentSurfacePage() {
  return `<!doctype html><html lang="en"><head>${shellHead('Widgets')}</head><body>
<main>
<h1>Widgets</h1>
<p>Parent surface stub the not-found recovery link points at.</p>
</main>
</body></html>`;
}

export function startServer({ port } = {}) {
  const server = http.createServer(requestHandler);
  return new Promise((resolve) => {
    server.listen(port ?? 0, () => {
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ server, port: boundPort });
    });
  });
}

// CLI entry: node server.js
const isDirect = import.meta.url === `file://${process.argv[1]}`;
if (isDirect) {
  const port = Number(process.env.PORT ?? 3000);
  if (port === 4200) {
    process.stderr.write('refusing to bind port 4200 (reserved for the operator workspace)\n');
    process.exit(2);
  }
  startServer({ port }).then(({ port: boundPort }) => {
    process.stdout.write(`LISTENING ${boundPort}\n`);
  });
}
