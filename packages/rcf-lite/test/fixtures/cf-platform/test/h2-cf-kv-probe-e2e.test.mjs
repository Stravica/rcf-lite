// h2-cf-kv-probe-e2e.test.mjs
//
// End-to-end local proof for the KV probe running through the mock CF
// REST API. Boots the mock, points the shim at it, invokes the probe
// module's default export, asserts pass verdict + positive evidence,
// and asserts the account inventory returns to zero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockCfApi } from './mock-cf-api-server.mjs';

async function withMock(fn) {
  const mock = createMockCfApi();
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
  try { await fn(mock); }
  finally {
    await mock.stop();
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('KV probe e2e: real-account run mints, verifies, tears down, zero orphans', async () => {
  await withMock(async (mock) => {
    const probe = (await import('../../../../../../blueprints/platform-cloudflare-kv/contributions/probes/real-account-eventual-consistency-smoke.mjs')).default;
    assert.equal(mock.state.kvNamespaces.size, 0, 'BEFORE: 0 namespaces');
    const out = await probe();
    assert.ok(out && out.results && out.results.length === 1);
    const r = out.results[0];
    assert.equal(r.anchorAcId, 'AC-31103-1');
    assert.equal(r.verdict, 'pass', `probe verdict should be pass; got: ${JSON.stringify(r)}`);
    // Positive evidence: namespace id, put status, elapsed ms, key
    assert.ok(out.extra.namespaceId, 'evidence includes namespaceId');
    assert.ok(out.extra.namespaceTitle && out.extra.namespaceTitle.startsWith('h2-cf-probe-integrity-scratch-kv-'));
    assert.ok(out.extra.key && out.extra.key.startsWith('h2-storage-smoke-'));
    assert.equal(out.extra.putStatus, 200);
    assert.equal(out.extra.deleteStatus, 200);
    assert.ok(typeof out.extra.elapsedMs === 'number');
    assert.deepEqual(out.extra.envDeclared, [
      'CI_HAS_CLOUDFLARE_ACCOUNT', 'CF_ACCOUNT_ID', 'CF_API_TOKEN', 'CF_API_BASE_URL',
    ]);
    // AFTER: teardown removed the namespace
    assert.equal(mock.state.kvNamespaces.size, 0, 'AFTER: 0 namespaces (teardown clean)');
    // Print the pass detail so the wrap can capture the LOCAL PROOF TAIL
    process.stdout.write(`\nKV_PROBE_PASS_DETAIL: ${r.detail}\n`);
  });
});

test('KV probe: unset CI_HAS_CLOUDFLARE_ACCOUNT keeps pass-with-skip and declares env', async () => {
  const prev = process.env.CI_HAS_CLOUDFLARE_ACCOUNT;
  delete process.env.CI_HAS_CLOUDFLARE_ACCOUNT;
  try {
    const probe = (await import('../../../../../../blueprints/platform-cloudflare-kv/contributions/probes/real-account-eventual-consistency-smoke.mjs')).default;
    const out = await probe();
    assert.equal(out.results[0].verdict, 'pass');
    assert.equal(out.results[0].accountBoundSkipped, true);
    assert.deepEqual(out.extra.envDeclared, [
      'CI_HAS_CLOUDFLARE_ACCOUNT', 'CF_ACCOUNT_ID', 'CF_API_TOKEN', 'CF_API_BASE_URL',
    ]);
  } finally {
    if (prev === undefined) delete process.env.CI_HAS_CLOUDFLARE_ACCOUNT; else process.env.CI_HAS_CLOUDFLARE_ACCOUNT = prev;
  }
});
