// Anatomy + shape + probe + fixture + shelf-doc test for the
// edge-cloudflare-rate-limiting v1.0.0 blueprint (T-6 of the Cloudflare
// round 6 spec, 2026-09-06 section 5.6). Covers TS-130..137 on the
// T-6 repo chain slice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'edge-cloudflare-rate-limiting');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'cf-edge');
const MANIFEST_DIR = join(FIXTURE_ROOT, 'cloudflare', 'rate-limits');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');
const SCHEMA_PATH = join(BLUEPRINT_ROOT, 'contributions', 'schemas', 'rate-limit-rule.schema.json');
const README = join(BLUEPRINT_ROOT, 'README.md');
const CHANGELOG = join(BLUEPRINT_ROOT, 'CHANGELOG.md');
const GUIDE = join(BLUEPRINT_ROOT, 'guide', 'edge-cloudflare-rate-limiting.md');
const OWN_TOPICS = join(BLUEPRINT_ROOT, 'docs', 'topics.md');
const AUTHORING = join(REPO_ROOT, 'packages', 'rcf-lite', 'docs', 'blueprint-authoring.md');

async function runProbe(name, env = {}) {
  const modUrl = pathToFileURL(join(PROBES_DIR, `${name}.mjs`)).href + '?ts=' + Date.now();
  const mod = await import(modUrl);
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  try {
    return await mod.default();
  } finally {
    for (const [k] of Object.entries(env)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

// TS-130 (US-10001, AC-10001-1): manifest presence pass.
test('T-6 rate-limiting AC-10001-1 anatomy proof (TC-130-manifest-presence-pass)', async () => {
  const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(bp.slug, 'edge-cloudflare-rate-limiting');
  assert.equal(bp.version, '1.1.2');
  assert.equal(bp.category, 'edge');
  assert.deepEqual(bp.capabilities, ['edgeRateLimit']);
  const entries = (await readdir(MANIFEST_DIR)).filter((f) => f.endsWith('.json'));
  assert.ok(entries.length >= 1, `cloudflare/rate-limits/ holds ${entries.length} files, expected >=1`);
  for (const name of entries) {
    const doc = JSON.parse(await readFile(join(MANIFEST_DIR, name), 'utf8'));
    for (const f of ['id', 'expression', 'threshold', 'period', 'characteristics', 'action', 'duration']) {
      assert.ok(f in doc, `manifest file ${name} missing required field ${f}`);
    }
  }
  const out = await runProbe('manifest-presence');
  const bad = out.results.find((r) => r.verdict !== 'pass');
  assert.ok(!bad, `manifest-presence should pass on the shipped fixture, got: ${bad ? bad.detail : ''}`);
});

// TS-131 (US-10101, AC-10101-1): guide documents wrangler and dashboard flows plus the vendor URL.
test('T-6 rate-limiting AC-10101-1 anatomy proof (TC-131-guide-management-surface-doc)', async () => {
  const guide = await readFile(GUIDE, 'utf8');
  assert.match(guide, /## Management surface/);
  assert.match(guide, /### wrangler flow/);
  assert.match(guide, /### Cloudflare dashboard flow/);
  assert.match(guide, /https:\/\/developers\.cloudflare\.com\/waf\/rate-limiting-rules\//);
});

// TS-132 (US-10201, AC-10201-1): real-account burst probe records accountBoundSkipped without env vars.
test('T-6 rate-limiting AC-10201-1 anatomy proof (TC-132-real-account-burst-and-429-or-skipped)', async () => {
  const out = await runProbe('real-account-burst-and-429', { CI_HAS_CLOUDFLARE_ACCOUNT: 'false', CF_RATE_LIMIT_URL: '' });
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].verdict, 'pass');
  assert.equal(out.results[0].accountBoundSkipped, true);
  assert.match(out.results[0].detail, /accountBoundSkipped/);
});

// TS-133 (US-10301, AC-10301-1): drift-audit runner diffs manifest against a fake live-zone response.
test('T-6 rate-limiting AC-10301-1 anatomy proof (TC-133-drift-audit-runner-diff)', async () => {
  const runnerMod = await import(pathToFileURL(join(FIXTURE_ROOT, 'src/drift-audit-runner.mjs')).href);
  const manifestRule = {
    id: 'public-api-per-ip', expression: 'x', threshold: 60, period: 60,
    characteristics: ['ip.src'], action: 'block', duration: 60,
  };
  const liveRule = { ...manifestRule, threshold: 90 };
  const captured = [];
  const runner = runnerMod.createDriftAuditRunner({
    env: { CF_ZONE_ID: 'fixture-zone' },
    eventSink: (r) => captured.push(r),
    fetch: async () => ({ ok: true, status: 200, async json() { return { result: [liveRule] }; } }),
    clock: () => '2026-09-07T22:00:00.000Z',
    cadence: 'daily',
    manifestLoader: async () => [manifestRule],
  });
  const report = await runner.runOnce();
  assert.equal(report.driftCount, 1);
  assert.equal(captured.length, 1);
  const rec = captured[0];
  assert.equal(rec.ruleId, 'public-api-per-ip');
  assert.ok(Array.isArray(rec.diff) && rec.diff.length === 1);
  assert.equal(rec.diff[0].field, 'threshold');
  assert.equal(rec.diff[0].manifestValue, 60);
  assert.equal(rec.diff[0].liveValue, 90);
});

// TS-134 (US-10401, AC-10401-1): guide composition section names ADR-3702 and both characteristic sets.
test('T-6 rate-limiting AC-10401-1 anatomy proof (TC-134-composition-guide-section)', async () => {
  const guide = await readFile(GUIDE, 'utf8');
  assert.match(guide, /## Composition with security-auth-magic-link/);
  assert.match(guide, /ADR-3702/);
  assert.match(guide, /IP-per-URL/);
  assert.match(guide, /per-email per-minute/);
  assert.match(guide, /rcf define blueprint add \.\/blueprints\/edge-cloudflare-rate-limiting/);
});

// TS-135 (US-10601, AC-10601-1): schema-validate passes on the fixture and refuses SIMULATE_SCHEMA_INVALID.
test('T-6 rate-limiting AC-10601-1 anatomy proof (TC-135-manifest-schema-validate-pass-and-fail)', async () => {
  assert.ok(existsSync(SCHEMA_PATH), 'shipped JSON Schema present');
  const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(schema.additionalProperties, false);
  const pass = await runProbe('manifest-schema-validate');
  const bad = pass.results.find((r) => r.verdict !== 'pass');
  assert.ok(!bad, `schema-validate should pass on the shipped fixture, got: ${bad ? bad.detail : ''}`);
  const fail = await runProbe('manifest-schema-validate', { SIMULATE_SCHEMA_INVALID: 'true' });
  const failing = fail.results.find((r) => r.verdict === 'fail');
  assert.ok(failing, 'SIMULATE_SCHEMA_INVALID=true should produce a failing result');
  assert.match(failing.detail, /missing required field threshold/);
});

// TS-136 (US-10701, AC-10701-1): event-secrecy passes clean, fails under SIMULATE_EVENT_LEAK_IP.
test('T-6 rate-limiting AC-10701-1 anatomy proof (TC-136-event-secrecy-pass-and-leak)', async () => {
  const clean = await runProbe('event-secrecy');
  const badClean = clean.results.find((r) => r.verdict !== 'pass');
  assert.ok(!badClean, `event-secrecy should pass clean, got: ${badClean ? badClean.detail : ''}`);
  const leak = await runProbe('event-secrecy', { SIMULATE_EVENT_LEAK_IP: 'true' });
  const badLeak = leak.results.find((r) => r.verdict === 'fail');
  assert.ok(badLeak, 'SIMULATE_EVENT_LEAK_IP=true should produce a failing result');
  assert.match(badLeak.detail, /leaked a full IP address/);
});

// TS-137 (US-10801, AC-10801-1): manifest-presence refuses a missing file under SIMULATE_MANIFEST_MISSING.
test('T-6 rate-limiting AC-10801-1 anatomy proof (TC-137-manifest-presence-missing-fail)', async () => {
  const out = await runProbe('manifest-presence', { SIMULATE_MANIFEST_MISSING: 'true' });
  const failing = out.results.find((r) => r.verdict === 'fail');
  assert.ok(failing, 'SIMULATE_MANIFEST_MISSING=true should produce a failing result');
  assert.match(failing.detail, /manifest file missing/);
  assert.equal(failing.anchorAcId, 'AC-36108-1');
});

// Shelf-doc anatomy: section 6a table has the edgeRateLimit row, own topics.md carries edgeThrottleContract, CHANGELOG and README exist, no em-dashes anywhere in the blueprint tree.
test('T-6 shelf-doc anatomy: 6a table row, topics.md row, no em-dashes in the blueprint tree', async () => {
  const authoring = await readFile(AUTHORING, 'utf8');
  assert.ok(/^\| `edgeRateLimit` \| /m.test(authoring), 'section 6a edgeRateLimit row present');
  const topics = await readFile(OWN_TOPICS, 'utf8');
  assert.match(topics, /`edgeThrottleContract`/);
  assert.match(topics, /^\| edge-cloudflare-rate-limiting \| 36101-36899 \| 37xx \| shipped v1\.0\.0 \|/m);
  const readme = await readFile(README, 'utf8');
  assert.match(readme, /accountBoundSkipped/);
  const changelog = await readFile(CHANGELOG, 'utf8');
  assert.match(changelog, /## 1\.0\.0/);
  // No em-dashes in the blueprint tree.
  async function walk(root) {
    const out = [];
    for (const name of await readdir(root, { withFileTypes: true })) {
      const p = join(root, name.name);
      if (name.isDirectory()) out.push(...await walk(p));
      else if (name.isFile()) out.push(p);
    }
    return out;
  }
  const files = await walk(BLUEPRINT_ROOT);
  for (const f of files) {
    const t = await readFile(f, 'utf8');
    assert.ok(!/\u2014/.test(t), `em-dash found in ${f}`);
  }
});
