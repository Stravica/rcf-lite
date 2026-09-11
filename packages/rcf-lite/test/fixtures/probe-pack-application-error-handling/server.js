// Sample-app fixture for the application-error-handling probe pack.
//
// A dependency-free Node HTTP server carrying the smallest surface
// the application-error-handling probes assert on:
//
//   - /construct/:category: returns a constructed error record in
//     the ADR-1701 shape (code, category, message, occurredAt,
//     traceId, cause, context, remediation) with the requested
//     category (REQ-002, REQ-003).
//   - /boundary/framework: returns the record the framework-level
//     handler produced from a synthetic uncaught exception (REQ-001,
//     REQ-004). Emission is stubbed here: the record is appended to
//     an in-memory sink readable at /emitted.
//   - /boundary/process: same for the process-level handler, marked
//     with source=process so the probe can pair the two.
//   - /emitted: JSON list of the records emitted so a probe can pair
//     the boundary calls with the recorded emits.
//   - /healthz: liveness ping.
//
// Exports startServer({ port }) so probes and anatomy tests can drive
// on ephemeral or fixed ports without a subprocess. Ports 47300-47399
// are reserved for the shelf-gate probe packs; default is 3000 for
// manual runs.

import http from 'node:http';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';

const CATEGORIES = new Set([
  'validation',
  'authorization',
  'notFound',
  'conflict',
  'downstream',
  'internal',
]);

function constructRecord({ category, source }) {
  return {
    code: 'ERR_SAMPLE_' + category.toUpperCase(),
    category,
    message: `sample ${category} error`,
    occurredAt: new Date().toISOString(),
    traceId: randomUUID(),
    cause: null,
    context: { source: source || 'app', fixture: 'application-error-handling' },
    remediation: `retry after correcting the ${category} input`,
  };
}

// In-memory emission sink. The two boundaries push here so the pair
// is checkable via GET /emitted.
const emitted = [];

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }
  if (url.pathname === '/emitted') {
    sendJson(res, 200, { emitted });
    return;
  }
  const constructMatch = url.pathname.match(/^\/construct\/([a-zA-Z]+)$/);
  if (constructMatch) {
    const category = constructMatch[1];
    if (!CATEGORIES.has(category)) {
      sendJson(res, 400, { error: 'unknown category', requested: category, allowed: [...CATEGORIES] });
      return;
    }
    const record = constructRecord({ category, source: 'construct' });
    sendJson(res, 200, record);
    return;
  }
  if (url.pathname === '/boundary/framework') {
    const record = constructRecord({ category: 'internal', source: 'framework-boundary' });
    emitted.push({ ...record, boundary: 'framework' });
    sendJson(res, 500, { boundary: 'framework', record });
    return;
  }
  if (url.pathname === '/boundary/process') {
    const record = constructRecord({ category: 'internal', source: 'process-boundary' });
    emitted.push({ ...record, boundary: 'process' });
    sendJson(res, 500, { boundary: 'process', record });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
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
