// primary-kpi-top-left probe for application-dashboard v1.0.4.
//
// Verifies that the primary KPI carries the top-left placement the
// reader reaches first (REQ-002): the tile with
// data-tile-role="primary-kpi" appears first in DOM order inside
// the tile row and carries grid-column-start:1. Also checks the
// break-switch case (?break=kpi-position) demotes it. Records the
// request id and body excerpt as evidence.
//
// anchorReqId: application-dashboard-REQ-002.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-dashboard-REQ-002';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-dashboard/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];

    const okRes = await fetch(`${fixture.baseUrl}/`);
    const okBody = await okRes.text();
    const firstTile = okBody.match(/<article class="tile"([^>]*)/);
    const isPrimaryFirst = firstTile && /data-tile-role="primary-kpi"/.test(firstTile[1]);
    const hasColumnStart = firstTile && /grid-column-start:1/.test(firstTile[1]);
    const okPass = okRes.status === 200 && isPrimaryFirst && hasColumnStart;
    results.push({
      anchorReqId: 'application-dashboard-REQ-002',
      verdict: okPass ? 'pass' : 'fail',
      detail: okPass
        ? 'primary KPI tile is first in DOM order with grid-column-start:1'
        : `primary-first fault: primaryFirst=${isPrimaryFirst} columnStart=${hasColumnStart} status=${okRes.status}`,
      evidence: evidenceFromResponse({ route: '/', response: okRes, bodyText: okBody }),
    });

    const brokenRes = await fetch(`${fixture.baseUrl}/?break=kpi-position`);
    const brokenBody = await brokenRes.text();
    const brokenFirst = brokenBody.match(/<article class="tile"([^>]*)/);
    const brokenIsPrimary = brokenFirst && /data-tile-role="primary-kpi"/.test(brokenFirst[1]);
    const brokenPass = brokenRes.status === 200 && !brokenIsPrimary;
    results.push({
      anchorReqId: 'application-dashboard-REQ-002',
      verdict: brokenPass ? 'pass' : 'fail',
      detail: brokenPass
        ? 'break switch demoted primary KPI (probe would refuse ship on this run)'
        : `break switch not observed: primaryStillFirst=${brokenIsPrimary}`,
      evidence: evidenceFromResponse({ route: '/?break=kpi-position', response: brokenRes, bodyText: brokenBody, extraFields: { brokenPrimaryStillFirst: brokenIsPrimary } }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
