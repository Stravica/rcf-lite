// apg-table-shape probe for application-datatable v1.0.9.
//
// AC-17107-1 (server-observable, ): the rendered
// datatable is a <table role="grid"> with <th> cells scoped to col;
// this is a real DOM shape the probe reads directly from the shell
// route. The row is a plain anchor (not conformanceOnly, not
// notObservableHere) - the AC is fully observable server-side.
// AC-17107-5 (arrow-key cell focus) remains browser-only.
//
// anchorAcId: application-datatable-AC-17107-1 (row 1) and
// application-datatable-AC-17107-5 (row 2, notObservableHere).

import { startFixture, evidenceFromResponse, notObservableHereResult } from './probe-utils.mjs';

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
 results.push({
 anchorAcId: 'application-datatable-AC-17107-1',
 verdict: pass ? 'pass' : 'fail',
 detail: `Given a datatable shell that renders interactive per-row - shell renders <table role="grid"> with ${colHeaders} scope="col" headers and per-row interactivity (sortControls=${sortControls}, rowSelectors=${rowSelectors})`,
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

 results.push(notObservableHereResult({
 ac: 'application-datatable-AC-17107-5',
 detail: 'Given a `role="grid"` shell, when the operator uses - arrow-key cell focus is browser-only per the browser-only rule',
 reason: 'AC-17107-5 requires observing arrow-key cell focus movement; server-side probe pack cannot observe focus',
 evidence: { requires: 'browser keydown events + focus observation' },
 }));

 return { results };
 } finally {
 await fixture.close();
 }
}
