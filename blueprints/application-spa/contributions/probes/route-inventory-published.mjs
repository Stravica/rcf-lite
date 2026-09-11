// route-inventory-published probe for application-spa v1.5.8.
//
// Verifies the property AC-1101-1 protects: the shell publishes a
// declared route inventory and every entry in that inventory is
// reachable. The probe crawls each declared path from a plain GET
// and compares the reachable set against the inventory, so both
// surfaces are independently observed and the check is not the
// same constant asserted against itself (Addendum rule 2).
//
// anchorAcId: application-spa-AC-1101-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-spa-REQ-001';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-spa/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    // Independent observation A: the JSON inventory.
    const routesRes = await fetch(`${fixture.baseUrl}/__routes`);
    const routesBody = await routesRes.text();
    const routesJson = JSON.parse(routesBody);
    const declaredPaths = Array.isArray(routesJson.routes)
      ? routesJson.routes.map((r) => r.path)
      : [];
    const shape = declaredPaths.length >= 3
      && routesJson.routes.every((r) => typeof r.path === 'string' && typeof r.name === 'string' && typeof r.state === 'string');

    // Independent observation B: crawl each declared path and record
    // the reachable set from real HTTP responses. Comparing crawl
    // vs inventory closes the loop without any shared constant.
    const reachable = [];
    const perPath = {};
    for (const p of declaredPaths) {
      const r = await fetch(`${fixture.baseUrl}${p}`);
      const body = await r.text();
      const ok = r.status === 200 && /<main[^>]+data-route=/.test(body);
      if (ok) reachable.push(p);
      perPath[p] = { status: r.status, ok };
    }
    const declaredSet = new Set(declaredPaths);
    const reachableSet = new Set(reachable);
    const missingFromReachable = declaredPaths.filter((p) => !reachableSet.has(p));
    const extraInReachable = reachable.filter((p) => !declaredSet.has(p));
    const parity = missingFromReachable.length === 0 && extraInReachable.length === 0;
    const inventoryOk = routesRes.status === 200 && shape && declaredPaths.length >= 3;

    results.push({
      anchorAcId: 'application-spa-AC-1101-1',
      anchorReqId: 'application-spa-REQ-001',
      verdict: inventoryOk && parity ? 'pass' : 'fail',
      detail: inventoryOk && parity
        ? `The project maintains a declared route inventory naming - inventory of ${declaredPaths.length} routes matches the reachable crawl set`
        : `The project maintains a declared route inventory naming - inventory-vs-crawl mismatch: declared=[${declaredPaths.join(',')}] missing=[${missingFromReachable.join(',')}] extra=[${extraInReachable.join(',')}]`,
      evidence: evidenceFromResponse({
        route: '/__routes',
        response: routesRes,
        bodyText: routesBody,
        extraFields: {
          input: { paths: declaredPaths },
          derived: { reachableCount: reachable.length, perPath, missingFromReachable, extraInReachable },
        },
      }),
    });

    // A second observation of AC-1101-1: the shell's <meta
    // name="route-inventory"> is compared against the crawl set,
    // not against the JSON constant. Two independent renderings of
    // the same property agreeing is the derived output.
    const shellRes = await fetch(`${fixture.baseUrl}/`);
    const shellBody = await shellRes.text();
    const metaMatch = shellBody.match(/<meta name="route-inventory" content="([^"]+)"/);
    const shellPaths = metaMatch ? metaMatch[1].split(',') : [];
    const shellVsCrawl = shellPaths.length === reachable.length && shellPaths.every((p) => reachableSet.has(p));

    results.push({
      anchorAcId: 'application-spa-AC-1101-1',
      anchorReqId: 'application-spa-REQ-001',
      verdict: shellVsCrawl ? 'pass' : 'fail',
      detail: shellVsCrawl
        ? `The project maintains a declared route inventory naming - <meta name="route-inventory"> ${shellPaths.join(',')} matches the crawled reachable set`
        : `The project maintains a declared route inventory naming - inventory drift: meta=${shellPaths.join(',')} crawlReachable=${reachable.join(',')}`,
      evidence: evidenceFromResponse({
        route: '/',
        response: shellRes,
        bodyText: shellBody,
        extraFields: {
          input: { metaPaths: shellPaths },
          derived: { crawlReachable: reachable, shellVsCrawl },
        },
      }),
    });

    return { results };
  } finally {
    await fixture.close();
  }
}
