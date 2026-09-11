// apg-table-shape probe for application-datatable v1.0.4.
//
// Verifies that the datatable surface honours the ARIA APG grid
// pattern (REQ-001): a <table role="grid"> with column headers
// carrying scope="col" and sort controls; the fixture ships a
// keyboard-reachable sortControl button per column. Records the
// request id and body excerpt as evidence.
//
// anchorReqId: application-datatable-REQ-001.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-datatable-REQ-001';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-datatable/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];
    const res = await fetch(`${fixture.baseUrl}/`);
    const body = await res.text();
    const hasGrid = /<table[^>]+role="grid"/.test(body);
    const colHeaders = (body.match(/scope="col"/g) || []).length;
    const sortControls = (body.match(/class="sortControl"/g) || []).length;
    const pass = res.status === 200 && hasGrid && colHeaders >= 2 && sortControls >= 2;
    results.push({
      anchorReqId: 'application-datatable-REQ-001',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `APG grid shape observed: table role=grid; scope=col headers=${colHeaders}; sortControls=${sortControls}`
        : `APG shape fault: gridRole=${hasGrid} scopeColHeaders=${colHeaders} sortControls=${sortControls} status=${res.status}`,
      evidence: evidenceFromResponse({ route: '/', response: res, bodyText: body, extraFields: { columnHeaders: colHeaders, sortControls } }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
