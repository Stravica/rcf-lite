// h2-cf-sweep-safety.test.mjs
//
// Dedicated sweep-safety test (Dave hard constraint 4, 8be06ee5): feed
// the crash-recovery prefix sweep a set of plausibly-live production
// Worker / KV / Queue names (some production - stravica-ai, curlies-
// corner, streaky, whoosh, wsdyou admin - plus a sneaky mid-string-
// prefix name) and assert the sweep selects ZERO of them. Same
// property applied to KV namespaces and Queues (any resource type
// our sweep walks).
//
// Two variants:
//   - mock-only (always runs): seeds the mock CF server with the
//     LIVE_PRODUCTION_WORKER_NAMES fallback list plus the mid-string
//     sneaky names, exercises sweepOrphans end-to-end against the
//     mock, and asserts zero selections.
//   - live-inventory (runs when CI_HAS_CLOUDFLARE_ACCOUNT is set):
//     reads the real account inventory via the read-only listers,
//     runs the pure selection functions (no delete path exercised)
//     and asserts zero selections against the ACTUAL live names,
//     not the frozen fallback.
//
// The sweep is a structurally separate code path from the happy-path
// destroy (which uses exact-name equality against a scratch record).
// This test proves the sweep filter cannot be relaxed to select
// anything not carrying the frozen throwaway prefix constant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockCfApi } from './mock-cf-api-server.mjs';

