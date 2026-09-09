// h2-cf-account-api.mjs
//
// Zero-dep thin client over the Cloudflare Workers REST API surface
// the H-2 real-account fixtures need to self-provision their scratch
// dependencies. Node 24 built-in fetch only; no external HTTP libs
// (round-5 spec section 5, brief section 4).
//
// Endpoints in play:
//   - Workers KV: create / delete / list namespaces; put / get / delete
//     keys. Per https://developers.cloudflare.com/api/operations/
//     workers-kv-namespace-create-a-namespace.
//   - Cloudflare Queues: create / delete / list queues; attach and
//     detach a consumer Worker. Per https://developers.cloudflare.com/
//     api/operations/queue-create-queue.
//   - Workers scripts: upload (multipart), delete, list. Per
//     https://developers.cloudflare.com/api/operations/worker-script-
//     upload-worker-module.
//   (The Workers subdomain surface is deliberately absent - see NOTE
//   below the workerList export. Dave ruling 376b4f30.)
//
// Every method reads the account id and token from process.env at call
// time so a test can boot the process without them (envAssert throws
// with a pointer). The API base URL is overrideable via
// CF_API_BASE_URL: tests point it at the local mock CF server
// (test/mock-cf-api-server.mjs) to prove the mint / evidence / teardown
// / crash+sweep loops without any real account access.
//
// Every response body is parsed as JSON when the content-type says so,
// text otherwise. Non-2xx bodies are captured verbatim in the thrown
// Error so a probe FAIL tail names the exact API failure Dave reads
// line by line.

const DEFAULT_API_BASE = 'https://api.cloudflare.com/client/v4';

function apiBase() {
  const override = process.env.CF_API_BASE_URL;
  if (override && override.trim().length > 0) return override.replace(/\/$/, '');
  return DEFAULT_API_BASE;
}

function assertEnv(name) {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    throw new Error(`h2-cf-account-api: ${name} is not set on the environment; a real-account call cannot proceed. Set CI_HAS_CLOUDFLARE_ACCOUNT=true and pair CF_ACCOUNT_ID and CF_API_TOKEN, or unset CI_HAS_CLOUDFLARE_ACCOUNT to keep the pass-with-skip path.`);
  }
  return v;
}

function authHeaders(extra) {
  const token = assertEnv('CF_API_TOKEN');
  return { authorization: `Bearer ${token}`, ...(extra || {}) };
}

async function callJson(method, path, { body, headers } = {}) {
  const url = `${apiBase()}${path}`;
  const init = { method, headers: authHeaders({ 'content-type': 'application/json', ...(headers || {}) }) };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const resp = await fetch(url, init);
  const text = await resp.text();
  let json = null;
  try { json = text.length > 0 ? JSON.parse(text) : null; } catch (_err) { /* keep as text */ }
  if (!resp.ok) {
    const err = new Error(`h2-cf-account-api ${method} ${path} failed: status=${resp.status} body=${text.slice(0, 500)}`);
    err.status = resp.status;
    err.body = text;
    err.json = json;
    throw err;
  }
  return { status: resp.status, json, text };
}

async function callText(method, path, { body, headers, contentType } = {}) {
  const url = `${apiBase()}${path}`;
  const init = { method, headers: authHeaders({ ...(contentType ? { 'content-type': contentType } : {}), ...(headers || {}) }) };
  if (body !== undefined) init.body = body;
  const resp = await fetch(url, init);
  const text = await resp.text();
  if (!resp.ok) {
    const err = new Error(`h2-cf-account-api ${method} ${path} failed: status=${resp.status} body=${text.slice(0, 500)}`);
    err.status = resp.status;
    err.body = text;
    throw err;
  }
  return { status: resp.status, text };
}

// ----- Workers KV -----

export async function kvCreateNamespace({ title }) {
  const accountId = assertEnv('CF_ACCOUNT_ID');
  const { json } = await callJson('POST', `/accounts/${accountId}/storage/kv/namespaces`, { body: { title } });
  const id = json && json.result && json.result.id;
  if (!id) throw new Error(`kvCreateNamespace: response missing result.id: ${JSON.stringify(json)}`);
  return { id, title: json.result.title || title, requestId: (json && json.result && json.result.request_id) || null };
}

