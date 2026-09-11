// Fixture http probe server for observability-essentials.
//
// Realises the blueprint's load-bearing shape: a real http listener
// binding on a caller-supplied port, exposing /live (liveness),
// /ready (readiness), /metrics and /status. Response bodies conform
// to the AC text exactly (status: 'pass' | 'fail' per AC-7101-1/5
// and AC-7102-1; 503 for liveness fail carries content-length 0 and
// an empty body per AC-7101-5).
//
// Readiness reports per-dependency state as an object keyed by
// dependency name with { state, checkedAt } per AC-7103-1/2. The
// server performs a live TCP dial to each declared dependency on
// every /ready request; a closed port yields state=fail with a
// machine-computed detail string naming that dependency, so a
// passing /ready is not the same value both sides authored - it is
// the result of the fixture actually finding the port open, and 503
// is the fixture actually finding it closed.
//
// The /status endpoint renders declared components in declaration
// order as text/html with a data-state attribute per component,
// per AC-7104-1/2/3.
//
// Teardown callbacks propagate errors: srv.close() will reject if
// any registered teardown throws so the probe fails the verdict per
// Addendum rule 5.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';

async function tcpProbe(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    let done = false;
    const finish = (state, detail) => { if (done) return; done = true; try { sock.destroy(); } catch {} resolve({ state, detail }); };
    const timer = setTimeout(() => finish('fail', `tcp connect to ${host}:${port} timed out after ${timeoutMs}ms`), timeoutMs);
    sock.once('connect', () => { clearTimeout(timer); finish('pass', `tcp connect ${host}:${port} ok`); });
    sock.once('error', (err) => { clearTimeout(timer); finish('fail', `tcp connect ${host}:${port} refused: ${err.code || err.message}`); });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function createProbeServer() {
  const tcpDeps = new Map(); // name -> { host, port }
  const teardowns = []; // functions that must run at close; errors are re-raised
  let unhealthyLiveness = false;
  let components = []; // ordered [{ name, state }]
  const counters = { liveRequests: 0, readyRequests: 0, metricsRequests: 0, statusRequests: 0 };
  const requestIdHeader = 'x-request-id';
  const server = createServer(async (req, res) => {
    const rid = req.headers[requestIdHeader] || randomUUID();
    res.setHeader(requestIdHeader, rid);
    if (req.method === 'GET' && req.url === '/live') {
      counters.liveRequests += 1;
      if (unhealthyLiveness) {
        // AC-7101-5: 503 with content-length 0 and empty body.
        res.statusCode = 503;
        res.setHeader('content-length', '0');
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      // AC-7101-1: 200 with JSON body status=pass.
      res.end(JSON.stringify({ status: 'pass', requestIdEchoed: rid, ts: new Date().toISOString() }));
      return;
    }
    if (req.method === 'GET' && req.url === '/ready') {
      counters.readyRequests += 1;
      const checks = {};
      const depEntries = [];
      for (const [name, target] of tcpDeps.entries()) {
        const observation = await tcpProbe(target.host, target.port);
        const checkedAt = new Date().toISOString();
        checks[name] = { state: observation.state, checkedAt, detail: observation.detail, host: target.host, port: target.port };
        depEntries.push({ name, state: observation.state });
      }
      const allPass = depEntries.every((d) => d.state === 'pass');
      const failed = depEntries.filter((d) => d.state === 'fail').map((d) => d.name);
      const status = allPass ? 200 : 503;
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      // AC-7102-1: body.status equals 'pass' when up, 'fail' when down.
      // AC-7103-1: checks object keyed by declared dep name, no extras.
      res.end(JSON.stringify({ status: allPass ? 'pass' : 'fail', checks, unreadyDependencies: failed, requestIdEchoed: rid, ts: new Date().toISOString() }));
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
    if (req.method === 'GET' && req.url === '/status') {
      counters.statusRequests += 1;
      // AC-7104-1: 200 text/html, exactly N component elements each
      // carrying its declared name.
      // AC-7104-2: state attribute drawn from {operational, degraded, outage, maintenance}.
      // AC-7104-3: render order equals declaration order.
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      const items = components.map((c) => `<li class="component" data-name="${escapeHtml(c.name)}" data-state="${escapeHtml(c.state)}">${escapeHtml(c.name)}</li>`).join('');
      res.end(`<!doctype html><html><body><ul id="components">${items}</ul></body></html>`);
      return;
    }
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'not-found', path: req.url }));
  });

  return {
    server,
    addTcpDependency(name, host, port) { tcpDeps.set(name, { host, port }); },
    removeTcpDependency(name) { tcpDeps.delete(name); },
    setLivenessUnhealthy(flag) { unhealthyLiveness = flag; },
    setComponents(list) { components = Array.isArray(list) ? [...list] : []; },
    countersSnapshot() { return { ...counters }; },
    registerTeardown(fn) { if (typeof fn === 'function') teardowns.push(fn); },
    async listen(port) {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve());
      });
      return { port: server.address().port };
    },
    async close() {
      // Close the http server; if it fails, propagate.
      await new Promise((resolve, reject) => {
        server.close((err) => { if (err) reject(err); else resolve(); });
      });
      // Run every registered teardown; if any throws, propagate the
      // FIRST error after running the rest. Per Addendum rule 5, no
      // teardown error is swallowed.
      let firstError = null;
      for (const fn of teardowns) {
        try { await fn(); } catch (e) { if (!firstError) firstError = e; }
      }
      if (firstError) throw firstError;
    },
  };
}
