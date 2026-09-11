// Sample-app fixture for the application-spa probe pack.
//
// A dependency-free Node HTTP server that renders the smallest
// surface the application-spa probes assert on:
//
//   - A published route inventory (AC-1101-1), served both as an
//     HTML meta shape at / and as JSON at /__routes.
//   - A second source of truth at /__mounted returning the actually
//     mounted paths from a separate MOUNTED_PATHS constant, so the
//     inventory-vs-mounted comparison can detect an undeclared
//     surface (Addendum 3 rule 11 companion, positive evidence not
//     browser-observable).
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

export const ROUTE_INVENTORY = [
  { path: '/', name: 'landing', state: 'populated', dataBearing: false },
  { path: '/dashboard', name: 'dashboard', state: 'populated', dataBearing: true },
  { path: '/settings', name: 'settings', state: 'populated', dataBearing: false },
  { path: '/reports', name: 'reports', state: 'empty', dataBearing: true },
];

// Independent source of truth: the actually mounted paths. If a new
// content route is added here without also being added to
// ROUTE_INVENTORY, the route-inventory-published probe detects the
// undeclared surface (AC-1101-1).
export const MOUNTED_PATHS = ['/', '/dashboard', '/settings', '/reports'];

function shellHead(title) {
  return `<meta charset="utf-8"><title>${title}</title>` +
    `<meta name="route-inventory" content="${ROUTE_INVENTORY.map((r) => r.path).join(',')}">` +
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

function shellBody(route, requestedState) {
  const state = requestedState || route.state;
  return `<body class="tokenSurface" data-token-scope="app">` +
    `<nav aria-label="Primary" data-region="primary-nav"><ul>` +
    ROUTE_INVENTORY.map((r) => `<li><a href="${r.path}" data-route-name="${r.name}">${r.name}</a></li>`).join('') +
    `</ul></nav>` +
    `<main role="main" data-route="${route.name}" data-route-state="${state}">` +
    renderStateSection(route.name, state) +
    `</main></body>`;
}

function renderRoute(routePath, requestedState) {
  const route = ROUTE_INVENTORY.find((r) => r.path === routePath);
  if (!route) return null;
  return `<!doctype html><html lang="en"><head>${shellHead('spa fixture')}</head>${shellBody(route, requestedState)}</html>`;
}

function stampRequestId(req, res) {
  const inbound = req.headers['x-request-id'];
  const id = typeof inbound === 'string' && inbound.length > 0 ? inbound : randomUUID();
  res.setHeader('x-fixture-request-id', id);
  res.setHeader('x-request-id', id);
  return id;
}

function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  stampRequestId(req, res);
  if (url.pathname === '/__routes') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ routes: ROUTE_INVENTORY }));
    return;
  }
  if (url.pathname === '/__mounted') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ paths: MOUNTED_PATHS }));
    return;
  }
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }
  const requestedState = url.searchParams.get('state');
  const html = renderRoute(url.pathname, requestedState);
  if (html === null) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>not found</title>not found');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

export function startServer({ port } = {}) {
  const desiredPort = typeof port === 'number' ? port : Number(process.env.PORT ?? 3000);
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(desiredPort, '127.0.0.1', () => {
      const addr = server.address();
      const bound = typeof addr === 'object' && addr ? addr.port : desiredPort;
      resolve({ server, port: bound });
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
