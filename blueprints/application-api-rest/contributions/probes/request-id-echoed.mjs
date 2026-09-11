// request-id-echoed probe for application-api-rest v2.1.8.
//
// Verifies AC-2117-1 (supplied x-request-id echoed verbatim AND the
// same id appears on the request-scoped log line) and AC-2117-2 (an
// absent one is generated at the edge).
//
// anchorAcId: per-row.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-api-rest-REQ-013';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    const supplied = 'req-supplied-12345';
    const suppliedRes = await fetch(`${fixture.baseUrl}/livez?deps=up`, { headers: { 'x-request-id': supplied } });
    const suppliedBody = await suppliedRes.text();
    const suppliedEcho = suppliedRes.headers.get('x-request-id');
    // Now inspect the request-scoped log line the fixture emitted.
    const logRes = await fetch(`${fixture.baseUrl}/__logs?requestId=${encodeURIComponent(supplied)}`);
    const logBody = await logRes.text();
    let logJson = null;
    try { logJson = JSON.parse(logBody); } catch {}
    const logLineMatches = logRes.status === 200 && logJson && logJson.requestId === supplied && typeof logJson.route === 'string';
    const suppliedOk = suppliedRes.status === 200 && suppliedEcho === supplied && logLineMatches;
    results.push({
      anchorAcId: 'application-api-rest-AC-2117-1',
      anchorReqId: 'application-api-rest-REQ-013',
      verdict: suppliedOk ? 'pass' : 'fail',
      detail: `A request arriving with a valid value in - supplied x-request-id="${supplied}" echoed verbatim on the response and appears on the /__logs line: ${logLineMatches}`,
      evidence: evidenceFromResponse({
        route: '/livez?deps=up',
        response: suppliedRes,
        bodyText: suppliedBody,
        extraFields: {
          input: { xRequestIdSent: supplied },
          derived: {
            xRequestIdEchoed: suppliedEcho,
            matches: suppliedEcho === supplied,
            logLine: logJson,
            logStatus: logRes.status,
          },
          altBodyExcerpt: logBody.slice(0, 240),
        },
      }),
    });

    const genRes = await fetch(`${fixture.baseUrl}/livez?deps=up`);
    const genBody = await genRes.text();
    const generated = genRes.headers.get('x-request-id');
    const genOk = genRes.status === 200 && typeof generated === 'string' && generated.length >= 16 && generated !== supplied;
    results.push({
      anchorAcId: 'application-api-rest-AC-2117-2',
      anchorReqId: 'application-api-rest-REQ-013',
      verdict: genOk ? 'pass' : 'fail',
      detail: `A request arriving without the request-id header owned - absent x-request-id: server generated ${generated}`,
      evidence: evidenceFromResponse({
        route: '/livez?deps=up',
        response: genRes,
        bodyText: genBody,
        extraFields: {
          input: { xRequestIdSent: null },
          derived: { xRequestIdGenerated: generated, length: generated ? generated.length : 0 },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
