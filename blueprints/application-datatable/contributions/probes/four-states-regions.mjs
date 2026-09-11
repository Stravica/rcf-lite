// four-states-regions probe for application-datatable v1.0.4.
//
// Verifies that each of the four states renders inside its own
// role="region" element with aria-live (REQ-005). The fixture ships
// gridRegion (populated), emptyRegion (empty), loadingRegion
// (loading) and errorRegion (error), each a <section role="region"
// aria-live="polite" id="...Region">. Records the request id and
// body excerpt per state as evidence.
//
// anchorReqId: application-datatable-REQ-005.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-datatable-REQ-005';
export const accountBound = false;

const STATE_TO_REGION = {
  populated: 'gridRegion',
  empty: 'emptyRegion',
  loading: 'loadingRegion',
  error: 'errorRegion',
};

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-datatable/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];
    for (const [state, regionId] of Object.entries(STATE_TO_REGION)) {
      const res = await fetch(`${fixture.baseUrl}/?state=${state}`);
      const body = await res.text();
      const pattern = new RegExp(`<section[^>]+role="region"[^>]+aria-live="polite"[^>]+id="${regionId}"`);
      const alternate = new RegExp(`<section[^>]+id="${regionId}"[^>]+role="region"[^>]+aria-live="polite"`);
      const regionOk = pattern.test(body) || alternate.test(body);
      const pass = res.status === 200 && regionOk;
      results.push({
        anchorReqId: 'application-datatable-REQ-005',
        verdict: pass ? 'pass' : 'fail',
        detail: pass
          ? `state="${state}" renders <section role="region" aria-live="polite" id="${regionId}">`
          : `state region fault at ${state}: expected id="${regionId}" role=region aria-live; status=${res.status}`,
        evidence: evidenceFromResponse({ route: `/?state=${state}`, response: res, bodyText: body, extraFields: { state, regionId } }),
      });
    }
    return { results };
  } finally {
    await fixture.close();
  }
}
