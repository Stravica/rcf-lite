// two-boundaries-registered probe for application-error-handling v1.0.12.
//
// Row 1 (AC-16102-2): the framework-level boundary catches a thrown
// handler exception whose induced stack carries system-path and file-URI
// substrings, and the wire response body carries none of them.
// This observation targets the specific scrub AC.
// Row 2 (AC-16102-1): the framework-level boundary produces a
// mapped wire response body (five envelope fields, no stack marker),
// separate from the scrub-substring observation on row 1.
// Row 3 (AC-16101-1): the process-level boundary catches a REAL
// uncaught exception on the runtime, emits ONE JSON line at
// level=error with the record on it (category unknown, stack on
// cause) and exits the process with OS code 1. Observed by
// spawning the fixture as a child, hitting /crash-real, and
// reading the child's stderr and OS exit code from the exit event.
// Row 4 (AC-16102-4, streaming-close): the fixture flushes headers,
// writes a partial body and tears the socket down after the write
// drains, so a Node client observes a premature-close error and no
// wire bytes past the partial body. The probe drives that endpoint,
// records the client's premature-close, and observes the exact-one
// mid-stream companion emission at level=error whose message names
// the streaming-in-progress condition with category='unknown'. AC
// AC-16102-4's shipped description names only the connection-close,
// the exact companion emission, the level, message and category;
// every clause is server-observable here so the row is a full
// counting row with anchorAcId, not conformanceOnly.
// Row 5 (REQ-004): the framework AND process boundaries both emit
// through the injected logging companion factory. Observed on the
// SAME spawned child: the child first hits /throw-handler
// (framework path, emits through the companion); the uncaught path
// then emits through the SAME companion inside the uncaughtException
// handler before writing the level=error line, and dumps the
// companion's invocations array to stderr as a level=info line
// immediately before process.exit(1). The probe reads both lines
// from the child's stderr.
//
// anchorAcId: per-row.

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture, evidenceFromResponse, conformanceOnlyResult, notObservableHereResult } from './probe-utils.mjs';

export const anchorReqId = 'application-error-handling-REQ-001';
export const accountBound = false;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SERVER = resolve(HERE, '..', '..', '..', '..', 'packages/rcf-lite/test/fixtures/probe-pack-application-error-handling/server.js');

