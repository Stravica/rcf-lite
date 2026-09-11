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
import { randomUUID as __rid } from 'node:crypto';

import { URL } from 'node:url';

// Every response carries an x-fixture-request-id header (positive
// evidence per section 7d): the criterion-e probes echo this id back
// into the run record so a later reader can prove the response was
// answered by this fixture on this run, not fabricated by a local
// mock.
function withRequestId__(handler){
  return async function wrapped__(req,res){
    const rid=__rid();
    const orig=res.writeHead.bind(res);
    res.writeHead=function patched__(){
      const args=Array.from(arguments);
      const last=args[args.length-1];
      if(last&&typeof last==='object'&&!Array.isArray(last)){last['x-fixture-request-id']=rid;}
      else if(Array.isArray(last)){last.push('x-fixture-request-id',rid);}
      else{args.push({'x-fixture-request-id':rid});}
      return orig.apply(res,args);
    };
    return handler(req,res);
  };
}


// Pre-seeded buffered write the pack observes on the offline
// route. Idempotency token and monotonic sequence per TAC-2303.
const SEED_OFFLINE_BUFFER = [
  { idempotencyToken: 'idempotency-token-seed-write-1', payload: { kind: 'note', body: 'offline draft' }, sequence: 1 },
];

// AC-22105-1 server-side buffer lifecycle: enqueue while offline,
// flush on reconnect, delivery-log records the drained items. The
// probe drives this via HTTP so the buffer lifecycle IS observable
// from a server-side vantage (banner state + enqueue count + flushed
// count). Keyed by principal-id (defaults to a single-tenant fixture
// principal). Each principal's state is (state, buffer[], delivered[]).
const offlineBufferState = new Map();

function readOfflineState(principalId) {
  if (!offlineBufferState.has(principalId)) {
    offlineBufferState.set(principalId, {
      state: 'online',
      buffer: [...SEED_OFFLINE_BUFFER],
      delivered: [],
      lastFlushedCount: 0,
      lastFlushedAt: null,
      lastEnqueuedAt: null,
      nextSequence: SEED_OFFLINE_BUFFER.length + 1,
    });
  }
  return offlineBufferState.get(principalId);
}

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
  <p data-safe-response>The workspace exists but its details are hidden from unauthorised viewers.</p>
  <span data-request-id="req-forbidden-000001" hidden>req-forbidden-000001</span>
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
  <p data-safe-error>The server hit an internal failure. The support team has the request id below.</p>
  <span data-correlation-id="cid-server-000001" hidden>cid-server-000001</span>
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
  <span data-cause-class="scope-missing" hidden>scope-missing</span>
  <span data-request-id="req-perm-000001" hidden>req-perm-000001</span>
</section>
</main>
</body></html>`;
}

function offlinePage({ reconnect, break_, principalId }) {
  const s = readOfflineState(principalId);
  // Presence of ?reconnect=1 on the URL is treated as an observation
  // hint (equivalent to a POST /probe/offline/reconnect). Kept as a
  // convenience so previous callers still see the reconnected banner.
  if (reconnect && s.state === 'offline') {
    flushOfflineBuffer(s);
  }
  const bufferCount = s.buffer.length;
  const flushedCount = s.lastFlushedCount || 0;
  const banner = s.state === 'offline'
    ? `<p data-banner="offline">You are offline. Writes are buffering locally and will flush when the network returns.</p>`
    : `<p data-banner="online">Online. Buffered writes have been flushed.</p>`;
  const liveText = reconnect ? `Reconnected. Flushing ${flushedCount} buffered write${flushedCount === 1 ? '' : 's'}.` : '';
  const liveWrapper = reconnect && break_ === 'no-live-region'
    ? ''
    : `<div data-live-region="polite" role="status" aria-live="polite">${escapeHtml(liveText)}</div>`;
  const seed = JSON.stringify(s.buffer);
  return `<!doctype html><html lang="en"><head>${shellHead('Offline')}</head><body>
<main>
<section data-surface="offline" role="region" aria-labelledby="offlineHeading" data-buffer-state="${s.state}" data-buffer-count="${bufferCount}" data-flushed-count="${flushedCount}">
  <h1 id="offlineHeading">Working offline</h1>
  ${banner}
  <p>Buffered writes: <span id="bufferCount">${bufferCount}</span></p>
  <p>Last flushed count: <span data-role="last-flushed-count">${flushedCount}</span></p>
