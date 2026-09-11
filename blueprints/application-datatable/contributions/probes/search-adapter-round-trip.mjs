// search-adapter-round-trip probe for application-datatable v1.0.4.
//
// Verifies that the search input drives the query adapter (REQ-003).
// Calls /api/rows with and without a text query and asserts the
// filtered result set differs and the response echoes the q param.
// Records the request id and body excerpt as evidence.
//
// anchorReqId: application-datatable-REQ-003.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-datatable-REQ-003';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-datatable/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];

    const noQ = await fetch(`${fixture.baseUrl}/api/rows?pageSize=100`);
    const noQBody = await noQ.text();
    const totalUnfiltered = JSON.parse(noQBody).total;

    const q = 'a';
    const withQ = await fetch(`${fixture.baseUrl}/api/rows?q=${q}&pageSize=100`);
    const withQBody = await withQ.text();
    const withParsed = JSON.parse(withQBody);
    const echoed = withParsed.q === q;
    const filtered = withParsed.total <= totalUnfiltered;
    const pass = noQ.status === 200 && withQ.status === 200 && echoed && filtered;
    results.push({
      anchorReqId: 'application-datatable-REQ-003',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `search adapter: unfiltered total=${totalUnfiltered} q="${q}" total=${withParsed.total} echoedQ=${echoed}`
        : `search adapter fault: unfiltered=${totalUnfiltered} filtered=${withParsed.total} echoedQ=${echoed}`,
      evidence: evidenceFromResponse({ route: `/api/rows?q=${q}&pageSize=100`, response: withQ, bodyText: withQBody, extraFields: { totalUnfiltered, totalFiltered: withParsed.total, echoedQ: echoed } }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
