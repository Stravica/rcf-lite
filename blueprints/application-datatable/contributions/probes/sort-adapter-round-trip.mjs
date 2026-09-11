// sort-adapter-round-trip probe for application-datatable v1.0.8.
//
// AC-17101-1 has two halves: the API sort response ordering
// (server-observable) and the browser DOM re-render after clicking
// the header (browser-only). This probe records ONE conformanceOnly
// row carrying the API observation with a limitation naming the
// browser half - no separate notObservableHere row (
// section 2: same-AC positive + amber duplicates were the defect).
//
// anchorAcId: application-datatable-AC-17101-1.

import { startFixture, evidenceFromResponse, conformanceOnlyResult } from './probe-utils.mjs';

export const anchorReqId = 'application-datatable-REQ-002';
export const accountBound = false;

function idsOf(payload) { return (payload.rows || []).map((r) => r.id); }
function valuesOf(payload, key) { return (payload.rows || []).map((r) => r[key]); }

export default async function runProbe() {
 const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-datatable/server.js');
 const fixture = await startFixture({ startServer, port: 0 });
 try {
 const results = [];
 const unsorted = await fetch(`${fixture.baseUrl}/api/rows?pageSize=100`);
 const unsortedBody = await unsorted.text();
 const unsortedIds = idsOf(JSON.parse(unsortedBody));

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
 results.push(conformanceOnlyResult({
 anchorAcId: 'application-datatable-AC-17101-1',
 anchorReqId: 'application-datatable-REQ-002',
 verdict: pass ? 'pass' : 'fail',
 detail: `Given a rendered datatable route with a sortable - sort=${sortField}: order changed vs unsorted AND matches a JS-side ascending comparator over the returned ${sortField} values (server-observable half)`,
 evidence: evidenceFromResponse({
 route: `/api/rows?sort=${sortField}&pageSize=100`,
 response: sortedRes,
 bodyText: sortedBody,
 extraFields: {
 input: { sort: sortField },
 derived: { unsortedIds, sortedIds, sortedValues, changed, echoedSort: echoed, comparatorMatches },
 },
 }),
 limitation: 'application-datatable-AC-17101-1: clicking the column-header sort control and comparing rendered DOM row order is browser-only',
 }));
 return { results };
 } finally {
 await fixture.close();
 }
}