// Mock-only fallback list of plausibly-live Worker script names. This
// is a fixed vector for the mock-CF-server variant of the sweep-safety
// test: it seeds the mock listing and asserts the sweep filter selects
// zero of them. It is NOT the source of truth for what lives on the
// real account - the live-inventory variant below reads the account
// directly (when CI_HAS_CLOUDFLARE_ACCOUNT is set) and asserts against
// THAT. Kept as an exported const so any later dispatch that adds
// sweep code can import and re-assert.
export const LIVE_PRODUCTION_WORKER_NAMES = Object.freeze([
  'stravica-ai',
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

test('sweep-safety: Queue+Worker+telemetryKV sweep filter uses startsWith on the frozen prefix constants (structural assertion)', async () => {
  const qShim = await import('../h2-cf-queue-real-account-shim.mjs');
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(fileURLToPath(new URL('../h2-cf-queue-real-account-shim.mjs', import.meta.url)), 'utf8');
  assert.equal(qShim.QUEUE_PREFIX, 'h2-cf-probe-integrity-scratch-q-');
  assert.equal(qShim.WORKER_PREFIX, 'h2-cf-probe-integrity-scratch-w-');
  assert.equal(qShim.TELEMETRY_KV_PREFIX, 'h2-cf-probe-integrity-scratch-kv-tel-');
  assert.match(src, /w\.name\.startsWith\(WORKER_PREFIX\)/, 'worker sweep filter uses startsWith on frozen constant');
  assert.match(src, /q\.name\.startsWith\(QUEUE_PREFIX\)/, 'queue sweep filter uses startsWith on frozen constant');
  assert.match(src, /n\.title\.startsWith\(TELEMETRY_KV_PREFIX\)/, 'telemetry KV sweep filter uses startsWith on frozen constant');
});

test('sweep-safety: no workers.dev subdomain surface anywhere in the client, shim, mock or tests (Dave ruling 376b4f30)', async () => {
  // The words "workers.dev" and "subdomain" legitimately appear in
  // comments that document their absence and cite the ruling; those
  // must not fail the check. Instead assert on the CALLABLE / URL /
  // ROUTE patterns that would indicate an active surface.
  const { readFile, readdir } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { join, dirname } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const roots = [join(here, '..'), here];
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.wrangler' || e.name === 'scratch' || e.name === '.rcf') continue;
        await walk(full);
      } else if (/\.(mjs|js|json)$/.test(e.name)) {
        files.push(full);
      }
    }
  }
  for (const r of roots) await walk(r);
  for (const f of files) {
    if (f === fileURLToPath(import.meta.url)) continue; // this test names the forbidden patterns
    const s = await readFile(f, 'utf8');
    // Template-literal or quoted string containing .workers.dev
    // (would indicate a URL construction on that surface).
    assert.equal(/[`'"][^`'"\n]*\.workers\.dev[^`'"\n]*[`'"]/.test(s), false, `no .workers.dev URL literal should remain in ${f}`);
    // Callable named workerEnableSubdomain or any variant.
    assert.equal(/workerEnableSubdomain\s*\(/.test(s), false, `workerEnableSubdomain call must be gone from ${f}`);
    assert.equal(/export\s+(async\s+)?function\s+workerEnableSubdomain\b/.test(s), false, `workerEnableSubdomain export must be gone from ${f}`);
    // POST /workers/scripts/<name>/subdomain route.
    assert.equal(/\/workers\/scripts\/[^"'`\s]*\/subdomain/.test(s), false, `/workers/scripts/<name>/subdomain route must be gone from ${f}`);
    // GET /workers/subdomain (account-level) route.
    assert.equal(/\/workers\/subdomain\b/.test(s), false, `/workers/subdomain route must be gone from ${f}`);
  }
});

test('sweep-safety: multi-page listings still catch every prefixed residue (pagination cover, Dave ruling 4e9ff62d item 5)', async () => {
  await withMock(async (mock) => {
    const kvShim = await import('../h2-cf-kv-real-account-shim.mjs');
    const qShim = await import('../h2-cf-queue-real-account-shim.mjs');
    // Seed 250 live-looking KV namespaces (> 2 pages at per_page=100),
    // 250 live-looking queues, 250 live-looking workers. A page-one-
    // only sweep would leave residues on pages 2+; a correct
    // paginated sweep leaves the whole live set untouched.
    for (let i = 0; i < 250; i++) {
      const kvId = `live-kv-${i.toString().padStart(4, '0')}`;
      mock.state.kvNamespaces.set(kvId, { id: kvId, title: `live-namespace-${i}` });
      const qId = `live-q-${i.toString().padStart(4, '0')}`;
      mock.state.queues.set(qId, { queue_id: qId, queue_name: `live-queue-${i}` });
      const wName = `live-worker-${i.toString().padStart(4, '0')}`;
      mock.state.workers.set(wName, { name: wName, script: 'live', uploadedAt: Date.now() });
    }
    // Sprinkle throwaway residues on the last, middle and first
    // "pages" so a truncated sweep would visibly miss them.
    const junk1 = await kvShim.mintScratchNamespace({ runId: 'multi-page-1' });
    const junk2 = await qShim.mintScratchQueueAndWorker({ runId: 'multi-page-2' });
    // A KV sweep should catch junk1 + junk2's telemetry KV.
    const kvSweep = await kvShim.sweepOrphans();
    // KV sweep filters on 'h2-cf-probe-integrity-scratch-kv-' which
    // covers both the KV-probe scratch prefix AND the queue shim's
    // telemetry KV prefix by design.
    assert.equal(kvSweep.sweptCount, 2, `KV sweep should catch both scratch namespaces (probe + queue telemetry) across pages; got ${kvSweep.sweptCount}`);
    // The queue sweep should catch junk2's queue + worker only (KV
    // telemetry already gone via kvSweep).
    const qSweep = await qShim.sweepOrphans();
    assert.equal(qSweep.workerSweptCount, 1);
    assert.equal(qSweep.queueSweptCount, 1);
    // Every live-looking name survives.
    assert.equal(mock.state.kvNamespaces.size, 250);
    assert.equal(mock.state.queues.size, 250);
    assert.equal(mock.state.workers.size, 250);
  });
});

// ---- Live-inventory variant --------------------------------------
//
// When CI_HAS_CLOUDFLARE_ACCOUNT=true (paired with CF_ACCOUNT_ID and
// CF_API_TOKEN), read the real Cloudflare account's Workers, KV
// namespaces and Queues over the paginated listers, then run the
// shims' pure selection functions over those listings and assert
// zero selections. No delete path is exercised; the selection
// functions are the exact filter sweepOrphans uses internally.
//
// Without the env var, the variant records
// { accountBoundSkipped: true, reason } naming the required env var
// and exits pass, matching the pass-with-skip shape used by every
// other real-account probe in this fixture.
test('sweep-safety live-inventory: real account listings select zero for KV, Queue and Worker sweeps', async (t) => {
  const skip = process.env.CI_HAS_CLOUDFLARE_ACCOUNT !== 'true'
    || !process.env.CF_ACCOUNT_ID
    || !process.env.CF_API_TOKEN;
  if (skip) {
    const record = {
      accountBoundSkipped: true,
      reason: 'CI_HAS_CLOUDFLARE_ACCOUNT=true (with CF_ACCOUNT_ID and CF_API_TOKEN) is required to run the live-inventory variant of sweep-safety; skipped, mock-only variant still ran.',
    };
    t.diagnostic(JSON.stringify(record));
    return; // pass-with-skip; the mock-only variants above still assert.
  }

  const api = await import('../h2-cf-account-api.mjs');
  const kvShim = await import('../h2-cf-kv-real-account-shim.mjs');
  const qShim = await import('../h2-cf-queue-real-account-shim.mjs');

  const [workers, kvNamespaces, queues] = await Promise.all([
    api.workerList(),
    api.kvListNamespaces(),
    api.queueList(),
  ]);

  const kvSelected = kvShim.selectSweepCandidates(kvNamespaces);
  const workerSelected = qShim.selectWorkerSweepCandidates(workers);
  const queueSelected = qShim.selectQueueSweepCandidates(queues);
  const telemetryKvSelected = qShim.selectTelemetryKvSweepCandidates(kvNamespaces);

  t.diagnostic(JSON.stringify({
    account: process.env.CF_ACCOUNT_ID,
    inventory: {
      workers: workers.length,
      kvNamespaces: kvNamespaces.length,
      queues: queues.length,
    },
    selected: {
      kv: kvSelected.length,
      workers: workerSelected.length,
      queues: queueSelected.length,
      telemetryKv: telemetryKvSelected.length,
    },
  }));

  assert.equal(kvSelected.length, 0, `KV sweep filter selected ${kvSelected.length} of ${kvNamespaces.length} live KV namespaces: ${kvSelected.map((n) => n.title).join(', ')}`);
  assert.equal(workerSelected.length, 0, `Worker sweep filter selected ${workerSelected.length} of ${workers.length} live Workers: ${workerSelected.map((w) => w.name).join(', ')}`);
  assert.equal(queueSelected.length, 0, `Queue sweep filter selected ${queueSelected.length} of ${queues.length} live queues: ${queueSelected.map((q) => q.name).join(', ')}`);
  assert.equal(telemetryKvSelected.length, 0, `Telemetry-KV sweep filter selected ${telemetryKvSelected.length} of ${kvNamespaces.length} live KV namespaces: ${telemetryKvSelected.map((n) => n.title).join(', ')}`);
});
