// mock-cf-api-server.mjs
//
// Test-only in-memory mock of the Cloudflare REST API surface the H-2
// self-provisioning fixtures hit. Boots on a random localhost port,
// returns Cloudflare-shaped envelopes ({ success, result, ... }), and
// stores every resource in a Map so the tests can assert BEFORE and
// AFTER inventories to prove the mint / teardown / sweep loops leave
// zero orphans (dispatch requirement 3).
//
// Endpoints implemented (all under /accounts/<aid>/... unless noted):
//   Workers KV:
//     - GET/POST     storage/kv/namespaces                          (list / create)
//     - DELETE       storage/kv/namespaces/<nsId>                   (delete)
//     - GET          storage/kv/namespaces/<nsId>/keys?prefix=      (list keys)
//     - GET/PUT/DEL  storage/kv/namespaces/<nsId>/values/<key>      (value ops)
//   Cloudflare Queues:
//     - GET/POST     queues                                         (list / create)
//     - DELETE       queues/<qid>                                   (delete)
//     - POST         queues/<qid>/consumers                         (attach consumer)
//     - POST         queues/<qid>/messages                          (REST publish batch)
//   Workers scripts:
//     - GET          workers/scripts                                (list)
//     - PUT          workers/scripts/<name>                         (upload; parses bindings)
//     - DELETE       workers/scripts/<name>                         (delete)
//
//   Workers account subdomain (pre-flight surface):
//     - GET          workers/subdomain                              (returns provisioned name; 404/10007 when the mock is booted with workersSubdomainProvisioned=false)
//
// The mock has no worker-origin HTTP route: the driver does not
// speak HTTP to the consumer Worker; publish is via the Queues REST
// endpoint and telemetry is read via the KV REST list + get
// endpoints. The account-level subdomain endpoint is exercised by
// the messaging queue concurrency probe's pre-flight, which routes
// through the same authorised REST surface as the other verbs.
//
// When the REST publish endpoint fires, the mock enqueues messages
// and drains them through a simulated push consumer that fires up to
// `maxConcurrency` invocations at once (default 8; caller-config-
// urable) and writes one telemetry record per invocation into the
// worker's RCF_TEST_TELEMETRY_KV binding target. The Worker's
// bindings are parsed from the upload multipart metadata; there is
// no hidden lookup channel between the fixture and the mock.
//
// Zero-dep (node:http, node:crypto only). Bound to 127.0.0.1 with
// port 0 so a test picks up whatever the OS hands out.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// Extract the metadata JSON out of a multipart/form-data body. The
// wire format the fixture h2-cf-account-api.mjs writes is:
//   --<boundary>\r\n
//   Content-Disposition: form-data; name="metadata"; filename="metadata.json"\r\n
//   Content-Type: application/json\r\n\r\n
//   {...json...}\r\n
//   --<boundary>\r\n
//   Content-Disposition: form-data; name="worker.mjs"; filename="worker.mjs"\r\n
//   Content-Type: application/javascript+module\r\n\r\n
//   ...script...\r\n
//   --<boundary>--\r\n
function extractMetadataFromMultipart(raw) {
  const marker = 'name="metadata"';
  const idx = raw.indexOf(marker);
  if (idx < 0) return null;
  const headerEnd = raw.indexOf('\r\n\r\n', idx);
  if (headerEnd < 0) return null;
  const bodyStart = headerEnd + 4;
  // The JSON ends at the next boundary marker "\r\n--".
  const bodyEnd = raw.indexOf('\r\n--', bodyStart);
  if (bodyEnd < 0) return null;
  const jsonText = raw.slice(bodyStart, bodyEnd);
  try { return JSON.parse(jsonText); } catch (_err) { return null; }
}

