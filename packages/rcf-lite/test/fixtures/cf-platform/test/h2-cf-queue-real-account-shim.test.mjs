// h2-cf-queue-real-account-shim.test.mjs
//
// Lifecycle-logic proof for the Queue + Consumer-Worker + telemetry-KV
// self-provisioning fixture (convention: local proof
// exercises OUR lifecycle logic against a mock of the CF contract;
// the real-account gate is the only surface that proves the wire
// format). Boots the mock CF REST API in-process, points the shim at
// it via CF_API_BASE_URL, and exercises every path the HQ real-
// account run will hit:
//
//   1) mint (telemetry KV + queue + worker upload with RCF_TEST_QUEUE
//      + RCF_TEST_TELEMETRY_KV bindings + consumer attach) -> verify
//      BEFORE=(0 queues, 0 workers, 0 KV) AFTER=(1 each) with the
//      documented throwaway prefixes. Worker declares the shipped
//      convention binding name RCF_TEST_QUEUE (convention).
//      No workers.dev subdomain call anywhere.
//   2) destroy path -> zero queues, zero workers, zero KV namespaces.
//   3) mid-run crash (mint then abort before destroy) -> sweepOrphans
//      cleans all three residues (worker + queue + telemetry KV).
//   4) sweep-safety: seed the account with the ten LIVE production
//      Worker script names Dave enumerated (Dave hard constraint 4:
//      feed the sweep live-looking names, assert zero selected). Same
//      property for plausible live queue and KV namespace names,
//      including mid-string-prefix decoys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { createMockCfApi } from './mock-cf-api-server.mjs';