export async function kvDeleteNamespace({ id, title }) {
  if (!id) throw new Error('kvDeleteNamespace: id is required');
  const accountId = assertEnv('CF_ACCOUNT_ID');
  try {
    const { json } = await callJson('DELETE', `/accounts/${accountId}/storage/kv/namespaces/${id}`);
    return { id, title: title || null, deleted: true, api: json };
  } catch (err) {
    // Idempotency (Dave ruling 4e9ff62d item 3+4): a 404 on delete
    // means the namespace is already gone; treat as success so a
    // botched-retry teardown does not strand siblings on the second
    // pass.
    if (err && err.status === 404) return { id, title: title || null, deleted: true, alreadyGone: true };
    throw err;
  }
}

// Paginated list over all KV namespaces on the account (Dave ruling
// 4e9ff62d item 5). KV namespaces list is page-based with per_page
// capped at 100 (documented at
// https://developers.cloudflare.com/api/operations/workers-kv-namespace-list-namespaces).
// Loop pages until returned length is below per_page or until
// result_info reports we have consumed count === total_count. Under
// no circumstance return a page-one-only truncation and claim
// completeness: sweepOrphans depends on the whole list.
const KV_LIST_PAGE_SIZE = 100;
const KV_LIST_MAX_PAGES = 1000; // hard stop against runaway loops on a bad server response
export async function kvListNamespaces() {
  const accountId = assertEnv('CF_ACCOUNT_ID');
  const out = [];
  for (let page = 1; page <= KV_LIST_MAX_PAGES; page++) {
    const { json } = await callJson('GET', `/accounts/${accountId}/storage/kv/namespaces?per_page=${KV_LIST_PAGE_SIZE}&page=${page}`);
    const list = (json && Array.isArray(json.result)) ? json.result : [];
    for (const n of list) out.push({ id: n.id, title: n.title });
    const info = (json && json.result_info) || null;
    if (info && typeof info.total_count === 'number') {
      if (out.length >= info.total_count) break;
    }
    if (list.length < KV_LIST_PAGE_SIZE) break;
  }
  return out;
}

export async function kvPut({ namespaceId, key, value }) {
  const accountId = assertEnv('CF_ACCOUNT_ID');
  const enc = encodeURIComponent(key);
  const { status } = await callText('PUT', `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${enc}`, {
    body: String(value),
    contentType: 'text/plain',
  });
  return { status };
}

export async function kvGet({ namespaceId, key }) {
  const accountId = assertEnv('CF_ACCOUNT_ID');
  const enc = encodeURIComponent(key);
  const url = `${apiBase()}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${enc}`;
  const resp = await fetch(url, { method: 'GET', headers: authHeaders() });
  const text = await resp.text();
  return { status: resp.status, text, ok: resp.ok };
}

export async function kvDelete({ namespaceId, key }) {
  const accountId = assertEnv('CF_ACCOUNT_ID');
  const enc = encodeURIComponent(key);
  const { status } = await callText('DELETE', `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${enc}`);
  return { status };
}

// ----- Cloudflare Queues -----

export async function queueCreate({ name }) {
  const accountId = assertEnv('CF_ACCOUNT_ID');
  const { json } = await callJson('POST', `/accounts/${accountId}/queues`, { body: { queue_name: name } });
  const q = json && json.result;
  if (!q || !q.queue_id) throw new Error(`queueCreate: response missing result.queue_id: ${JSON.stringify(json)}`);
  return { id: q.queue_id, name: q.queue_name || name };
}

export async function queueDelete({ id, name }) {
  if (!id) throw new Error('queueDelete: id is required');
  const accountId = assertEnv('CF_ACCOUNT_ID');
  try {
    const { json } = await callJson('DELETE', `/accounts/${accountId}/queues/${id}`);
    return { id, name: name || null, deleted: true, api: json };
  } catch (err) {
    // Idempotency (Dave ruling 4e9ff62d item 3+4).
    if (err && err.status === 404) return { id, name: name || null, deleted: true, alreadyGone: true };
    throw err;
  }
}

