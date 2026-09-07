// Anatomy + shape + probe + fixture + shelf-doc test for the
// platform-cloudflare-durable-objects v1.0.0 blueprint (T-3 of
// the Cloudflare round 6 spec, 2026-09-06 section 5.3). Covers
// TS-100..109.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'platform-cloudflare-durable-objects');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'cf-platform');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');
const README = join(BLUEPRINT_ROOT, 'README.md');
const CHANGELOG = join(BLUEPRINT_ROOT, 'CHANGELOG.md');
const GUIDE = join(BLUEPRINT_ROOT, 'guide', 'platform-cloudflare-durable-objects.md');
const OWN_TOPICS = join(BLUEPRINT_ROOT, 'docs', 'topics.md');
const SPA_TOPICS = join(REPO_ROOT, 'blueprints', 'application-spa', 'docs', 'topics.md');
const AUTHORING = join(REPO_ROOT, 'packages', 'rcf-lite', 'docs', 'blueprint-authoring.md');

// TS-100 (US-7001): DO facade opens on boot and emits namespaceReady with metadata-only payload.

test('DO facade opens on boot and emits namespaceReady with metadata-only payload (TC-100-do-facade-ready)', async () => {
  const { createInMemoryDoStorage } = await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'do-storage.mjs')).href);
  const { SingleCellObject } = await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'do-single-cell.mjs')).href);
  const { HubObject } = await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'do-hub.mjs')).href);
  const { createDoFacadeInProcess } = await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'do-facade.mjs')).href);
  const { createFakeState } = await import(pathToFileURL(join(PROBES_DIR, 'probe-utils.mjs')).href);

  const events = [];
  const sink = (rec) => events.push(rec);
  const cell = new SingleCellObject({ storage: createInMemoryDoStorage({ backend: 'sql' }), eventSink: sink, name: 'c1' });
  const hub = new HubObject({ state: createFakeState(), storage: createInMemoryDoStorage({ backend: 'sql' }), eventSink: sink, name: 'h1' });
  const facade = createDoFacadeInProcess({ singleCell: cell, hub, eventSink: sink });

  await facade.ready();
  const ready = events.filter((e) => e.event === 'namespaceReady');
  assert.equal(ready.length, 1, 'namespaceReady emitted exactly once');
  const allowed = new Set(['event', 'key', 'size', 'ttl', 'timestamp']);
  const extra = Object.keys(ready[0]).filter((k) => !allowed.has(k));
  assert.deepEqual(extra, [], `namespaceReady record must carry only {event,key,size,ttl,timestamp}; extra=${JSON.stringify(extra)}`);
  assert.equal(ready[0].key, null);
  assert.equal(ready[0].size, 0);
  assert.equal(ready[0].ttl, null);
  assert.equal(facade.cell('c1'), cell);
  assert.equal(facade.hub('h1'), hub);
});

// TS-100 (US-7001) part 2: src/do-facade.mjs is the SOLE reader of env.CELL and env.HUB.

test('do-facade.mjs is the sole reader of env.CELL and env.HUB in the fixture source tree (TC-100-sole-reader-boundary)', async () => {
  const facadeSrc = await readFile(join(FIXTURE_ROOT, 'src', 'do-facade.mjs'), 'utf8');
  assert.equal(facadeSrc.includes('env.CELL'), true, 'do-facade.mjs must dereference env.CELL');
  assert.equal(facadeSrc.includes('env.HUB'), true, 'do-facade.mjs must dereference env.HUB');
  // Verify the sole-reader-scan probe module exists as the shipped enforcement mechanism.
  const scanExists = existsSync(join(PROBES_DIR, 'sole-reader-scan.mjs'));
  assert.equal(scanExists, true, 'sole-reader-scan.mjs must exist as the shipped enforcement mechanism');
});

// TS-101 (US-7101): two concurrent increments serialise per instance and read returns the sum.

