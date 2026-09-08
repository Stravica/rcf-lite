// Anatomy + shape + probe + fixture + shelf-doc test for the
// platform-cloudflare-kv v1.0.0 blueprint (T-1 of the Cloudflare
// round 6 spec, 2026-09-06 section 5.1). Covers TS-080..087 and
// (post H-2 re-anchor) the shipped kv AC band AC-31101-1..AC-
// 31108-1. Assertion ids moved from the defunct earlier AC band
// to the shipped AC-31xxx band per dispatch addendum ruling 1,
// H-2 (h2-cf-platform-probe-integrity) train.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'platform-cloudflare-kv');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'cf-platform');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');
const README = join(BLUEPRINT_ROOT, 'README.md');
const CHANGELOG = join(BLUEPRINT_ROOT, 'CHANGELOG.md');
const GUIDE = join(BLUEPRINT_ROOT, 'guide', 'platform-cloudflare-kv.md');
const OWN_TOPICS = join(BLUEPRINT_ROOT, 'docs', 'topics.md');
const SPA_TOPICS = join(REPO_ROOT, 'blueprints', 'application-spa', 'docs', 'topics.md');
const AUTHORING = join(REPO_ROOT, 'packages', 'rcf-lite', 'docs', 'blueprint-authoring.md');

// TS-080 (US-31101): facade opens on boot and emits facadeReady with metadata-only payload.

test('facade opens on boot and emits facadeReady with metadata-only payload (TC-080-facade-ready)', async () => {
  const { createKvFacade } = await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'kv-facade.mjs')).href);
  const { createInMemoryKv } = await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'kv-driver.mjs')).href);
  const events = [];
  const sink = (rec) => events.push(rec);
  const binding = createInMemoryKv();
  const facade = createKvFacade({ binding, eventSink: sink });
  assert.equal(typeof facade.get, 'function');
  assert.equal(typeof facade.put, 'function');
  assert.equal(typeof facade.delete, 'function');
  assert.equal(typeof facade.list, 'function');
  assert.equal(typeof facade.ready, 'function');
  await facade.ready();
  const ready = events.filter((e) => e.event === 'facadeReady');
  assert.equal(ready.length, 1, 'facadeReady emitted exactly once');
  const allowed = new Set(['event', 'key', 'size', 'ttl', 'timestamp']);
  const extra = Object.keys(ready[0]).filter((k) => !allowed.has(k));
  assert.deepEqual(extra, [], `facadeReady record must carry only {event,key,size,ttl,timestamp}; extra=${JSON.stringify(extra)}`);
  assert.equal(ready[0].key, null);
  assert.equal(ready[0].size, 0);
  assert.equal(ready[0].ttl, null);
});

// TS-081 (US-31102): env.CACHE binding is dereferenced in exactly one fixture source file.

test('env.CACHE binding is dereferenced in exactly one fixture source file (TC-081-sole-reader)', async () => {
  const src = join(FIXTURE_ROOT, 'src');
  const entries = await readdir(src);
  const hits = [];
  for (const name of entries) {
    if (!name.endsWith('.mjs')) continue;
    const text = await readFile(join(src, name), 'utf8');
    if (text.includes('env.CACHE')) hits.push(name);
  }
  assert.deepEqual(hits, ['kv-facade.mjs'],
    `expected exactly src/kv-facade.mjs to dereference env.CACHE; observed ${JSON.stringify(hits)}`);
});

// TS-082 (US-31103): facade-round-trip probe passes on the fixture kv-driver.

test('facade-round-trip probe passes on the fixture kv-driver (TC-082-round-trip)', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'facade-round-trip.mjs')).href)).default;
  const { results } = await runProbe();
  const roundTrip = results.find((r) => r.anchorAcId === 'AC-31103-1');
  assert.ok(roundTrip, 'facade-round-trip probe must include an AC-31103-1 result');
  assert.equal(roundTrip.verdict, 'pass', `AC-31103-1 verdict: ${roundTrip.detail}`);
});

test('facade-round-trip probe verifies delete-then-null branch (TC-082-delete-null)', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'facade-round-trip.mjs')).href)).default;
  const { results } = await runProbe();
  const del = results.find((r) => r.anchorAcId === 'AC-31103-2');
  assert.ok(del, 'facade-round-trip probe must include an AC-31103-2 result');
  assert.equal(del.verdict, 'pass', `AC-31103-2 verdict: ${del.detail}`);
});