// Paginated queue list (Dave ruling 4e9ff62d item 5). Cloudflare
// Queues list endpoint returns result_info with page + per_page +
// total_count fields (documented at
// https://developers.cloudflare.com/api/operations/queue-list-queues).
const QUEUE_LIST_PAGE_SIZE = 100;
const QUEUE_LIST_MAX_PAGES = 1000;
export async function queueList() {
  const accountId = assertEnv('CF_ACCOUNT_ID');
  const out = [];
  for (let page = 1; page <= QUEUE_LIST_MAX_PAGES; page++) {
    const { json } = await callJson('GET', `/accounts/${accountId}/queues?per_page=${QUEUE_LIST_PAGE_SIZE}&page=${page}`);
    const list = (json && Array.isArray(json.result)) ? json.result : [];
    for (const q of list) out.push({ id: q.queue_id, name: q.queue_name });
    const info = (json && json.result_info) || null;
    if (info && typeof info.total_count === 'number') {
      if (out.length >= info.total_count) break;
    }
    if (list.length < QUEUE_LIST_PAGE_SIZE) break;
  }
  return out;
}

// Attach a Worker as the queue's push consumer. Dave ruling
// 4e9ff62d items 1 + 2: the CF consumer-attach body is a
// discriminated union (type: "worker" vs "http_pull"); the
// discriminator MUST be sent to survive schema tightening (a
// server-inferred "worker" from script_name presence works today
// but is fragile). dead_letter_queue is documented as an optional
// string, so omit the property entirely rather than sending an
// explicit null (which some validators reject).
export async function queueConsumerAttach({ queueId, scriptName }) {
  const accountId = assertEnv('CF_ACCOUNT_ID');
  const body = {
    type: 'worker',
    script_name: scriptName,
    settings: { batch_size: 10, max_retries: 3, max_wait_time_ms: 500 },
  };
  const { json } = await callJson('POST', `/accounts/${accountId}/queues/${queueId}/consumers`, { body });
  const c = json && json.result;
  return { consumerId: (c && c.consumer_id) || null, scriptName };
}

// ----- Workers scripts -----

