// Fixture JWKS server for the cf-edge fixture.
//
// A dependency-free Node HTTP server that publishes one JWKS
// document at /.well-known/jwks.json, matching the shape Cloudflare
// Access publishes at https://<team>.cloudflareaccess.com/cdn-cgi/access/certs.
// The Worker's JWT validator fetches this URL (elicited env var
// ACCESS_JWKS_URL) and caches the keys per-kid.

import { createServer } from 'node:http';
import { jwksExport } from './jwt-signer.mjs';

export function startJwksServer({ port = 0, keys, host = '127.0.0.1' } = {}) {
  return new Promise((resolve) => {
    const jwks = jwksExport(...keys);
    const server = createServer((req, res) => {
      if (req.url === '/.well-known/jwks.json') {
        const body = JSON.stringify(jwks);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'public, max-age=60' });
        res.end(body);
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        server,
        url: `http://${host}:${addr.port}/.well-known/jwks.json`,
        stop: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
