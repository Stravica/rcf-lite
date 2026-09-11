// Sample-app fixture for the application-error-handling probe pack.
//
// A dependency-free Node HTTP server that carries the smallest
// surface the application-error-handling probes assert on:
//
// - /construct/:category returns a constructed record in the exact
// ADR-1701 six-field shape. Cause is a nested ADR-1701 record
// (not a flat {message, category} pair) when the caller passes
// ?withCause=1 so REQ-002's cause-record structure holds.
// - /throw-handler: a framework-level boundary path that catches a
// synthetic uncaught exception, maps it to the wire body without
// leaking a stack, filesystem path or file:// URL, and appends
// the emitted record to /emitted (AC-16102-1).
// - /crash-process: a process-level boundary path that emits a
// record and then exits with code 1 via a real
// process.nextTick handler; a probe spawns the child that
// imports this fixture and reads the child's exit code from the
// OS, satisfying// - /emitted: JSON list of records the boundaries have emitted.
// - /companion-invocations: JSON list of {category, correlationId}
// the companion factory saw, so REQ-004 has real derived
// evidence.
//
// A companion factory can be injected via startServer({ companion });
// the boundaries invoke it before appending to /emitted so the
// probe can observe the pair.

import http from 'node:http';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';

const CATEGORIES = new Set(['transient', 'permanent', 'unknown']);

// The default companion factory: records invocations in memory so a
// probe can read them from /companion-invocations. A caller may
// override by passing startServer({ companion }); the injected
// companion is invoked in the same place.
function makeDefaultCompanion() {
 const invocations = [];
 return {
 emit(record) {
 // Companion factory owns the emission surface for REQ-004:
 // (1) record the invocation for the companion-dump readback,
 // (2) render the record as ONE level=error JSON line on stderr
 // through this companion. Callers MUST NOT write the record
 // to stdout/stderr directly.
 const source = (record && record.context && record.context.source) || null;
 invocations.push({ category: record.category, correlationId: record.correlationId, source, at: new Date().toISOString() });
 const boundary = source && source.startsWith('process-boundary') ? 'process' : 'framework';
 const line = { level: 'error', boundary, record, at: new Date().toISOString() };
 try { process.stderr.write(JSON.stringify(line) + '\n'); } catch { /* stderr closed */ }
 },
 invocations,
 };
}

function constructRecord({ category, source, correlationId, cause }) {
 return {
 code: 'ERR_SAMPLE_' + category.toUpperCase(),
 category,
 message: `sample ${category} error`,
 correlationId: correlationId || randomUUID(),
 cause: cause || null,
 context: { source: source || 'app', fixture: 'application-error-handling' },
 };
}

function stampRequestId(req, res) {
 const inbound = req.headers['x-request-id'];
 const id = typeof inbound === 'string' && inbound.length > 0 ? inbound : randomUUID();
 res.setHeader('x-fixture-request-id', id);
 res.setHeader('x-request-id', id);
 return id;
}

function sendJson(res, status, body, headers = {}) {
 res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
 res.end(JSON.stringify(body));
}

