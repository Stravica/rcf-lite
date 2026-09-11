// sort-adapter-round-trip probe for application-datatable v1.0.6.
//
// Verifies AC-17101-1: activating a column's sort control makes the
// server-side sort response order the derived output; the probe
// asserts the row order actually changed vs the unsorted response
// AND that the returned order matches a comparator run over the
// rows themselves. `changed` and `comparator` are both required
// for pass (Addendum rule 2 - a derived assertion, not a constant
// echo).
//
// anchorAcId: application-datatable-AC-17101-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-datatable-REQ-002';
export const accountBound = false;

function idsOf(payload) {
  return (payload.rows || []).map((r) => r.id);
}

function valuesOf(payload, key) {
  return (payload.rows || []).map((r) => r[key]);
}

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-datatable/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];
    const unsorted = await fetch(`${fixture.baseUrl}/api/rows?pageSize=100`);
    const unsortedBody = await unsorted.text();
    const unsortedIds = idsOf(JSON.parse(unsortedBody));

    // Sort by score - the fixture's scores are shuffled (30, 10,
    // 20, 40, 50, 15, 35, 25) so an ascending sort visibly
    // reorders vs the insertion-order unsorted response. Sorting
    // by name would leave the order unchanged (fixture inserts
    // alphabetically) and would not observe the property.
    const sortField = 'score';
    const sortedRes = await fetch(`${fixture.baseUrl}/api/rows?sort=${sortField}&pageSize=100`);
    const sortedBody = await sortedRes.text();
    const sortedParsed = JSON.parse(sortedBody);
    const sortedIds = idsOf(sortedParsed);
    const sortedValues = valuesOf(sortedParsed, sortField);
    const comparator = [...sortedValues].sort((a, b) => a - b);
    const comparatorMatches = comparator.every((v, i) => v === sortedValues[i]);
    const echoed = sortedParsed.sort === sortField;
    const changed = JSON.stringify(unsortedIds) !== JSON.stringify(sortedIds);
    const pass = unsorted.status === 200 && sortedRes.status === 200 && echoed && changed && comparatorMatches;
    results.push({
      anchorAcId: 'application-datatable-AC-17101-1',
      anchorReqId: 'application-datatable-REQ-002',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `sort=${sortField}: order changed vs unsorted AND matches a JS-side ascending comparator over the returned ${sortField} values`
        : `sort fault: echoed=${echoed} changed=${changed} comparatorMatches=${comparatorMatches} unsorted=${unsorted.status} sorted=${sortedRes.status}`,
      evidence: evidenceFromResponse({
        route: `/api/rows?sort=${sortField}&pageSize=100`,
        response: sortedRes,
        bodyText: sortedBody,
        extraFields: {
          input: { sort: sortField },
          derived: { unsortedIds, sortedIds, sortedValues, changed, echoedSort: echoed, comparatorMatches },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
