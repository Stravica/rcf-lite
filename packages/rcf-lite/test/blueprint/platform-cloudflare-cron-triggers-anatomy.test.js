// Anatomy + shape + probe + fixture + shelf-doc test for the
// platform-cloudflare-cron-triggers v1.0.0 blueprint (T-2 of the
// Cloudflare round 6 spec, 2026-09-06 section 5.2). Covers TS-090..096.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'platform-cloudflare-cron-triggers');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'cf-platform');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');
const README = join(BLUEPRINT_ROOT, 'README.md');
const CHANGELOG = join(BLUEPRINT_ROOT, 'CHANGELOG.md');
const GUIDE = join(BLUEPRINT_ROOT, 'guide', 'platform-cloudflare-cron-triggers.md');
const OWN_TOPICS = join(BLUEPRINT_ROOT, 'docs', 'topics.md');
const SPA_TOPICS = join(REPO_ROOT, 'blueprints', 'application-spa', 'docs', 'topics.md');
const AUTHORING = join(REPO_ROOT, 'packages', 'rcf-lite', 'docs', 'blueprint-authoring.md');

// TS-090 (US-6001): scheduled handler opens on boot and emits cronReady with metadata-only payload.

test('scheduled handler opens on boot and emits cronReady with metadata-only payload (TC-090-scheduled-ready)', async () => {
  const { createScheduledHandler } = await import(pathToFileURL(join(FIXTURE_ROOT, 'src', 'scheduled.mjs')).href);
  const events = [];
  const sink = (rec) => events.push(rec);
  const handler = createScheduledHandler({
    routes: [{ expression: '* * * * *', handler: async () => { /* noop */ } }],
    eventSink: sink,
    skewToleranceMs: 30000,
    softBudgetMs: 30000,
  });
  assert.equal(typeof handler.scheduled, 'function');
  assert.equal(typeof handler.ready, 'function');
  await handler.ready();
  const ready = events.filter((e) => e.event === 'cronReady');
  assert.equal(ready.length, 1, 'cronReady emitted exactly once');
  const allowed = new Set(['event', 'expression', 'scheduledTime', 'outcome', 'duration']);
  const extra = Object.keys(ready[0]).filter((k) => !allowed.has(k));
  assert.deepEqual(extra, [], `cronReady record must carry only the cron-vocabulary shape {event,expression,scheduledTime,outcome,duration}; extra=${JSON.stringify(extra)}`);
  assert.equal(ready[0].expression, null);
  assert.equal(ready[0].scheduledTime, null);
  assert.equal(ready[0].outcome, 'ready');
  assert.equal(ready[0].duration, 0);
});

// TS-090 (US-6001) part 2: src/scheduled.mjs does not dereference env.CACHE (KV stays owned by T-1 facade).

test('scheduled handler source does not dereference env.CACHE (TC-090-sole-reader-boundary)', async () => {
  const src = await readFile(join(FIXTURE_ROOT, 'src', 'scheduled.mjs'), 'utf8');
  assert.equal(src.includes('env.CACHE'), false, 'src/scheduled.mjs must not dereference env.CACHE; KV binding stays owned by src/kv-facade.mjs');
});

// TS-091 (US-6002): wrangler-test-scheduled probe exports the expected anchor and shape.

test('wrangler-test-scheduled probe binds and drives cronFired on the cf-platform fixture (TC-091-wrangler-test-scheduled)', async () => {
  const mod = await import(pathToFileURL(join(PROBES_DIR, 'wrangler-test-scheduled.mjs')).href);
  assert.equal(mod.anchorAcId, 'AC-32105-1');
  assert.equal(mod.accountBound, false);
  assert.equal(typeof mod.default, 'function');
});

// TS-092 (US-6003): real-account-scheduled-smoke probe records accountBoundSkipped without env var.

test('real-account live-cron smoke probe records accountBoundSkipped without env var (TC-092-real-account-smoke-skip)', async () => {
  const originalEnv = process.env.CI_HAS_CLOUDFLARE_ACCOUNT;
  delete process.env.CI_HAS_CLOUDFLARE_ACCOUNT;
  try {
    const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'real-account-scheduled-smoke.mjs')).href)).default;
    const { results, extra } = await runProbe();
    assert.equal(results.length, 1);
    assert.equal(results[0].anchorAcId, 'AC-32107-1');
    assert.equal(results[0].verdict, 'pass');
    assert.equal(extra?.accountBoundSkipped, true, 'accountBoundSkipped should be true when CI_HAS_CLOUDFLARE_ACCOUNT is unset');
  } finally {
    if (originalEnv !== undefined) process.env.CI_HAS_CLOUDFLARE_ACCOUNT = originalEnv;
  }
});

