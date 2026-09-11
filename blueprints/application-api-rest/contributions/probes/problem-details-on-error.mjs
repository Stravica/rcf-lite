// problem-details-on-error probe for application-api-rest v2.1.9.
//
// Verifies AC-2111-1 (RFC 7807 shape and content-type on any error
// path) and AC-2111-3 (envelope status equals HTTP status line).
// Each observation is a separate row so a defect at one AC does
// not hide behind the other's pass.
//
// anchorAcId: application-api-rest-AC-2111-1 (row 1) and
// application-api-rest-AC-2111-3 (row 2).

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-api-rest-REQ-009';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    const res = await fetch(`${fixture.baseUrl}/v1/widgets/does-not-exist`);
    const body = await res.text();
    const parsed = JSON.parse(body);
    const cType = res.headers.get('content-type') || '';
    const requiredFields = ['type', 'title', 'status', 'detail', 'instance'];
    const missing = requiredFields.filter((k) => !(k in parsed));
    const shapeOk = res.status === 404
      && cType.includes('application/problem+json')
      && missing.length === 0;
    results.push({
      anchorAcId: 'application-api-rest-AC-2111-1',
      anchorReqId: 'application-api-rest-REQ-009',
      verdict: shapeOk ? 'pass' : 'fail',
      detail: shapeOk
        ? 'Every 4xx and 5xx response body is an - GET /v1/widgets/does-not-exist returned application/problem+json with all five RFC 7807 fields'
        : `Every 4xx and 5xx response body is an - problem-details shape fault: status=${res.status} contentType=${cType} missing=${JSON.stringify(missing)}`,
      evidence: evidenceFromResponse({
        route: '/v1/widgets/does-not-exist',
        response: res,
        bodyText: body,
        extraFields: {
          input: { path: '/v1/widgets/does-not-exist' },
          derived: { contentType: cType, missingFields: missing },
        },
      }),
    });

    // Row 2: envelope status equals HTTP status line (AC-2111-3).
    // Drive an unknown route to force a distinct 404 body and check
    // both status positions agree.
    const res2 = await fetch(`${fixture.baseUrl}/unknown-route`);
    const body2 = await res2.text();
    const parsed2 = JSON.parse(body2);
    const equalOk = res2.status === 404 && parsed2.status === res2.status;
    results.push({
      anchorAcId: 'application-api-rest-AC-2111-3',
      anchorReqId: 'application-api-rest-REQ-009',
      verdict: equalOk ? 'pass' : 'fail',
      detail: equalOk
        ? `The status field inside the envelope always equals - envelope status=${parsed2.status} equals HTTP status ${res2.status}`
        : `The status field inside the envelope always equals - status-equality fault: httpStatus=${res2.status} envelopeStatus=${parsed2.status}`,
      evidence: evidenceFromResponse({
        route: '/unknown-route',
        response: res2,
        bodyText: body2,
        extraFields: {
          input: { path: '/unknown-route' },
          derived: { httpStatus: res2.status, envelopeStatus: parsed2.status, equal: parsed2.status === res2.status },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
