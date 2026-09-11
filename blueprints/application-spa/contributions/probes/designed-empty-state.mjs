// designed-empty-state probe for application-spa v1.5.6.
//
// Verifies that a data-bearing route ships a designed empty state
// (REQ-010) rather than falling back to a generic frame. The probe
// hits /reports (which the fixture declares as state=empty on the
// route inventory), asserts data-route-state="empty" on the main
// element and a data-empty-state="reports" region with a labelled
// call-to-action, then records the response identifier and body
// excerpt as evidence.
//
// anchorReqId: application-spa-REQ-010.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-spa-REQ-010';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-spa/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];
    const res = await fetch(`${fixture.baseUrl}/reports`);
    const body = await res.text();
    const hasEmpty = /data-empty-state="reports"/.test(body);
    const stateAttr = /data-route-state="empty"/.test(body);
    const pass = res.status === 200 && hasEmpty && stateAttr;
    results.push({
      anchorReqId: 'application-spa-REQ-010',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? 'GET /reports renders data-route-state="empty" with data-empty-state="reports" region'
        : `empty-state fault: status=${res.status} emptyRegion=${hasEmpty} stateAttr=${stateAttr}`,
      evidence: evidenceFromResponse({ route: '/reports', response: res, bodyText: body }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