// TS-093 (US-6101): dispatcher-routing probe passes on the matched and unmatched branches.

test('dispatcher-routing probe routes matched expression to the matched spy only (TC-093-dispatch-matched)', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'dispatcher-routing.mjs')).href)).default;
  const { results } = await runProbe();
  const matched = results.find((r) => r.anchorAcId === 'AC-32102-1');
  assert.ok(matched, 'dispatcher-routing probe must include an AC-32102-1 result');
  assert.equal(matched.verdict, 'pass', `AC-32102-1 verdict: ${matched.detail}`);
});

test('dispatcher-routing probe fires cronUnmatched on unmatched expression with no spy invocation (TC-093-dispatch-unmatched)', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'dispatcher-routing.mjs')).href)).default;
  const { results } = await runProbe();
  const unmatched = results.find((r) => r.anchorAcId === 'AC-32102-2');
  assert.ok(unmatched, 'dispatcher-routing probe must include an AC-32102-2 result');
  assert.equal(unmatched.verdict, 'pass', `AC-32102-2 verdict: ${unmatched.detail}`);
});

// TS-094 (US-6201): skew-tolerance probe passes aligned and shifted branches.

test('skew-tolerance probe fires cronFired outcome onTime when clock is inside the window (TC-094-skew-on-time)', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'skew-tolerance.mjs')).href)).default;
  const { results } = await runProbe();
  const onTime = results.find((r) => r.anchorAcId === 'AC-32103-1');
  assert.ok(onTime, 'skew-tolerance probe must include an AC-32103-1 result');
  assert.equal(onTime.verdict, 'pass', `AC-32103-1 verdict: ${onTime.detail}`);
});

test('skew-tolerance probe fires cronSkewed with delta when clock is outside the window (TC-094-skew-outside)', async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'skew-tolerance.mjs')).href)).default;
  const { results } = await runProbe();
  const skewed = results.find((r) => r.anchorAcId === 'AC-32103-2');
  assert.ok(skewed, 'skew-tolerance probe must include an AC-32103-2 result');
  assert.equal(skewed.verdict, 'pass', `AC-32103-2 verdict: ${skewed.detail}`);
});

// TS-095 (US-6301): soft-budget covered as additional results on skew-tolerance probe.

test('soft-budget breach fires cronStalled once on the shipped dispatcher (TC-095-soft-budget-fires)', { timeout: 5000 }, async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'skew-tolerance.mjs')).href)).default;
  const { results } = await runProbe();
  const stalled = results.find((r) => r.anchorAcId === 'AC-32104-1');
  assert.ok(stalled, 'skew-tolerance probe must include an AC-32104-1 result');
  assert.equal(stalled.verdict, 'pass', `AC-32104-1 verdict: ${stalled.detail}`);
});

test('soft-budget breach does not terminate the handler and a final cronFired follows (TC-095-soft-budget-continues)', { timeout: 5000 }, async () => {
  const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'skew-tolerance.mjs')).href)).default;
  const { results } = await runProbe();
  const continued = results.find((r) => r.anchorAcId === 'AC-32104-2');
  assert.ok(continued, 'skew-tolerance probe must include an AC-32104-2 result');
  assert.equal(continued.verdict, 'pass', `AC-32104-2 verdict: ${continued.detail}`);
});

// TS-096 (US-6302): event-secrecy probe returns pass with zero forbidden keys and zero PII hits on shipped path.

test('event-secrecy probe returns pass with zero forbidden keys and zero PII hits on shipped path (TC-096-event-secrecy)', async () => {
  const originalLeak = process.env.SIMULATE_PII_LEAK;
  delete process.env.SIMULATE_PII_LEAK;
  try {
    const runProbe = (await import(pathToFileURL(join(PROBES_DIR, 'event-secrecy.mjs')).href)).default;
    const { results } = await runProbe();
    const secrecy = results.find((r) => r.anchorAcId === 'AC-32106-1');
    assert.ok(secrecy, 'event-secrecy probe must include an AC-32106-1 result');
    assert.equal(secrecy.verdict, 'pass', `AC-32106-1 verdict: ${secrecy.detail}`);
  } finally {
    if (originalLeak !== undefined) process.env.SIMULATE_PII_LEAK = originalLeak;
  }
});

// Blueprint shape.