test('two concurrent increments serialise per instance and read returns the sum (TC-101-single-cell-concurrent)', async () => {
  const { createInMemoryDoStorage } = await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'do-storage.mjs')).href);
  const { SingleCellObject } = await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'do-single-cell.mjs')).href);
  const events = [];
  const cell = new SingleCellObject({ storage: createInMemoryDoStorage({ backend: 'sql' }), eventSink: (r) => events.push(r), name: 'c' });
  const [a, b] = await Promise.all([cell.increment(1), cell.increment(1)]);
  const read = await cell.read();
  const counters = [a.counter, b.counter].sort((x, y) => x - y);
  const witnesses = [a.witness, b.witness].sort((x, y) => x - y);
  assert.deepEqual(counters, [1, 2]);
  assert.deepEqual(witnesses, [0, 1]);
  assert.equal(read.counter, 2);
});

// TS-102 (US-7201): storage round-trip covers put/get/delete/list on both sql and kv backends.

test('storage round-trip covers put get delete list on both sql and kv backends (TC-102-storage-round-trip)', async () => {
  const { createInMemoryDoStorage } = await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'do-storage.mjs')).href);
  for (const backend of ['sql', 'kv']) {
    const s = createInMemoryDoStorage({ backend });
    assert.equal(s.backend, backend);
    await s.put('k/a', 'A');
    assert.equal(await s.get('k/a'), 'A');
    await s.put('p/1', 1);
    await s.put('p/2', 2);
    const list = await s.list({ prefix: 'p/' });
    assert.equal(list.size, 2);
    assert.equal(list.get('p/1'), 1);
    await s.delete('k/a');
    assert.equal(await s.get('k/a'), undefined);
  }
});

// TS-103 (US-7301): alarm fires exactly once and drains storage.

test('alarm fires exactly once and drains storage (TC-103-alarm-fires-once)', async () => {
  const { createInMemoryDoStorage } = await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'do-storage.mjs')).href);
  const { SingleCellObject } = await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'do-single-cell.mjs')).href);
  const events = [];
  const storage = createInMemoryDoStorage({ backend: 'sql' });
  const cell = new SingleCellObject({ storage, eventSink: (r) => events.push(r), name: 'a1', clock: () => 1_800_000_000_000 });
  const { scheduledTime } = await cell.setAlarm(100);
  await cell.alarm();
  const fires = events.filter((e) => e.event === 'doAlarmFired');
  assert.equal(fires.length, 1);
  assert.equal(fires[0].objectName, 'a1');
  assert.equal(fires[0].scheduledTime, scheduledTime);
  assert.equal(await storage.getAlarm(), null);
});

// TS-104 (US-7401): hub broadcast fans out to all connected clients within the elicited window.

test('hub broadcast fans out to all connected clients within the elicited window (TC-104-hub-broadcast)', async () => {
  const { createInMemoryDoStorage } = await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'do-storage.mjs')).href);
  const { HubObject } = await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'do-hub.mjs')).href);
  const { createFakeState, createFakeSocketPair } = await import(pathToFileURL(join(PROBES_DIR, 'probe-utils.mjs')).href);
  const events = [];
  const storage = createInMemoryDoStorage({ backend: 'sql' });
  const hub = new HubObject({ state: createFakeState(), storage, eventSink: (r) => events.push(r), name: 'lobby', hibernateAfterIdleMs: 500 });
  const a = createFakeSocketPair('A');
  const b = createFakeSocketPair('B');
  await hub.accept(a);
  await hub.accept(b);
  const started = Date.now();
  await hub.webSocketMessage(a, JSON.stringify({ type: 'broadcast', payload: 'ping' }));
  const elapsed = Date.now() - started;
  assert.ok(elapsed <= 500, `broadcast within 500ms; observed ${elapsed}ms`);
  assert.ok(a.inbound.some((s) => s.includes('"payload":"ping"')), 'A received broadcast');
  assert.ok(b.inbound.some((s) => s.includes('"payload":"ping"')), 'B received broadcast');
  const stored = await storage.get('lastBroadcast');
  assert.ok(stored && stored.includes('"payload":"ping"'));
});

// TS-105 (US-7402): hibernate and wake round trip preserves storage and doWakeUp fires exactly once.

