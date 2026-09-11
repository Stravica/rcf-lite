// shell-nav-present probe for application-spa v1.5.9.
//
// Verifies AC-1102-1: navigation renders on every route (not only
// the shell root). The probe crawls every declared inventory path,
// GETs each, and asserts the primary <nav> block appears in every
// rendered page with one link per inventory entry.
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
    const inventory = routesJson.routes || [];
    const inventoryNames = inventory.map((r) => r.name);

    const perRoute = {};
    let allPerRoutePass = true;
    let firstFailBody = '';
    let lastRoute = null;
    let lastBody = null;
    let lastRes = null;

    for (const r of inventory) {
      const shellRes = await fetch(`${fixture.baseUrl}${r.path}`);
      const body = await shellRes.text();
      lastRes = shellRes; lastBody = body; lastRoute = r.path;
      const navMatch = body.match(/<nav[^>]+aria-label="Primary"[^>]+data-region="primary-nav"[^>]*>([\s\S]*?)<\/nav>/);
      const hasNav = !!navMatch;
      const linksInNav = hasNav
        ? Array.from(navMatch[1].matchAll(/data-route-name="([^"]+)"/g)).map((m) => m[1])
        : [];
      const linksParity = linksInNav.length === inventoryNames.length
        && inventoryNames.every((n) => linksInNav.includes(n));
      const routePass = shellRes.status === 200 && hasNav && linksParity;
      perRoute[r.path] = { status: shellRes.status, hasNav, linksInNav, routePass };
      if (!routePass) { allPerRoutePass = false; if (!firstFailBody) firstFailBody = body.slice(0, 240); }
    }
    const pass = allPerRoutePass && inventory.length > 0;

    results.push({
      anchorAcId: 'application-spa-AC-1102-1',
      anchorReqId: 'application-spa-REQ-002',
      verdict: pass ? 'pass' : 'fail',
      detail: `Top navigation renders on every route from the - primary <nav aria-label="Primary"> renders on all ${Object.keys(perRoute).length} routes; every route carries links [${inventoryNames.join(',')}]`,
      evidence: evidenceFromResponse({
        route: lastRoute || '/',
        response: lastRes,
        bodyText: lastBody,
        extraFields: {
          input: { inventoryPaths: inventory.map((r) => r.path), inventoryNames },
          derived: { perRoute, allRoutesRenderNav: allPerRoutePass, firstFailBody },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
