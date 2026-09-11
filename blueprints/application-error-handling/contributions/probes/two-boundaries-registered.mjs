// two-boundaries-registered probe for application-error-handling
// v1.0.5.
//
// Verifies AC-16102-1 (a handler that throws produces a mapped
// wire body with no raw stack, no filesystem path, no file:// URL)
// and AC-16101-1 (the process-level boundary constructs one
// record, records it emitted, and reports exit code 1). Each
// boundary is its own row.
//
// anchorAcId: application-error-handling-AC-16102-1 (framework row)
// and application-error-handling-AC-16101-1 (process row); the
// paired /emitted row anchors REQ-004.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-error-handling-REQ-001';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-error-handling/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    // AC-16102-1: framework-level boundary catches a thrown handler
    // and writes a mapped body carrying no stack, no filesystem
    // path and no file:// URL.
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
      detail: fwOk
        ? 'framework boundary returned 500 with a mapped envelope and no stack/path/URL leak'
        : `A handler that throws produces a wire response - framework boundary fault: status=${fw.status} noStack=${noStack} noUsers=${noUsersPath} noHome=${noHomePath} noFileUrl=${noFileUrl} mappedShape=${mappedShape}`,
      evidence: evidenceFromResponse({
        route: '/throw-handler',
        response: fw,
        bodyText: fwBody,
        extraFields: {
          input: { thrown: 'Error with stack containing /Users/, /home/, file://' },
          derived: { noStack, noUsersPath, noHomePath, noFileUrl, mappedCode: fwParsed.error ? fwParsed.error.code : null },
        },
      }),
    });

    // AC-16101-1: process-level boundary constructs a record and
    // reports exit code 1. The fixture reports rather than exits
    // so the probe can complete; didExit=1 is the derived output.
    const pr = await fetch(`${fixture.baseUrl}/crash-process`);
    const prBody = await pr.text();
    const prParsed = JSON.parse(prBody);
    const recOk = prParsed.record
      && prParsed.record.category === 'unknown'
      && typeof prParsed.record.correlationId === 'string';
    const exitOk = prParsed.didExit === 1;
    const prOk = pr.status === 200 && recOk && exitOk;
    results.push({
      anchorAcId: 'application-error-handling-AC-16101-1',
      anchorReqId: 'application-error-handling-REQ-001',
      verdict: prOk ? 'pass' : 'fail',
      detail: prOk
        ? 'process boundary constructed one record under category=unknown and reported didExit=1'
        : `An uncaughtException on the Node runtime (or an - process boundary fault: status=${pr.status} recOk=${recOk} didExit=${prParsed.didExit}`,
      evidence: evidenceFromResponse({
        route: '/crash-process',
        response: pr,
        bodyText: prBody,
        extraFields: {
          input: { source: 'synthetic uncaughtException' },
          derived: { category: prParsed.record ? prParsed.record.category : null, didExit: prParsed.didExit, correlationId: prParsed.record ? prParsed.record.correlationId : null },
        },
      }),
    });

    // Pair verification anchoring REQ-004: /emitted lists at least
    // one framework and one process record after the two calls.
    const em = await fetch(`${fixture.baseUrl}/emitted`);
    const emBody = await em.text();
    const emitted = JSON.parse(emBody).emitted || [];
    const seenFw = emitted.some((r) => r.boundary === 'framework');
    const seenPr = emitted.some((r) => r.boundary === 'process');
    const emOk = seenFw && seenPr;
    results.push({
      anchorReqId: 'application-error-handling-REQ-004',
      verdict: emOk ? 'pass' : 'fail',
      detail: emOk
        ? `Error emission goes through the logging companion factory, - both boundaries emitted through /emitted (${emitted.length} records total)`
        : `Error emission goes through the logging companion factory, - emission fault: framework=${seenFw} process=${seenPr} total=${emitted.length}`,
      evidence: evidenceFromResponse({
        route: '/emitted',
        response: em,
        bodyText: emBody,
        extraFields: {
          input: { after: ['/throw-handler', '/crash-process'] },
          derived: { framework: seenFw, process: seenPr, total: emitted.length },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
