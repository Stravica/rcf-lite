// task-list-surface probe for application-forms-wizard v1.2.6.
//
// AC-24101-1 (server-observable): the task-list surface exposes
// data-surface="task-list" carrying a role="progressbar" and one
// child element per step whose data-step-state is drawn from the
// four-state GOV.UK enum. The probe DRIVES a varied manifest via
// `?manifest=slug1|slug2|slug3|slug4` so the rendered rows AND
// /__task-manifest both derive from the same varied input rather
// than duplicating the fixture's module constant.
//
// Row 2 (AC-24101-1, browser-only half): the AC's contract names
// driving the REAL BROWSER to /task-list and reading the state
// string per step, the progressbar values and the enumerated step
// order from the rendered DOM. A server-side probe pack cannot
// drive a browser, so that half is recorded as notObservableHere
// against the same AC alongside the server counting row.
//
// anchorAcId: application-forms-wizard-AC-24101-1.

import { startFixture, evidenceFromResponse, conformanceOnlyResult, notObservableHereResult } from './probe-utils.mjs';

export const anchorReqId = 'application-forms-wizard-REQ-001';
export const accountBound = false;

function extractRows(body) {
 const rowRe = /data-step-slug="([^"]+)"[^>]*data-step-state="([^"]+)"/g;
 const rows = [];
 let m;
 while ((m = rowRe.exec(body)) !== null) rows.push({ slug: m[1], state: m[2] });
 return rows;
}

async function driveOne(fixture, variedSlugs) {
 const q = variedSlugs.join('|');
 const manifestRes = await fetch(`${fixture.baseUrl}/__task-manifest?manifest=${encodeURIComponent(q)}`);
 const manifestBody = await manifestRes.text();
 const manifest = JSON.parse(manifestBody);
 const expectedSlugs = (manifest.steps || []).map((s) => s.slug);
 const allowedStates = new Set(manifest.allowedStates || []);

 const shellRes = await fetch(`${fixture.baseUrl}/task-list?manifest=${encodeURIComponent(q)}`);
 const shellBody = await shellRes.text();
 const rows = extractRows(shellBody);
 const slugsInOrder = rows.map((r) => r.slug);
 const progressbar = /role="progressbar"[^>]*aria-valuenow="(\d+)"[^>]*aria-valuemax="(\d+)"[^>]*aria-valuetext="([^"]+)"/.exec(shellBody);
 const statesValid = rows.every((r) => allowedStates.has(r.state));
 const orderMatchesManifest = slugsInOrder.length === expectedSlugs.length && slugsInOrder.every((s, i) => s === expectedSlugs[i]);
 const manifestFollowsInput = expectedSlugs.length === variedSlugs.length && expectedSlugs.every((s, i) => s === variedSlugs[i]);
 const progressOk = !!progressbar && Number(progressbar[2]) === variedSlugs.length;
 const passOne = shellRes.status === 200 && rows.length === variedSlugs.length && statesValid && orderMatchesManifest && manifestFollowsInput && progressOk;
 return { manifestBody, manifestRes, manifest, expectedSlugs, allowedStates: [...allowedStates], rows, slugsInOrder, orderMatchesManifest, manifestFollowsInput, progressOk, statesValid, passOne, shellRes, shellBody };
}

export default async function runProbe() {
 const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard/server.js');
 const fixture = await startFixture({ startServer, port: 0 });
 try {
 const results = [];

 // Drive TWO distinct manifests so the varied input demonstrably
 // changes the rendered output; a fixture that echoed the module
 // constant would fail both.
 const runA = await driveOne(fixture, ['alpha-step', 'bravo-step', 'charlie-step']);
 const runB = await driveOne(fixture, ['delta-step', 'echo-step', 'foxtrot-step', 'golf-step']);
 const pass = runA.passOne && runB.passOne
 && JSON.stringify(runA.slugsInOrder) !== JSON.stringify(runB.slugsInOrder);
 results.push(conformanceOnlyResult({
 anchorAcId: 'application-forms-wizard-AC-24101-1',
 verdict: pass ? 'pass' : 'fail',
 detail: `Given the wizard task-list route, the rendered surface - drove two distinct manifests; runA rows=[${runA.slugsInOrder.join(',')}] runB rows=[${runB.slugsInOrder.join(',')}]; both align with /__task-manifest (${runA.manifestFollowsInput && runB.manifestFollowsInput}) and progressbar valuemax follows the varied input (${runA.progressOk && runB.progressOk})`,
 evidence: evidenceFromResponse({
 route: '/task-list?manifest=delta-step|echo-step|foxtrot-step|golf-step',
 response: runB.shellRes,
 bodyText: runB.shellBody,
 extraFields: {
 input: { runA: ['alpha-step', 'bravo-step', 'charlie-step'], runB: ['delta-step', 'echo-step', 'foxtrot-step', 'golf-step'] },
 derived: {
 runARows: runA.slugsInOrder,
 runBRows: runB.slugsInOrder,
 runAManifestFollowsInput: runA.manifestFollowsInput,
 runBManifestFollowsInput: runB.manifestFollowsInput,
 runAOrderMatchesManifest: runA.orderMatchesManifest,
 runBOrderMatchesManifest: runB.orderMatchesManifest,
 runAStatesValid: runA.statesValid,
 runBStatesValid: runB.statesValid,
 },
 altBodyExcerpt: runA.manifestBody.slice(0, 240),
 },
 }),
 limitation: 'application-forms-wizard-AC-24101-1: the closed enum owned by TAC-2501.interfaces.statesEnum is validated against /__task-manifest.allowedStates on this pack; a server-side probe pack cannot import the applying project\'s statesEnum. The rendered per-step [data-step-state] and progressbar values are asserted directly.',
 }));

 // Row 2: notObservableHere for AC-24101-1's browser-only half -
 // the AC contract names driving the real browser to /task-list
 // and reading per-step state, progressbar values and enumerated
 // step order from the rendered DOM. A server-side probe pack
 // cannot drive a browser, so the row represents that half on the
 // shelf so it is not carried by the server row's limitation alone.
 results.push(notObservableHereResult({
 ac: 'application-forms-wizard-AC-24101-1',
 detail: 'Given the wizard task-list route, the rendered surface - the pack drives the real browser to /task-list and reads state per step, progressbar values and step order from the rendered DOM',
 reason: 'AC-24101-1 requires driving a real browser to /task-list and reading data-step-state, aria-valuenow/valuemax/valuetext and the enumerated step order from the rendered DOM; a server-side probe pack cannot drive a browser or observe DOM read-back',
 evidence: { requires: 'real-browser observation of /task-list rendered DOM', ac: 'application-forms-wizard-AC-24101-1' },
 }));
 return { results };
 } finally {
 await fixture.close();
 }
}
