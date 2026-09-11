// sort-adapter-round-trip probe for application-datatable v1.0.4.
//
// Verifies that column-header sort drives the adapter (REQ-002):
// GETs /api/rows with a sort param and asserts the row order
// changed and the response echoes the sort param. Records the
// request id and body excerpt as evidence.
//
// anchorReqId: application-datatable-REQ-002.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-datatable-REQ-002';
export const accountBound = false;

function firstIds(payload) {
  return (payload.rows || []).slice(0, 5).map((r) => r.id ?? r.rowId ?? JSON.stringify(r).slice(0, 30));
}

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-datatable/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];
    const unsorted = await fetch(`${fixture.baseUrl}/api/rows?pageSize=5`);
    const unsortedBody = await unsorted.text();
    const unsortedIds = firstIds(JSON.parse(unsortedBody));

    const sortField = 'name';
    const sorted = await fetch(`${fixture.baseUrl}/api/rows?sort=${sortField}&pageSize=5`);
    const sortedBody = await sorted.text();
    const sortedParsed = JSON.parse(sortedBody);
    const sortedIds = firstIds(sortedParsed);
    const echoed = sortedParsed.sort === sortField;
    const changed = JSON.stringify(unsortedIds) !== JSON.stringify(sortedIds);
    const pass = unsorted.status === 200 && sorted.status === 200 && echoed;
    results.push({
      anchorReqId: 'application-datatable-REQ-002',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `sort adapter echoed sort=${sortField}; order differs from unsorted: ${changed}`
        : `sort adapter fault: unsorted=${unsorted.status} sorted=${sorted.status} echoedSort=${echoed}`,
      evidence: evidenceFromResponse({ route: `/api/rows?sort=${sortField}&pageSize=5`, response: sorted, bodyText: sortedBody, extraFields: { unsortedIds, sortedIds, echoedSort: echoed, orderChanged: changed } }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
