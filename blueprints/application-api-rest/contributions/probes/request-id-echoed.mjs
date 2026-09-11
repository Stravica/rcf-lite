// request-id-echoed probe for application-api-rest v2.1.5.
//
// Verifies that every inbound request either carries an x-request-id
// header or receives a server-generated one, and the value is echoed
// on the response (REQ-013). The probe drives two calls: one with a
// supplied x-request-id and one without, and asserts the echo
// behaviour on both. Records the x-request-id from the response
// alongside the body excerpt as evidence.
//
// anchorReqId: application-api-rest-REQ-013.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-api-rest-REQ-013';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];

    const supplied = 'req-supplied-12345';
    const suppliedRes = await fetch(`${fixture.baseUrl}/livez`, { headers: { 'x-request-id': supplied } });
    const suppliedBody = await suppliedRes.text();
    const suppliedEcho = suppliedRes.headers.get('x-request-id');
    const suppliedOk = suppliedRes.status === 200 && suppliedEcho === supplied;
    results.push({
      anchorReqId: 'application-api-rest-REQ-013',
      verdict: suppliedOk ? 'pass' : 'fail',
      detail: suppliedOk
        ? `supplied x-request-id="${supplied}" echoed on response`
        : `supplied echo fault: sent=${supplied} echoed=${suppliedEcho}`,
      evidence: evidenceFromResponse({ route: '/livez', response: suppliedRes, bodyText: suppliedBody, extraFields: { xRequestIdEchoed: suppliedEcho, xRequestIdSent: supplied } }),
    });

    const genRes = await fetch(`${fixture.baseUrl}/livez`);
    const genBody = await genRes.text();
    const generated = genRes.headers.get('x-request-id');
    const genOk = genRes.status === 200 && typeof generated === 'string' && generated.length >= 16;
    results.push({
      anchorReqId: 'application-api-rest-REQ-013',
      verdict: genOk ? 'pass' : 'fail',
      detail: genOk
        ? `absent x-request-id: server generated ${generated}`
        : `generated echo fault: header=${generated}`,
      evidence: evidenceFromResponse({ route: '/livez', response: genRes, bodyText: genBody, extraFields: { xRequestIdGenerated: generated } }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