// Uploads a Worker as an ES module with the given bindings. Multipart
// body; the "metadata" part is JSON, the module part is JS. Cloudflare
// treats the module named "worker.mjs" as the entry.
export async function workerUpload({ name, scriptSource, bindings = [], mainModule = 'worker.mjs' }) {
  const accountId = assertEnv('CF_ACCOUNT_ID');
  const boundary = `----h2cf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const metadata = { main_module: mainModule, bindings, compatibility_date: '2026-01-01', compatibility_flags: [] };
  const parts = [];
  parts.push(`--${boundary}\r\n`);
  parts.push('Content-Disposition: form-data; name="metadata"; filename="metadata.json"\r\n');
  parts.push('Content-Type: application/json\r\n\r\n');
  parts.push(JSON.stringify(metadata));
  parts.push(`\r\n--${boundary}\r\n`);
  parts.push(`Content-Disposition: form-data; name="${mainModule}"; filename="${mainModule}"\r\n`);
  parts.push('Content-Type: application/javascript+module\r\n\r\n');
  parts.push(scriptSource);
  parts.push(`\r\n--${boundary}--\r\n`);
  const body = parts.join('');
  const url = `${apiBase()}/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}`;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: authHeaders({ 'content-type': `multipart/form-data; boundary=${boundary}` }),
    body,
  });
  const text = await resp.text();
  if (!resp.ok) {
    const err = new Error(`workerUpload ${name} failed: status=${resp.status} body=${text.slice(0, 500)}`);
    err.status = resp.status;
    throw err;
  }
  let json = null;
  try { json = JSON.parse(text); } catch (_err) { /* keep as null */ }
  return { name, uploaded: true, response: json };
}

export async function workerDelete({ name }) {
  if (!name) throw new Error('workerDelete: name is required');
  const accountId = assertEnv('CF_ACCOUNT_ID');
  try {
    const { json } = await callJson('DELETE', `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}`);
    return { name, deleted: true, api: json };
  } catch (err) {
    // Idempotency (Dave ruling 4e9ff62d item 3+4): a 404 means the
    // script is already gone; treat as success so a botched-retry
    // teardown proceeds to the queue delete rather than stranding it.
    if (err && err.status === 404) return { name, deleted: true, alreadyGone: true };
    throw err;
  }
}

// Paginated worker script list (Dave ruling 4e9ff62d item 5).
// Workers script listing is cursor-based: the response's
// result_info.cursor points at the next page when more remain, and
// is absent or empty on the final page.
const WORKER_LIST_MAX_PAGES = 1000;
export async function workerList() {
  const accountId = assertEnv('CF_ACCOUNT_ID');
  const out = [];
  let cursor = '';
  for (let page = 0; page < WORKER_LIST_MAX_PAGES; page++) {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const { json } = await callJson('GET', `/accounts/${accountId}/workers/scripts${qs}`);
    const list = (json && Array.isArray(json.result)) ? json.result : [];
    for (const s of list) out.push({ name: s.id || s.name });
    const nextCursor = (json && json.result_info && json.result_info.cursor) || '';
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return out;
}

// NOTE: the CF Workers subdomain endpoints (documented as script-level
// subdomain and account-level subdomain per the Cloudflare API) are
// deliberately absent (Dave ruling 376b4f30). The throwaway consumer
// Worker is invoked BY THE QUEUE, not over HTTP, so no public dev
// URL is needed; the subdomain endpoint is also a state change on
// the operator account that is refused on review. The driver
// publishes messages via the Cloudflare Queues REST publish endpoint
// below and reads consumer telemetry via the scratch KV namespace the
// consumer Worker writes to.

// ----- Cloudflare Queues REST publish -----
// POST /accounts/<aid>/queues/<qid>/messages accepts a body of
// { messages: [{ body: <string|json>, content_type: 'json'|'text', ... }] }
// per https://developers.cloudflare.com/api/operations/queue-publish-messages
// and enqueues the batch onto the queue for the push consumer.
export async function queuePublishBatch({ queueId, messages }) {
  const accountId = assertEnv('CF_ACCOUNT_ID');
  const body = {
    messages: messages.map((m) => ({
      body: typeof m.body === 'string' ? m.body : JSON.stringify(m.body),
      content_type: typeof m.body === 'string' ? 'text' : 'json',
    })),
  };
  const { json } = await callJson('POST', `/accounts/${accountId}/queues/${queueId}/messages`, { body });
  return { count: messages.length, api: json };
}

// ----- KV list keys within a namespace -----
// GET /accounts/<aid>/storage/kv/namespaces/<nsid>/keys?prefix=<p>&limit=<n>&cursor=<c>
// returns { result: [{ name, expiration?, metadata? }], result_info: { cursor } }
// per https://developers.cloudflare.com/api/operations/workers-kv-namespace-list-a-namespace-s-keys.
// Paginated with the documented cursor loop (Dave ruling 4e9ff62d
// item 5, extended): the queue probe's readTelemetryRecords feeds on
// this listing, so completeness must hold at any size. `limit` is the
// per-page limit (CF max 1000); we cursor to completion and stop when
// the server returns an empty next cursor. Hard-capped page count
// against a runaway server response.
const KV_LIST_KEYS_MAX_PAGES = 1000;
export async function kvListKeys({ namespaceId, prefix, limit = 1000 }) {
  const accountId = assertEnv('CF_ACCOUNT_ID');
  const out = [];
  let cursor = '';
  for (let page = 0; page < KV_LIST_KEYS_MAX_PAGES; page++) {
    const qs = new URLSearchParams();
    if (prefix) qs.set('prefix', prefix);
    qs.set('limit', String(limit));
    if (cursor) qs.set('cursor', cursor);
    const { json } = await callJson('GET', `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys?${qs.toString()}`);
    const list = (json && Array.isArray(json.result)) ? json.result : [];
    for (const k of list) out.push({ name: k.name, expiration: k.expiration || null, metadata: k.metadata || null });
    const nextCursor = (json && json.result_info && json.result_info.cursor) || '';
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return out;
}

// Convenience for tests / the mock server: expose the resolved base
// so a caller can log which surface the shim will hit.
export function currentApiBase() {
  return apiBase();
}
