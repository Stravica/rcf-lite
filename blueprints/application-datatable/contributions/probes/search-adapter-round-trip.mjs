// search-adapter-round-trip probe for application-datatable v1.0.6.
//
// Verifies AC-17102-1: a text-filter q value narrows the returned
// set AND the returned rows all match the filter. The probe
// compares row content (name.includes(q)) - not merely total <=
// totalUnfiltered - to avoid the constant-echo bypass called out
// in closure section 8.
//
// anchorAcId: application-datatable-AC-17102-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

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
    results.push({
      anchorAcId: 'application-datatable-AC-17102-1',
      anchorReqId: 'application-datatable-REQ-003',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `search q="${q}" narrowed ${totalUnfiltered} to ${totalFiltered}; every returned row.name contains "${q}"`
        : `search fault: echoed=${echoed} totalUnfiltered=${totalUnfiltered} totalFiltered=${totalFiltered} narrowed=${narrowed} allMatch=${allMatch} droppedContainsRows=${droppedNamesInclude}`,
      evidence: evidenceFromResponse({
        route: `/api/rows?q=${q}&pageSize=100`,
        response: withQ,
        bodyText: withQBody,
        extraFields: {
          input: { q },
          derived: { totalUnfiltered, totalFiltered, narrowed, allMatch, filteredNames, unfilteredCount: noQNames.length },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