export function createMockCfApi({ maxConcurrency = 8, consumerDelayMs = 4, workersSubdomainProvisioned = true, workersSubdomainName = 'mock-tenant' } = {}) {
  const state = {
    kvNamespaces: new Map(),       // id -> { id, title }
    kvValues: new Map(),           // `${nsId}::${key}` -> string
    queues: new Map(),             // id -> { queue_id, queue_name }
    queueMessages: new Map(),      // qid -> Array<message>
    workers: new Map(),            // name -> { name, script, bindings, uploadedAt }
    workerConsumers: new Map(),    // qid -> scriptName
    workersSubdomain: workersSubdomainProvisioned ? { subdomain: workersSubdomainName } : null,
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

  // Simulated queue-triggered push consumer. For each message on a
  // queue, run the consumer worker's queue() handler at up to
  // `maxConcurrency` in parallel; the handler writes one telemetry
  // record per invocation into the RCF_TEST_TELEMETRY_KV binding
  // target so the driver's KV-list poll observes it.
  const startDrainer = (qid) => {
    const rec = state.workerConsumers.get(qid);
    if (!rec) return;
    const scriptName = typeof rec === 'string' ? rec : rec.scriptName;
    if (!scriptName) return;
    const worker = state.workers.get(scriptName);
    if (!worker) return;
    const telemetryBinding = (worker.bindings || []).find((b) => b.type === 'kv_namespace' && b.name === 'RCF_TEST_TELEMETRY_KV');
    if (!telemetryBinding) return;
    const telemetryNsId = telemetryBinding.namespace_id;
    if (!state.kvNamespaces.has(telemetryNsId)) return;

    const q = state.queueMessages.get(qid);
    if (!q || q.length === 0) return;
    // Batch: batch_size 10 mirrors the fixture default consumer settings.
    const batches = [];
    while (q.length > 0) batches.push(q.splice(0, 10));

    let idx = 0;
    const workers = Math.min(maxConcurrency, batches.length);
    const runOne = async () => {
      while (idx < batches.length) {
        const my = batches[idx++];
        const start = Date.now();
        const invocationId = randomUUID();
        await new Promise((r) => setTimeout(r, consumerDelayMs));
        const end = Date.now();
        const key = `telemetry-${String(start).padStart(20, '0')}-${invocationId}`;
        const value = JSON.stringify({ start, end, batchSize: my.length, invocationId });
        state.kvValues.set(`${telemetryNsId}::${key}`, value);
      }
    };
    for (let i = 0; i < workers; i++) runOne();
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;

      if (!requireAuth(req, res)) return;

      // ------- KV namespaces + keys + values -------
      const nsKeysMatch = path.match(/^\/accounts\/[^/]+\/storage\/kv\/namespaces\/([^/]+)\/keys$/);
      if (nsKeysMatch && req.method === 'GET') {
        const nsId = nsKeysMatch[1];
        if (!state.kvNamespaces.has(nsId)) return notFound(res, `namespace ${nsId}`);
        const prefix = url.searchParams.get('prefix') || '';
        const keys = [];
        for (const mapKey of state.kvValues.keys()) {
          if (!mapKey.startsWith(`${nsId}::`)) continue;
          const bareKey = mapKey.slice(nsId.length + 2);
          if (prefix && !bareKey.startsWith(prefix)) continue;
          keys.push({ name: bareKey });
        }
        return send(res, 200, { success: true, errors: [], messages: [], result: keys, result_info: { cursor: '' } });
      }
      const nsMatch = path.match(/^\/accounts\/[^/]+\/storage\/kv\/namespaces(?:\/([^/]+))?(?:\/values\/(.+))?$/);
      if (nsMatch) {
        const nsId = nsMatch[1] || null;
        const keyEncoded = nsMatch[2] || null;
        if (!nsId) {
          if (req.method === 'GET') {
            // Paginated (Dave ruling 4e9ff62d item 5): mirror CF's
            // page + per_page shape so the client's pagination loop
            // is exercised by tests.
            const all = [...state.kvNamespaces.values()];
            const perPage = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get('per_page') || '100', 10) || 100));
            const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
            const startIdx = (page - 1) * perPage;
            const slice = all.slice(startIdx, startIdx + perPage);
            return send(res, 200, {
              success: true, errors: [], messages: [],
              result: slice,
              result_info: { page, per_page: perPage, total_count: all.length, count: slice.length },
            });
          }
          if (req.method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString() || '{}');
            const id = `ns-${Math.random().toString(36).slice(2, 10)}`;
            const ns = { id, title: body.title || '', supports_url_encoding: true };
            state.kvNamespaces.set(id, ns);
            return success(res, ns);
          }
        }
        if (nsId && !keyEncoded) {
          if (req.method === 'DELETE') {
            if (!state.kvNamespaces.has(nsId)) return notFound(res, `namespace ${nsId}`);
            state.kvNamespaces.delete(nsId);
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

      // ------- Queues: list / create / delete / consumers / messages -------
      // Vendor batch endpoint (H-2 real-account gate 2026-09-09):
      // POST /queues/<qid>/messages/batch accepts { messages: [...] }.
      // The sibling single-message endpoint POST /queues/<qid>/messages
      // takes { body, content_type } and rejects the batch wrapper
      // with HTTP 400 code 10207; the mock enforces the same
      // discrimination so the shim tests catch a regression.
      const qBatchMatch = path.match(/^\/accounts\/[^/]+\/queues\/([^/]+)\/messages\/batch$/);
      if (qBatchMatch && req.method === 'POST') {
        const qid = qBatchMatch[1];
        if (!state.queues.has(qid)) return notFound(res, `queue ${qid}`);
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        if (!Array.isArray(body.messages)) {
          return send(res, 400, { success: false, errors: [{ code: 10207, message: 'Validation error: Required at "messages"' }] });
        }
        const q = state.queueMessages.get(qid) || [];
        for (const m of body.messages) q.push({ body: m.body, ts: Date.now() });
        state.queueMessages.set(qid, q);
        setImmediate(() => startDrainer(qid));
        return success(res, { count: body.messages.length });
      }
      const qMessagesMatch = path.match(/^\/accounts\/[^/]+\/queues\/([^/]+)\/messages$/);
      if (qMessagesMatch && req.method === 'POST') {
        const qid = qMessagesMatch[1];
        if (!state.queues.has(qid)) return notFound(res, `queue ${qid}`);
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        if (typeof body.body === 'undefined') {
          // Mirrors the real API's HTTP 400 code 10207 that the
          // 2026-09-09 gate hit when the batch wrapper was sent to
          // the single-message endpoint.
          return send(res, 400, { success: false, errors: [{ code: 10207, message: 'Validation error: Required at "body"' }] });
        }
        const q = state.queueMessages.get(qid) || [];
        q.push({ body: body.body, ts: Date.now() });
        state.queueMessages.set(qid, q);
        setImmediate(() => startDrainer(qid));
        return success(res, { count: 1 });
      }
      const qConsumerByIdMatch = path.match(/^\/accounts\/[^/]+\/queues\/([^/]+)\/consumers\/([^/]+)$/);
      if (qConsumerByIdMatch && req.method === 'DELETE') {
        const qid = qConsumerByIdMatch[1];
        const consumerId = qConsumerByIdMatch[2];
        const rec = state.workerConsumers.get(qid);
        if (!rec || rec.consumer_id !== consumerId) return notFound(res, `consumer ${consumerId} on queue ${qid}`);
        state.workerConsumers.delete(qid);
        return success(res, null);
      }
      const qConsumersMatch = path.match(/^\/accounts\/[^/]+\/queues\/([^/]+)\/consumers$/);
      if (qConsumersMatch && req.method === 'GET') {
        const qid = qConsumersMatch[1];
        if (!state.queues.has(qid)) return notFound(res, `queue ${qid}`);
        const rec = state.workerConsumers.get(qid);
        const list = rec
          ? [{ consumer_id: rec.consumer_id, script_name: rec.scriptName, type: 'worker' }]
          : [];
        return success(res, list);
      }
      if (qConsumersMatch && req.method === 'POST') {
        const qid = qConsumersMatch[1];
        if (!state.queues.has(qid)) return notFound(res, `queue ${qid}`);
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        const scriptName = body.script_name;
        if (!state.workers.has(scriptName)) return send(res, 400, { success: false, errors: [{ message: `no such script ${scriptName}` }] });
        const consumer_id = `c-${Math.random().toString(36).slice(2, 10)}`;
        state.workerConsumers.set(qid, { consumer_id, scriptName });
        return success(res, { consumer_id });
      }
      const qMatch = path.match(/^\/accounts\/[^/]+\/queues(?:\/([^/]+))?$/);
      if (qMatch) {
        const qid = qMatch[1] || null;
        if (!qid && req.method === 'GET') {
          const all = [...state.queues.values()];
          const perPage = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get('per_page') || '100', 10) || 100));
          const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
          const startIdx = (page - 1) * perPage;
          const slice = all.slice(startIdx, startIdx + perPage);
          return send(res, 200, {
            success: true, errors: [], messages: [],
            result: slice,
            result_info: { page, per_page: perPage, total_count: all.length, count: slice.length },
          });
        }
        if (!qid && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)).toString() || '{}');
          const id = `q-${Math.random().toString(36).slice(2, 10)}`;
          const q = { queue_id: id, queue_name: body.queue_name };
          state.queues.set(id, q);
          state.queueMessages.set(id, []);
          return success(res, q);
        }
        if (qid && req.method === 'DELETE') {
          if (!state.queues.has(qid)) return notFound(res, `queue ${qid}`);
          state.queues.delete(qid);
          state.queueMessages.delete(qid);
          state.workerConsumers.delete(qid);
          return success(res, null);
        }
      }

      // ------- Workers scripts: list / upload / delete -------
      const wMatch = path.match(/^\/accounts\/[^/]+\/workers\/scripts(?:\/([^/]+))?$/);
      if (wMatch) {
        const scriptName = wMatch[1] || null;
        if (!scriptName && req.method === 'GET') {
          // Cursor-based pagination (Dave ruling 4e9ff62d item 5).
          // Each page returns up to WORKER_PAGE_SIZE items and a
          // cursor to the next page; empty cursor means final page.
          const WORKER_PAGE_SIZE = 100;
          const all = [...state.workers.values()].map((w) => ({ id: w.name, name: w.name }));
          const cursorIn = url.searchParams.get('cursor') || '';
          const startIdx = cursorIn ? Number.parseInt(cursorIn, 10) : 0;
          const slice = all.slice(startIdx, startIdx + WORKER_PAGE_SIZE);
          const nextIdx = startIdx + slice.length;
          const nextCursor = nextIdx < all.length ? String(nextIdx) : '';
          return send(res, 200, {
            success: true, errors: [], messages: [],
            result: slice,
            result_info: { cursor: nextCursor, count: slice.length },
          });
        }
        if (scriptName && req.method === 'PUT') {
          const raw = (await readBody(req)).toString();
          const metadata = extractMetadataFromMultipart(raw);
          const bindings = (metadata && Array.isArray(metadata.bindings)) ? metadata.bindings : [];
          state.workers.set(scriptName, {
            name: scriptName,
            script: raw.slice(0, 200),
            bindings,
            uploadedAt: Date.now(),
          });
          return success(res, { id: scriptName, etag: `etag-${Date.now()}` });
        }
        if (scriptName && req.method === 'DELETE') {
          if (!state.workers.has(scriptName)) return notFound(res, `script ${scriptName}`);
          // Vendor precondition (H-2 real-account gate 2026-09-09,
          // CF error 10064): a Worker that is still bound as a queue
          // consumer refuses delete with HTTP 403 until the consumer
          // is detached. Enforced here so the mock cannot pass an
          // order the real API rejects.
          for (const [qid, rec] of state.workerConsumers.entries()) {
            const boundName = typeof rec === 'string' ? rec : (rec && rec.scriptName);
            if (boundName === scriptName) {
              return send(res, 403, {
                success: false,
                errors: [{
                  code: 10064,
                  message: `Cannot delete this Worker as it is a consumer for a Queue ${qid}. Remove it from the Queue's consumers first, then retry.`,
                }],
              });
            }
          }
          state.workers.delete(scriptName);
          return success(res, null);
        }
      }

      // ------- Workers account-level subdomain (pre-flight surface) -------
      // GET /accounts/<aid>/workers/subdomain returns the account's
      // workers.dev subdomain. Provisioned: HTTP 200 with
      // { result: { subdomain: "<name>" } }. Unprovisioned (mock toggled
      // via workersSubdomainProvisioned=false): HTTP 404 with error
      // code 10007, mirroring the vendor's affirmative-absence shape
      // observed live on 2026-09-10.
      const subdomainMatch = path.match(/^\/accounts\/[^/]+\/workers\/subdomain$/);
      if (subdomainMatch && req.method === 'GET') {
        if (state.workersSubdomain && state.workersSubdomain.subdomain) {
          return success(res, { subdomain: state.workersSubdomain.subdomain });
        }
        return send(res, 404, {
          success: false,
          errors: [{ code: 10007, message: 'You do not have a workers.dev subdomain.' }],
          messages: [],
          result: null,
        });
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
