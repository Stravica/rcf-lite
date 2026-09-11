// designed-empty-state probe for application-spa v1.5.10.
//
// Verifies AC-1117-1: every data-bearing route renders a designed
// loading, empty, error and success state (not a generic frame).
// The probe drives every data-bearing route through each of the
// four state values via ?state= and asserts the state-specific
// region markers.
//
// anchorAcId: application-spa-AC-1117-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-spa-REQ-010';
export const accountBound = false;

const STATES = ['loading', 'empty', 'error', 'success'];

function stateMarkers(state) {
  if (state === 'loading') return { attr: /data-route-state="loading"/, region: /aria-busy="true"/ };
  if (state === 'empty') return { attr: /data-route-state="empty"/, region: /data-empty-state=/ };
  if (state === 'error') return { attr: /data-route-state="error"/, region: /data-state="error"/ };
  return { attr: /data-route-state="success"/, region: /data-state="success"/ };
}

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-spa/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    const routesRes = await fetch(`${fixture.baseUrl}/__routes`);
    const routesJson = JSON.parse(await routesRes.text());
    const dataBearing = (routesJson.routes || []).filter((r) => r.dataBearing);

    const matrix = {};
    let allPass = true;
    let lastRes = null, lastBody = null, lastRoute = null;
    for (const r of dataBearing) {
      matrix[r.path] = {};
      for (const state of STATES) {
        const res = await fetch(`${fixture.baseUrl}${r.path}?state=${state}`);
        const body = await res.text();
        lastRes = res; lastBody = body; lastRoute = `${r.path}?state=${state}`;
        const markers = stateMarkers(state);
        const attrOk = markers.attr.test(body);
        const regionOk = markers.region.test(body);
        const pass = res.status === 200 && attrOk && regionOk;
        matrix[r.path][state] = { status: res.status, attrOk, regionOk, pass };
        if (!pass) allPass = false;
      }
    }
    const overallPass = allPass && dataBearing.length > 0;
    results.push({
      anchorAcId: 'application-spa-AC-1117-1',
      anchorReqId: 'application-spa-REQ-010',
      verdict: overallPass ? 'pass' : 'fail',
      detail: `Every data-bearing route renders designed loading, empty, error, - drove ${dataBearing.length} data-bearing routes through 4 states each (${dataBearing.length * 4} observations); all state markers present: ${allPass}`,
      evidence: evidenceFromResponse({
        route: lastRoute || '/reports?state=empty',
        response: lastRes,
        bodyText: lastBody,
        extraFields: {
          input: { dataBearingPaths: dataBearing.map((r) => r.path), states: STATES },
          derived: { matrix, allPass },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
