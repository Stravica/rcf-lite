// Sample-app fixture for the application-api-rest probe pack.
//
// A dependency-free Node HTTP server that carries the smallest
// surface the application-api-rest probes assert on:
//
//   - Cursor-paginated JSON collection at /v1/widgets (REQ-007) with
//     a nextCursor field per the shipped shape.
//   - Health probes at /livez, /readyz, /startupz (REQ-006) that
//     return distinct JSON status bodies.
//   - RFC 7807 problem-details error body on any unknown resource
//     (REQ-009), with the correct application/problem+json content
//     type and the five required fields.
//   - Request-id echo at x-request-id (REQ-013): the server accepts
//     an inbound x-request-id header or synthesises one, and echoes
//     it on the response.
//
// Exports startServer({ port }) so the probes and anatomy tests
// can drive the fixture on ephemeral or fixed ports without a
// subprocess. Ports 47300-47399 are reserved for the shelf-gate
// probe packs; the default is 3000 to keep manual runs friendly.

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
  const inboundReqId = req.headers['x-request-id'];
  const requestId = typeof inboundReqId === 'string' && inboundReqId.length > 0
    ? inboundReqId
    : randomUUID();
  res.setHeader('x-request-id', requestId);

  if (url.pathname === '/livez') {
    sendJson(res, 200, { status: 'alive', probe: 'livez', requestId }, { 'x-request-id': requestId });
    return;
  }
  if (url.pathname === '/readyz') {
    sendJson(res, 200, { status: 'ready', probe: 'readyz', requestId }, { 'x-request-id': requestId });
    return;
  }
  if (url.pathname === '/startupz') {
    sendJson(res, 200, { status: 'started', probe: 'startupz', requestId }, { 'x-request-id': requestId });
    return;
  }
  if (url.pathname === '/v1/widgets' && req.method === 'GET') {
    const cursor = parseCursor(url.searchParams.get('cursor'));
    const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '5', 10) || 5));
    const items = WIDGETS.slice(cursor, cursor + limit);
    const nextCursor = cursor + limit < WIDGETS.length ? String(cursor + limit) : null;
    sendJson(res, 200, {
      items,
      nextCursor,
      total: WIDGETS.length,
      requestId,
    }, { 'x-request-id': requestId });
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
    sendJson(res, 200, { ...w, requestId }, { 'x-request-id': requestId });
    return;
  }
  // Unknown route falls through to a problem-details 404.
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