test('hibernate and wake round trip preserves storage and doWakeUp fires exactly once (TC-105-hibernate-wake)', async () => {
  const { createInMemoryDoStorage } = await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'do-storage.mjs')).href);
  const { HubObject } = await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'do-hub.mjs')).href);
  const { createFakeState, createFakeSocketPair } = await import(pathToFileURL(join(PROBES_DIR, 'probe-utils.mjs')).href);
  const events = [];
  const storage = createInMemoryDoStorage({ backend: 'sql' });
  const hub = new HubObject({ state: createFakeState(), storage, eventSink: (r) => events.push(r), name: 'lobby' });
  const s = createFakeSocketPair('S');
  await hub.accept(s);
  await hub.webSocketMessage(s, JSON.stringify({ type: 'broadcast', payload: 'p' }));
  const persisted = await storage.get('lastBroadcast');
  await hub.hibernate();
  const w1 = await hub.wake();
  const w2 = await hub.wake();
  assert.equal(w1.lastBroadcast, persisted);
  assert.equal(w2.alreadyAwake, true);
  assert.equal(w2.lastBroadcast, persisted);
  const wakes = events.filter((e) => e.event === 'doWakeUp');
  assert.equal(wakes.length, 1, `doWakeUp emitted once; observed ${wakes.length}`);
});

// TS-106 (US-7501): event-secrecy result on the hub broadcast probe returns pass on the shipped path.

test('event-secrecy result on the hub broadcast probe returns pass on the shipped path (TC-106-event-secrecy)', async () => {
  const originalLeak = process.env.SIMULATE_PII_LEAK;
  delete process.env.SIMULATE_PII_LEAK;
  try {
    const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'websocket-hub-broadcast.mjs')).href)).default;
    const { results } = await runProbe();
    const secrecy = results.find((r) => r.anchorAcId === 'AC-33106-1');
    assert.ok(secrecy, 'hub broadcast probe must include an AC-33106-1 event-secrecy result');
    assert.equal(secrecy.verdict, 'pass', `AC-33106-1 verdict: ${secrecy.detail}`);
  } finally {
    if (originalLeak !== undefined) process.env.SIMULATE_PII_LEAK = originalLeak;
  }
});

// TS-107 (US-7601): sole-reader-scan probe binds and surfaces no leaks on the clean fixture.

test('sole-reader-scan probe binds and surfaces no leaks on the clean fixture (TC-107-sole-reader-scan)', async () => {
  const originalSim = process.env.SIMULATE_NON_FACADE_IMPORT;
  delete process.env.SIMULATE_NON_FACADE_IMPORT;
  try {
    const mod = await import(pathToFileURL(join(PROBES_DIR, 'sole-reader-scan.mjs')).href);
    assert.equal(mod.anchorAcId, 'AC-33107-1');
    assert.equal(mod.accountBound, false);
    const { results } = await mod.default();
    const clean = results.find((r) => r.anchorAcId === 'AC-33107-1');
    assert.ok(clean, 'sole-reader-scan probe must include an AC-33107-1 result');
    assert.equal(clean.verdict, 'pass', `AC-33107-1 clean-scan verdict: ${clean.detail}`);
  } finally {
    if (originalSim !== undefined) process.env.SIMULATE_NON_FACADE_IMPORT = originalSim;
  }
});

// TS-108 (US-7701): wrangler toml carries DO bindings and migrations tag additively over T-0 T-1 T-2 blocks.

test('wrangler toml carries DO bindings and migrations tag additively over T-0 T-1 T-2 blocks (TC-108-wrangler-do-bindings)', async () => {
  const toml = await readFile(join(FIXTURE_ROOT, 'wrangler.toml'), 'utf8');
  // T-0 preserved
  assert.match(toml, /\[assets\][\s\S]*directory = "\.\/dist"/);
  // T-1 preserved
  assert.match(toml, /\[\[kv_namespaces\]\][\s\S]*binding = "CACHE"/);
  // T-2 preserved
  assert.match(toml, /\[triggers\][\s\S]*crons = \["\* \* \* \* \*", "\*\/5 \* \* \* \*"\]/);
  // T-3 additive
  assert.match(toml, /\[\[durable_objects\.bindings\]\][\s\S]*name = "CELL"[\s\S]*class_name = "SingleCellObject"/);
  assert.match(toml, /\[\[durable_objects\.bindings\]\][\s\S]*name = "HUB"[\s\S]*class_name = "HubObject"/);
  assert.match(toml, /\[\[migrations\]\][\s\S]*tag = "v1"[\s\S]*new_classes = \["SingleCellObject", "HubObject"\]/);
});

