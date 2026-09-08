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
//   - Workers subdomain: enable workers.dev on a script so the fixture
//     driver has an origin to hit.
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
  const { json } = await callJson('DELETE', `/accounts/${accountId}/storage/kv/namespaces/${id}`);
  return { id, title: title || null, deleted: true, api: json };
}

export async function kvListNamespaces() {
  const accountId = assertEnv('CF_ACCOUNT_ID');
  const { json } = await callJson('GET', `/accounts/${accountId}/storage/kv/namespaces`);
  const list = (json && Array.isArray(json.result)) ? json.result : [];
  return list.map((n) => ({ id: n.id, title: n.title }));
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
  const { json } = await callJson('DELETE', `/accounts/${accountId}/queues/${id}`);
  return { id, name: name || null, deleted: true, api: json };
}

export async function queueList() {
  const accountId = assertEnv('CF_ACCOUNT_ID');
  const { json } = await callJson('GET', `/accounts/${accountId}/queues`);
  const list = (json && Array.isArray(json.result)) ? json.result : [];
  return list.map((q) => ({ id: q.queue_id, name: q.queue_name }));
}

export async function queueConsumerAttach({ queueId, scriptName }) {
  const accountId = assertEnv('CF_ACCOUNT_ID');
  const body = {
    script_name: scriptName,
    settings: { batch_size: 10, max_retries: 3, max_wait_time_ms: 500 },
    dead_letter_queue: null,
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
  const { json } = await callJson('DELETE', `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}`);
  return { name, deleted: true, api: json };
}

export async function workerList() {
  const accountId = assertEnv('CF_ACCOUNT_ID');
  const { json } = await callJson('GET', `/accounts/${accountId}/workers/scripts`);
  const list = (json && Array.isArray(json.result)) ? json.result : [];
  return list.map((s) => ({ name: s.id || s.name }));
}

// Enable workers.dev on the given script; returns the URL the driver
// can drive. The subdomain endpoint returns the account subdomain;
// callers combine as `${scriptName}.${subdomain}.workers.dev`.
export async function workerEnableSubdomain({ name }) {
  const accountId = assertEnv('CF_ACCOUNT_ID');
  await callJson('POST', `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}/subdomain`, { body: { enabled: true } });
  const { json } = await callJson('GET', `/accounts/${accountId}/workers/subdomain`);
  const subdomain = json && json.result && json.result.subdomain;
  if (!subdomain) throw new Error(`workerEnableSubdomain: subdomain missing from /workers/subdomain response: ${JSON.stringify(json)}`);
  return { subdomain, url: `https://${name}.${subdomain}.workers.dev` };
}

// Convenience for tests / the mock server: expose the resolved base
// so a caller can log which surface the shim will hit.
export function currentApiBase() {
  return apiBase();
}
