// Fixture http probe server for observability-essentials.
//
// Realises the blueprint's load-bearing shape: a real http listener
// binding on a caller-supplied port, exposing /live (liveness),
// /ready (readiness), and /metrics. Every response carries a real
// request-id header, echoing an inbound x-request-id when the caller
// supplied one so the probe can vary the input and observe the
// derived output.
//
// Readiness reports per-dependency status derived from declared
// TCP endpoints the caller registers via addTcpDependency. The
// server performs a live TCP dial to each on every /ready request;
// a closed port yields status=down with a machine-computed detail
// string naming that dependency, so a passing /ready is not the
// same value both sides authored - it is the result of the fixture
// actually finding the port open, and 503 is the fixture actually
// finding it closed.
//
// Metrics counters are incremented per handled request. The probe
// reads them, sends N more requests, reads them again and asserts
// the delta equals N (derived output, not a printed constant).

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';

async function tcpProbe(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    let done = false;
    const finish = (status, detail) => { if (done) return; done = true; try { sock.destroy(); } catch {} resolve({ status, detail }); };
    const timer = setTimeout(() => finish('down', `tcp connect to ${host}:${port} timed out after ${timeoutMs}ms`), timeoutMs);
    sock.once('connect', () => { clearTimeout(timer); finish('up', `tcp connect ${host}:${port} ok`); });
    sock.once('error', (err) => { clearTimeout(timer); finish('down', `tcp connect ${host}:${port} refused: ${err.code || err.message}`); });
  });
}

export function createProbeServer() {
  const tcpDeps = new Map(); // name -> { host, port }
  let unhealthyLiveness = false;
  const counters = { liveRequests: 0, readyRequests: 0, metricsRequests: 0 };
  const requestIdHeader = 'x-request-id';
  const server = createServer(async (req, res) => {
    const rid = req.headers[requestIdHeader] || randomUUID();
    res.setHeader(requestIdHeader, rid);
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url === '/live') {
      counters.liveRequests += 1;
      const status = unhealthyLiveness ? 503 : 200;
      res.statusCode = status;
      res.end(JSON.stringify({ status: status === 200 ? 'live' : 'unhealthy', requestIdEchoed: rid, ts: new Date().toISOString() }));
      return;
    }
    if (req.method === 'GET' && req.url === '/ready') {
      counters.readyRequests += 1;
      const deps = [];
      for (const [name, target] of tcpDeps.entries()) {
        const observation = await tcpProbe(target.host, target.port);
        deps.push({ name, host: target.host, port: target.port, status: observation.status, detail: observation.detail });
      }
      const allUp = deps.every((d) => d.status === 'up');
      const down = deps.filter((d) => d.status === 'down').map((d) => d.name);
      const status = allUp ? 200 : 503;
      res.statusCode = status;
      res.end(JSON.stringify({ status: allUp ? 'ready' : 'unready', dependencies: deps, unreadyDependencies: down, requestIdEchoed: rid, ts: new Date().toISOString() }));
      return;
    }
    if (req.method === 'GET' && req.url === '/metrics') {
      counters.metricsRequests += 1;
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain; version=0.0.4');
      const body = [
        '# HELP probe_live_requests_total /live requests handled',
        '# TYPE probe_live_requests_total counter',
        `probe_live_requests_total ${counters.liveRequests}`,
        '# HELP probe_ready_requests_total /ready requests handled',
        '# TYPE probe_ready_requests_total counter',
        `probe_ready_requests_total ${counters.readyRequests}`,
        '# HELP probe_metrics_requests_total /metrics requests handled',
        '# TYPE probe_metrics_requests_total counter',
        `probe_metrics_requests_total ${counters.metricsRequests}`,
        '',
      ].join('\n');
      res.end(body);
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not-found', path: req.url }));
  });

  return {
    server,
    addTcpDependency(name, host, port) { tcpDeps.set(name, { host, port }); },
    removeTcpDependency(name) { tcpDeps.delete(name); },
    setLivenessUnhealthy(flag) { unhealthyLiveness = flag; },
    countersSnapshot() { return { ...counters }; },
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