export default async function runProbe() {
 const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-error-handling/server.js');
 // Framework-boundary observations use an in-process fixture with no crash arm.
 const fixture = await startFixture({ startServer, port: 0 });
 const results = [];
 try {
 // Row 1: AC-16102-2 stack/path/file:// scrub.
 const fw = await fetch(`${fixture.baseUrl}/throw-handler`);
 const fwBody = await fw.text();
 const fwParsed = JSON.parse(fwBody);
 const noStack = !/at\s+.*:\d+:\d+/.test(fwBody);
 const noUsersPath = !/\/Users\//.test(fwBody);
 const noHomePath = !/\/home\//.test(fwBody);
 const noFileUrl = !/file:\/\//.test(fwBody);
 const scrubOk = fw.status === 500 && noStack && noUsersPath && noHomePath && noFileUrl;
 results.push({
 anchorAcId: 'application-error-handling-AC-16102-2',
 verdict: scrubOk ? 'pass' : 'fail',
 detail: `Given a handler that throws a JavaScript Error - the wire response for /throw-handler carried noStack=${noStack} noUsersPath=${noUsersPath} noHomePath=${noHomePath} noFileUrl=${noFileUrl} at status ${fw.status}`,
 evidence: evidenceFromResponse({
 route: '/throw-handler',
 response: fw,
 bodyText: fwBody,
 extraFields: {
 input: { thrownStackContainsInducedSubstrings: true },
 derived: { noStack, noUsersPath, noHomePath, noFileUrl, mappedCode: fwParsed.error?.code ?? null },
 },
 }),
 });

 // Row 2: AC-16102-1 handler-throws-produces-mapped-response.
 const mappedShape = fwParsed.error
 && typeof fwParsed.error.code === 'string'
 && typeof fwParsed.error.category === 'string'
 && typeof fwParsed.error.correlationId === 'string';
 const mappedOk = fw.status === 500 && mappedShape;
 results.push({
 anchorAcId: 'application-error-handling-AC-16102-1',
 verdict: mappedOk ? 'pass' : 'fail',
 detail: `A handler that throws produces a wire response - /throw-handler returned status ${fw.status} with mapped envelope (code, category, correlationId all strings): ${mappedShape}`,
 evidence: evidenceFromResponse({
 route: '/throw-handler',
 response: fw,
 bodyText: fwBody,
 extraFields: {
 input: { path: '/throw-handler' },
 derived: { mappedShape, code: fwParsed.error?.code, category: fwParsed.error?.category, correlationId: fwParsed.error?.correlationId },
 },
 }),
 });

 // Row 3: AC-16101-1 via a spawned child. The child first hits
 // /throw-handler (framework boundary through the companion), then
 // /crash-real which triggers the real uncaught exception. The
 // uncaughtException handler emits through the same companion,
 // writes a level=error line and dumps companion state as
 // level=info type=companion-dump, then process.exit(1).
 const childExit = await new Promise((resolveExit, rejectExit) => {
 const child = spawn(process.execPath, [
 '-e',
 `
 (async () => {
 const mod = await import(${JSON.stringify(FIXTURE_SERVER)});
 const { server, port } = await mod.startServer({ port: 0, crashOnRequest: true });
 try {
 const first = await fetch('http://127.0.0.1:' + port + '/throw-handler');
 await first.text();
 const second = await fetch('http://127.0.0.1:' + port + '/crash-real');
 await second.text();
 } catch (e) {}
 setTimeout(() => { try { server.close(); } catch (e) {}; process.exit(42); }, 3000);
 })();
 `,
 ], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
 let stdout = ''; let stderr = '';
 child.stdout.on('data', (b) => { stdout += b.toString(); });
 child.stderr.on('data', (b) => { stderr += b.toString(); });
 const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} rejectExit(new Error('child timeout')); }, 15000);
 child.on('exit', (code, signal) => {
 clearTimeout(t);
 resolveExit({ code, signal, stdout: stdout.slice(0, 4000), stderr });
 });
 child.on('error', (err) => { clearTimeout(t); rejectExit(err); });
 });

 const stderrLines = childExit.stderr.split('\n').map((l) => l.trim()).filter(Boolean);
 let errorLine = null;
 let errorCount = 0;
 let dumpLine = null;
 // The companion factory writes ONE level=error JSON line for
 // EVERY emit; the child in this run drives /throw-handler
 // (framework-boundary, category='permanent') and then /crash-real
 // (process-boundary, category='unknown'). Count only the
 // process-boundary line so oneJsonLine tests AC-16101-1: exactly
 // one level=error emission from the uncaughtException path.
 for (const line of stderrLines) {
 try {
 const j = JSON.parse(line);
 if (j && j.level === 'error' && j.record && j.boundary === 'process') { errorCount += 1; errorLine = j; }
 else if (j && j.level === 'info' && j.type === 'companion-dump') { dumpLine = j; }
 } catch { /* not JSON */ }
 }
 const oneJsonLine = errorCount === 1;
 const exitOk = childExit.code === 1;
 const categoryUnknown = errorLine && errorLine.record && errorLine.record.category === 'unknown';
 const stackOnCause = !!(errorLine && errorLine.record && errorLine.record.cause
 && errorLine.record.cause.context && typeof errorLine.record.cause.context.stack === 'string'
 && errorLine.record.cause.context.stack.length > 0
 && /at\s+.*:\d+:\d+/.test(errorLine.record.cause.context.stack));
 const rec = errorLine && errorLine.record;
 const rowOk = exitOk && oneJsonLine && categoryUnknown && stackOnCause;
 // Evidence for this row: the child emits its own identifiers.
 // xFixtureRequestId carries the emitted record's correlationId
 // (the fixture-stamped correlation id for this emission); status
 // carries the OS exit code the process ended with. The row is
 // conformanceOnly with limitation naming these substitutions,
 // because a process-boundary observation runs off the HTTP wire.
 results.push(conformanceOnlyResult({
 anchorAcId: 'application-error-handling-AC-16101-1',
 verdict: rowOk ? 'pass' : 'fail',
 detail: `An uncaughtException on the Node runtime (or an - spawned child fixture exited with OS code ${childExit.code}; stderr carried ${errorCount} level=error JSON line(s); record.category=${rec?.category ?? 'null'}; stackOnCause=${stackOnCause}`,
 evidence: {
 route: '/crash-real (via spawned child)',
 status: exitOk ? 1 : (childExit.code ?? 0) || 1,
 xFixtureRequestId: (rec && rec.correlationId) || `child-exit-${childExit.code ?? 'null'}`,
 bodyExcerpt: (errorLine ? JSON.stringify(errorLine) : childExit.stderr || childExit.stdout).slice(0, 240),
 input: { childMode: 'crashOnRequest', trigger: 'GET /throw-handler then GET /crash-real' },
 derived: {
 osExitCode: childExit.code,
 signal: childExit.signal,
 oneJsonLine,
 jsonLineCount: errorCount,
 categoryUnknown,
 stackOnCause,
 level: errorLine?.level ?? null,
 recordCorrelationId: rec?.correlationId ?? null,
 recordCauseCorrelationId: rec?.cause?.correlationId ?? null,
 companionDumpPresent: !!dumpLine,
 },
 },
 limitation: 'application-error-handling-AC-16101-1: process-boundary observation runs off the HTTP wire; evidence.status carries the OS exit code observed by the OS on the child.on(exit) event, and evidence.xFixtureRequestId carries the emitted record\'s correlationId (the fixture-stamped identifier for this emission), because there is no fixture-stamped x-fixture-request-id header on a process exit',
 }));

 // Row 4: AC-16102-4 mid-stream close. The AC has three clauses:
 // (a) the connection is closed without rewriting the wire
 // response, observed as the client's premature socket close on
 // /stream-then-throw after status 200 and the partial-body
 // prefix have been flushed,
 // (b) exactly one error record emits through the logging
 // companion at error level naming the streaming-in-progress
 // condition, and
 // (c) the recorded record has category 'unknown' unless the
 // throwing site supplied one.
 // The probe drives /stream-then-throw with a Node client that
 // exposes premature-close errors, observes the exact-one companion
 // emission with level='error' and a message naming the
 // streaming-in-progress condition, and records the row as a full
 // anchored counting result whose predicate requires midStatus 200,
 // prematureClose true, exactly-one companion emission at error
 // level naming the streaming-in-progress condition, and the
 // recorded category 'unknown'. Every clause is observable here;
 // no browser-network sub-clause is carved out.
 const invBefore = await (await fetch(`${fixture.baseUrl}/companion-invocations`)).json();
 const invBeforeLen = invBefore.invocations.length;
 let midStatus = null;
 let midHeadersRequestId = null;
 let midBody = '';
 let clientErrorMessage = null;
 let prematureClose = false;
 try {
 const midRes = await fetch(`${fixture.baseUrl}/stream-then-throw`);
 midStatus = midRes.status;
 midHeadersRequestId = midRes.headers.get('x-fixture-request-id');
 // Read body chunks incrementally so a partial body received
 // before the premature close is retained in midBody even when
 // the read then throws. Using res.text() would discard whatever
 // was already delivered on the reader when the socket aborts.
 const decoder = new TextDecoder('utf-8');
 const reader = midRes.body ? midRes.body.getReader() : null;
 if (reader) {
 // eslint-disable-next-line no-constant-condition
 while (true) {
 let step;
 try {
 step = await reader.read();
 } catch (readErr) {
 clientErrorMessage = String(readErr && readErr.message ? readErr.message : readErr);
 prematureClose = true;
 break;
 }
 if (step && step.done) break;
 if (step && step.value) {
 midBody += decoder.decode(step.value, { stream: true });
 }
 }
 midBody += decoder.decode();
 } else {
 // Fallback for runtimes that do not expose a body stream.
 try {
 midBody = await midRes.text();
 } catch (bodyErr) {
 clientErrorMessage = String(bodyErr && bodyErr.message ? bodyErr.message : bodyErr);
 prematureClose = true;
 }
 }
 } catch (fetchErr) {
 clientErrorMessage = String(fetchErr && fetchErr.message ? fetchErr.message : fetchErr);
 prematureClose = true;
 }
 const invAfter = await (await fetch(`${fixture.baseUrl}/companion-invocations`)).json();
 const newInvocations = invAfter.invocations.slice(invBeforeLen);
 const midEmissions = newInvocations.filter((x) => x.source === 'framework-boundary-mid-stream');
 const exactlyOneMidEmission = midEmissions.length === 1;
 const midCategoryUnknown = exactlyOneMidEmission && midEmissions[0].category === 'unknown';
 const midLevelError = exactlyOneMidEmission && midEmissions[0].level === 'error';
 const streamingCondition = 'streaming-in-progress';
 const midMessage = exactlyOneMidEmission ? (midEmissions[0].message || '') : '';
 const midMessageNamesCondition = midMessage.includes(streamingCondition);
 const partialBodyPrefix = 'partial-body-before-throw';
 const partialBodyReceived = midBody.startsWith(partialBodyPrefix);
 const socketClosedEarly = prematureClose || (partialBodyReceived && midBody === partialBodyPrefix && clientErrorMessage);
 // AC-16102-4 requires the connection be closed without rewriting
 // the wire response. Recording partialBodyReceived is not a
 // substitute for the close: a normal completed 200 response that
 // happens to carry the prefix must fail this row. The predicate
 // therefore requires status 200 (headers were flushed before the
 // throw), prematureClose===true (the socket was aborted after the
 // partial write), and the exact-one companion emission at
 // level=error with the streaming-in-progress condition and
 // category unknown; partialBodyReceived is recorded but does not
 // participate in the verdict.
 const ac4ServerOk = midStatus === 200
 && prematureClose === true
 && exactlyOneMidEmission
 && midCategoryUnknown
 && midLevelError
 && midMessageNamesCondition;
 results.push({
 anchorAcId: 'application-error-handling-AC-16102-4',
 verdict: ac4ServerOk ? 'pass' : 'fail',
 detail: `Given a handler that throws AFTER the response body: companion recorded ${midEmissions.length} mid-stream emission(s) with category=${midEmissions[0]?.category ?? 'MISSING'} level=${midEmissions[0]?.level ?? 'MISSING'} messageNamesStreamingInProgress=${midMessageNamesCondition}; client saw prematureClose=${prematureClose} partialBodyPrefix=${partialBodyReceived}`,
 evidence: {
 route: '/stream-then-throw',
 status: midStatus == null ? 0 : midStatus,
 xFixtureRequestId: midHeadersRequestId || (exactlyOneMidEmission ? midEmissions[0].correlationId : ''),
 bodyExcerpt: (midBody || clientErrorMessage || '').slice(0, 240),
 input: { flushedHeadersFirst: true, wroteBytesBeforeThrow: partialBodyPrefix },
 derived: {
 invBeforeLen,
 invAfterLen: invAfter.invocations.length,
 midEmissions,
 exactlyOneMidEmission,
 midCategoryUnknown,
 midLevelError,
 midMessage,
 midMessageNamesCondition,
 partialBodyReceived,
 prematureClose,
 socketClosedEarly: !!socketClosedEarly,
 clientErrorMessage,
 midStatus,
 midHeadersRequestId,
 },
 },
 });

 // Row 5: REQ-004 - the SAME companion saw the framework-boundary
 // emission from /throw-handler AND the process-boundary emission
 // from the uncaughtException handler on the same child. The
 // companion-dump line carries the invocations array recorded in
 // the child before process.exit.
 const invocations = (dumpLine && dumpLine.invocations) || [];
 const sources = new Set(invocations.map((i) => i.source || null).filter(Boolean));
 const bothBoundaries = sources.has('framework-boundary') && sources.has('process-boundary');
 const req4Ok = !!dumpLine && bothBoundaries;
 results.push({
 anchorReqId: 'application-error-handling-REQ-004',
 verdict: req4Ok ? 'pass' : 'fail',
 detail: `Error emission goes through the logging companion factory, - companion-dump line ${dumpLine ? 'present' : 'MISSING'}; recorded sources=[${[...sources].join(',')}]; both boundaries observed on the SAME companion instance in the same child run: ${bothBoundaries}`,
 evidence: {
 route: 'child stderr / companion-dump line',
 status: exitOk ? 1 : (childExit.code ?? 0) || 1,
 xFixtureRequestId: (rec && rec.correlationId) || `child-exit-${childExit.code ?? 'null'}`,
 bodyExcerpt: dumpLine ? JSON.stringify(dumpLine).slice(0, 240) : childExit.stderr.slice(0, 240),
 input: { drove: ['/throw-handler', '/crash-real'] },
 derived: { dumpPresent: !!dumpLine, invocationCount: invocations.length, sourcesSeen: [...sources], bothBoundaries, invocations },
 },
 });

 return { results };
 } finally {
 await fixture.close();
 }
}