// TS-109 (US-7002): real-account storage smoke probe records accountBoundSkipped without env var.

test('real-account storage smoke probe records accountBoundSkipped without env var (TC-109-real-account-skip)', async () => {
  const original = process.env.CI_HAS_CLOUDFLARE_ACCOUNT;
  delete process.env.CI_HAS_CLOUDFLARE_ACCOUNT;
  try {
    const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'real-account-storage-smoke.mjs')).href)).default;
    const { results, extra } = await runProbe();
    assert.equal(results.length, 1);
    assert.equal(results[0].anchorAcId, 'AC-33112-1');
    assert.equal(results[0].verdict, 'pass');
    assert.equal(extra?.accountBoundSkipped, true);
  } finally {
    if (original !== undefined) process.env.CI_HAS_CLOUDFLARE_ACCOUNT = original;
  }
});

// Blueprint shape.

test('blueprint.json declares slug, version, capabilities, elicits, contributions', async () => {
  const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(bp.slug, 'platform-cloudflare-durable-objects');
  assert.equal(bp.version, '1.0.0');
  assert.equal(bp.category, 'platform');
  assert.deepEqual(bp.capabilities, ['strongConsistencyCell', 'hibernatableWebSocket']);
  assert.equal(Array.isArray(bp.elicits), true);
  assert.equal(bp.elicits.length, 7);
  assert.equal(Array.isArray(bp.contributions), true);
  assert.equal(bp.contributions.length, 30, `expected 30 contributions (8 REQ + 12 US + 5 TAC + 5 ADR); observed ${bp.contributions.length}`);
  const kinds = bp.contributions.reduce((acc, c) => { acc[c.kind] = (acc[c.kind] ?? 0) + 1; return acc; }, {});
  assert.deepEqual(kinds, { req: 8, us: 12, tac: 5, adr: 5 });
});

test('every contribution file referenced from blueprint.json exists', async () => {
  const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  for (const c of bp.contributions) {
    const p = join(BLUEPRINT_ROOT, 'contributions', c.path);
    assert.equal(existsSync(p), true, `contribution file missing: ${p}`);
  }
});

test('README, CHANGELOG, guide, docs/topics.md exist and mention the eight REQs and seven probes', async () => {
  const readme = await readFile(README, 'utf8');
  const changelog = await readFile(CHANGELOG, 'utf8');
  const guide = await readFile(GUIDE, 'utf8');
  const topics = await readFile(OWN_TOPICS, 'utf8');
  assert.match(readme, /platform-cloudflare-durable-objects-REQ-001/);
  assert.match(readme, /platform-cloudflare-durable-objects-REQ-008/);
  assert.match(readme, /namespace-facade-ready\.mjs/);
  assert.match(readme, /websocket-hub-broadcast\.mjs/);
  assert.match(readme, /real-account-storage-smoke\.mjs/);
  assert.match(changelog, /1\.0\.0 \(2026-09-07\)/);
  assert.match(guide, /Decision tree/);
  assert.match(topics, /strongConsistencyCellContract/);
  assert.match(topics, /websocketHubContract/);
  assert.match(topics, /platform-cloudflare-durable-objects \| 33101-33899/);
});

test('shelf-wide topics.md registry row appears on application-spa', async () => {
  const spa = await readFile(SPA_TOPICS, 'utf8');
  assert.match(spa, /platform-cloudflare-durable-objects \| 33101-33899 \| 34xx \| shipped v1\.0\.0/);
});

test('section 6a of blueprint-authoring.md carries the strongConsistencyCell capability row', async () => {
  const auth = await readFile(AUTHORING, 'utf8');
  assert.match(auth, /`strongConsistencyCell` \| The applied blueprint provides a Cloudflare Durable Objects single-cell/);
});

