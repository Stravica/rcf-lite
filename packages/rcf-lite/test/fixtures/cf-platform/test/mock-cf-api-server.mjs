// mock-cf-api-server.mjs
//
// Test-only in-memory mock of the Cloudflare REST API surface the H-2
// self-provisioning fixtures hit. Boots on a random localhost port,
// returns Cloudflare-shaped envelopes ({ success, result, ... }), and
// stores every resource in a Map so the tests can assert BEFORE and
// AFTER inventories to prove the mint / teardown / sweep loops leave
// zero orphans (dispatch requirement 3).
//
// The mock also serves the throwaway consumer Worker origin the queue
// fixture provisions: `/publish-batch`, `/reset` and `/stats` are
// implemented so the driver end-to-end path is exercisable without
// wrangler and without a real account. When /publish-batch fires, the
// mock enqueues messages against the matching queue and drains them
// through a simulated push consumer that fires up to `maxConcurrency`
// invocations at once (default 8; caller-configurable). The consumer
// telemetry mirrors the fixture Worker's shape so the probe's
// assertions run unchanged.
//
// Zero-dep (node:http only). Bound to 127.0.0.1 with port 0 so a test
// picks up whatever the OS hands out.

import { createServer } from 'node:http';

export function createMockCfApi({ maxConcurrency = 8, consumerDelayMs = 4 } = {}) {
  const state = {
    kvNamespaces: new Map(),       // id -> { id, title }
    kvValues: new Map(),           // `${nsId}::${key}` -> string
    queues: new Map(),             // id -> { id, name }
    queueMessages: new Map(),      // qid -> Array<message>
    workers: new Map(),            // name -> { name, script, bindings, uploadedAt }
    workerConsumers: new Map(),    // qid -> scriptName
    workerTelemetry: new Map(),    // scriptName -> { published, batches, totalConsumed, inFlight, maxConcurrent }
    workersSubdomain: 'h2-cf-mock',
    logs: [],
  };

  const requireAuth = (req, res) => {
    const auth = req.headers['authorization'] || '';
    if (!auth.startsWith('Bearer ')) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }));
      return false;
    }
    return true;
  };

  const send = (res, status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  const success = (res, result, status = 200) => send(res, status, { success: true, errors: [], messages: [], result });

  const notFound = (res, msg = 'not found') => send(res, 404, { success: false, errors: [{ code: 10007, message: msg }] });

  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  // Simulate the push consumer for a queue: fire drain in the
  // background so telemetry populates while the driver polls /stats.
  const startDrainer = (qid) => {
    const scriptName = state.workerConsumers.get(qid);
    if (!scriptName) return;
    const tel = state.workerTelemetry.get(scriptName);
    if (!tel) return;
    const q = state.queueMessages.get(qid);
    if (!q || q.length === 0) return;

    // Batch messages (batch_size 10 to mirror the fixture default).
    const batches = [];
    while (q.length > 0) batches.push(q.splice(0, 10));
    let idx = 0;
    const workers = Math.min(maxConcurrency, batches.length);
    // Fire `workers` batches at once; each finishes after
    // consumerDelayMs then picks the next batch. Track inFlight /
    // maxConcurrent honestly.
    const runOne = async () => {
      while (idx < batches.length) {
        const my = batches[idx++];
        tel.batches += 1;
        tel.inFlight += 1;
        if (tel.inFlight > tel.maxConcurrent) tel.maxConcurrent = tel.inFlight;
        await new Promise((r) => setTimeout(r, consumerDelayMs));
        tel.totalConsumed += my.length;
        tel.inFlight -= 1;
      }
    };
    for (let i = 0; i < workers; i++) runOne();
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;

      // ------- Worker origin surface (/reset, /publish-batch, /stats) -------
      // Any request that does not start with /accounts/... is treated
      // as a "workers.dev" call and routed by scriptName from the Host
      // header sub-part. The fixture URL shape is
      // http://127.0.0.1:PORT/w/<scriptName>/<path> in test mode.
      if (path.startsWith('/w/')) {
        const parts = path.split('/');
        const scriptName = parts[2];
        const inner = '/' + parts.slice(3).join('/');
        if (!state.workers.has(scriptName)) return notFound(res, `worker ${scriptName} not found`);
        const tel = state.workerTelemetry.get(scriptName) || { published: 0, batches: 0, totalConsumed: 0, inFlight: 0, maxConcurrent: 0 };
        state.workerTelemetry.set(scriptName, tel);

        // Find the queue bound to this script via workerConsumers.
        const qid = [...state.workerConsumers.entries()].find(([, s]) => s === scriptName)?.[0] || null;

        if (req.method === 'POST' && inner === '/reset') {
          tel.published = 0; tel.batches = 0; tel.totalConsumed = 0; tel.inFlight = 0; tel.maxConcurrent = 0;
          return send(res, 200, { ok: true });
        }
        if (req.method === 'GET' && inner === '/stats') {
          return send(res, 200, tel);
        }
        if (req.method === 'POST' && inner === '/publish-batch') {
          const body = JSON.parse((await readBody(req)).toString() || '{}');
          const messages = Array.isArray(body) ? body : (Array.isArray(body.messages) ? body.messages : []);
          if (!qid) return send(res, 400, { ok: false, error: `worker ${scriptName} has no queue consumer binding` });
          const q = state.queueMessages.get(qid) || [];
          for (const m of messages) q.push({ body: m.body ?? m, ts: Date.now() });
          state.queueMessages.set(qid, q);
          tel.published += messages.length;
          const ids = messages.map((_, i) => `${scriptName}-${Date.now()}-${i}`);
          // Kick the drainer AFTER the response - simulates real push
          // consumer semantics.
          setImmediate(() => startDrainer(qid));
          return send(res, 200, { ok: true, count: messages.length, ids });
        }
        return send(res, 404, { ok: false, error: `worker ${scriptName}: unknown path ${inner}` });
      }

      // Everything below expects a Bearer token.
      if (!requireAuth(req, res)) return;

      // ------- KV namespaces -------
      const nsMatch = path.match(/^\/accounts\/[^/]+\/storage\/kv\/namespaces(?:\/([^/]+))?(?:\/values\/(.+))?$/);
      if (nsMatch) {
        const nsId = nsMatch[1] || null;
        const keyEncoded = nsMatch[2] || null;
        // Collection: create/list
        if (!nsId) {
          if (req.method === 'GET') {
            return success(res, [...state.kvNamespaces.values()]);
          }
          if (req.method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString() || '{}');
            const id = `ns-${Math.random().toString(36).slice(2, 10)}`;
            const ns = { id, title: body.title || '', supports_url_encoding: true };
            state.kvNamespaces.set(id, ns);
            return success(res, ns);
          }
        }
        // Item: delete namespace or key ops
        if (nsId && !keyEncoded) {
          if (req.method === 'DELETE') {
            if (!state.kvNamespaces.has(nsId)) return notFound(res, `namespace ${nsId}`);
            state.kvNamespaces.delete(nsId);
            // Cascade: forget every key under this namespace.
            for (const k of [...state.kvValues.keys()]) {
              if (k.startsWith(`${nsId}::`)) state.kvValues.delete(k);
            }
            return success(res, null);
          }
        }
        if (nsId && keyEncoded) {
          if (!state.kvNamespaces.has(nsId)) return notFound(res, `namespace ${nsId}`);
          const key = decodeURIComponent(keyEncoded);
          const mapKey = `${nsId}::${key}`;
          if (req.method === 'PUT') {
            const body = (await readBody(req)).toString();
            state.kvValues.set(mapKey, body);
            return success(res, null);
          }
          if (req.method === 'GET') {
            if (!state.kvValues.has(mapKey)) return notFound(res, `key ${key}`);
            res.writeHead(200, { 'content-type': 'text/plain' });
            return res.end(state.kvValues.get(mapKey));
          }
          if (req.method === 'DELETE') {
            state.kvValues.delete(mapKey);
            return success(res, null);
          }
        }
      }

      // ------- Queues -------
      const qMatch = path.match(/^\/accounts\/[^/]+\/queues(?:\/([^/]+))?(?:\/consumers)?$/);
      if (qMatch) {
        const qid = qMatch[1] || null;
        const isConsumers = /\/consumers$/.test(path);
        if (!qid && req.method === 'GET') {
          return success(res, [...state.queues.values()]);
        }
        if (!qid && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)).toString() || '{}');
          const id = `q-${Math.random().toString(36).slice(2, 10)}`;
          const q = { queue_id: id, queue_name: body.queue_name };
          state.queues.set(id, q);
          state.queueMessages.set(id, []);
          return success(res, q);
        }
        if (qid && !isConsumers && req.method === 'DELETE') {
          if (!state.queues.has(qid)) return notFound(res, `queue ${qid}`);
          state.queues.delete(qid);
          state.queueMessages.delete(qid);
          state.workerConsumers.delete(qid);
          return success(res, null);
        }
        if (qid && isConsumers && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)).toString() || '{}');
          if (!state.queues.has(qid)) return notFound(res, `queue ${qid}`);
          const scriptName = body.script_name;
          if (!state.workers.has(scriptName)) return send(res, 400, { success: false, errors: [{ message: `no such script ${scriptName}` }] });
          state.workerConsumers.set(qid, scriptName);
          state.workerTelemetry.set(scriptName, { published: 0, batches: 0, totalConsumed: 0, inFlight: 0, maxConcurrent: 0 });
          return success(res, { consumer_id: `c-${Math.random().toString(36).slice(2, 10)}` });
        }
      }

      // ------- Workers scripts -------
      const wMatch = path.match(/^\/accounts\/[^/]+\/workers\/scripts(?:\/([^/]+))?(?:\/(subdomain))?$/);
      if (wMatch) {
        const scriptName = wMatch[1] || null;
        const sub = wMatch[2] || null;
        if (!scriptName && req.method === 'GET') {
          return success(res, [...state.workers.values()].map((w) => ({ id: w.name, name: w.name })));
        }
        if (scriptName && !sub && req.method === 'PUT') {
          const raw = (await readBody(req)).toString();
          state.workers.set(scriptName, { name: scriptName, script: raw.slice(0, 200), uploadedAt: Date.now() });
          return success(res, { id: scriptName, etag: `etag-${Date.now()}` });
        }
        if (scriptName && !sub && req.method === 'DELETE') {
          if (!state.workers.has(scriptName)) return notFound(res, `script ${scriptName}`);
          state.workers.delete(scriptName);
          state.workerTelemetry.delete(scriptName);
          // Also detach as any consumer.
          for (const [qid, s] of [...state.workerConsumers.entries()]) {
            if (s === scriptName) state.workerConsumers.delete(qid);
          }
          return success(res, null);
        }
        if (scriptName && sub === 'subdomain' && req.method === 'POST') {
          return success(res, { enabled: true });
        }
      }

      // ------- Workers subdomain (account-level) -------
      if (path.match(/^\/accounts\/[^/]+\/workers\/subdomain$/) && req.method === 'GET') {
        return success(res, { subdomain: state.workersSubdomain });
      }

      state.logs.push({ method: req.method, path });
      return send(res, 404, { success: false, errors: [{ code: 7003, message: `no route for ${req.method} ${path}` }] });
    } catch (err) {
      state.logs.push({ error: err.message });
      send(res, 500, { success: false, errors: [{ message: err.message }] });
    }
  });

  return {
    server,
    state,
    async start() {
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const addr = server.address();
      return { host: '127.0.0.1', port: addr.port, base: `http://127.0.0.1:${addr.port}` };
    },
    async stop() {
      await new Promise((r) => server.close(r));
    },
  };
}
