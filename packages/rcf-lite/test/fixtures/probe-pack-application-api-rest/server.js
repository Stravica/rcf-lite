// Sample-app fixture for the application-api-rest probe pack.
//
// A dependency-free Node HTTP server that carries the smallest
// surface the application-api-rest probes assert on. Every response
// carries an x-fixture-request-id header stamped from x-request-id
// or a freshly-generated UUID (AC-2117-1/2117-2).
//
// Notable behaviour:
//   - /livez, /readyz and /startupz each answer their own question
//     and vary output on ?deps= and ?state= respectively, so a probe
//     can drive multiple states and assert derived responses.
//   - /v1/widgets returns an opaque base64url cursor over an internal
//     marker; a malformed cursor returns application/problem+json
//     with type=cursor.invalid; ?limit above 50 returns
//     application/problem+json with type=limit.exceeded (REQ-007
//     opacity and max-limit).
//   - /__logs?requestId=X returns the request-scoped log line the
//     fixture emitted for that request, so a probe can compare the
//     response echo to a real log line (AC-2117-1).

import http from 'node:http';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';

const WIDGETS = Array.from({ length: 12 }).map((_, i) => ({
  id: `widget-${(i + 1).toString().padStart(3, '0')}`,
  name: `Widget ${i + 1}`,
  createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
}));

// In-memory request log keyed by requestId; probes read via /__logs.
const REQUEST_LOG = new Map();

function logRequest(requestId, route, status) {
  REQUEST_LOG.set(requestId, { requestId, route, status, at: new Date().toISOString() });
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(JSON.stringify(body));
}

function sendProblem(res, status, problem, requestId) {
  res.writeHead(status, {
    'content-type': 'application/problem+json; charset=utf-8',
    'x-request-id': requestId,
    'x-fixture-request-id': requestId,
  });
  res.end(JSON.stringify(problem));
}