// TS-083 (US-31104): list-with-prefix probe passes on 10 keys under a shared prefix.

test('list-with-prefix probe passes on 10 keys under a shared prefix (TC-083-list-prefix)', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'list-with-prefix.mjs')).href)).default;
  const { results } = await runProbe();
  const listed = results.find((r) => r.anchorAcId === 'AC-31104-1');
  assert.ok(listed, 'list-with-prefix probe must include an AC-31104-1 result');
  assert.equal(listed.verdict, 'pass', `AC-31104-1 verdict: ${listed.detail}`);
});

// TS-084 (US-31105, US-31106): cache-aside-hit-then-miss probe under an elicited deterministic clock.

test('cache-aside-hit-then-miss probe: within-TTL cached branch (TC-084-hit-within-ttl)', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'cache-aside-hit-then-miss.mjs')).href)).default;
  const { results } = await runProbe();
  const hit = results.find((r) => r.anchorAcId === 'AC-31105-1');
  assert.ok(hit, 'cache-aside-hit-then-miss probe must include an AC-31105-1 result');
  assert.equal(hit.verdict, 'pass', `AC-31105-1 verdict: ${hit.detail}`);
});

test('cache-aside-hit-then-miss probe: past-TTL miss branch (TC-084-miss-past-ttl)', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'cache-aside-hit-then-miss.mjs')).href)).default;
  const { results } = await runProbe();
  const miss = results.find((r) => r.anchorAcId === 'AC-31106-1');
  assert.ok(miss, 'cache-aside-hit-then-miss probe must include an AC-31106-1 result');
  assert.equal(miss.verdict, 'pass', `AC-31106-1 verdict: ${miss.detail}`);
});

// TS-085 (US-31107): lifecycle events carry only the metadata-only whitelist.

test('lifecycle events carry only the metadata-only whitelist (TC-085-metadata-only)', async () => {
  const { createKvFacade } = await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'kv-facade.mjs')).href);
  const { createInMemoryKv } = await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'kv-driver.mjs')).href);
  const events = [];
  const sink = (rec) => events.push(rec);
  const binding = createInMemoryKv();
  const facade = createKvFacade({ binding, eventSink: sink });
  await facade.ready();
  await facade.put('key-a', 'value-a', { metadata: { v: 1 } });
  await facade.get('key-a');
  await facade.get('key-missing');
  await facade.delete('key-a');
  const allowed = new Set(['event', 'key', 'size', 'ttl', 'timestamp']);
  for (const rec of events) {
    const extras = Object.keys(rec).filter((k) => !allowed.has(k));
    assert.deepEqual(extras, [], `event ${rec.event} carried forbidden keys=${JSON.stringify(extras)}`);
  }
  // Must have all four event types.
  const kinds = new Set(events.map((e) => e.event));
  for (const k of ['facadeReady', 'kvHit', 'kvMiss', 'kvWrite']) {
    assert.ok(kinds.has(k), `expected event kind ${k} to have fired at least once; observed kinds=${JSON.stringify([...kinds])}`);
  }
});

// TS-086 (US-31108): event-secrecy probe passes on PII fixture and fails under the fixture-side SIMULATE_PII_LEAK mutation switch.

