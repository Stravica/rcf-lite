// route-inventory-published probe for application-spa v1.5.6.
//
// Verifies that the running shell publishes a route inventory to the
// reader (REQ-001). The probe starts the sample-app fixture, GETs
// /__routes, asserts the JSON body carries a non-empty routes[] with
// path/name/state per entry, and records the fixture-echoed
// x-fixture-request-id header plus a body excerpt as positive
// evidence. It then GETs the shell HTML at / and asserts the same
// inventory reappears in the <meta name="route-inventory"> attribute
// so both surfaces agree.
//
// anchorReqId: application-spa-REQ-001.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-spa-REQ-001';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-spa/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];

    const routesRes = await fetch(`${fixture.baseUrl}/__routes`);
    const routesBody = await routesRes.text();
    const routesJson = JSON.parse(routesBody);
    const shape = Array.isArray(routesJson.routes)
      && routesJson.routes.length >= 3
      && routesJson.routes.every((r) => typeof r.path === 'string' && typeof r.name === 'string' && typeof r.state === 'string');
    results.push({
      anchorReqId: 'application-spa-REQ-001',
      verdict: routesRes.status === 200 && shape ? 'pass' : 'fail',
      detail: routesRes.status === 200 && shape
        ? `GET /__routes returned ${routesJson.routes.length} routes with path/name/state`
        : `route inventory malformed: status=${routesRes.status} body=${routesBody.slice(0, 120)}`,
      evidence: evidenceFromResponse({ route: '/__routes', response: routesRes, bodyText: routesBody, extraFields: { routeCount: routesJson.routes ? routesJson.routes.length : 0 } }),
    });

    const shellRes = await fetch(`${fixture.baseUrl}/`);
    const shellBody = await shellRes.text();
    const metaMatch = shellBody.match(/<meta name="route-inventory" content="([^"]+)"/);
    const shellPaths = metaMatch ? metaMatch[1].split(',') : [];
    const jsonPaths = routesJson.routes.map((r) => r.path);
    const agree = shellPaths.length === jsonPaths.length && shellPaths.every((p, i) => p === jsonPaths[i]);
    results.push({
      anchorReqId: 'application-spa-REQ-001',
      verdict: agree ? 'pass' : 'fail',
      detail: agree
        ? `<meta name="route-inventory"> matches /__routes: ${shellPaths.join(',')}`
        : `inventory drift: meta=${shellPaths.join(',')} json=${jsonPaths.join(',')}`,
      evidence: evidenceFromResponse({ route: '/', response: shellRes, bodyText: shellBody, extraFields: { metaPaths: shellPaths } }),
    });

    return { results };
  } finally {
    await fixture.close();
  }
}
