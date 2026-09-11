// cursor-pagination-round-trip probe for application-api-rest v2.1.5.
//
// Verifies that a collection endpoint paginates with cursors per
// REQ-007. The probe starts the fixture, GETs /v1/widgets?limit=5,
// asserts the response body carries items[] of length 5 with a
// nextCursor, then GETs the follow-up page and asserts a fresh set
// of items appears with either the next cursor or null. The
// x-request-id echo header and the JSON body excerpt are recorded
// as evidence.
//
// anchorReqId: application-api-rest-REQ-007.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-api-rest-REQ-007';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];

    const firstRes = await fetch(`${fixture.baseUrl}/v1/widgets?limit=5`);
    const firstBody = await firstRes.text();
    const first = JSON.parse(firstBody);
    const firstOk = firstRes.status === 200 && Array.isArray(first.items) && first.items.length === 5 && first.nextCursor === '5';
    results.push({
      anchorReqId: 'application-api-rest-REQ-007',
      verdict: firstOk ? 'pass' : 'fail',
      detail: firstOk
        ? `GET /v1/widgets?limit=5 returned 5 items with nextCursor=${first.nextCursor}`
        : `pagination fault first page: status=${firstRes.status} items=${first.items ? first.items.length : 'null'} nextCursor=${first.nextCursor}`,
      evidence: evidenceFromResponse({ route: '/v1/widgets?limit=5', response: firstRes, bodyText: firstBody, extraFields: { firstIds: (first.items || []).map((i) => i.id) } }),
    });

    const nextRes = await fetch(`${fixture.baseUrl}/v1/widgets?limit=5&cursor=${first.nextCursor}`);
    const nextBody = await nextRes.text();
    const next = JSON.parse(nextBody);
    const distinct = next.items && !next.items.some((it) => (first.items || []).some((f) => f.id === it.id));
    const nextOk = nextRes.status === 200 && Array.isArray(next.items) && next.items.length === 5 && distinct;
    results.push({
      anchorReqId: 'application-api-rest-REQ-007',
      verdict: nextOk ? 'pass' : 'fail',
      detail: nextOk
        ? `GET /v1/widgets?limit=5&cursor=${first.nextCursor} returned 5 distinct items with nextCursor=${next.nextCursor}`
        : `pagination fault follow-up: status=${nextRes.status} items=${next.items ? next.items.length : 'null'} distinct=${distinct}`,
      evidence: evidenceFromResponse({ route: `/v1/widgets?cursor=${first.nextCursor}`, response: nextRes, bodyText: nextBody, extraFields: { followUpIds: (next.items || []).map((i) => i.id) } }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
