// problem-details-on-error probe for application-api-rest v2.1.5.
//
// Verifies that error responses carry an RFC 7807 problem-details
// body (REQ-009): the correct content-type
// (application/problem+json) and the five required fields (type,
// title, status, detail, instance). Records the request identifier
// and body excerpt as evidence.
//
// anchorReqId: application-api-rest-REQ-009.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-api-rest-REQ-009';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];

    const res = await fetch(`${fixture.baseUrl}/v1/widgets/does-not-exist`);
    const body = await res.text();
    const parsed = JSON.parse(body);
    const cType = res.headers.get('content-type') || '';
    const requiredFields = ['type', 'title', 'status', 'detail', 'instance'];
    const missing = requiredFields.filter((k) => !(k in parsed));
    const pass = res.status === 404
      && cType.includes('application/problem+json')
      && missing.length === 0
      && parsed.status === 404;
    results.push({
      anchorReqId: 'application-api-rest-REQ-009',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `GET /v1/widgets/does-not-exist returned 404 application/problem+json with all five required fields`
        : `problem-details fault: status=${res.status} contentType=${cType} missingFields=${JSON.stringify(missing)}`,
      evidence: evidenceFromResponse({ route: '/v1/widgets/does-not-exist', response: res, bodyText: body, extraFields: { contentType: cType, missingFields: missing } }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