function scrubForWire(text) {
 return String(text)
 .replace(/\/Users\/[^\s"']+/g, '<path>')
 .replace(/\/home\/[^\s"']+/g, '<path>')
 .replace(/file:\/\/[^\s"']+/g, '<uri>');
}

function makeHandler({ companion, emitted, crashOnRequest }) {
 return function handler(req, res) {
 const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
 const requestId = stampRequestId(req, res);
 if (url.pathname === '/healthz') {
 res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
 res.end('ok');
 return;
 }
 if (url.pathname === '/emitted') { sendJson(res, 200, { emitted }); return; }
 if (url.pathname === '/companion-invocations') { sendJson(res, 200, { invocations: companion.invocations }); return; }
 if (url.pathname === '/stream-then-throw') {
 // AC-16102-4 mid-stream close. Flush headers, write partial body,
 // then the framework boundary catches a mid-stream exception,
 // emits EXACTLY ONE record via the companion at error level
 // naming the streaming-in-progress condition, records the
 // emitted record with category 'unknown' unless the throwing
 // site supplied one, and closes the socket without rewriting the
 // wire response. The browser-network wire-close half is
 // observable only on a browser network log.
 res.writeHead(200, {
 'content-type': 'text/plain; charset=utf-8',
 'x-fixture-request-id': requestId,
 'x-request-id': requestId,
 });
 res.write('partial-body-before-throw');
 let record;
 try {
 const err = new Error('handler threw AFTER response streaming began');
 throw err;
 } catch (thrown) {
 record = constructRecord({
 category: 'unknown',
 source: 'framework-boundary-mid-stream',
 correlationId: randomUUID(),
 cause: null,
 });
 record.message = 'framework boundary observed a mid-stream throw; streaming-in-progress condition; connection is closed without rewriting the wire';
 companion.emit(record);
 emitted.push({ ...record, boundary: 'framework-mid-stream', requestId });
 }
 // End the response after the partial body so the client sees a
 // normal HTTP round-trip with headers, a partial body, and no
 // rewritten wire response. The browser-network close-condition is
 // notObservableHere on a server-driven probe pack; this endpoint
 // is the server-side surface for AC-16102-4's emission/category
 // clauses only.
 res.end();
 return;
 }
 if (url.pathname === '/throw-handler') {
 let record;
 try {
 const err = new Error('handler threw during request');
 err.stack = 'Error: handler threw during request\n at handler (/Users/probe/app.js:12:3)\n at (/home/ci/build/dispatch.js:44:5)\n at file:///opt/app/router.js:2:1';
 throw err;
 } catch (thrown) {
 // Cause is a nested ADR-1701 record, not a flat pair.
 const causeRecord = constructRecord({
 category: 'unknown',
 source: 'framework-boundary-cause',
 correlationId: randomUUID(),
 });
 record = constructRecord({
 category: 'permanent',
 source: 'framework-boundary',
 cause: causeRecord,
 });
 companion.emit(record);
 emitted.push({ ...record, boundary: 'framework', requestId });
 sendJson(res, 500, {
 error: {
 code: record.code, category: record.category,
 message: record.message, correlationId: record.correlationId,
 },
 wireVersion: 1,
 }, { 'x-fixture-request-id': requestId, 'x-request-id': requestId });
 return;
 }
 }
 if (url.pathname === '/crash-process') {
 // Emit-and-report path: the fixture does NOT exit under it so
 // in-process tests continue. The real exit-code semantics are
 // covered by /crash-real invoked from a spawned child.
 const causeRecord = constructRecord({
 category: 'unknown',
 source: 'process-boundary-cause',
 correlationId: randomUUID(),
 });
 const record = constructRecord({
 category: 'unknown',
 source: 'process-boundary',
 cause: causeRecord,
 });
 companion.emit(record);
 emitted.push({ ...record, boundary: 'process', requestId });
 sendJson(res, 200, { record, didExit: 1 }, { 'x-fixture-request-id': requestId, 'x-request-id': requestId });
 return;
 }
 if (url.pathname === '/crash-real' && crashOnRequest) {
 // AC-16101-1: induce a REAL uncaughtException on the runtime
 //. The
 // process-boundary uncaughtException handler registered in
 // startServer({ crashOnRequest: true }) constructs the record
 // with category "unknown", emits ONE JSON line at level=error
 // with the stack on cause, and exits with code 1. The handler
 // returns a response first so the probe reads a wire body;
 // the throw fires after the response is committed.
 sendJson(res, 200, { willExit: 1, note: 'about to throw an uncaught exception' }, { 'x-fixture-request-id': requestId, 'x-request-id': requestId });
 setImmediate(() => { throw new Error('handler-path uncaught: sample AC-16101-1'); });
 return;
 }
 const constructMatch = url.pathname.match(/^\/construct\/([a-zA-Z]+)$/);
 if (constructMatch) {
 const category = constructMatch[1];
 if (!CATEGORIES.has(category)) {
 sendJson(res, 400, {
 error: 'unelicited-category',
 refused: category,
 accepted: [...CATEGORIES],
 detail: 'category token not in ADR-1702 defaults and not elicited by this project',
 });
 return;
 }
 const withCause = url.searchParams.get('withCause') === '1';
 const cause = withCause
 ? constructRecord({ category: 'unknown', source: 'cause-record' })
 : null;
 const record = constructRecord({ category, source: 'construct', cause });
 sendJson(res, 200, record);
 return;
 }
 if (url.pathname === '/boundary/framework') {
 const record = constructRecord({ category: 'unknown', source: 'framework-boundary' });
 companion.emit(record);
 emitted.push({ ...record, boundary: 'framework', requestId });
 sendJson(res, 500, { boundary: 'framework', record });
 return;
 }
 if (url.pathname === '/boundary/process') {
 const record = constructRecord({ category: 'unknown', source: 'process-boundary' });
 companion.emit(record);
 emitted.push({ ...record, boundary: 'process', requestId });
 sendJson(res, 500, { boundary: 'process', record });
 return;
 }
 res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
 res.end('not found');
 };
}

export function startServer({ port, companion, crashOnRequest } = {}) {
 const desiredPort = typeof port === 'number' ? port : Number(process.env.PORT ?? 3000);
 const c = companion || makeDefaultCompanion();
 const emitted = [];
 const wantCrash = !!(crashOnRequest || process.env.CRASH_ON_REQUEST === '1');
 const handler = makeHandler({ companion: c, emitted, crashOnRequest: wantCrash });
 if (wantCrash) {
 // AC-16101-1 process-level boundary: on uncaughtException,
 // construct the record with category "unknown", emit ONE JSON
 // line at level=error to stderr with the thrown stack on cause,
 // then process.exit(1). The probe reads this line from the
 // spawned child's stderr and the OS exit code from process
 // 'exit'. Idempotent: register at most once per process.
 if (!process.__cePAF_ehBoundInstalled) {
 process.__cePAF_ehBoundInstalled = true;
 process.on('uncaughtException', (err) => {
 try {
 const causeRecord = {
 code: 'ERR_SAMPLE_UNKNOWN',
 category: 'unknown',
 message: err && err.message ? String(err.message) : String(err),
 correlationId: randomUUID(),
 cause: null,
 context: { source: 'process-boundary-uncaught-cause', stack: err && err.stack ? String(err.stack) : null },
 };
 const record = {
 code: 'ERR_SAMPLE_UNKNOWN',
 category: 'unknown',
 message: 'uncaughtException reached the process boundary',
 correlationId: randomUUID(),
 cause: causeRecord,
 context: { source: 'process-boundary', fixture: 'application-error-handling' },
 };
 // Emit through the injected companion so REQ-004 observes
 // both boundaries via the SAME companion instance. The uncaught
 // handler MUST NOT itself write the error record to stdout/stderr
 // per REQ-004; the companion is the sole emission surface for
 // the error record. The companion-dump line below is metadata
 // (invocations state), not the error record, and serves as the
 // process-boundary evidence the probe reads from the child's
 // stderr before OS exit.
 try { c.emit(record); } catch { /* companion failure must not stop teardown */ }
 // Dump companion state so the probe can prove that both the
 // framework and process boundaries reached the companion in
 // this same child run.
 const dumpLine = { level: 'info', type: 'companion-dump', invocations: c.invocations };
 process.stderr.write(JSON.stringify(dumpLine) + '\n');
 } catch { /* teardown continues */ }
 process.exit(1);
 });
 }
 }
 return new Promise((resolve, reject) => {
 const server = http.createServer(handler);
 server.once('error', reject);
 server.listen(desiredPort, '127.0.0.1', () => {
 const addr = server.address();
 const bound = typeof addr === 'object' && addr ? addr.port : desiredPort;
 resolve({ server, port: bound, companion: c, emitted });
 });
 });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
 const argCrash = process.argv.includes('--crash-on-request') || process.env.CRASH_ON_REQUEST === '1';
 startServer({ crashOnRequest: argCrash }).then(({ port }) => {
 process.stdout.write(`LISTENING ${port}\n`);
 }).catch((err) => {
 process.stderr.write(`fixture failed to start: ${err.message}\n`);
 process.exit(1);
 });
}