async function withMock(fn) {
  const mock = createMockCfApi();
  const { base } = await mock.start();
  const prev = {
    CF_API_BASE_URL: process.env.CF_API_BASE_URL,
    CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID,
    CF_API_TOKEN: process.env.CF_API_TOKEN,
    CI_HAS_CLOUDFLARE_ACCOUNT: process.env.CI_HAS_CLOUDFLARE_ACCOUNT,
    GITHUB_RUN_ID: process.env.GITHUB_RUN_ID,
  };
  process.env.CF_API_BASE_URL = base;
  process.env.CF_ACCOUNT_ID = 'acct-mock';
  process.env.CF_API_TOKEN = 'tok-mock';
  process.env.CI_HAS_CLOUDFLARE_ACCOUNT = 'true';
  process.env.GITHUB_RUN_ID = `test-${Date.now()}`;
  try {
    await fn(mock, base);
  } finally {
    await mock.stop();
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('Queue shim: mint (telemetry KV + queue + worker + consumer) then destroy leaves zero orphans', async () => {
  await withMock(async (mock) => {
    const shim = await import('../h2-cf-queue-real-account-shim.mjs');
    assert.equal(mock.state.queues.size, 0);
    assert.equal(mock.state.workers.size, 0);
    assert.equal(mock.state.kvNamespaces.size, 0);
    const rec = await shim.mintScratchQueueAndWorker({ runId: 'proof-q1' });
    assert.ok(rec.queue.id);
    assert.ok(rec.queue.name.startsWith(shim.QUEUE_PREFIX));
    assert.ok(rec.worker.name.startsWith(shim.WORKER_PREFIX));
    assert.ok(rec.telemetryKv.id);
    assert.ok(rec.telemetryKv.title.startsWith(shim.TELEMETRY_KV_PREFIX));
    // No worker.url field on the record (workers.dev subdomain not enabled).
    assert.equal(rec.worker.url, undefined, 'worker record must not carry a url (no subdomain enablement)');
    assert.equal(mock.state.queues.size, 1);
    assert.equal(mock.state.workers.size, 1);
    assert.equal(mock.state.kvNamespaces.size, 1);
    // Worker declares BOTH bindings, RCF_TEST_QUEUE (shipped
    // convention) and RCF_TEST_TELEMETRY_KV.
    const w = mock.state.workers.get(rec.worker.name);
    assert.ok(w.bindings && w.bindings.length === 2, 'worker declares two bindings');
    const queueBinding = w.bindings.find((b) => b.type === 'queue');
    assert.equal(queueBinding.name, 'RCF_TEST_QUEUE', 'queue binding uses the shipped convention name RCF_TEST_QUEUE');
    assert.equal(queueBinding.queue_name, rec.queue.name);
    const kvBinding = w.bindings.find((b) => b.type === 'kv_namespace');
    assert.equal(kvBinding.name, 'RCF_TEST_TELEMETRY_KV');
    assert.equal(kvBinding.namespace_id, rec.telemetryKv.id);
    // Consumer attached to the queue; the mock stores
    // { consumer_id, scriptName } per the vendor consumer object
    // shape enforced on the DELETE consumer path.
    const consumerRec = mock.state.workerConsumers.get(rec.queue.id);
    assert.equal(consumerRec && consumerRec.scriptName, rec.worker.name);
    assert.ok(consumerRec && consumerRec.consumer_id, 'mock consumer record carries a consumer_id');
    // Shim mint records the consumer_id so destroy can detach
    // BEFORE deleting the worker (vendor teardown order proven by
    // the 2026-09-09 H-2 gate; CF error 10064 on out-of-order).
    assert.equal(rec.consumer && rec.consumer.id, consumerRec.consumer_id);
    assert.equal(rec.consumer && rec.consumer.scriptName, rec.worker.name);
    // Destroy
    const td = await shim.destroyScratchQueueAndWorker(rec);
    assert.equal(td.destroyed.queue, rec.queue.id);
    assert.equal(td.destroyed.worker, rec.worker.name);
    assert.equal(td.destroyed.telemetryKv, rec.telemetryKv.id);
    assert.equal(mock.state.queues.size, 0);
    assert.equal(mock.state.workers.size, 0);
    assert.equal(mock.state.kvNamespaces.size, 0);
  });
});

test('Queue shim: mid-run crash then sweep removes all three residues (worker, queue, telemetry KV)', async () => {
  await withMock(async (mock) => {
    const shim = await import('../h2-cf-queue-real-account-shim.mjs');
    const rec = await shim.mintScratchQueueAndWorker({ runId: 'crash-q1' });
    if (existsSync(shim._SCRATCH_PATH)) await unlink(shim._SCRATCH_PATH);
    assert.equal(mock.state.queues.size, 1);
    assert.equal(mock.state.workers.size, 1);
    assert.equal(mock.state.kvNamespaces.size, 1);
    const sweep = await shim.sweepOrphans();
    assert.equal(sweep.queueSweptCount, 1);
    assert.equal(sweep.workerSweptCount, 1);
    assert.equal(sweep.kvSweptCount, 1);
    assert.equal(sweep.queueSwept[0].id, rec.queue.id);
    assert.equal(sweep.workerSwept[0].name, rec.worker.name);
    assert.equal(sweep.kvSwept[0].id, rec.telemetryKv.id);
    assert.equal(mock.state.queues.size, 0);
    assert.equal(mock.state.workers.size, 0);
    assert.equal(mock.state.kvNamespaces.size, 0);
  });
});

test('Queue shim: sweep-safety - ten LIVE production Worker script names survive sweep', async () => {
  await withMock(async (mock) => {
    const shim = await import('../h2-cf-queue-real-account-shim.mjs');
    // Dave 8be06ee5: the account hosts these ten live scripts,
    // several production. The sweep MUST select none of them.
    const liveWorkerNames = [
      'stravica.ai',
      'stravica-ai-staging',
      'curlies-corner',
      'watchpost-heartbeat',
      'urlc-admin-api',
      'urlc-redirect',
      'streaky',
      'whoosh',
      'webhook-inspector-staging',
      'blueprint-dogfood-run1',
      // Sneakier: a name that contains the prefix substring mid-string.
      'production-h2-cf-probe-integrity-scratch-w-should-survive',
    ];
    for (const n of liveWorkerNames) mock.state.workers.set(n, { name: n, script: 'live', uploadedAt: Date.now() });
    const liveQueueNames = [
      'rcf-lite-ci-queue-smoke',
      'production-orders',
      'billing-dlq',
      'production-h2-cf-probe-integrity-scratch-q-should-survive',
    ];
    for (const n of liveQueueNames) {
      const id = `live-q-${Math.random().toString(36).slice(2)}`;
      mock.state.queues.set(id, { queue_id: id, queue_name: n });
    }
    const liveKvTitles = [
      'watchpost-heartbeat',
      'urlc-admin-api-URL_CACHE',
      'worker-compact_urls_kv',
      'legacy-h2-cf-probe-integrity-scratch-kv-tel-should-survive',
    ];
    for (const t of liveKvTitles) {
      const id = `live-kv-${Math.random().toString(36).slice(2)}`;
      mock.state.kvNamespaces.set(id, { id, title: t });
    }
    // Seed one throwaway of each.
    const junk = await shim.mintScratchQueueAndWorker({ runId: 'junk-q' });
    assert.equal(mock.state.workers.size, liveWorkerNames.length + 1);
    assert.equal(mock.state.queues.size, liveQueueNames.length + 1);
    assert.equal(mock.state.kvNamespaces.size, liveKvTitles.length + 1);

    const sweep = await shim.sweepOrphans();
    assert.equal(sweep.workerSweptCount, 1);
    assert.equal(sweep.queueSweptCount, 1);
    assert.equal(sweep.kvSweptCount, 1);
    assert.equal(sweep.workerSwept[0].name, junk.worker.name);
    assert.equal(sweep.queueSwept[0].id, junk.queue.id);
    assert.equal(sweep.kvSwept[0].id, junk.telemetryKv.id);

    for (const n of liveWorkerNames) {
      assert.ok(mock.state.workers.has(n), `live worker survived sweep: ${n}`);
    }
    for (const n of liveQueueNames) {
      const survivor = [...mock.state.queues.values()].find((q) => q.queue_name === n);
      assert.ok(survivor, `live queue survived sweep: ${n}`);
    }
    for (const t of liveKvTitles) {
      const survivor = [...mock.state.kvNamespaces.values()].find((n) => n.title === t);
      assert.ok(survivor, `live KV namespace survived sweep: ${t}`);
    }
  });
});

// Vendor teardown-order precondition proof (H-2 real-account gate
// 2026-09-09, CF error 10064): the mock now enforces the same 403
// the real API returns when a Worker delete is attempted while the
// script is still bound as a queue consumer. Two properties are
// proven here so the mock can never again pass an order the real
// API rejects:
//   1) the account-api's workerDelete throws { status: 403, ...
//      code: 10064 } when called out of order,
//   2) the shim's destroyScratchQueueAndWorker (which now detaches
//      the consumer first) succeeds where the naked worker delete
//      fails.
test('Mock CF API enforces vendor precondition: Worker delete refuses 403 while script is a consumer', async () => {
  await withMock(async (mock) => {
    const shim = await import('../h2-cf-queue-real-account-shim.mjs');
    const api = await import('../h2-cf-account-api.mjs');
    const rec = await shim.mintScratchQueueAndWorker({ runId: 'precond-1' });
    // Out-of-order worker delete fails with the exact vendor code.
    let caught;
    try {
      await api.workerDelete({ name: rec.worker.name });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'workerDelete must throw while the script is still a consumer');
    assert.equal(caught.status, 403, `expected HTTP 403, got ${caught && caught.status}`);
    assert.match(caught.message, /10064/, 'error body carries CF code 10064');
    // The worker and queue and KV all still exist (delete was refused).
    assert.ok(mock.state.workers.has(rec.worker.name));
    assert.ok(mock.state.queues.has(rec.queue.id));
    assert.ok(mock.state.kvNamespaces.has(rec.telemetryKv.id));
    // The shim's destroy path detaches the consumer first, then
    // proceeds through the correct order.
    const td = await shim.destroyScratchQueueAndWorker(rec);
    assert.equal(td.destroyed.worker, rec.worker.name);
    assert.equal(td.destroyed.queue, rec.queue.id);
    assert.equal(td.destroyed.telemetryKv, rec.telemetryKv.id);
    assert.ok(Array.isArray(td.destroyed.consumers) && td.destroyed.consumers.length >= 1, 'destroy reports at least one consumer detached');
    assert.equal(mock.state.workers.size, 0);
    assert.equal(mock.state.queues.size, 0);
    assert.equal(mock.state.kvNamespaces.size, 0);
  });
});