test('event-secrecy probe passes on PII fixture and fails under fixture-side SIMULATE_PII_LEAK (TC-086-event-secrecy)', async () => {
  // Shipped code path via the module. Post H-2, SIMULATE_PII_LEAK
  // is read by the fixture-side h2-cf-kv-event-secrecy-shim and
  // captured at sink construction, so we invoke the probe module
  // directly for the happy path.
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'event-secrecy.mjs')).href)).default;
  const { results } = await runProbe();
  const es = results.find((r) => r.anchorAcId === 'AC-31108-1');
  assert.ok(es, 'event-secrecy probe must include an AC-31108-1 result');
  assert.equal(es.verdict, 'pass', `AC-31108-1 shipped-path verdict: ${es.detail}`);
  // AC-31107-1 whitelist-scan additional-result also lands on the
  // shipped path.
  const wl = results.find((r) => r.anchorAcId === 'AC-31107-1');
  assert.ok(wl, 'event-secrecy probe must include an AC-31107-1 result (whitelist-only lifecycle events)');
  assert.equal(wl.verdict, 'pass', `AC-31107-1 shipped-path verdict: ${wl.detail}`);

  // Mutation-run: run the shim as a child process with the switch
  // on; the fixture-side shim reads SIMULATE_PII_LEAK and returns
  // a polluted sink; the probe body still holds zero SIMULATE_
  // reads.
  const shim = join(PROBES_DIR, 'run-event-secrecy.mjs');
  const child = spawnSync(process.execPath, [shim], {
    cwd: FIXTURE_ROOT,
    env: { ...process.env, SIMULATE_PII_LEAK: 'true' },
    encoding: 'utf8',
  });
  assert.notEqual(child.status, 0, `SIMULATE_PII_LEAK=true expected non-zero exit; observed status=${child.status}`);
  assert.match(child.stdout, /"aggregateVerdict":\s*"fail"/, 'mutation-run must report aggregateVerdict fail');
  assert.match(child.stdout, /forbiddenKeys/i, 'mutation-run must name forbiddenKeys in the detail');
});

// TS-087 (US-31103 real-account carrier): real-account eventual-consistency smoke.

test('real-account eventual-consistency smoke records accountBoundSkipped without the env var (TC-087-real-account-smoke)', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'real-account-eventual-consistency-smoke.mjs')).href)).default;
  // Force skip regardless of ambient env.
  const originalEnv = process.env.CI_HAS_CLOUDFLARE_ACCOUNT;
  delete process.env.CI_HAS_CLOUDFLARE_ACCOUNT;
  try {
    const { results, extra } = await runProbe();
    const r = results.find((x) => x.anchorAcId === 'AC-31103-1');
    assert.ok(r, 'probe must emit an AC-31103-1 result');
    assert.equal(r.verdict, 'pass', `AC-31103-1 skipped verdict: ${r.detail}`);
    assert.equal(extra && extra.accountBoundSkipped, true, 'without CI_HAS_CLOUDFLARE_ACCOUNT the probe records accountBoundSkipped true per spec section 3.5');
  } finally {
    if (originalEnv !== undefined) process.env.CI_HAS_CLOUDFLARE_ACCOUNT = originalEnv;
  }
});

// H-2 chain slice coverage.

// TS-180 / TC-180-no-ac-5xxx-after-re-anchor (AC-15001-1):
// No AC-5xxx string survives on the kv blueprint tree after the H-2 re-anchor.
test('H-2 kv AC-15001-1 no AC-5xxx string survives on the kv blueprint tree after re-anchor', async () => {
  async function walk(dir, hits) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.rcf' || e.name === '.git') continue;
        await walk(full, hits);
      } else {
        const s = await readFile(full, 'utf8').catch(() => '');
        const re = /AC-5\d{3,}(?:-\d+)?/g;
        let m;
        while ((m = re.exec(s)) !== null) hits.push(`${full}:${m[0]}`);
      }
    }
  }
  const hits = [];
  await walk(BLUEPRINT_ROOT, hits);
  assert.equal(hits.length, 0, `expected no AC-5xxx references on the kv blueprint tree after H-2 re-anchor; observed: ${hits.slice(0, 6).join(' | ')}`);
});

