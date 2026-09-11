// Fixture http probe server for observability-essentials.
//
// Realises the blueprint's load-bearing shape: a real http listener
// binding on a caller-supplied port, exposing /live (liveness),
// /ready (readiness), and /metrics. Every response carries a real
// request-id header the probe reads back for positive evidence.
// The readiness endpoint reports per-dependency status derived from
// the dependencies map the caller sets. Liveness never depends on
// external state so the orchestrator restart contract holds.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export function createProbeServer({ dependencies = new Map() } = {}) {
  let unhealthyLiveness = false;
  const requestIdHeader = 'x-request-id';
  const server = createServer((req, res) => {
    const rid = req.headers[requestIdHeader] || randomUUID();
    res.setHeader(requestIdHeader, rid);
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url === '/live') {
      const status = unhealthyLiveness ? 503 : 200;
      res.statusCode = status;
      res.end(JSON.stringify({ status: status === 200 ? 'live' : 'unhealthy', ts: new Date().toISOString() }));
      return;
    }
    if (req.method === 'GET' && req.url === '/ready') {
      const deps = [...dependencies.entries()].map(([name, val]) => ({ name, status: val.status, detail: val.detail ?? null }));
      const allUp = deps.every((d) => d.status === 'up');
      const status = allUp ? 200 : 503;
      res.statusCode = status;
      res.end(JSON.stringify({ status: allUp ? 'ready' : 'unready', dependencies: deps, ts: new Date().toISOString() }));
      return;
    }
    if (req.method === 'GET' && req.url === '/metrics') {
      res.statusCode = 200; res.setHeader('content-type', 'text/plain; version=0.0.4');
      res.end(`# HELP probe_up 1 if server is up\n# TYPE probe_up gauge\nprobe_up 1\n`);
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not-found', path: req.url }));
  });

  return {
    server,
    setDependency(name, status, detail) { dependencies.set(name, { status, detail }); },
    setLivenessUnhealthy(flag) { unhealthyLiveness = flag; },
    async listen(port) {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve());
      });
      return { port: server.address().port };
    },
    async close() { await new Promise((r) => server.close(() => r())); },
  };
}
