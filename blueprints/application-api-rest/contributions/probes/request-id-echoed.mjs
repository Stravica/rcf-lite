// request-id-echoed probe for application-api-rest v2.1.7.
//
// Verifies AC-2117-1 (a supplied x-request-id is echoed verbatim)
// and AC-2117-2 (an absent one is generated at the edge). Each row
// anchors its own AC.
//
// anchorAcId: application-api-rest-AC-2117-1 (row 1) and
// application-api-rest-AC-2117-2 (row 2).

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-api-rest-REQ-013';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    const supplied = 'req-supplied-12345';
    const suppliedRes = await fetch(`${fixture.baseUrl}/livez`, { headers: { 'x-request-id': supplied } });
    const suppliedBody = await suppliedRes.text();
    const suppliedEcho = suppliedRes.headers.get('x-request-id');
    const suppliedOk = suppliedRes.status === 200 && suppliedEcho === supplied;
    results.push({
      anchorAcId: 'application-api-rest-AC-2117-1',
      anchorReqId: 'application-api-rest-REQ-013',
      verdict: suppliedOk ? 'pass' : 'fail',
      detail: suppliedOk
        ? `A request arriving with a valid value in - supplied x-request-id="${supplied}" echoed verbatim`
        : `A request arriving with a valid value in - supplied echo fault: sent=${supplied} echoed=${suppliedEcho}`,
      evidence: evidenceFromResponse({
        route: '/livez',
        response: suppliedRes,
        bodyText: suppliedBody,
        extraFields: {
          input: { xRequestIdSent: supplied },
          derived: { xRequestIdEchoed: suppliedEcho, matches: suppliedEcho === supplied },
        },
      }),
    });

    const genRes = await fetch(`${fixture.baseUrl}/livez`);
    const genBody = await genRes.text();
    const generated = genRes.headers.get('x-request-id');
    const genOk = genRes.status === 200 && typeof generated === 'string' && generated.length >= 16 && generated !== supplied;
    results.push({
      anchorAcId: 'application-api-rest-AC-2117-2',
      anchorReqId: 'application-api-rest-REQ-013',
      verdict: genOk ? 'pass' : 'fail',
      detail: genOk
        ? `A request arriving without the request-id header owned - absent x-request-id: server generated ${generated}`
        : `A request arriving without the request-id header owned - generated echo fault: header=${generated}`,
      evidence: evidenceFromResponse({
        route: '/livez',
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