// Opaque cursor: base64url over a JSON marker { i: <index>, tag: 'v1' }.
// A probe cannot recover the numeric offset from the token without
// duplicating the fixture's decode logic, so REQ-007 opacity holds.
function encodeCursor(index) {
  const raw = JSON.stringify({ i: index, tag: 'v1' });
  return Buffer.from(raw, 'utf8').toString('base64url');
}
function decodeCursor(cursor) {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const marker = JSON.parse(raw);
    if (marker && typeof marker.i === 'number' && marker.tag === 'v1' && marker.i >= 0) {
      return { ok: true, index: marker.i };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const inbound = req.headers['x-request-id'];
  const requestId = typeof inbound === 'string' && inbound.length > 0 ? inbound : randomUUID();
  res.setHeader('x-request-id', requestId);
  res.setHeader('x-fixture-request-id', requestId);

  const commonHeaders = { 'x-request-id': requestId, 'x-fixture-request-id': requestId };

  if (url.pathname === '/livez') {
    // Liveness varies on ?deps=up|down|unknown so a probe can drive
    // multiple dependency-availability states and assert derived
    // status codes (AC-2108-1).
    const deps = url.searchParams.get('deps') || 'up';
    const status = deps === 'down' ? 503 : 200;
    const alive = deps === 'down' ? 'notAlive' : 'alive';
    logRequest(requestId, '/livez', status);
    sendJson(res, status, { status: alive, probe: 'livez', requestId, deps }, commonHeaders);
    return;
  }
  if (url.pathname === '/readyz') {
    // Readiness enumerates declared dependency checks; a probe can
    // drive one check down via ?deps=down and observe the response
    // becomes not ready while carrying every declared check's status
    // (AC-2108-2).
    const deps = url.searchParams.get('deps') || 'up';
    const declared = [
      { name: 'database', ok: deps !== 'down' },
      { name: 'cache', ok: deps !== 'down-cache' && deps !== 'down' },
      { name: 'messageBus', ok: true },
    ];
    const allOk = declared.every((c) => c.ok);
    const status = allOk ? 200 : 503;
    const readyLabel = allOk ? 'ready' : 'notReady';
    logRequest(requestId, '/readyz', status);
    sendJson(res, status, { status: readyLabel, probe: 'readyz', requestId, checks: declared }, commonHeaders);
    return;
  }
  if (url.pathname === '/startupz') {
    // Startup accepts ?state=init|complete so a probe can observe
    // both mid-initialisation (503 with pending!=[]) and completed
    // (200 with pending==[]) states (AC-2108-4).
    const state = url.searchParams.get('state') || 'complete';
    const pending = state === 'init' ? ['migrations', 'warmCache'] : [];
    const startedOk = pending.length === 0;
    const status = startedOk ? 200 : 503;
    const label = startedOk ? 'started' : 'starting';
    logRequest(requestId, '/startupz', status);
    sendJson(res, status, { status: label, probe: 'startupz', requestId, pending }, commonHeaders);
    return;
  }
  if (url.pathname === '/__logs' && req.method === 'GET') {
    // Request-scoped log lookup so a probe can compare the response
    // echo with the fixture's own log line (AC-2117-1).
    const q = url.searchParams.get('requestId');
    const line = q && REQUEST_LOG.get(q);
    if (!line) {
      logRequest(requestId, '/__logs', 404);
      sendProblem(res, 404, {
        type: 'https://example.com/probs/log-not-found', title: 'Log not found', status: 404,
        detail: `No log line for requestId ${q}.`, instance: url.pathname, requestId,
      }, requestId);
      return;
    }
    logRequest(requestId, '/__logs', 200);
    sendJson(res, 200, line, commonHeaders);
    return;
  }
  if (url.pathname === '/v1/widgets' && req.method === 'GET') {
    const rawCursor = url.searchParams.get('cursor');
    const rawLimit = url.searchParams.get('limit');
    // Max limit is 50; violations return problem+json with
    // type=limit.exceeded per REQ-007.
    if (rawLimit !== null) {
      const parsed = Number.parseInt(rawLimit, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 50) {
        logRequest(requestId, '/v1/widgets', 400);
        sendProblem(res, 400, {
          type: 'https://example.com/probs/limit-exceeded', title: 'Limit exceeded', status: 400,
          detail: `?limit must be an integer between 1 and 50; got ${rawLimit}.`,
          instance: url.pathname, requestId,
        }, requestId);
        return;
      }
    }
    const limit = Math.min(50, Math.max(1, Number.parseInt(rawLimit ?? '5', 10) || 5));
    let index = 0;
    if (rawCursor !== null) {
      const decoded = decodeCursor(rawCursor);
      if (!decoded.ok) {
        logRequest(requestId, '/v1/widgets', 400);
        sendProblem(res, 400, {
          type: 'https://example.com/probs/cursor-invalid', title: 'Cursor invalid', status: 400,
          detail: `?cursor is not a valid opaque token.`, instance: url.pathname, requestId,
        }, requestId);
        return;
      }
      index = decoded.index;
    }
    const includeCount = url.searchParams.get('count') === 'true';
    const items = WIDGETS.slice(index, index + limit);
    const nextIndex = index + limit;
    const prevIndex = index - limit;
    const next = nextIndex < WIDGETS.length ? encodeCursor(nextIndex) : null;
    const prev = index > 0 ? encodeCursor(Math.max(0, prevIndex)) : null;
    const body = { items, next, prev, requestId };
    if (includeCount) body.total = WIDGETS.length;
    logRequest(requestId, '/v1/widgets', 200);
    sendJson(res, 200, body, commonHeaders);
    return;
  }
  if (url.pathname.startsWith('/v1/widgets/') && req.method === 'GET') {
    const id = url.pathname.slice('/v1/widgets/'.length);
    const w = WIDGETS.find((x) => x.id === id);
    if (!w) {
      logRequest(requestId, url.pathname, 404);
      sendProblem(res, 404, {
        type: 'https://example.com/probs/widget-not-found', title: 'Widget not found', status: 404,
        detail: `No widget with id ${id}.`, instance: url.pathname, requestId,
      }, requestId);
      return;
    }
    logRequest(requestId, url.pathname, 200);
    sendJson(res, 200, { ...w, requestId }, commonHeaders);
    return;
  }
  logRequest(requestId, url.pathname, 404);
  sendProblem(res, 404, {
    type: 'https://example.com/probs/route-not-found', title: 'Route not found', status: 404,
    detail: `No route registered for ${req.method} ${url.pathname}.`,
    instance: url.pathname, requestId,
  }, requestId);
}

export function startServer({ port } = {}) {
  const desiredPort = typeof port === 'number' ? port : Number(process.env.PORT ?? 3000);
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(desiredPort, '127.0.0.1', () => {
      const addr = server.address();
      const bound = typeof addr === 'object' && addr ? addr.port : desiredPort;
      resolve({ server, port: bound });
    });
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  startServer({}).then(({ port }) => {
    process.stdout.write(`LISTENING ${port}\n`);
  }).catch((err) => {
    process.stderr.write(`fixture failed to start: ${err.message}\n`);
    process.exit(1);
  });
}
