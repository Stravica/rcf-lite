// Sample-app fixture for the application-spa probe pack.
//
// A dependency-free Node HTTP server that renders the smallest
// surface the application-spa probes assert on:
//
//   - A published route inventory (AC-1101-1), served both as an
//     HTML meta shape at / and as JSON at /__routes.
//   - /__mounted returns the actually mounted paths from the
//     dispatch table the request handler resolves against. Both
//     /__routes and /__mounted follow the route set the caller
//     of startServer({ routes }) injects, so the probe can pass
//     two independent inputs and assert both endpoints follow
//     each one.
//   - Per-route render supporting ?state=loading|empty|error|success
//     so a probe can drive the full state matrix on any data-bearing
//     route (AC-1117-1).
//   - The application shell HTML with a top-level primary <nav>
//     region carrying a data-region marker (AC-1102-1).
//
// Every response carries an x-fixture-request-id header stamped by
// the fixture request pipeline before the handler writes.

import http from 'node:http';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';

export const DEFAULT_ROUTE_INVENTORY = [
  { path: '/', name: 'landing', state: 'populated', dataBearing: false },
  { path: '/dashboard', name: 'dashboard', state: 'populated', dataBearing: true },
  { path: '/settings', name: 'settings', state: 'populated', dataBearing: false },
  { path: '/reports', name: 'reports', state: 'empty', dataBearing: true },
];

function normaliseRoute(raw) {
  const path = String(raw.path);
  const name = String(raw.name || path.replace(/^\//, '') || 'landing');
  const state = String(raw.state || 'populated');
  const dataBearing = raw.dataBearing === true;
  return { path, name, state, dataBearing };
}

function buildDispatchTable(routeSet) {
  return new Map(routeSet.map((r) => [r.path, r]));
}

function shellHead(title, routeSet) {
  return `<meta charset="utf-8"><title>${title}</title>` +
    `<meta name="route-inventory" content="${routeSet.map((r) => r.path).join(',')}">` +
    `<meta name="theme-tokens" content="surface,on-surface,primary,on-primary,danger">`;
}

function renderStateSection(routeName, state) {
  if (state === 'loading') {
    return `<section role="region" aria-label="${routeName}" aria-busy="true" data-state="loading"><p>Loading ${routeName}...</p></section>`;
  }
  if (state === 'empty') {
    return `<section role="region" aria-label="${routeName}" data-empty-state="${routeName}"><p>No ${routeName} yet. Create your first ${routeName}.</p><button type="button" data-empty-cta="${routeName}">Create first ${routeName}</button></section>`;
  }
  if (state === 'error') {
    return `<section role="region" aria-label="${routeName}" data-state="error" role="alert"><p>Could not load ${routeName}. Retry?</p><button type="button" data-error-cta="${routeName}">Retry</button></section>`;
  }
  return `<section role="region" aria-label="${routeName}" data-state="success"><h1>${routeName}</h1><p>Route body for ${routeName}.</p></section>`;
}

function shellBody(route, requestedState, routeSet) {
  const state = requestedState || route.state;
  return `<body class="tokenSurface" data-token-scope="app">` +
    `<nav aria-label="Primary" data-region="primary-nav"><ul>` +
    routeSet.map((r) => `<li><a href="${r.path}" data-route-name="${r.name}">${r.name}</a></li>`).join('') +
    `</ul></nav>` +
    `<main role="main" data-route="${route.name}" data-route-state="${state}">` +
    renderStateSection(route.name, state) +
    `</main></body>`;
}

function renderRoute(dispatchTable, routeSet, routePath, requestedState) {
  const route = dispatchTable.get(routePath);
  if (!route) return null;
  return `<!doctype html><html lang="en"><head>${shellHead('spa fixture', routeSet)}</head>${shellBody(route, requestedState, routeSet)}</html>`;
}

function stampRequestId(req, res) {
  const inbound = req.headers['x-request-id'];
  const id = typeof inbound === 'string' && inbound.length > 0 ? inbound : randomUUID();
  res.setHeader('x-fixture-request-id', id);
  res.setHeader('x-request-id', id);
  return id;
}

function makeHandler(routeSet) {
  const dispatchTable = buildDispatchTable(routeSet);
  return function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    stampRequestId(req, res);
    if (url.pathname === '/__routes') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ routes: routeSet }));
      return;
    }
    if (url.pathname === '/__mounted') {
      // Serves the dispatch table's live keys. The dispatch table
      // is constructed from the injected route set at startup, so
      // /__mounted follows the probe-controlled input the same as
      // /__routes but is read from the running dispatch structure.
      const paths = [...dispatchTable.keys()];
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ paths }));
      return;
    }
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('ok');
      return;
    }
    const requestedState = url.searchParams.get('state');
    const html = renderRoute(dispatchTable, routeSet, url.pathname, requestedState);
    if (html === null) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>not found</title>not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  };
}

export function startServer({ port, routes } = {}) {
  const desiredPort = typeof port === 'number' ? port : Number(process.env.PORT ?? 3000);
  const routeSet = Array.isArray(routes) && routes.length > 0
    ? routes.map(normaliseRoute)
    : DEFAULT_ROUTE_INVENTORY.slice();
  const handler = makeHandler(routeSet);
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(desiredPort, '127.0.0.1', () => {
      const addr = server.address();
      const bound = typeof addr === 'object' && addr ? addr.port : desiredPort;
      resolve({ server, port: bound, routes: routeSet });
    });
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  startServer({}).then(({ port }) => {
    process.stdout.write(`LISTENING ${port}\n`);
  }).catch((err) => {
    process.stderr.write(`fixture failed to start: ${err.message}\n`);
    process.exit(1);
  });
}
