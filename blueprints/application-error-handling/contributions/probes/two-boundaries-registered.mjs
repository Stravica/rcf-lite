// two-boundaries-registered probe for application-error-handling v1.0.8.
//
// Row 1 (AC-16102-2): the framework-level boundary catches a thrown
// handler exception whose induced stack carries system-path substrings and a file-URI substring
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
// Row 4 (AC-16102-4, streaming-close): mid-stream close is a
// browser-network-observable half; the row is conformanceOnly with
// a limitation naming that a server-side probe pack cannot observe
// the client-side close condition.
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
 for (const line of stderrLines) {
 try {
 const j = JSON.parse(line);
 if (j && j.level === 'error' && j.record) { errorCount += 1; errorLine = j; }
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

 // Row 4: AC-16102-4 streaming close is browser-network observable.
 results.push(notObservableHereResult({
 ac: 'application-error-handling-AC-16102-4',
 detail: 'Given a handler that throws AFTER the response body - streaming-close and mid-stream network termination are browser-network observable',
 reason: 'AC-16102-4 requires observing that once headers are flushed and the body is partially written, the connection closes without a rewritten wire response; the observable half is on the browser network log. A server-side probe pack can drive a mid-stream throw but cannot observe the client-side close condition on the wire',
 evidence: { requires: 'browser network log observation', ac: 'application-error-handling-AC-16102-4', half: 'browser-network' },
 }));

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