</section>
${liveWrapper}
<script>
  window.__offlineBuffer = ${seed};
</script>
</main>
</body></html>`;
}

function flushOfflineBuffer(s) {
  const drained = s.buffer.slice();
  s.delivered = s.delivered.concat(drained);
  s.buffer = [];
  s.state = 'online';
  s.lastFlushedCount = drained.length;
  s.lastFlushedAt = new Date().toISOString();
  return drained;
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
  <span data-error-class="render-failure" hidden>render-failure</span>
  <span data-correlation-id="cid-boundary-000001" hidden>cid-boundary-000001</span>
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

function readPrincipalId(req, url) {
  const header = req.headers['x-principal-id'];
  if (typeof header === 'string' && header.length > 0) return header;
  const q = url.searchParams.get('principal-id');
  return typeof q === 'string' && q.length > 0 ? q : 'fixture-default-principal';
}

function requestHandler(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const break_ = reqUrl.searchParams.get('break') || process.env.PROBE_BREAK || DEFAULT_BREAK;
  const principalId = readPrincipalId(req, reqUrl);

  // AC-22105-1 server-side buffer lifecycle endpoints. Enqueue during
  // 'offline'; flush on reconnect drains the buffer into delivered[].
  if (reqUrl.pathname === '/probe/offline/state') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let parsed;
        try { parsed = body.length ? JSON.parse(body) : {}; } catch (e) { parsed = null; }
        if (!parsed || (parsed.state !== 'online' && parsed.state !== 'offline')) {
          return jsonResponse(res, 400, { error: 'body must be { state: "online" | "offline" }' });
        }
        const s = readOfflineState(principalId);
        s.state = parsed.state;
        return jsonResponse(res, 200, { ok: true, principalId, state: s.state, bufferCount: s.buffer.length });
      });
      return;
    }
    if (req.method === 'GET') {
      const s = readOfflineState(principalId);
      return jsonResponse(res, 200, { principalId, state: s.state, bufferCount: s.buffer.length, deliveredCount: s.delivered.length, lastFlushedCount: s.lastFlushedCount });
    }
    return jsonResponse(res, 405, { error: 'method not allowed' });
  }
  if (reqUrl.pathname === '/probe/offline/buffer') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let parsed;
        try { parsed = body.length ? JSON.parse(body) : {}; } catch (e) { parsed = null; }
        const s = readOfflineState(principalId);
        if (s.state !== 'offline') {
          return jsonResponse(res, 409, { error: 'buffer accepts writes only when state=offline', state: s.state });
        }
        const idempotencyToken = parsed && typeof parsed.idempotencyToken === 'string' ? parsed.idempotencyToken : ('token-' + __rid());
        // Idempotency: if this token already exists in the buffer, do
        // not add a duplicate (AC-22105-1 idempotency-per-token contract).
        const existing = s.buffer.find((b) => b.idempotencyToken === idempotencyToken);
        if (existing) {
          return jsonResponse(res, 200, { ok: true, principalId, bufferCount: s.buffer.length, deduped: true, sequence: existing.sequence });
        }
        const payload = parsed && parsed.payload ? parsed.payload : {};
        const sequence = s.nextSequence++;
        s.buffer.push({ idempotencyToken, payload, sequence });
        s.lastEnqueuedAt = new Date().toISOString();
        return jsonResponse(res, 200, { ok: true, principalId, bufferCount: s.buffer.length, sequence });
      });
      return;
    }
    if (req.method === 'GET') {
      const s = readOfflineState(principalId);
      return jsonResponse(res, 200, { principalId, buffer: s.buffer, bufferCount: s.buffer.length });
    }
    return jsonResponse(res, 405, { error: 'method not allowed' });
  }
  if (reqUrl.pathname === '/probe/offline/reconnect' && req.method === 'POST') {
    const s = readOfflineState(principalId);
    if (s.state !== 'offline') {
      return jsonResponse(res, 409, { error: 'reconnect requires state=offline', state: s.state });
    }
    const drained = flushOfflineBuffer(s);
    return jsonResponse(res, 200, { ok: true, principalId, state: s.state, flushedCount: drained.length, deliveredCount: s.delivered.length });
  }

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
      return htmlResponse(res, offlinePage({ reconnect: reqUrl.searchParams.get('reconnect') === '1', break_, principalId }), 200);
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
  const server = http.createServer(withRequestId__(requestHandler));
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
