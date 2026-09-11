// two-boundaries-registered probe for application-error-handling v1.0.7.
//
// Row 1 (AC-16102-1): framework boundary maps a thrown handler
// exception to a wire body with no stack/path/URL leak.
// Row 2 (AC-16101-1): the process-level boundary catches a REAL
// uncaught exception, emits ONE JSON line at level=error with the
// thrown stack on cause, and exits with OS code 1. The probe spawns
// the fixture as a child, hits /crash-real, and reads the child's
// stderr JSON line and OS exit code (Addendum 3 rules 12 and 14;
// closure 3 sections 1, 3 and 6).
// Row 3 (REQ-004): the framework AND the process boundaries both
// emit through the injected companion factory. The probe drives
// /throw-handler AND /crash-process (an in-process emit-only path
// that does NOT exit) then reads /companion-invocations for the two
// records the companion saw.
//
// anchorAcId: per-row.

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-error-handling-REQ-001';
export const accountBound = false;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SERVER = resolve(HERE, '..', '..', '..', '..', 'packages/rcf-lite/test/fixtures/probe-pack-application-error-handling/server.js');

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-error-handling/server.js');
  const injectedInvocations = [];
  const injectedCompanion = {
    emit(record) { injectedInvocations.push({ category: record.category, correlationId: record.correlationId, source: record.context && record.context.source, at: new Date().toISOString() }); },
    invocations: injectedInvocations,
  };
  const fixture = await startFixture({ startServer: (opts) => startServer({ ...opts, companion: injectedCompanion }), port: 0 });
  const results = [];
  try {
    // Row 1 (AC-16102-1): framework boundary.
    const fw = await fetch(`${fixture.baseUrl}/throw-handler`);
    const fwBody = await fw.text();
    const fwParsed = JSON.parse(fwBody);
    const noStack = !/at\s+.*:\d+:\d+/.test(fwBody);
    const noUsersPath = !/\/Users\//.test(fwBody);
    const noHomePath = !/\/home\//.test(fwBody);
    const noFileUrl = !/file:\/\//.test(fwBody);
    const mappedShape = fwParsed.error
      && typeof fwParsed.error.code === 'string'
      && typeof fwParsed.error.category === 'string'
      && typeof fwParsed.error.correlationId === 'string';
    const fwOk = fw.status === 500 && noStack && noUsersPath && noHomePath && noFileUrl && mappedShape;
    results.push({
      anchorAcId: 'application-error-handling-AC-16102-1',
      verdict: fwOk ? 'pass' : 'fail',
      detail: `A handler that throws produces a wire response - framework boundary returned ${fw.status}; noStack=${noStack} noUsersPath=${noUsersPath} noHomePath=${noHomePath} noFileUrl=${noFileUrl} mappedShape=${mappedShape}`,
      evidence: evidenceFromResponse({
        route: '/throw-handler',
        response: fw,
        bodyText: fwBody,
        extraFields: {
          input: { thrown: 'Error whose stack contains /Users/, /home/, file://' },
          derived: { noStack, noUsersPath, noHomePath, noFileUrl, mappedCode: fwParsed.error?.code ?? null },
        },
      }),
    });

    // Row 2 (AC-16101-1): OS-observable exit code from a spawned child.
    // The child starts the fixture with crashOnRequest=true (which
    // registers the process uncaughtException handler). Hitting
    // /crash-real triggers an uncaught throw from within the handler
    // path; the boundary emits ONE JSON line at level=error to
    // stderr with the thrown stack on cause, then process.exit(1).
    const childExit = await new Promise((resolveExit, rejectExit) => {
      const child = spawn(process.execPath, [
        '-e',
        `
        (async () => {
          const mod = await import(${JSON.stringify(FIXTURE_SERVER)});
          const { server, port } = await mod.startServer({ port: 0, crashOnRequest: true });
          try {
            const res = await fetch('http://127.0.0.1:' + port + '/crash-real');
            await res.text();
          } catch (e) {}
          setTimeout(() => { try { server.close(); } catch (e) {}; process.exit(42); }, 3000);
        })();
        `,
      ], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (b) => { stdout += b.toString(); });
      child.stderr.on('data', (b) => { stderr += b.toString(); });
      const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} rejectExit(new Error('child timeout')); }, 10000);
      child.on('exit', (code, signal) => {
        clearTimeout(t);
        resolveExit({ code, signal, stdout: stdout.slice(0, 2000), stderr: stderr.slice(0, 2000) });
      });
      child.on('error', (err) => { clearTimeout(t); rejectExit(err); });
    });
    const exitOk = childExit.code === 1;
    // Parse ONE JSON line at level=error carrying the record shape and stack-on-cause.
    const errorLines = childExit.stderr.split('\n').map((l) => l.trim()).filter(Boolean);
    let parsedLine = null;
    let parsedCount = 0;
    for (const line of errorLines) {
      try {
        const j = JSON.parse(line);
        if (j && j.level === 'error' && j.record) { parsedCount += 1; parsedLine = j; }
      } catch { /* not JSON */ }
    }
    const oneJsonLine = parsedCount === 1;
    const categoryUnknown = parsedLine && parsedLine.record && parsedLine.record.category === 'unknown';
    const stackOnCause = !!(parsedLine && parsedLine.record && parsedLine.record.cause
      && parsedLine.record.cause.context && typeof parsedLine.record.cause.context.stack === 'string'
      && parsedLine.record.cause.context.stack.length > 0
      && /at\s+.*:\d+:\d+/.test(parsedLine.record.cause.context.stack));
    const rowOk = exitOk && oneJsonLine && categoryUnknown && stackOnCause;
    const correlationId = (parsedLine && parsedLine.record && parsedLine.record.correlationId) || `child-process-${childExit.code ?? 'null'}`;
    results.push({
      anchorAcId: 'application-error-handling-AC-16101-1',
      verdict: rowOk ? 'pass' : 'fail',
      detail: `An uncaughtException on the Node runtime (or - spawned child fixture exited with OS code ${childExit.code}; stderr carried ${parsedCount} level=error JSON line(s); category=${parsedLine?.record?.category ?? 'null'}; stackOnCause=${stackOnCause}`,
      evidence: {
        route: '/crash-real (via spawned child)',
        status: exitOk ? 200 : 500,
        xFixtureRequestId: correlationId,
        bodyExcerpt: (parsedLine ? JSON.stringify(parsedLine) : childExit.stderr || childExit.stdout).slice(0, 240),
        input: { childMode: 'crashOnRequest', trigger: 'GET /crash-real' },
        derived: {
          osExitCode: childExit.code,
          signal: childExit.signal,
          oneJsonLine,
          jsonLineCount: parsedCount,
          categoryUnknown,
          stackOnCause,
          level: parsedLine?.level ?? null,
        },
      },
    });

    // Row 3 (REQ-004): the framework and the process boundaries both
    // emit through the injected companion factory. The probe already
    // hit /throw-handler (framework). Drive /crash-process to add the
    // process-boundary emission that does NOT exit. Then read
    // /companion-invocations: expect at least two invocations with
    // distinct sources (framework-boundary and process-boundary).
    const cp = await fetch(`${fixture.baseUrl}/crash-process`);
    await cp.text();
    const ci = await fetch(`${fixture.baseUrl}/companion-invocations`);
    const ciBody = await ci.text();
    const ciJson = JSON.parse(ciBody);
    const sources = new Set((ciJson.invocations || []).map((i) => (i.source || null))
      .concat(injectedInvocations.map((i) => i.source || null))
      .filter(Boolean));
    const bothBoundaries = sources.has('framework-boundary') && sources.has('process-boundary');
    const req4Ok = ci.status === 200 && bothBoundaries;
    results.push({
      anchorReqId: 'application-error-handling-REQ-004',
      verdict: req4Ok ? 'pass' : 'fail',
      detail: `Error emission goes through the logging companion factory, - companion saw sources=[${[...sources].join(',')}] (both boundaries required by REQ-004)`,
      evidence: evidenceFromResponse({
        route: '/companion-invocations',
        response: ci,
        bodyText: ciBody,
        extraFields: {
          input: { drove: ['/throw-handler', '/crash-process'] },
          derived: { inlineInvocations: injectedInvocations, endpointInvocations: ciJson.invocations, sourcesSeen: [...sources], bothBoundaries },
        },
      }),
    });

    return { results };
  } finally {
    await fixture.close();
  }
}
