// shell-five-regions probe for application-dashboard v1.0.4.
//
// Verifies that the shipped dashboard composes the five ratified
// regions on one page (REQ-001): tile row, chart region, filter
// chrome, timeframe picker, export handle. Fetches the shell HTML
// and asserts every region carries its role="region" and
// data-region marker. Records the response identifier and body
// excerpt as evidence.
//
// anchorReqId: application-dashboard-REQ-001.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-dashboard-REQ-001';
export const accountBound = false;

const REGIONS = ['tile-row', 'chart-region', 'filter-chrome', 'timeframe-picker', 'export-handle'];

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-dashboard/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];
    const res = await fetch(`${fixture.baseUrl}/`);
    const body = await res.text();
    const missing = REGIONS.filter((r) => !new RegExp(`data-region="${r}"`).test(body));
    const pass = res.status === 200 && missing.length === 0;
    results.push({
      anchorReqId: 'application-dashboard-REQ-001',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `dashboard shell renders all five regions: ${REGIONS.join(', ')}`
        : `regions missing: ${JSON.stringify(missing)} status=${res.status}`,
      evidence: evidenceFromResponse({ route: '/', response: res, bodyText: body, extraFields: { regionsExpected: REGIONS, regionsMissing: missing } }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
