// two-boundaries-registered probe for application-error-handling
// v1.0.3.
//
// Verifies that both boundaries are wired and emit constructed
// records (REQ-001, REQ-004). Calls /boundary/framework and
// /boundary/process, then GETs /emitted and asserts both records
// appeared, tagged by their source boundary. Records the response
// identifier and body excerpt as evidence.
//
// anchorReqId: application-error-handling-REQ-001.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-error-handling-REQ-001';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-error-handling/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];

    const fw = await fetch(`${fixture.baseUrl}/boundary/framework`);
    const fwBody = await fw.text();
    const fwOk = fw.status === 500 && JSON.parse(fwBody).boundary === 'framework';
    results.push({
      anchorReqId: 'application-error-handling-REQ-001',
      verdict: fwOk ? 'pass' : 'fail',
      detail: fwOk
        ? 'framework boundary returned 500 with boundary="framework"'
        : `framework boundary fault: status=${fw.status} body=${fwBody.slice(0, 120)}`,
      evidence: evidenceFromResponse({ route: '/boundary/framework', response: fw, bodyText: fwBody }),
    });

    const pr = await fetch(`${fixture.baseUrl}/boundary/process`);
    const prBody = await pr.text();
    const prOk = pr.status === 500 && JSON.parse(prBody).boundary === 'process';
    results.push({
      anchorReqId: 'application-error-handling-REQ-001',
      verdict: prOk ? 'pass' : 'fail',
      detail: prOk
        ? 'process boundary returned 500 with boundary="process"'
        : `process boundary fault: status=${pr.status} body=${prBody.slice(0, 120)}`,
      evidence: evidenceFromResponse({ route: '/boundary/process', response: pr, bodyText: prBody }),
    });

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
        ? `both boundaries emitted: /emitted lists framework and process records (${emitted.length} total)`
        : `emission fault: framework=${seenFw} process=${seenPr} totalEmitted=${emitted.length}`,
      evidence: evidenceFromResponse({ route: '/emitted', response: em, bodyText: emBody, extraFields: { emittedCount: emitted.length } }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
