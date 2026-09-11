// designed-empty-state probe for application-spa v1.5.8.
//
// Verifies AC-1117-1 on the /reports route: the surface renders a
// designed empty state - a data-empty-state region with named
// content and a per-context filling action - instead of a generic
// frame. The probe asserts data-route-state="empty" on the main
// element AND the region carries a per-context cue AND a
// data-empty-cta button naming the action.
//
// anchorAcId: application-spa-AC-1117-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-spa-REQ-010';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-spa/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];
    const res = await fetch(`${fixture.baseUrl}/reports`);
    const body = await res.text();
    const stateAttr = /<main[^>]+data-route-state="empty"/.test(body);
    const emptyRegionMatch = body.match(/<section[^>]+role="region"[^>]+data-empty-state="reports"[^>]*>([\s\S]*?)<\/section>/);
    const hasEmptyRegion = !!emptyRegionMatch;
    const hasCta = hasEmptyRegion && /data-empty-cta="reports"/.test(emptyRegionMatch[1]);
    const hasNamedCopy = hasEmptyRegion && /No reports yet/.test(emptyRegionMatch[1]);
    const pass = res.status === 200 && stateAttr && hasEmptyRegion && hasCta && hasNamedCopy;
    results.push({
      anchorAcId: 'application-spa-AC-1117-1',
      anchorReqId: 'application-spa-REQ-010',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? 'GET /reports renders main[data-route-state="empty"] with per-context empty region and CTA'
        : `empty-state fault: stateAttr=${stateAttr} emptyRegion=${hasEmptyRegion} cta=${hasCta} copy=${hasNamedCopy} status=${res.status}`,
      evidence: evidenceFromResponse({
        route: '/reports',
        response: res,
        bodyText: body,
        extraFields: {
          input: { route: '/reports' },
          derived: { stateAttr, hasEmptyRegion, hasCta, hasNamedCopy },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
