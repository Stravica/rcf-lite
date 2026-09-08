// h2-cf-sweep-safety.test.mjs
//
// Dedicated sweep-safety test (Dave hard constraint 4, 8be06ee5): feed
// the crash-recovery prefix sweep the ten LIVE production Worker
// script names hosted on the operator Cloudflare account today (some
// production - stravica.ai, curlies-corner, streaky, whoosh, wsdyou
// admin - plus a sneaky mid-string-prefix name) and assert the sweep
// selects ZERO of them. Same property applied to KV namespaces and
// Queues (any resource type our sweep walks).
//
// The sweep is a structurally separate code path from the happy-path
// destroy (which uses exact-name equality against a scratch record).
// This test proves the sweep filter cannot be relaxed to select
// anything not carrying the frozen throwaway prefix constant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockCfApi } from './mock-cf-api-server.mjs';

// The ten live production Worker script names Dave enumerated (Dave
// 8be06ee5). Kept as an exported const so any later dispatch that
// adds sweep code can import and re-assert.
export const LIVE_PRODUCTION_WORKER_NAMES = Object.freeze([
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
]);

// Sneakier defence: names that contain our throwaway prefix substring
// mid-string. A prefix filter must NOT match them; a naive regex would.
export const SNEAKY_MID_STRING_NAMES = Object.freeze([
  'production-h2-cf-probe-integrity-scratch-w-should-survive',
  'legacy-h2-cf-probe-integrity-scratch-kv-should-survive',
  'prod-h2-cf-probe-integrity-scratch-q-should-survive',
]);

async function withMock(fn) {
  const mock = createMockCfApi();
  const { base } = await mock.start();
  const prev = {
    CF_API_BASE_URL: process.env.CF_API_BASE_URL,
    CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID,
    CF_API_TOKEN: process.env.CF_API_TOKEN,
  };
  process.env.CF_API_BASE_URL = base;
  process.env.CF_ACCOUNT_ID = 'acct-mock';
  process.env.CF_API_TOKEN = 'tok-mock';
  try { await fn(mock); }
  finally {
    await mock.stop();
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('sweep-safety KV: 10 live production names + mid-string-prefix name survive KV sweep', async () => {
  await withMock(async (mock) => {
    const kvShim = await import('../h2-cf-kv-real-account-shim.mjs');
    // Reuse the same names as if they were KV namespaces (defence
    // against a sweep mis-scope: if someone ever runs the KV sweep
    // over an account that also names KV namespaces after live
    // Workers, the sweep still leaves them alone).
    const all = [...LIVE_PRODUCTION_WORKER_NAMES, ...SNEAKY_MID_STRING_NAMES];
    for (const t of all) {
      const id = `live-${Math.random().toString(36).slice(2)}`;
      mock.state.kvNamespaces.set(id, { id, title: t });
    }
    const beforeSize = mock.state.kvNamespaces.size;
    const sweep = await kvShim.sweepOrphans();
    assert.equal(sweep.sweptCount, 0, `sweep selected ${sweep.sweptCount} of the seeded live-looking names; must select zero`);
    assert.equal(mock.state.kvNamespaces.size, beforeSize, 'KV namespaces set is byte-identical after sweep');
    for (const t of all) {
      const survivor = [...mock.state.kvNamespaces.values()].find((n) => n.title === t);
      assert.ok(survivor, `live-looking KV namespace survived: ${t}`);
    }
  });
});

test('sweep-safety Queue: 10 live production names + mid-string-prefix names survive Queue+Worker sweep', async () => {
  await withMock(async (mock) => {
    const qShim = await import('../h2-cf-queue-real-account-shim.mjs');
    for (const n of LIVE_PRODUCTION_WORKER_NAMES) {
      mock.state.workers.set(n, { name: n, script: 'live-production', uploadedAt: Date.now() });
    }
    // Sneaky mid-string prefix names on BOTH resource types.
    for (const n of SNEAKY_MID_STRING_NAMES) {
      mock.state.workers.set(n, { name: n, script: 'live-sneaky', uploadedAt: Date.now() });
      const id = `sneaky-q-${Math.random().toString(36).slice(2)}`;
      mock.state.queues.set(id, { queue_id: id, queue_name: n });
    }
    // Plausible live queue names.
    const liveQueueNames = ['rcf-lite-ci-queue-smoke', 'production-orders', 'billing-dlq'];
    for (const n of liveQueueNames) {
      const id = `live-q-${Math.random().toString(36).slice(2)}`;
      mock.state.queues.set(id, { queue_id: id, queue_name: n });
    }

    const workersBefore = mock.state.workers.size;
    const queuesBefore = mock.state.queues.size;
    const sweep = await qShim.sweepOrphans();
    assert.equal(sweep.workerSweptCount, 0, `sweep selected ${sweep.workerSweptCount} worker(s); must select zero`);
    assert.equal(sweep.queueSweptCount, 0, `sweep selected ${sweep.queueSweptCount} queue(s); must select zero`);
    assert.equal(mock.state.workers.size, workersBefore, 'workers set byte-identical after sweep');
    assert.equal(mock.state.queues.size, queuesBefore, 'queues set byte-identical after sweep');
    for (const n of LIVE_PRODUCTION_WORKER_NAMES) {
      assert.ok(mock.state.workers.has(n), `live production worker survived: ${n}`);
    }
    for (const n of SNEAKY_MID_STRING_NAMES) {
      assert.ok(mock.state.workers.has(n), `sneaky mid-prefix worker survived: ${n}`);
    }
    for (const n of liveQueueNames) {
      const survivor = [...mock.state.queues.values()].find((q) => q.queue_name === n);
      assert.ok(survivor, `live queue survived: ${n}`);
    }
  });
});

test('sweep-safety: KV sweep filter is a startsWith on the frozen prefix constant (structural assertion)', async () => {
  const kvShim = await import('../h2-cf-kv-real-account-shim.mjs');
  // Read the source and assert the sweep filter is a startsWith on
  // NAMESPACE_PREFIX (not a regex, not a substring match). Defence
  // against future edits that could relax the filter.
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(fileURLToPath(new URL('../h2-cf-kv-real-account-shim.mjs', import.meta.url)), 'utf8');
  assert.ok(kvShim.NAMESPACE_PREFIX === 'h2-cf-probe-integrity-scratch-kv-', 'KV prefix constant is frozen');
  assert.match(src, /n\.title\.startsWith\(NAMESPACE_PREFIX\)/, 'sweep filter uses startsWith on the frozen constant');
});

test('sweep-safety: Queue+Worker sweep filter uses startsWith on the frozen prefix constants (structural assertion)', async () => {
  const qShim = await import('../h2-cf-queue-real-account-shim.mjs');
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(fileURLToPath(new URL('../h2-cf-queue-real-account-shim.mjs', import.meta.url)), 'utf8');
  assert.equal(qShim.QUEUE_PREFIX, 'h2-cf-probe-integrity-scratch-q-');
  assert.equal(qShim.WORKER_PREFIX, 'h2-cf-probe-integrity-scratch-w-');
  assert.match(src, /w\.name\.startsWith\(WORKER_PREFIX\)/, 'worker sweep filter uses startsWith on frozen constant');
  assert.match(src, /q\.name\.startsWith\(QUEUE_PREFIX\)/, 'queue sweep filter uses startsWith on frozen constant');
});
