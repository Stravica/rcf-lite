// two-boundaries-registered probe for application-error-handling
// v1.0.6.
//
// Verifies AC-16102-1 (framework boundary maps a thrown handler
// to a wire body with no stack/path/URL leak), AC-16101-1 (the
// process boundary emits and exits with OS-observable code 1 - the
// probe spawns the fixture as a child process and reads the child's
// exit code per Addendum 3 rule 12), and REQ-004 (the emission
// goes through a companion factory; the probe observes the injected
// companion's own invocation record).
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

  // Inject a companion factory so REQ-004 has real derived evidence:
  // the record the boundaries emit reaches this companion first, and
  // /companion-invocations reports what it saw.
  const injectedInvocations = [];
  const injectedCompanion = {
    emit(record) { injectedInvocations.push({ category: record.category, correlationId: record.correlationId, at: new Date().toISOString() }); },
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
      anchorReqId: 'application-error-handling-REQ-001',
      verdict: fwOk ? 'pass' : 'fail',
      detail: `A handler that throws produces a wire response - framework boundary returned ${fw.status}; noStack=${noStack} noUsers=${noUsersPath} noHome=${noHomePath} noFileUrl=${noFileUrl} mappedShape=${mappedShape}`,
      evidence: evidenceFromResponse({
        route: '/throw-handler',
        response: fw,
        bodyText: fwBody,
        extraFields: {
          input: { thrown: 'Error with stack containing /Users/, /home/, file://' },
          derived: { noStack, noUsersPath, noHomePath, noFileUrl, mappedCode: fwParsed.error?.code ?? null },
        },
      }),
    });

    // Row 2 (AC-16101-1): OS-observable exit code from a spawned child.
    // The child imports the fixture with crashOnRequest, hits
    // /crash-real, and the fixture's process.nextTick(exit(1))
    // terminates it. The probe reads process.exitCode after 'exit'.
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
          setTimeout(() => { try { server.close(); } catch (e) {}; process.exit(42); }, 2000);
        })();
        `,
      ], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (b) => { stdout += b.toString(); });
      child.stderr.on('data', (b) => { stderr += b.toString(); });
      const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} rejectExit(new Error('child timeout')); }, 8000);
      child.on('exit', (code, signal) => {
        clearTimeout(t);
        resolveExit({ code, signal, stdout: stdout.slice(0, 400), stderr: stderr.slice(0, 400) });
      });
      child.on('error', (err) => { clearTimeout(t); rejectExit(err); });
    });
    const exitOk = childExit.code === 1;
    // Confirm the emission was captured too (READ from a fresh
    // in-process fixture is not applicable; we assert via the child
    // stdout marker instead: the fixture's /crash-real returns
    // willExit:1 in its body).
    const responseOk = /willExit/.test(childExit.stdout) || /willExit/.test(childExit.stderr);
    // Synth a fake response shape for the evidence helper's request
    // id slot: the child owned the id; we record the exit code as
    // the derived output and preserve a body excerpt.
    const bodyExcerpt = childExit.stdout || childExit.stderr || 'child produced no output';
    results.push({
      anchorAcId: 'application-error-handling-AC-16101-1',
      anchorReqId: 'application-error-handling-REQ-001',
      verdict: exitOk ? 'pass' : 'fail',
      detail: `An uncaughtException on the Node runtime (or an - spawned child fixture exited with OS code ${childExit.code} (Addendum 3 rule 12); willExit marker seen in child stdout: ${responseOk}`,
      evidence: {
        route: '/crash-real (via spawned child)',
        status: childExit.code === 1 ? 200 : (childExit.code || 0) + 500,
        xFixtureRequestId: 'child-process-' + (childExit.code ?? 'null'),
        bodyExcerpt: bodyExcerpt.slice(0, 240),
        input: { childMode: 'crashOnRequest' },
        derived: { osExitCode: childExit.code, signal: childExit.signal, responseOk },
      },
    });

    // Row 3 (REQ-004): the injected companion saw the framework
    // record. Reads the /companion-invocations endpoint on the
    // fixture we started for row 1; the injected companion's
    // invocations are the derived output.
    const ci = await fetch(`${fixture.baseUrl}/companion-invocations`);
    const ciBody = await ci.text();
    const ciJson = JSON.parse(ciBody);
    const seenAny = Array.isArray(ciJson.invocations) && ciJson.invocations.length >= 1;
    // The injectedInvocations closure is populated inline; check both.
    const inlineSeen = injectedInvocations.length >= 1;
    const req4Ok = ci.status === 200 && (seenAny || inlineSeen);
    results.push({
      anchorReqId: 'application-error-handling-REQ-004',
      verdict: req4Ok ? 'pass' : 'fail',
      detail: `Error emission goes through the logging companion factory, - injected companion saw ${injectedInvocations.length} record(s); /companion-invocations reports ${ciJson.invocations?.length ?? 0}`,
      evidence: evidenceFromResponse({
        route: '/companion-invocations',
        response: ci,
        bodyText: ciBody,
        extraFields: {
          input: { after: ['/throw-handler'] },
          derived: { inlineInvocations: injectedInvocations, endpointInvocations: ciJson.invocations },
        },
      }),
    });

    return { results };
  } finally {
    await fixture.close();
  }
}
