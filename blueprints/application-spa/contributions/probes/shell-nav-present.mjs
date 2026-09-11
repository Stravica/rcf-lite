// shell-nav-present probe for application-spa v1.5.7.
//
// Verifies that the shell provides top-level navigation (REQ-002)
// via a semantic <nav> region carrying an aria-label and a labelled
// primary-nav data-region. The probe derives its expected route
// count from a separate HTTP round trip to /__routes rather than
// importing a fixture-side constant, so the check compares two
// independent server observations (the JSON inventory vs. the shell
// DOM) rather than asserting a constant against itself (rule 2 of
// the 7d addendum, 2026-09-11).
//
// anchorReqId: application-spa-REQ-002.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-spa-REQ-002';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-spa/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];

    // Independent round trip to /__routes derives the expected count
    // from the running server, not from a shared JS constant.
    const routesRes = await fetch(`${fixture.baseUrl}/__routes`);
    const routesBody = await routesRes.text();
    const routesJson = JSON.parse(routesBody);
    const expected = Array.isArray(routesJson.routes) ? routesJson.routes.length : 0;

    const shellRes = await fetch(`${fixture.baseUrl}/`);
    const body = await shellRes.text();
    const hasNav = /<nav[^>]+aria-label="Primary"[^>]+data-region="primary-nav"/.test(body);
    const linkCount = (body.match(/data-route-name="/g) || []).length;
    const pass = shellRes.status === 200 && hasNav && expected > 0 && linkCount === expected;
    results.push({
      anchorReqId: 'application-spa-REQ-002',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `top-level <nav aria-label="Primary"> present with ${linkCount} route links (matches /__routes count ${expected})`
        : `nav fault: status=${shellRes.status} navPresent=${hasNav} linkCount=${linkCount} inventoryCount=${expected}`,
      evidence: evidenceFromResponse({ route: '/', response: shellRes, bodyText: body, extraFields: { linkCount, inventoryCount: expected } }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
