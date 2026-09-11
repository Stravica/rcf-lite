// apg-table-shape probe for application-datatable v1.0.7.
//
// AC-17107-1 requires the rendered interactive shell / accessibility
// tree; that observation is browser-only and recorded as
// notObservableHere per Addendum 3 rule 11. The server-observable
// half (table role=grid, scope=col headers, sortControls in DOM,
// data-tile-role attributes) remains a conformanceOnly evidence row.
// AC-17107-5 (arrow-key cell focus) is also browser-only.
//
// anchorAcId: application-datatable-AC-17107-1.

import { startFixture, evidenceFromResponse, notObservableHereResult, conformanceOnlyResult } from './probe-utils.mjs';

export const anchorReqId = 'application-datatable-REQ-001';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-datatable/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];
    const res = await fetch(`${fixture.baseUrl}/`);
    const body = await res.text();
    const hasGrid = /<table[^>]+role="grid"/.test(body);
    const colHeaders = (body.match(/scope="col"/g) || []).length;
    const sortControls = (body.match(/class="sortControl"/g) || []).length;
    const rowSelectors = (body.match(/class="rowSelect"/g) || []).length;
    const interactivityShipped = /rowSelect/.test(body) && /bulkAction/.test(body);
    const pass = res.status === 200 && hasGrid && colHeaders >= 4 && sortControls >= 4 && interactivityShipped;
    results.push(conformanceOnlyResult({
      anchorAcId: 'application-datatable-AC-17107-1',
      anchorReqId: 'application-datatable-REQ-001',
      verdict: pass ? 'pass' : 'fail',
      detail: `Given a datatable shell that renders interactive per-row - server-observable half of AC-17107-1: table role=grid, scope=col headers=${colHeaders}, sortControls=${sortControls}, per-row interactivity ships`,
      evidence: evidenceFromResponse({
        route: '/',
        response: res,
        bodyText: body,
        extraFields: {
          input: { fixtureShipsInteractivity: interactivityShipped },
          derived: { gridRole: hasGrid, colHeaders, sortControls, rowSelectors },
        },
      }),
      limitation: 'application-datatable-AC-17107-1: rendered interactive shell / accessibility tree is browser-only',
    }));

    results.push(notObservableHereResult({
      anchorAcId: 'application-datatable-AC-17107-1',
      anchorReqId: 'application-datatable-REQ-001',
      ac: 'application-datatable-AC-17107-1',
      detail: 'Given a datatable shell that renders interactive per-row - rendered interactive shell and accessibility tree are browser-only',
      reason: 'AC-17107-1 requires the rendered accessibility tree with interactive per-row controls; server-side probe pack cannot observe it',
      evidence: { requires: 'browser accessibility tree', probes: ['axe', 'aria-inspect'] },
    }));

    results.push(notObservableHereResult({
      anchorAcId: 'application-datatable-AC-17107-5',
      anchorReqId: 'application-datatable-REQ-001',
      ac: 'application-datatable-AC-17107-5',
      detail: 'Arrow-key cell focus - browser-only per Addendum 3 rule 11',
      reason: 'AC-17107-5 requires observing arrow-key cell focus movement; server-side probe pack cannot observe focus',
      evidence: { requires: 'browser keydown events + focus observation' },
    }));

    return { results };
  } finally {
    await fixture.close();
  }
}
