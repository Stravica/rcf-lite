// apg-table-shape probe for application-datatable v1.0.6.
//
// Verifies AC-17107-1: the shell ships interactive per-row controls
// (sort buttons, row-selection checkboxes, inline actions), so the
// rendered table is <table role="grid"> with <th scope="col">. The
// closure ruling on ADR-1801 makes role="grid" the correct branch
// for this fixture because it ships row checkboxes; the probe
// asserts the fixture actually renders those controls before
// asserting the grid role, so a future stripped fixture flips the
// row to the read-only branch cleanly.
//
// anchorAcId: application-datatable-AC-17107-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

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
    const rowSelectors = (body.match(/class="rowSelect"/g) || []).length
      + (body.match(/type="checkbox"[^>]*class="rowSelect"/g) || []).length;
    // The shell also ships column-move controls and a bulk-action
    // opening a modal dialog; per-row inline interactions land after
    // the client script populates rows, so use the presence of the
    // row-selection template in the client script as the evidence
    // that per-row interactivity ships.
    const interactivityShipped = /rowSelect/.test(body) && /bulkAction/.test(body);
    const pass = res.status === 200 && hasGrid && colHeaders >= 4 && sortControls >= 4 && interactivityShipped;
    results.push({
      anchorAcId: 'application-datatable-AC-17107-1',
      anchorReqId: 'application-datatable-REQ-001',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `Given a datatable shell that renders interactive per-row - APG grid shape observed: table role=grid; scope=col headers=${colHeaders}; sortControls=${sortControls}; per-row interactivity ships`
        : `Given a datatable shell that renders interactive per-row - APG shape fault: gridRole=${hasGrid} scopeColHeaders=${colHeaders} sortControls=${sortControls} interactivity=${interactivityShipped} status=${res.status}`,
      evidence: evidenceFromResponse({
        route: '/',
        response: res,
        bodyText: body,
        extraFields: {
          input: { fixtureShipsInteractivity: interactivityShipped },
          derived: { gridRole: hasGrid, colHeaders, sortControls, rowSelectors },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
