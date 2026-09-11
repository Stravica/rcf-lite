// shell-nav-present probe for application-spa v1.5.8.
//
// Verifies AC-1102-1: the shell provides a top-level primary <nav>
// with an accessible name and a route link per declared inventory
// entry. The probe crawls the JSON inventory and asserts one link
// per inventory entry appears inside the primary <nav> block,
// matching by data-route-name; the crawl vs shell comparison is
// two independent server observations.
//
// anchorAcId: application-spa-AC-1102-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-spa-REQ-002';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-spa/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    const routesRes = await fetch(`${fixture.baseUrl}/__routes`);
    const routesJson = JSON.parse(await routesRes.text());
    const inventoryNames = (routesJson.routes || []).map((r) => r.name);

    const shellRes = await fetch(`${fixture.baseUrl}/`);
    const body = await shellRes.text();
    const navMatch = body.match(/<nav[^>]+aria-label="Primary"[^>]+data-region="primary-nav"[^>]*>([\s\S]*?)<\/nav>/);
    const hasNav = !!navMatch;
    const linksInNav = hasNav
      ? Array.from(navMatch[1].matchAll(/data-route-name="([^"]+)"/g)).map((m) => m[1])
      : [];
    const pass = shellRes.status === 200
      && hasNav
      && inventoryNames.length > 0
      && linksInNav.length === inventoryNames.length
      && inventoryNames.every((n) => linksInNav.includes(n));

    results.push({
      anchorAcId: 'application-spa-AC-1102-1',
      anchorReqId: 'application-spa-REQ-002',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `primary <nav aria-label="Primary"> carries ${linksInNav.length} links matching inventory names [${inventoryNames.join(',')}]`
        : `nav parity fault: navPresent=${hasNav} linksInNav=[${linksInNav.join(',')}] inventoryNames=[${inventoryNames.join(',')}]`,
      evidence: evidenceFromResponse({
        route: '/',
        response: shellRes,
        bodyText: body,
        extraFields: {
          input: { inventoryNames },
          derived: { navPresent: hasNav, linksInNav },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
