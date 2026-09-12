// search-adapter-round-trip probe for application-datatable v1.0.9.
//
// AC-17102-1: the query adapter reads `q` and returns rows matching
// the filter. The API round-trip is server-observable and the row is
// a conformanceOnly with a limitation naming the browser half; no
// duplicate notObservableHere row is emitted for the same AC.
//
// anchorAcId: application-datatable-AC-17102-1.

import { startFixture, evidenceFromResponse, conformanceOnlyResult } from './probe-utils.mjs';

export const anchorReqId = 'application-datatable-REQ-003';
export const accountBound = false;

export default async function runProbe() {
 const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-datatable/server.js');
 const fixture = await startFixture({ startServer, port: 0 });
 try {
 const results = [];

 const noQ = await fetch(`${fixture.baseUrl}/api/rows?pageSize=100`);
 const noQBody = await noQ.text();
 const noQParsed = JSON.parse(noQBody);
 const totalUnfiltered = noQParsed.total;
 const noQNames = (noQParsed.rows || []).map((r) => r.name.toLowerCase());

 const q = 'a';
 const withQ = await fetch(`${fixture.baseUrl}/api/rows?q=${q}&pageSize=100`);
 const withQBody = await withQ.text();
 const withParsed = JSON.parse(withQBody);
 const echoed = withParsed.q === q;
 const totalFiltered = withParsed.total;
 const filteredNames = (withParsed.rows || []).map((r) => r.name.toLowerCase());
 const narrowed = totalFiltered < totalUnfiltered;
 const allMatch = filteredNames.length > 0 && filteredNames.every((n) => n.includes(q.toLowerCase()));
 const droppedNamesInclude = noQNames.some((n) => !filteredNames.includes(n));
 const pass = noQ.status === 200 && withQ.status === 200 && echoed && narrowed && allMatch && droppedNamesInclude;
 results.push(conformanceOnlyResult({
 anchorAcId: 'application-datatable-AC-17102-1',
 anchorReqId: 'application-datatable-REQ-003',
 verdict: pass ? 'pass' : 'fail',
 detail: `Given a rendered datatable route with a text - search q="${q}" narrowed ${totalUnfiltered} to ${totalFiltered}; every returned row.name contains "${q}" (server-observable half)`,
 evidence: evidenceFromResponse({
 route: `/api/rows?q=${q}&pageSize=100`,
 response: withQ,
 bodyText: withQBody,
 extraFields: {
 input: { q },
 derived: { totalUnfiltered, totalFiltered, narrowed, allMatch, filteredNames, unfilteredCount: noQNames.length },
 },
 }),
 limitation: 'application-datatable-AC-17102-1: typing into the browser filter input and comparing rendered rows is browser-only',
 }));
 return { results };
 } finally {
 await fixture.close();
 }
}
