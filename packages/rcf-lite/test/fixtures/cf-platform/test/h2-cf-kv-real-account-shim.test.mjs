// h2-cf-kv-real-account-shim.test.mjs
//
// Local proof for the KV self-provisioning fixture. Boots the mock CF
// REST API in-process, points the shim at it via CF_API_BASE_URL, and
// exercises every path the HQ real-account run will hit:
//
//   1) mint scratch namespace -> verify BEFORE=0 AFTER=1 with the
//      documented throwaway prefix.
//   2) put / poll / delete + destroy -> verify positive evidence
//      captured (namespace id, put status, elapsed).
//   3) mid-run crash (mint then abort before destroy) -> sweepOrphans
//      cleans the residue and BEFORE and AFTER on the sweep match.
//   4) sweep-safety: seed the account with the ten LIVE script names
//      Dave enumerated plus a live-looking KV namespace name; assert
//      sweepOrphans selects ZERO of them (Dave hard constraint 4 for
//      the KV resource type - same property applied to namespaces).
//
// Node built-in test runner; run via `node --test <this-file>`.

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

test('KV shim: mint + put + get + delete + destroy leaves zero orphans', async () => {
  await withMock(async (mock) => {
    const shim = await import('../h2-cf-kv-real-account-shim.mjs');
    // BEFORE
    assert.equal(mock.state.kvNamespaces.size, 0, 'BEFORE: no namespaces');
    // Mint
    const rec = await shim.mintScratchNamespace({ runId: 'proof-1' });
    assert.ok(rec.id, 'mint returns id');
    assert.ok(rec.title.startsWith(shim.NAMESPACE_PREFIX), 'mint title has throwaway prefix');
    assert.equal(mock.state.kvNamespaces.size, 1, 'after mint: 1 namespace');
    // Put / get / delete
    const key = shim.generateKey({ runId: 'proof-1' });
    const put = await shim.putScratchKey({ namespaceId: rec.id, key, value: 'hello-world' });
    assert.equal(put.status, 200, 'put status 200');
    const got = await shim.getScratchKey({ namespaceId: rec.id, key });
    assert.equal(got.status, 200);
    assert.equal(got.text, 'hello-world');
    const del = await shim.deleteScratchKey({ namespaceId: rec.id, key });
    assert.equal(del.status, 200);
    // Destroy
    const td = await shim.destroyScratchNamespace(rec);
    assert.equal(td.destroyed, rec.id);
    // AFTER
    assert.equal(mock.state.kvNamespaces.size, 0, 'AFTER: no namespaces (zero orphans)');
  });
});

test('KV shim: mid-run crash then sweep leaves zero orphans', async () => {
  await withMock(async (mock) => {
    const shim = await import('../h2-cf-kv-real-account-shim.mjs');
    // Simulate crash: mint, then wipe the scratch record and DO NOT
    // call destroy (i.e. process died with the record only in the
    // account).
    const rec = await shim.mintScratchNamespace({ runId: 'crash-1' });
    assert.equal(mock.state.kvNamespaces.size, 1, 'after crash-mint: 1 namespace');
    if (existsSync(shim._SCRATCH_PATH)) await unlink(shim._SCRATCH_PATH);
    // Sweep by prefix (does NOT read the scratch file)
    const sweep = await shim.sweepOrphans();
    assert.equal(sweep.sweptCount, 1, 'sweep removed the residue');
    assert.equal(sweep.swept[0].id, rec.id, 'sweep removed the exact minted id');
    assert.equal(mock.state.kvNamespaces.size, 0, 'AFTER sweep: zero orphans');
  });
});

test('KV shim: sweep-safety - live-looking names survive the sweep', async () => {
  await withMock(async (mock) => {
    const shim = await import('../h2-cf-kv-real-account-shim.mjs');
    // Seed the mock with ten live production namespace names lifted
    // from the operator account inventory (Dave 8be06ee5 lists the
    // ten Worker scripts; we apply the same defence to KV namespace
    // names because the sweep should never touch anything that does
    // not carry our documented throwaway prefix).
    const liveNames = [
      'stravica.ai',
      'stravica-ai-staging',
      'curlies-corner',
      'watchpost-heartbeat',
      'urlc-admin-api-URL_CACHE',
      'urlc-redirect',
      'streaky',
      'whoosh',
      'webhook-inspector-staging',
      'blueprint-dogfood-run1',
      // Sneakier: a name that CONTAINS the prefix mid-string.
      'production-h2-cf-probe-integrity-scratch-kv-should-survive',
    ];
    for (const t of liveNames) {
      const id = `live-${Math.random().toString(36).slice(2, 10)}`;
      mock.state.kvNamespaces.set(id, { id, title: t });
    }
    // Also seed two THROWAWAY residues from a prior crashed run.
    const junk1 = await shim.mintScratchNamespace({ runId: 'junk-1' });
    const junk2 = await shim.mintScratchNamespace({ runId: 'junk-2' });
    assert.equal(mock.state.kvNamespaces.size, liveNames.length + 2);

    const sweep = await shim.sweepOrphans();
    assert.equal(sweep.sweptCount, 2, 'sweep removed exactly the two throwaways');
    const sweptIds = sweep.swept.map((s) => s.id).sort();
    assert.deepEqual(sweptIds, [junk1.id, junk2.id].sort());
    // Verify EVERY live-looking name still present.
    for (const t of liveNames) {
      const survivor = [...mock.state.kvNamespaces.values()].find((n) => n.title === t);
      assert.ok(survivor, `live name survived sweep: ${t}`);
    }
    assert.equal(mock.state.kvNamespaces.size, liveNames.length, 'AFTER sweep: only live names remain');
  });
});
