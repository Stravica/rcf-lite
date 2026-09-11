// Sample-app fixture for the application-spa probe pack.
//
// A dependency-free Node HTTP server that renders the smallest
// surface the application-spa probes assert on:
//
//   - A named route inventory the shell publishes (REQ-001), served
//     both as an HTML meta shape and a JSON list at /__routes.
//   - The application shell HTML with a top-level <nav> region
//     (REQ-002) and a designed empty-state fragment (REQ-010).
//   - A layout root that carries the semantic-token wrapper class
//     (REQ-005) and a route body at /dashboard, /settings, and
//     /reports so the inventory-vs-shell reconciliation probe can
//     GET each declared route and confirm it responds.
//
// Exports startServer({ port }) so the probes and anatomy tests
// can drive the fixture on ephemeral or fixed ports without a
// subprocess. Ports 47300-47399 are reserved for the shelf-gate
// probe packs; the default is 3000 to keep manual runs friendly.

import http from 'node:http';
import { URL } from 'node:url';

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
      ? `<section role="region" aria-label="Reports" data-empty-state="reports"><p>No reports yet. Create your first report.</p></section>`
      : `<section role="region" aria-label="${route.name}"><h1>${route.name}</h1><p>Route body for ${route.path}.</p></section>`) +
    `</main></body>`;
}

function renderRoute(routePath) {
  const route = ROUTE_INVENTORY.find((r) => r.path === routePath);
  if (!route) return null;
  return `<!doctype html><html lang="en"><head>${shellHead('spa fixture')}</head>${shellBody(route)}</html>`;
}

function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
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