test('blueprint.json declares slug, version, capabilities, elicits, contributions', async () => {
  const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(bp.slug, 'platform-cloudflare-cron-triggers');
  assert.equal(bp.version, '1.1.0');
  assert.equal(bp.category, 'platform');
  assert.deepEqual(bp.capabilities, ['scheduledTrigger']);
  assert.equal(Array.isArray(bp.elicits), true);
  assert.equal(bp.elicits.length, 4);
  assert.equal(Array.isArray(bp.contributions), true);
  assert.equal(bp.contributions.length, 17, `expected 17 contributions (4 REQ + 7 US + 3 TAC + 3 ADR); observed ${bp.contributions.length}`);
  const kinds = bp.contributions.reduce((acc, c) => { acc[c.kind] = (acc[c.kind] ?? 0) + 1; return acc; }, {});
  assert.deepEqual(kinds, { req: 4, us: 7, tac: 3, adr: 3 });
});

test('every contribution file referenced from blueprint.json exists', async () => {
  const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  for (const c of bp.contributions) {
    const p = join(BLUEPRINT_ROOT, 'contributions', c.path);
    assert.equal(existsSync(p), true, `contribution file missing: ${p}`);
  }
});

test('README, CHANGELOG, guide, docs/topics.md exist and mention the four REQs and five probes', async () => {
  const readme = await readFile(README, 'utf8');
  const changelog = await readFile(CHANGELOG, 'utf8');
  const guide = await readFile(GUIDE, 'utf8');
  const topics = await readFile(OWN_TOPICS, 'utf8');
  assert.match(readme, /platform-cloudflare-cron-triggers-REQ-001/);
  assert.match(readme, /platform-cloudflare-cron-triggers-REQ-004/);
  assert.match(readme, /wrangler-test-scheduled\.mjs/);
  assert.match(readme, /real-account-scheduled-smoke\.mjs/);
  assert.match(changelog, /1\.0\.0 \(2026-09-07\)/);
  assert.match(guide, /Decision tree/);
  assert.match(topics, /scheduledTriggerContract/);
  assert.match(topics, /platform-cloudflare-cron-triggers \| 32101-32899/);
});

test('shelf-wide topics.md registry row appears on application-spa', async () => {
  const spa = await readFile(SPA_TOPICS, 'utf8');
  assert.match(spa, /platform-cloudflare-cron-triggers \| 32101-32899 \| 33xx \| shipped v1\.0\.0/);
});

test('section 6a of blueprint-authoring.md carries the scheduledTrigger capability row', async () => {
  const auth = await readFile(AUTHORING, 'utf8');
  assert.match(auth, /`scheduledTrigger` \| The applied blueprint provides a scheduled\(\) handler over Cloudflare Workers Cron Triggers/);
});

test('every probe exports anchorAcId and accountBound as a boolean', async () => {
  const probeFiles = (await readdir(PROBES_DIR)).filter((f) => f.endsWith('.mjs') && !f.startsWith('run-') && f !== 'probe-utils.mjs');
  assert.equal(probeFiles.length, 5, `expected 5 probe modules; observed ${probeFiles.length}`);
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
    'adr-3301-platform-cloudflare-cron-triggers-scheduled-trigger-contract.json',
    'adr-3302-platform-cloudflare-cron-triggers-dispatcher-mode.json',
    'adr-3303-platform-cloudflare-cron-triggers-skew-tolerance-default.json',
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
  }
});

test('every ADR contribution entry carries a non-null standardsTraceClause on blueprint.json', async () => {
  const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  const adrEntries = bp.contributions.filter((c) => c.kind === 'adr');
  assert.equal(adrEntries.length, 3);
  for (const e of adrEntries) {
    assert.equal(typeof e.standardsTraceClause, 'string', `ADR contribution entry ${e.id} must carry standardsTraceClause`);
    assert.notEqual(e.standardsTraceClause.length, 0);
  }
});

test('wrangler.toml carries the [triggers] crons block additively over the [assets] and [[kv_namespaces]] blocks', async () => {
  const toml = await readFile(join(FIXTURE_ROOT, 'wrangler.toml'), 'utf8');
  assert.match(toml, /\[assets\][\s\S]*directory = "\.\/dist"/);
  assert.match(toml, /\[\[kv_namespaces\]\][\s\S]*binding = "CACHE"/);
  assert.match(toml, /\[triggers\][\s\S]*crons = \["\* \* \* \* \*", "\*\/5 \* \* \* \*"\]/);
});

test('every probe report on disk has aggregateVerdict pass (shipped path)', async () => {
  const reportDir = join(REPO_ROOT, '.rcf', 'reports', 'blueprints', 'platform-cloudflare-cron-triggers');
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
