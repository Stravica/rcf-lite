// h2-cf-queue-real-account-shim.test.mjs
//
// Local proof for the Queue + Consumer-Worker self-provisioning fixture.
// Boots the mock CF REST API in-process, points the shim at it via
// CF_API_BASE_URL, and exercises every path the HQ real-account run
// will hit:
//
//   1) mint queue + upload consumer worker + attach consumer + enable
//      subdomain -> verify BEFORE=(0 queues, 0 workers) AFTER=(1 each)
//      with the documented throwaway prefixes.
//   2) destroy path -> zero queues, zero workers.
//   3) mid-run crash (mint then abort before destroy) -> sweepOrphans
//      cleans both the residue worker and the residue queue.
//   4) sweep-safety: seed the account with the ten LIVE production
//      Worker script names Dave enumerated (Dave hard constraint 4:
//      feed the sweep live-looking names, assert zero selected). Same
//      property for a plausible live-looking queue name that
//      accidentally begins with our prefix substring.

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

test('Queue shim: mint (queue + worker + consumer + subdomain) then destroy leaves zero orphans', async () => {
  await withMock(async (mock) => {
    const shim = await import('../h2-cf-queue-real-account-shim.mjs');
    assert.equal(mock.state.queues.size, 0);
    assert.equal(mock.state.workers.size, 0);
    const rec = await shim.mintScratchQueueAndWorker({ runId: 'proof-q1' });
    assert.ok(rec.queue.id);
    assert.ok(rec.queue.name.startsWith(shim.QUEUE_PREFIX));
    assert.ok(rec.worker.name.startsWith(shim.WORKER_PREFIX));
    assert.equal(mock.state.queues.size, 1);
    assert.equal(mock.state.workers.size, 1);
    // The consumer must be attached (mock state records it under the
    // queue id).
    assert.equal(mock.state.workerConsumers.get(rec.queue.id), rec.worker.name);
    const td = await shim.destroyScratchQueueAndWorker(rec);
    assert.equal(td.destroyed.queue, rec.queue.id);
    assert.equal(td.destroyed.worker, rec.worker.name);
    assert.equal(mock.state.queues.size, 0);
    assert.equal(mock.state.workers.size, 0);
  });
});

test('Queue shim: mid-run crash then sweep removes both residues', async () => {
  await withMock(async (mock) => {
    const shim = await import('../h2-cf-queue-real-account-shim.mjs');
    const rec = await shim.mintScratchQueueAndWorker({ runId: 'crash-q1' });
    if (existsSync(shim._SCRATCH_PATH)) await unlink(shim._SCRATCH_PATH);
    assert.equal(mock.state.queues.size, 1);
    assert.equal(mock.state.workers.size, 1);
    const sweep = await shim.sweepOrphans();
    assert.equal(sweep.queueSweptCount, 1);
    assert.equal(sweep.workerSweptCount, 1);
    assert.equal(sweep.queueSwept[0].id, rec.queue.id);
    assert.equal(sweep.workerSwept[0].name, rec.worker.name);
    assert.equal(mock.state.queues.size, 0);
    assert.equal(mock.state.workers.size, 0);
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
    // Plausible live-looking queue names.
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
    // Seed one throwaway of each.
    const junk = await shim.mintScratchQueueAndWorker({ runId: 'junk-q' });
    assert.equal(mock.state.workers.size, liveWorkerNames.length + 1);
    assert.equal(mock.state.queues.size, liveQueueNames.length + 1);

    const sweep = await shim.sweepOrphans();
    assert.equal(sweep.workerSweptCount, 1);
    assert.equal(sweep.queueSweptCount, 1);
    assert.equal(sweep.workerSwept[0].name, junk.worker.name);
    assert.equal(sweep.queueSwept[0].id, junk.queue.id);

    // Verify EVERY live-looking name still present.
    for (const n of liveWorkerNames) {
      assert.ok(mock.state.workers.has(n), `live worker survived sweep: ${n}`);
    }
    for (const n of liveQueueNames) {
      const survivor = [...mock.state.queues.values()].find((q) => q.queue_name === n);
      assert.ok(survivor, `live queue survived sweep: ${n}`);
    }
    assert.equal(mock.state.workers.size, liveWorkerNames.length);
    assert.equal(mock.state.queues.size, liveQueueNames.length);
  });
});