// TS-180 / TC-180-shipped-kv-ac-coverage-union (AC-15001-2):
// Every shipped kv AC appears in the union of shipped probe results with pass verdict.
test('H-2 kv AC-15001-2 every shipped kv AC appears in the union of probe results with pass verdict', async () => {
  const SHIPPED = [
    'AC-31101-1', 'AC-31102-1', 'AC-31103-1', 'AC-31103-2', 'AC-31104-1',
    'AC-31105-1', 'AC-31106-1', 'AC-31107-1', 'AC-31108-1',
  ];
  const probes = ['facade-round-trip', 'list-with-prefix', 'cache-aside-hit-then-miss', 'event-secrecy'];
  const union = new Map();
  const originalEnv = process.env.CI_HAS_CLOUDFLARE_ACCOUNT;
  delete process.env.CI_HAS_CLOUDFLARE_ACCOUNT;
  try {
    for (const p of probes) {
      const runProbe = (await import(pathToFileURL(join(PROBES_DIR, `${p}.mjs`)).href)).default;
      const out = await runProbe();
      const rs = Array.isArray(out) ? out : (out && out.results) || [];
      for (const r of rs) {
        const prev = union.get(r.anchorAcId);
        if (!prev || (prev !== 'pass' && r.verdict === 'pass')) union.set(r.anchorAcId, r.verdict);
      }
    }
    // real-account probe covers AC-31103-1 as an additional carrier; env unset -> pass with accountBoundSkipped.
    const raRun = (await import(pathToFileURL(join(PROBES_DIR, 'real-account-eventual-consistency-smoke.mjs')).href)).default;
    const raOut = await raRun();
    const raRs = Array.isArray(raOut) ? raOut : (raOut && raOut.results) || [];
    for (const r of raRs) {
      const prev = union.get(r.anchorAcId);
      if (!prev || (prev !== 'pass' && r.verdict === 'pass')) union.set(r.anchorAcId, r.verdict);
    }
  } finally {
    if (originalEnv !== undefined) process.env.CI_HAS_CLOUDFLARE_ACCOUNT = originalEnv;
  }
  for (const ac of SHIPPED) {
    assert.equal(union.get(ac), 'pass', `expected kv AC ${ac} to appear with pass verdict in the union of shipped probe results; observed=${union.get(ac) || 'absent'}`);
  }
});

// Shelf-shape cross-check.

test('blueprint.json declares 19 contributions with v1.0.1, capability keyValueStore and standardsTraceClause on every ADR contribution', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'platform-cloudflare-kv');
  assert.equal(doc.version, '1.0.1');
  assert.equal(doc.category, 'platform');
  assert.deepEqual(doc.capabilities, ['keyValueStore']);
  assert.equal(doc.contributions.length, 19);
  const kinds = doc.contributions.reduce((acc, c) => { acc[c.kind] = (acc[c.kind] || 0) + 1; return acc; }, {});
  assert.equal(kinds.req, 5);
  assert.equal(kinds.us, 8);
  assert.equal(kinds.tac, 3);
  assert.equal(kinds.adr, 3);
  for (const c of doc.contributions.filter((c) => c.kind === 'adr')) {
    assert.ok(typeof c.standardsTraceClause === 'string' && c.standardsTraceClause.length > 0, `ADR ${c.id} must carry standardsTraceClause`);
  }
  const globalAdr = doc.contributions.find((c) => c.kind === 'adr' && c.scope === 'global');
  assert.equal(globalAdr && globalAdr.topic, 'keyValueStoreContract');
  const roles = doc.suggestedCompanions.map((c) => c.role).sort();
  assert.deepEqual(roles, ['errorHandling', 'logging']);
});

test('fixture wrangler.toml carries [[kv_namespaces]] block for CACHE binding', async () => {
  const toml = await readFile(join(FIXTURE_ROOT, 'wrangler.toml'), 'utf8');
  assert.match(toml, /\[\[kv_namespaces\]\]/);
  assert.match(toml, /binding\s*=\s*"CACHE"/);
});

test('anatomy sanity: README, CHANGELOG, guide, docs/topics.md all present and mention the shipped shape', async () => {
  const readme = await readFile(README, 'utf8');
  assert.match(readme, /platform-cloudflare-kv/);
  assert.match(readme, /keyValueStore/);
  const changelog = await readFile(CHANGELOG, 'utf8');
  assert.match(changelog, /1\.0\.0/);
  const guide = await readFile(GUIDE, 'utf8');
  assert.match(guide, /eventually consistent/i);
  assert.match(guide, /platform-cloudflare-durable-objects/);
  const ownTopics = await readFile(OWN_TOPICS, 'utf8');
  assert.match(ownTopics, /keyValueStoreContract/);
  assert.match(ownTopics, /platform-cloudflare-kv/);
});

test('shelf-wide id-band registry: application-spa docs/topics.md carries the platform-cloudflare-kv row', async () => {
  const spa = await readFile(SPA_TOPICS, 'utf8');
  assert.match(spa, /\|\s*platform-cloudflare-kv\s*\|/);
  assert.match(spa, /31101-31899/);
});

test('blueprint-authoring.md section 6a table carries the keyValueStore row', async () => {
  const auth = await readFile(AUTHORING, 'utf8');
  assert.match(auth, /\|\s*`keyValueStore`\s*\|/);
  assert.match(auth, /platform-cloudflare-kv` v1\.0\.0/);
});
