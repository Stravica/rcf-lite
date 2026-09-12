// h2-cf-queue-probe-e2e.test.mjs
//
// End-to-end lifecycle-logic proof for the Queue probe against the
// mock CF REST API. The mock implements the KV list + get + delete
// endpoints, the Queues create / delete / consumers / messages
// endpoints, and the Workers upload / delete endpoints; the drainer
// writes one telemetry record per invocation into the worker's bound
// RCF_TEST_TELEMETRY_KV namespace so the probe's KV-list poll picks
// it up. NO workers.dev subdomain endpoints, NO /w/... HTTP surface
// (convention). The local run exercises the fixture lifecycle
// logic against a mock of Cloudflare's contract; the real-account
// gate is the only surface that proves the wire format.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockCfApi } from './mock-cf-api-server.mjs';

async function withMock(fn) {
  const mock = createMockCfApi({ maxConcurrency: 8, consumerDelayMs: 3 });
  const { base } = await mock.start();
  const prev = {
    CF_API_BASE_URL: process.env.CF_API_BASE_URL,
    CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID,
    CF_API_TOKEN: process.env.CF_API_TOKEN,
    CI_HAS_CLOUDFLARE_ACCOUNT: process.env.CI_HAS_CLOUDFLARE_ACCOUNT,
    CF_QUEUE_MESSAGE_COUNT: process.env.CF_QUEUE_MESSAGE_COUNT,
  };
  process.env.CF_API_BASE_URL = base;
  process.env.CF_ACCOUNT_ID = 'acct-mock';
  process.env.CF_API_TOKEN = 'tok-mock';
  process.env.CI_HAS_CLOUDFLARE_ACCOUNT = 'true';
  process.env.CF_QUEUE_MESSAGE_COUNT = '500';
  try { await fn(mock, base); }
  finally {
    await mock.stop();
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('Queue probe e2e: real-account run mints, publishes 500 via Queues REST, drains via telemetry KV, zero orphans', async () => {
  await withMock(async (mock) => {
    const probe = (await import('../../../../../../blueprints/messaging-queue-cloudflare/contributions/probes/real-account-concurrency-smoke.mjs')).default;
    assert.equal(mock.state.queues.size, 0);
    assert.equal(mock.state.workers.size, 0);
    assert.equal(mock.state.kvNamespaces.size, 0);
    const results = await probe();
    assert.ok(Array.isArray(results) && results.length === 1);
    const r = results[0];
    assert.equal(r.anchorAcId, 'AC-29108-2');
    assert.equal(r.verdict, 'pass', `probe verdict should be pass; got: ${JSON.stringify(r)}`);
    // Positive evidence
    assert.equal(r.publishedCount, 500);
    assert.equal(r.totalConsumed, 500, `totalConsumed should be 500; got ${r.totalConsumed}`);
    assert.ok(r.maxConcurrent > 1, `maxConcurrent should exceed 1; got ${r.maxConcurrent}`);
    assert.ok(r.maxConcurrent <= 250, `maxConcurrent should not exceed 250 cap; got ${r.maxConcurrent}`);
    assert.ok(r.queueName && r.queueName.startsWith('h2-cf-probe-integrity-scratch-q-'));
    assert.ok(r.workerName && r.workerName.startsWith('h2-cf-probe-integrity-scratch-w-'));
    assert.ok(r.telemetryKvId, 'evidence includes telemetry KV id');
    assert.equal(r.workerUrl, undefined, 'no worker URL on the result (no subdomain)');
    assert.deepEqual(r.envDeclared, [
      'CI_HAS_CLOUDFLARE_ACCOUNT', 'CF_ACCOUNT_ID', 'CF_API_TOKEN',
      'CF_API_BASE_URL', 'CF_QUEUE_MESSAGE_COUNT', 'GITHUB_RUN_ID',
    ]);
    // AFTER: teardown removed all three
    assert.equal(mock.state.queues.size, 0, 'AFTER: zero queues (teardown clean)');
    assert.equal(mock.state.workers.size, 0, 'AFTER: zero workers (teardown clean)');
    assert.equal(mock.state.kvNamespaces.size, 0, 'AFTER: zero KV namespaces (teardown clean)');
    process.stdout.write(`\nQUEUE_PROBE_PASS_DETAIL: ${r.detail}\n`);
  });
});

test('Queue probe e2e: pre-flight affirmative absence (unprovisioned mock) records the declared skip and issues zero writes', async () => {
  const mock = createMockCfApi({ workersSubdomainProvisioned: false });
  const { base } = await mock.start();
  const prev = {
    CF_API_BASE_URL: process.env.CF_API_BASE_URL,
    CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID,
    CF_API_TOKEN: process.env.CF_API_TOKEN,
    CI_HAS_CLOUDFLARE_ACCOUNT: process.env.CI_HAS_CLOUDFLARE_ACCOUNT,
  };
  process.env.CF_API_BASE_URL = base;
  process.env.CF_ACCOUNT_ID = 'acct-mock';
  process.env.CF_API_TOKEN = 'tok-mock';
  process.env.CI_HAS_CLOUDFLARE_ACCOUNT = 'true';
  try {
    const probe = (await import('../../../../../../blueprints/messaging-queue-cloudflare/contributions/probes/real-account-concurrency-smoke.mjs')).default;
    const results = await probe();
    assert.equal(results[0].verdict, 'pass');
    assert.equal(results[0].accountBoundSkipped, true);
    assert.equal(results[0].reason, 'cloudflare-account-workers-dev-subdomain-not-provisioned');
    assert.match(results[0].detail, /status=404/);
    assert.match(results[0].detail, /errorCode=10007/);
    // No mint / write path should have fired against the mock.
    assert.equal(mock.state.queues.size, 0, 'affirmative-absence path issues zero queue writes');
    assert.equal(mock.state.workers.size, 0, 'affirmative-absence path issues zero worker uploads');
    assert.equal(mock.state.kvNamespaces.size, 0, 'affirmative-absence path issues zero KV writes');
  } finally {
    await mock.stop();
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
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
      'CF_API_BASE_URL', 'CF_QUEUE_MESSAGE_COUNT', 'GITHUB_RUN_ID',
    ]);
  } finally {
    if (prev === undefined) delete process.env.CI_HAS_CLOUDFLARE_ACCOUNT; else process.env.CI_HAS_CLOUDFLARE_ACCOUNT = prev;
  }
});
