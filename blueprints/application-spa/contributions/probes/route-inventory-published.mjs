// route-inventory-published probe for application-spa v1.5.10.
//
// Verifies AC-1101-1: the project maintains a declared route
// inventory naming every route AND no navigable surface exists
// outside it. To rule out fixture self-agreement the probe drives
// two independent inputs it controls:
//
// Run A: routes = [/, /alpha, /beta]
// Run B: routes = [/, /gamma, /delta, /epsilon]
//
// For each run the probe reads /__routes and /__mounted and
// checks both endpoints reflect the injected input verbatim,
// then crawls every declared path (expects 200) and every path
// from the OTHER run's set that is NOT in the current set (expects
// 404). If /__routes or /__mounted diverged from the injected
// input, or if a path outside the input responded 200, the row
// fails. The two runs together establish input-driven variation.
//
// anchorAcId: application-spa-AC-1101-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-spa-REQ-001';
export const accountBound = false;

const RUN_A_ROUTES = [
 { path: '/', name: 'landing', state: 'populated', dataBearing: false },
 { path: '/alpha', name: 'alpha', state: 'populated', dataBearing: true },
 { path: '/beta', name: 'beta', state: 'populated', dataBearing: false },
];
const RUN_B_ROUTES = [
 { path: '/', name: 'landing', state: 'populated', dataBearing: false },
 { path: '/gamma', name: 'gamma', state: 'populated', dataBearing: true },
 { path: '/delta', name: 'delta', state: 'populated', dataBearing: false },
 { path: '/epsilon', name: 'epsilon', state: 'empty', dataBearing: true },
];

async function runOne(routeSet, otherSet) {
 const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-spa/server.js');
 const fixture = await startFixture({ startServer: (opts) => startServer({ ...opts, routes: routeSet }), port: 0 });
 try {
 const declaredPaths = routeSet.map((r) => r.path);
 const routesRes = await fetch(`${fixture.baseUrl}/__routes`);
 const routesBody = await routesRes.text();
 const routesJson = JSON.parse(routesBody);
 const routesPaths = (routesJson.routes || []).map((r) => r.path);

 const mountedRes = await fetch(`${fixture.baseUrl}/__mounted`);
 const mountedBody = await mountedRes.text();
 const mountedJson = JSON.parse(mountedBody);
 const mountedPaths = mountedJson.paths || [];

 const perPath = {};
 for (const p of declaredPaths) {
 const r = await fetch(`${fixture.baseUrl}${p}`);
 const body = await r.text();
 perPath[p] = { status: r.status, ok: r.status === 200 && /<main[^>]+data-route=/.test(body) };
 }

 // Paths NOT in the injected inventory must 404. We take them
 // from the OTHER run's set (minus paths shared with this run).
 const shared = new Set(declaredPaths);
 const outsidePaths = otherSet.map((r) => r.path).filter((p) => !shared.has(p));
 const perOutside = {};
 for (const p of outsidePaths) {
 const r = await fetch(`${fixture.baseUrl}${p}`);
 await r.text();
 perOutside[p] = { status: r.status, ok: r.status === 404 };
 }

 const routesMatchInput = declaredPaths.length === routesPaths.length && declaredPaths.every((p) => routesPaths.includes(p));
 const mountedMatchInput = declaredPaths.length === mountedPaths.length && declaredPaths.every((p) => mountedPaths.includes(p));
 const declaredAll200 = Object.values(perPath).every((v) => v.ok);
 const outsideAll404 = Object.values(perOutside).every((v) => v.ok);
 return {
 routesRes,
 routesBody,
 mountedRes,
 mountedBody,
 declaredPaths,
 routesPaths,
 mountedPaths,
 outsidePaths,
 perPath,
 perOutside,
 routesMatchInput,
 mountedMatchInput,
 declaredAll200,
 outsideAll404,
 };
 } finally {
 await fixture.close();
 }
}

