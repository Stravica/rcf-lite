// Sample-app fixture for the application-spa probe pack.
//
// A dependency-free Node HTTP server that renders the smallest
// surface the application-spa probes assert on:
//
//   - A published route inventory (AC-1101-1), served both as an
//     HTML meta shape at / and as JSON at /__routes.
//   - The application shell HTML with a top-level primary <nav>
//     region carrying a data-region marker (AC-1102-1) and
//     data-route-name attributes on each nav link.
//   - The empty-state variant at /reports carrying a designed
//     data-empty-state region (AC-1117-1).
//   - A per-route render for every declared inventory path so a
//     reachable-route crawl compared against the inventory has a
//     real DOM to observe (Addendum rule 2).
//
// Every response carries an x-fixture-request-id header stamped by
// the fixture request pipeline before the handler writes. That id
// is the fixture's own; probes read it as positive evidence per
// rule 7d.
//
// Exports startServer({ port }) so probes and anatomy tests drive
// the fixture on ephemeral or fixed ports without a subprocess.
// Ports 47300-47399 are reserved for shelf-gate probe packs; the
// default is 3000 for manual runs.

import http from 'node:http';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';

export const ROUTE_INVENTORY = [
  { path: '/', name: 'landing', state: 'populated' },
  { path: '/dashboard', name: 'dashboard', state: 'populated' },
  { path: '/settings', name: 'settings', state: 'populated' },
  { path: '/reports', name: 'reports', state: 'empty' },
];

function shellHead(title) {
  return `<meta charset="utf-8"><title>${title}</title>` +
    `<meta name="route-inventory" content="${ROUTE_INVENTORY.map((r) => r.path).join(',')}">` +
    `<meta name="theme-tokens" content="surface,on-surface,primary,on-primary,danger">`;
}

function shellBody(route) {
  return `<body class="tokenSurface" data-token-scope="app">` +
    `<nav aria-label="Primary" data-region="primary-nav"><ul>` +
    ROUTE_INVENTORY.map((r) => `<li><a href="${r.path}" data-route-name="${r.name}">${r.name}</a></li>`).join('') +
    `</ul></nav>` +
    `<main role="main" data-route="${route.name}" data-route-state="${route.state}">` +
    (route.state === 'empty'
      ? `<section role="region" aria-label="Reports" data-empty-state="reports"><p>No reports yet. Create your first report.</p><button type="button" data-empty-cta="reports">Create first report</button></section>`
      : `<section role="region" aria-label="${route.name}"><h1>${route.name}</h1><p>Route body for ${route.path}.</p></section>`) +
    `</main></body>`;
}

function renderRoute(routePath) {
  const route = ROUTE_INVENTORY.find((r) => r.path === routePath);
  if (!route) return null;
  return `<!doctype html><html lang="en"><head>${shellHead('spa fixture')}</head>${shellBody(route)}</html>`;
}

function stampRequestId(req, res) {
  const inbound = req.headers['x-request-id'];
  const id = typeof inbound === 'string' && inbound.length > 0 ? inbound : randomUUID();
  res.setHeader('x-fixture-request-id', id);
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
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }
  const html = renderRoute(url.pathname);
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
