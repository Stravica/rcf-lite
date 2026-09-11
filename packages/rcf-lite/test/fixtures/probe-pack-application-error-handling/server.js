// Sample-app fixture for the application-error-handling probe pack.
//
// A dependency-free Node HTTP server that carries the smallest
// surface the application-error-handling probes assert on:
//
//   - /construct/:category: returns a constructed error record in
//     the ADR-1701 exact six-field shape (code, category, message,
//     correlationId, cause, context). The category vocabulary is
//     the ADR-1702 recommended default set (transient, permanent,
//     unknown); an unelicited category is refused per AC-16105-4
//     with a 400 body naming the refusal.
//   - /throw-handler: a framework-level boundary path that catches
//     a synthetic uncaught exception, maps it to the wire body
//     without leaking a stack, filesystem path or file:// URL, and
//     appends the emitted record to /emitted (AC-16102-1).
//   - /crash-process: a process-level boundary path that constructs
//     one record for the caught exception, records it as emitted,
//     and returns { didExit: 1 } so the probe can assert exit-code
//     semantics without actually killing the fixture (AC-16101-1).
//   - /emitted: JSON list of records the boundaries have emitted.
//   - Every response carries x-fixture-request-id.
//
// Ports 47300-47399 are reserved for shelf-gate probe packs.

import http from 'node:http';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';

// ADR-1702 recommended default vocabulary. Additional categories
// are elicited per project and are not accepted by the fixture.
const CATEGORIES = new Set(['transient', 'permanent', 'unknown']);

function constructRecord({ category, source, correlationId, cause }) {
  // ADR-1701: exactly six fields; correlationId included; no
  // occurredAt, no traceId, no remediation on the record.
  return {
    code: 'ERR_SAMPLE_' + category.toUpperCase(),
    category,
    message: `sample ${category} error`,
    correlationId: correlationId || randomUUID(),
    cause: cause || null,
    context: { source: source || 'app', fixture: 'application-error-handling' },
  };
}

// In-memory emission sink. Both boundaries push records here so the
// pair is checkable via GET /emitted; the process boundary also
// carries a boundary tag so the pair test can distinguish framework
// vs process origin.
const emitted = [];

function stampRequestId(req, res) {
  const inbound = req.headers['x-request-id'];
  const id = typeof inbound === 'string' && inbound.length > 0 ? inbound : randomUUID();
  res.setHeader('x-fixture-request-id', id);
  return id;
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

function scrubForWire(text) {
  // The framework-level boundary strips any /Users/, /home/ and
  // file:// substring before the transport writes; AC-16102-2.
  return String(text)
    .replace(/\/Users\/[^\s"']+/g, '<path>')
    .replace(/\/home\/[^\s"']+/g, '<path>')
    .replace(/file:\/\/[^\s"']+/g, '<uri>');
}

function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const requestId = stampRequestId(req, res);
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }
  if (url.pathname === '/emitted') {
    sendJson(res, 200, { emitted });
    return;
  }
  if (url.pathname === '/throw-handler') {
    // A handler that throws produces a mapped wire body (AC-16102-1).
    // The synthetic exception carries a stack with /Users/, /home/
    // and file:// substrings; the wire body must carry none of them
    // (AC-16102-2). The record is appended to /emitted with source
    // marked framework-boundary.
    let record;
    try {
      const err = new Error('handler threw during request');
      err.stack = 'Error: handler threw during request\n    at handler (/Users/probe/app.js:12:3)\n    at (/home/ci/build/dispatch.js:44:5)\n    at file:///opt/app/router.js:2:1';
      throw err;
    } catch (thrown) {
      record = constructRecord({
        category: 'permanent',
        source: 'framework-boundary',
        cause: { message: scrubForWire(thrown.message), category: 'unknown' },
      });
      emitted.push({ ...record, boundary: 'framework', requestId });
      // Wire response: mapped, no stack, no path, no file:// URL.
      sendJson(res, 500, {
        error: {
          code: record.code,
          category: record.category,
          message: record.message,
          correlationId: record.correlationId,
        },
        wireVersion: 1,
      }, { 'x-fixture-request-id': requestId });
      return;
    }
  }
  if (url.pathname === '/crash-process') {
    // Process-level boundary: constructs one record for the caught
    // exception and reports its intent to exit with code 1
    // (AC-16101-1). The fixture reports rather than actually
    // exiting; the response body carries didExit: 1 so the probe
    // can assert the exit-status contract without the fixture
    // dying under it.
    const record = constructRecord({
      category: 'unknown',
      source: 'process-boundary',
      cause: { message: 'synthetic uncaughtException', category: 'unknown' },
    });
    emitted.push({ ...record, boundary: 'process', requestId });
    sendJson(res, 200, { record, didExit: 1 }, { 'x-fixture-request-id': requestId });
    return;
  }
  const constructMatch = url.pathname.match(/^\/construct\/([a-zA-Z]+)$/);
  if (constructMatch) {
    const category = constructMatch[1];
    if (!CATEGORIES.has(category)) {
      // AC-16105-4: an unelicited token is refused, not silently
      // accepted. The response body names the refused token and
      // the accepted set.
      sendJson(res, 400, {
        error: 'unelicited-category',
        refused: category,
        accepted: [...CATEGORIES],
        detail: 'category token not in ADR-1702 defaults and not elicited by this project',
      });
      return;
    }
    const record = constructRecord({ category, source: 'construct' });
    sendJson(res, 200, record);
    return;
  }
  if (url.pathname === '/boundary/framework') {
    const record = constructRecord({ category: 'unknown', source: 'framework-boundary' });
    emitted.push({ ...record, boundary: 'framework', requestId });
    sendJson(res, 500, { boundary: 'framework', record });
    return;
  }
  if (url.pathname === '/boundary/process') {
    const record = constructRecord({ category: 'unknown', source: 'process-boundary' });
    emitted.push({ ...record, boundary: 'process', requestId });
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