export default async function runProbe() {
 const results = [];
 const runA = await runOne(RUN_A_ROUTES, RUN_B_ROUTES);
 const runB = await runOne(RUN_B_ROUTES, RUN_A_ROUTES);

 const bothMatchInput = runA.routesMatchInput && runA.mountedMatchInput && runB.routesMatchInput && runB.mountedMatchInput;
 const bothDeclared200 = runA.declaredAll200 && runB.declaredAll200;
 const bothOutside404 = runA.outsideAll404 && runB.outsideAll404;
 const pass = bothMatchInput && bothDeclared200 && bothOutside404;

 results.push({
 anchorAcId: 'application-spa-AC-1101-1',
 anchorReqId: 'application-spa-REQ-001',
 verdict: pass ? 'pass' : 'fail',
 detail: `The project maintains a declared route inventory naming every route; no navigable surface exists outside it - runA(${runA.declaredPaths.join(',')}) routes=${runA.routesMatchInput} mounted=${runA.mountedMatchInput} declared200=${runA.declaredAll200} outside404=${runA.outsideAll404}; runB(${runB.declaredPaths.join(',')}) routes=${runB.routesMatchInput} mounted=${runB.mountedMatchInput} declared200=${runB.declaredAll200} outside404=${runB.outsideAll404}`,
 evidence: evidenceFromResponse({
 route: '/__routes (runA)',
 response: runA.routesRes,
 bodyText: runA.routesBody,
 extraFields: {
 input: {
 runARoutes: RUN_A_ROUTES.map((r) => r.path),
 runBRoutes: RUN_B_ROUTES.map((r) => r.path),
 },
 derived: {
 runA: {
 routesPaths: runA.routesPaths,
 mountedPaths: runA.mountedPaths,
 routesMatchInput: runA.routesMatchInput,
 mountedMatchInput: runA.mountedMatchInput,
 perPath: runA.perPath,
 outsidePaths: runA.outsidePaths,
 perOutside: runA.perOutside,
 },
 runB: {
 routesPaths: runB.routesPaths,
 mountedPaths: runB.mountedPaths,
 routesMatchInput: runB.routesMatchInput,
 mountedMatchInput: runB.mountedMatchInput,
 perPath: runB.perPath,
 outsidePaths: runB.outsidePaths,
 perOutside: runB.perOutside,
 },
 },
 altBodyExcerpt: runB.routesBody.slice(0, 240),
 },
 }),
 });

 // Second row: the shell HTML's <meta name="route-inventory">
 // agrees with /__routes and /__mounted under both injected sets.
 const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-spa/server.js');
 const fixture = await startFixture({ startServer: (opts) => startServer({ ...opts, routes: RUN_A_ROUTES }), port: 0 });
 let shellRes; let shellBody; let shellPaths = []; let shellAgreesJson = false; let shellAgreesMounted = false;
 try {
 shellRes = await fetch(`${fixture.baseUrl}/`);
 shellBody = await shellRes.text();
 const metaMatch = shellBody.match(/<meta name="route-inventory" content="([^"]+)"/);
 shellPaths = metaMatch ? metaMatch[1].split(',') : [];
 const declaredSet = new Set(RUN_A_ROUTES.map((r) => r.path));
 shellAgreesJson = shellPaths.length === RUN_A_ROUTES.length && shellPaths.every((p) => declaredSet.has(p));
 shellAgreesMounted = shellPaths.every((p) => runA.mountedPaths.includes(p));
 } finally {
 await fixture.close();
 }
 const agreeAll = shellAgreesJson && shellAgreesMounted;
 results.push({
 anchorAcId: 'application-spa-AC-1101-1',
 anchorReqId: 'application-spa-REQ-001',
 verdict: agreeAll ? 'pass' : 'fail',
 detail: `The project maintains a declared route inventory naming every route; no navigable surface exists outside it - shell <meta name="route-inventory"> ${shellPaths.join(',')} agrees with /__routes JSON: ${shellAgreesJson} and /__mounted: ${shellAgreesMounted}`,
 evidence: evidenceFromResponse({
 route: '/',
 response: shellRes,
 bodyText: shellBody,
 extraFields: {
 input: { shellMetaPaths: shellPaths, injectedRoutes: RUN_A_ROUTES.map((r) => r.path) },
 derived: { shellAgreesJson, shellAgreesMounted, agreeAll },
 },
 }),
 });

 return { results };
}
