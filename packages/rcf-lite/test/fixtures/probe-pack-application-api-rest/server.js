// Sample-app fixture for the application-api-rest probe pack.
//
// A dependency-free Node HTTP server that carries the smallest
// surface the application-api-rest probes assert on:
//
//   - Three distinct probe endpoints /livez, /readyz, /startupz
//     (AC-2108-1, AC-2108-2, AC-2108-4) each answering their own
//     question with a JSON body naming which probe replied.
//   - A cursor-paginated collection at /v1/widgets (AC-2109-1) with
//     the REQ-007 envelope { items, next, prev, total?, requestId }
//     - next is a cursor string on non-final pages and null on the
//     last page; prev is a cursor string on non-first pages and
//     null on the first (AC-2109-2). total is only included when
//     the client passes ?count=true.
//   - RFC 7807 problem-details bodies for unknown routes and
//     unknown widget ids (AC-2111-1) with application/problem+json,
//     the five required fields, and status equal to the HTTP status
//     line (AC-2111-3).
//   - Request-id echoed on x-request-id (AC-2117-1) or generated
//     when absent (AC-2117-2). The same value is also stamped as
//     x-fixture-request-id for probes that read via the shared
//     evidence helper.
//
// Ports 47300-47399 are reserved for shelf-gate probe packs.

import http from 'node:http';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';

const WIDGETS = Array.from({ length: 12 }).map((_, i) => ({
  id: `widget-${(i + 1).toString().padStart(3, '0')}`,
  name: `Widget ${i + 1}`,
  createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
}));

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

function parseCursor(cursor) {
  if (!cursor) return 0;
  const n = Number.parseInt(cursor, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const inbound = req.headers['x-request-id'];
  const requestId = typeof inbound === 'string' && inbound.length > 0
    ? inbound
    : randomUUID();
  res.setHeader('x-request-id', requestId);
  res.setHeader('x-fixture-request-id', requestId);

  if (url.pathname === '/livez') {
    sendJson(res, 200, { status: 'alive', probe: 'livez', requestId }, { 'x-request-id': requestId, 'x-fixture-request-id': requestId });
    return;
  }
  if (url.pathname === '/readyz') {
    sendJson(res, 200, { status: 'ready', probe: 'readyz', requestId, checks: [{ name: 'database', ok: true }] }, { 'x-request-id': requestId, 'x-fixture-request-id': requestId });
    return;
  }
  if (url.pathname === '/startupz') {
    sendJson(res, 200, { status: 'started', probe: 'startupz', requestId, pending: [] }, { 'x-request-id': requestId, 'x-fixture-request-id': requestId });
    return;
  }
  if (url.pathname === '/v1/widgets' && req.method === 'GET') {
    const cursor = parseCursor(url.searchParams.get('cursor'));
    const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '5', 10) || 5));
    const includeCount = url.searchParams.get('count') === 'true';
    const items = WIDGETS.slice(cursor, cursor + limit);
    const nextIndex = cursor + limit;
    const prevIndex = cursor - limit;
    const next = nextIndex < WIDGETS.length ? String(nextIndex) : null;
    const prev = cursor > 0 ? String(Math.max(0, prevIndex)) : null;
    const body = { items, next, prev, requestId };
    if (includeCount) body.total = WIDGETS.length;
    sendJson(res, 200, body, { 'x-request-id': requestId, 'x-fixture-request-id': requestId });
    return;
  }
  if (url.pathname.startsWith('/v1/widgets/') && req.method === 'GET') {
    const id = url.pathname.slice('/v1/widgets/'.length);
    const w = WIDGETS.find((x) => x.id === id);
    if (!w) {
      sendProblem(res, 404, {
        type: 'https://example.com/probs/widget-not-found',
        title: 'Widget not found',
        status: 404,
        detail: `No widget with id ${id}.`,
        instance: url.pathname,
        requestId,
      }, requestId);
      return;
    }
    sendJson(res, 200, { ...w, requestId }, { 'x-request-id': requestId, 'x-fixture-request-id': requestId });
    return;
  }
  // Unknown route falls through to a problem-details 404 that carries
  // status inside the envelope matching the HTTP status line.
  sendProblem(res, 404, {
    type: 'https://example.com/probs/route-not-found',
    title: 'Route not found',
    status: 404,
    detail: `No route registered for ${req.method} ${url.pathname}.`,
    instance: url.pathname,
    requestId,
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
