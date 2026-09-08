// h2-cf-queue-probe-e2e.test.mjs
//
// End-to-end local proof for the Queue probe running through the mock
// CF REST API + mock worker origin. The mock's /w/<scriptName>/...
// routes serve /reset, /publish-batch and /stats for the throwaway
// consumer worker; the mock's simulated push consumer fires up to
// maxConcurrency batches at once so the driver's maxConcurrent > 1
// assertion passes locally.
//
// The probe module's overrideWorkerUrl rewrites the worker.dev URL
// off the mint record to the mock server's /w/<name> origin when
// H2_CF_QUEUE_WORKER_URL_OVERRIDE is set - allowing the shim to
// return a real workers.dev URL for production runs while tests use
// the mock without patching the shim.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockCfApi } from './mock-cf-api-server.mjs';

async function withMock(fn) {
  const mock = createMockCfApi({ maxConcurrency: 8, consumerDelayMs: 3 });
  const { base } = await mock.start();
  const prev = {
    CF_API_BASE_URL: process.env.CF_API_BASE_URL,
    H2_CF_QUEUE_WORKER_URL_OVERRIDE: process.env.H2_CF_QUEUE_WORKER_URL_OVERRIDE,
    CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID,
    CF_API_TOKEN: process.env.CF_API_TOKEN,
    CI_HAS_CLOUDFLARE_ACCOUNT: process.env.CI_HAS_CLOUDFLARE_ACCOUNT,
    CF_QUEUE_MESSAGE_COUNT: process.env.CF_QUEUE_MESSAGE_COUNT,
  };
  process.env.CF_API_BASE_URL = base;
  process.env.H2_CF_QUEUE_WORKER_URL_OVERRIDE = base;
  process.env.CF_ACCOUNT_ID = 'acct-mock';
  process.env.CF_API_TOKEN = 'tok-mock';
  process.env.CI_HAS_CLOUDFLARE_ACCOUNT = 'true';
  // Keep the count in the same order of magnitude as production; the
  // mock's simulated push consumer handles 500 fine in a few hundred
  // ms.
  process.env.CF_QUEUE_MESSAGE_COUNT = '500';
  try { await fn(mock, base); }
  finally {
    await mock.stop();
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('Queue probe e2e: real-account run mints, drains 500 with concurrency, tears down, zero orphans', async () => {
  await withMock(async (mock) => {
    const probe = (await import('../../../../../../blueprints/messaging-queue-cloudflare/contributions/probes/real-account-concurrency-smoke.mjs')).default;
    assert.equal(mock.state.queues.size, 0);
    assert.equal(mock.state.workers.size, 0);
    const results = await probe();
    assert.ok(Array.isArray(results) && results.length === 1);
    const r = results[0];
    assert.equal(r.anchorAcId, 'AC-29108-2');
    assert.equal(r.verdict, 'pass', `probe verdict should be pass; got: ${JSON.stringify(r)}`);
    // Positive evidence
    assert.equal(r.publishedCount, 500);
    assert.ok(r.stats && r.stats.totalConsumed === 500, `totalConsumed should be 500; got ${JSON.stringify(r.stats)}`);
    assert.ok(r.stats.maxConcurrent > 1, `maxConcurrent should exceed 1; got ${r.stats.maxConcurrent}`);
    assert.ok(r.stats.maxConcurrent <= 250, `maxConcurrent should not exceed 250 cap; got ${r.stats.maxConcurrent}`);
    assert.ok(r.queueName && r.queueName.startsWith('h2-cf-probe-integrity-scratch-q-'));
    assert.ok(r.workerName && r.workerName.startsWith('h2-cf-probe-integrity-scratch-w-'));
    assert.deepEqual(r.envDeclared, [
      'CI_HAS_CLOUDFLARE_ACCOUNT', 'CF_ACCOUNT_ID', 'CF_API_TOKEN',
      'CF_API_BASE_URL', 'CF_QUEUE_MESSAGE_COUNT',
    ]);
    // AFTER: teardown removed both
    assert.equal(mock.state.queues.size, 0, 'AFTER: zero queues (teardown clean)');
    assert.equal(mock.state.workers.size, 0, 'AFTER: zero workers (teardown clean)');
    process.stdout.write(`\nQUEUE_PROBE_PASS_DETAIL: ${r.detail}\n`);
  });
});

test('Queue probe: unset CI_HAS_CLOUDFLARE_ACCOUNT keeps pass-with-skip and declares env', async () => {
  const prev = process.env.CI_HAS_CLOUDFLARE_ACCOUNT;
  delete process.env.CI_HAS_CLOUDFLARE_ACCOUNT;
  try {
    const probe = (await import('../../../../../../blueprints/messaging-queue-cloudflare/contributions/probes/real-account-concurrency-smoke.mjs')).default;
    const results = await probe();
    assert.equal(results[0].verdict, 'pass');
    assert.equal(results[0].accountBoundSkipped, true);
    assert.deepEqual(results[0].envDeclared, [
      'CI_HAS_CLOUDFLARE_ACCOUNT', 'CF_ACCOUNT_ID', 'CF_API_TOKEN',
      'CF_API_BASE_URL', 'CF_QUEUE_MESSAGE_COUNT',
    ]);
  } finally {
    if (prev === undefined) delete process.env.CI_HAS_CLOUDFLARE_ACCOUNT; else process.env.CI_HAS_CLOUDFLARE_ACCOUNT = prev;
  }
});