test('section 6a of blueprint-authoring.md carries the hibernatableWebSocket capability row', async () => {
  const auth = await readFile(AUTHORING, 'utf8');
  assert.match(auth, /`hibernatableWebSocket` \| The applied blueprint provides a Cloudflare Durable Objects hibernatable WebSocket hub/);
});

test('every probe exports anchorAcId and accountBound as a boolean', async () => {
  const probeFiles = (await readdir(PROBES_DIR)).filter((f) => f.endsWith('.mjs') && !f.startsWith('run-') && f !== 'probe-utils.mjs');
  assert.equal(probeFiles.length, 7, `expected 7 probe modules; observed ${probeFiles.length}`);
  for (const f of probeFiles) {
    const mod = await import(pathToFileURL(join(PROBES_DIR, f)).href);
    assert.equal(typeof mod.anchorAcId, 'string', `probe ${f} must export anchorAcId string`);
    assert.match(mod.anchorAcId, /^AC-\d{3,}(-\d+)?$/, `probe ${f} anchorAcId ${mod.anchorAcId} must match AC id shape`);
    assert.equal(typeof mod.accountBound, 'boolean', `probe ${f} must export accountBound boolean`);
    assert.equal(typeof mod.default, 'function', `probe ${f} must default-export runProbe`);
  }
});

test('every ADR body loads and carries the expected top-level fields', async () => {
  const adrPaths = [
    'adr-3401-platform-cloudflare-durable-objects-single-cell-contract.json',
    'adr-3402-platform-cloudflare-durable-objects-websocket-hub-contract.json',
    'adr-3403-platform-cloudflare-durable-objects-storage-backend.json',
    'adr-3404-platform-cloudflare-durable-objects-migrations-shape.json',
    'adr-3405-platform-cloudflare-durable-objects-hibernation-posture.json',
  ];
  for (const p of adrPaths) {
    const adr = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'contributions', 'adrs', p), 'utf8'));
    assert.equal(adr.status, 'accepted');
    assert.equal(adr.version, '1.0.0');
    assert.equal(typeof adr.context, 'string');
    assert.equal(typeof adr.decision, 'string');
    assert.equal(typeof adr.consequences, 'string');
    // standardsTraceClause lives on the CONTRIBUTION ENTRY on blueprint.json, not on the ADR body.
    assert.equal('standardsTraceClause' in adr, false, `ADR ${p} must NOT carry standardsTraceClause on the body`);
    // scope and topic likewise live on the contribution entry.
    assert.equal('scope' in adr, false, `ADR ${p} must NOT carry scope on the body`);
    assert.equal('topic' in adr, false, `ADR ${p} must NOT carry topic on the body`);
  }
});

test('every ADR contribution entry carries a non-null standardsTraceClause on blueprint.json', async () => {
  const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  const adrEntries = bp.contributions.filter((c) => c.kind === 'adr');
  assert.equal(adrEntries.length, 5);
  for (const e of adrEntries) {
    assert.equal(typeof e.standardsTraceClause, 'string', `ADR contribution entry ${e.id} must carry standardsTraceClause`);
    assert.notEqual(e.standardsTraceClause.length, 0);
  }
});

test('two ADR entries carry scope global with the mint topics', async () => {
  const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  const globals = bp.contributions.filter((c) => c.kind === 'adr' && c.scope === 'global');
  assert.equal(globals.length, 2, `expected two scope:global ADR entries; observed ${globals.length}`);
  const topics = globals.map((g) => g.topic).sort();
  assert.deepEqual(topics, ['strongConsistencyCellContract', 'websocketHubContract']);
});

test('every probe report on disk has aggregateVerdict pass (shipped path)', async () => {
  const reportDir = join(REPO_ROOT, '.rcf', 'reports', 'blueprints', 'platform-cloudflare-durable-objects');
  if (!existsSync(reportDir)) {
    // The reports are runtime artefacts. If a fresh checkout has not run
    // the probes, the anatomy test does not fail on their absence.
    return;
  }
  const files = (await readdir(reportDir)).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const rep = JSON.parse(await readFile(join(reportDir, f), 'utf8'));
    assert.equal(rep.aggregateVerdict, 'pass', `report ${f} aggregateVerdict=${rep.aggregateVerdict}`);
  }
});
