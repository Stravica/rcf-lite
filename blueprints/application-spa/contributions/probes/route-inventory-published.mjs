// route-inventory-published probe for application-spa v1.5.10.
//
// Verifies AC-1101-1: the shell publishes a declared route inventory
// AND no navigable surface exists outside it. Two independent
// sources of truth are compared:
//   - /__routes returns the published inventory.
//   - /__mounted returns the fixture's independent MOUNTED_PATHS
//     list (what is actually served).
// The parity of the two, plus a per-path crawl, gives positive
// evidence that no navigable surface exists outside the inventory
// (Addendum rule 2).
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

    // Observation A: published inventory.
    const routesRes = await fetch(`${fixture.baseUrl}/__routes`);
    const routesBody = await routesRes.text();
    const routesJson = JSON.parse(routesBody);
    const declaredPaths = (routesJson.routes || []).map((r) => r.path);

    // Observation B: actually mounted paths from an independent
    // source (fixture's MOUNTED_PATHS).
    const mountedRes = await fetch(`${fixture.baseUrl}/__mounted`);
    const mountedBody = await mountedRes.text();
    const mountedJson = JSON.parse(mountedBody);
    const mountedPaths = mountedJson.paths || [];

    // Observation C: crawl every declared path.
    const declaredSet = new Set(declaredPaths);
    const mountedSet = new Set(mountedPaths);
    const undeclared = mountedPaths.filter((p) => !declaredSet.has(p));
    const uncrawled = declaredPaths.filter((p) => !mountedSet.has(p));
    const perPath = {};
    for (const p of declaredPaths) {
      const r = await fetch(`${fixture.baseUrl}${p}`);
      const body = await r.text();
      const ok = r.status === 200 && /<main[^>]+data-route=/.test(body);
      perPath[p] = { status: r.status, ok };
    }

    const parity = undeclared.length === 0 && uncrawled.length === 0;
    const inventoryOk = routesRes.status === 200
      && declaredPaths.length >= 3
      && routesJson.routes.every((r) => typeof r.path === 'string' && typeof r.name === 'string' && typeof r.state === 'string');
    const pass = inventoryOk && parity;

    results.push({
      anchorAcId: 'application-spa-AC-1101-1',
      anchorReqId: 'application-spa-REQ-001',
      verdict: pass ? 'pass' : 'fail',
      detail: `The project maintains a declared route inventory naming - inventory[${declaredPaths.length}] vs mounted[${mountedPaths.length}]: undeclared=[${undeclared.join(',')}] uncrawled=[${uncrawled.join(',')}]`,
      evidence: evidenceFromResponse({
        route: '/__routes',
        response: routesRes,
        bodyText: routesBody,
        extraFields: {
          input: { declaredPaths, mountedPaths },
          derived: { undeclared, uncrawled, parity, perPath },
          altBodyExcerpt: mountedBody.slice(0, 240),
        },
      }),
    });

    // Second row: the shell's <meta name="route-inventory">
    // matches the /__routes JSON and the crawled mounted set. A
    // three-way agreement is the strongest derived output.
    const shellRes = await fetch(`${fixture.baseUrl}/`);
    const shellBody = await shellRes.text();
    const metaMatch = shellBody.match(/<meta name="route-inventory" content="([^"]+)"/);
    const shellPaths = metaMatch ? metaMatch[1].split(',') : [];
    const shellAgreesJson = shellPaths.length === declaredPaths.length && shellPaths.every((p) => declaredSet.has(p));
    const shellAgreesMounted = shellPaths.every((p) => mountedSet.has(p)) && mountedPaths.every((p) => shellPaths.includes(p));
    const agreeAll = shellAgreesJson && shellAgreesMounted;

    results.push({
      anchorAcId: 'application-spa-AC-1101-1',
      anchorReqId: 'application-spa-REQ-001',
      verdict: agreeAll ? 'pass' : 'fail',
      detail: `The project maintains a declared route inventory naming - <meta name="route-inventory"> ${shellPaths.join(',')} agrees with /__routes JSON: ${shellAgreesJson} and /__mounted: ${shellAgreesMounted}`,
      evidence: evidenceFromResponse({
        route: '/',
        response: shellRes,
        bodyText: shellBody,
        extraFields: {
          input: { shellMetaPaths: shellPaths },
          derived: { shellAgreesJson, shellAgreesMounted, agreeAll },
        },
      }),
    });

    return { results };
  } finally {
    await fixture.close();
  }
}
