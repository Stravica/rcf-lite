// Anatomy + shape + probe + fixture + shelf-doc test for the
// platform-docker-compose-host blueprint (Hetzner shipped spec,
// 2026-09-07 section 5.6). Enforces the strict inline row shape at
// the shelf and the v1.1.x pins.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'platform-docker-compose-host');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'hetzner-throwaway-server');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');
const COMPOSE = join(FIXTURE_ROOT, 'compose.yaml');
const CADDYFILE = join(FIXTURE_ROOT, 'caddy', 'Caddyfile');
const SECRET = join(FIXTURE_ROOT, 'secrets', 'web-token');
const README = join(BLUEPRINT_ROOT, 'README.md');
const CHANGELOG = join(BLUEPRINT_ROOT, 'CHANGELOG.md');
const GUIDE = join(BLUEPRINT_ROOT, 'guide', 'platform-docker-compose-host.md');
const OWN_TOPICS = join(BLUEPRINT_ROOT, 'docs', 'topics.md');
const AUTHORING = join(REPO_ROOT, 'packages', 'rcf-lite', 'docs', 'blueprint-authoring.md');

async function runProbe(name, env = {}) {
  const modUrl = pathToFileURL(join(PROBES_DIR, `${name}.mjs`)).href + '?ts=' + Date.now() + Math.random();
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

// Strict inline row shape (semantic, not key-name allow-list):
//   (a) an honest skip: accountBoundSkipped === true AND reason is
//       exactly one of the declared gate variables in the fixture
//       README env-var table for this blueprint, OR
//   (b) evidence carries BOTH a non-empty ENGINE-MINTED IDENTIFIER
//       and a non-empty DERIVED OBSERVATION.
//
// Engine-minted identifier: one of a small explicit set of fields
// whose value is minted by the engine or vendor that produced the
// row (a vendor-returned server / snapshot / firewall / image /
// container id, an engine request id, or the 64-hex Docker
// container id from `docker inspect`) with a non-empty value; OR a
// supplied/echo pair, where the row carries `supplied<Name>` and a
// matching `echoed<Name>` field, both non-empty and strictly equal.
//
// A hash the probe itself computes over an artefact it read is NOT
// an identifier; event names, file paths, service names, manifest
// names, container names Compose or the probe chose, and other
// probe inputs count only as derived context, never as the
// identifier or the observation. Rows on offline probes
// (validators, source-tree scans) that have no engine-minted
// identifier are honest `conformanceOnly` rows naming the shipped
// AC clause they do not observe; identity and observation checks
// apply to anchored rows only.
//
// Derived observation: a body excerpt, status code, observed mode,
// engine timestamp, non-zero count, or structured engine-returned
// object.
//
//   `notObservableHere` is reserved for browser-only ACs. The
//   platform-docker-compose-host blueprint has no browser-only ACs,
//   so BROWSER_ONLY_ACS is EMPTY and any notObservableHere row
//   FAILS. `conformanceOnly` rows must carry a `limitation` string
//   whose first token is a shipped AC id.
// A row that only carries `{probeName, reason}` never counts, and a
// numeric identity value of zero is not an observation.
const ENGINE_MINTED_ID_FIELDS = new Set([
  // Vendor-returned or resource ids minted by the vendor / mock /
  // engine that produced the row. `containerId` is the 64-hex
  // Docker container id from `docker inspect`, never the service
  // or container name Compose chose.
  'id', 'serverId', 'snapshotId', 'firewallId', 'imageId',
  'containerId', 'requestId', 'vendorRequestId', 'resourceId',
]);
const DERIVED_OBSERVATION_FIELDS = new Set([
  // Textual samples / excerpts
  'bodyExcerpt', 'tailExcerpt', 'snippet', 'renderHashSample', 'tail',
  // Vendor-return field values (concrete observed values)
  'primaryIpv4', 'location', 'serverType',
  // Numeric derived values (non-zero required by isNonEmpty)
  'statusCode', 'mode', 'wallClockTime', 'renderedByteLength', 'exitStatus',
  'reloadDurationMs', 'overlapCount', 'twoXx', 'total', 'drops', 'expectedTotal',
  'elicitedTimeoutSeconds', 'elicitedReloadWindowSeconds', 'elicitedReloadWindowMs',
  'burstDurationMs', 'eventCount', 'fileCount',
  // Structured derived observations (non-empty required by isNonEmpty)
  'payloadKeys', 'observedKeys', 'presentBlocks', 'missingBlocks', 'sourceIps',
  'ruleNames', 'observedDrivers', 'observedBinding', 'observedEvents', 'eventTrail',
  'headers', 'healthcheckKeys', 'requiredFields', 'shippedEnum',
  'allowedKeysByEvent', 'unexpectedKeys', 'leaks',
  'discoveredConfigSources', 'consumingServices', 'declaredMode',
  'declaredServices', 'observedNames',
  'observedSecretModes', 'baselineChecks', 'sshReadiness', 'cloudInit', 'teardown',
  'warm', 'burst', 'composeDown', 'onServer', 'onServerRoot', 'external',
  'postTeardownServerIds', 'unhealthyServices', 'missingServices',
  'observed', 'dockerVersion', 'driver', 'restart', 'ports', 'port',
  'direction', 'protocol', 'clockDomain',
]);
// The platform-docker-compose-host blueprint ships process/live-
// observable ACs only; no browser-only rendering is in scope. This
// set is EMPTY so any notObservableHere row FAILS anatomy.
const BROWSER_ONLY_ACS = new Set();
// Declared gate variables (fixture README env-vars section);
// accountBoundSkipped reason must be exactly one of these.
const DECLARED_SKIP_VARS = new Set([
  'CI_HAS_HETZNER_ACCOUNT', 'HCLOUD_TOKEN', 'GITHUB_RUN_ID',
  'RCF_LITE_CI_SSH_KEY', 'RCF_LITE_CI_SSH_KEY_NAME',
  'REVERSE_PROXY', 'LOG_DRIVER', 'RELOAD_WINDOW_SECONDS',
  'WEB_APP_NAME', 'WEB_LISTEN_PORT', 'WEB_HEALTH_PATH',
  'COMPOSE_UP_TIMEOUT_SECONDS',
]);
// Shipped ACs for this blueprint, loaded from the user stories at
// test start-up so conformanceOnly rows can be checked against the
// concrete set rather than a regex-only match.
let SHIPPED_ACS = null;
async function loadShippedAcs() {
  if (SHIPPED_ACS) return SHIPPED_ACS;
  const dir = join(BLUEPRINT_ROOT, 'contributions', 'user-stories');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const acs = new Set();
  for (const f of files) {
    const doc = JSON.parse(await readFile(join(dir, f), 'utf8'));
    for (const ac of doc.acceptanceCriteria || []) if (ac && ac.id) acs.add(ac.id);
  }
  SHIPPED_ACS = acs;
  return acs;
}
function isNonEmpty(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  if (typeof v === 'boolean') return v === true;
  return false;
}
async function assertRowsCarry7dShape(rows, label) {
  assert.ok(Array.isArray(rows) && rows.length > 0, `${label}: no results returned`);
  const shipped = await loadShippedAcs();
  for (const r of rows) {
    if (r.accountBoundSkipped === true) {
      assert.equal(typeof r.reason, 'string', `${label}: skip row must carry a string reason: ${JSON.stringify(r).slice(0, 300)}`);
      assert.ok(DECLARED_SKIP_VARS.has(r.reason), `${label}: skip reason ${JSON.stringify(r.reason)} is not a declared gate variable in the fixture README env-vars section: ${JSON.stringify(r).slice(0, 300)}`);
      continue;
    }
    if (r.notObservableHere) {
      const ac = r.notObservableHere && r.notObservableHere.ac;
      assert.ok(BROWSER_ONLY_ACS.has(ac), `${label}: notObservableHere is reserved for browser-only ACs; platform-docker-compose-host has NONE, so any notObservableHere row FAILS anatomy. Row claims ac=${JSON.stringify(ac)}: ${JSON.stringify(r).slice(0, 300)}`);
    }
    if (r.conformanceOnly) {
      assert.equal(typeof r.limitation, 'string', `${label}: conformanceOnly row must carry a limitation string: ${JSON.stringify(r).slice(0, 300)}`);
      assert.equal(r.anchorAcId, null, `${label}: conformanceOnly row must carry anchorAcId: null: ${JSON.stringify(r).slice(0, 300)}`);
      const m = r.limitation.match(/^(AC-[A-Za-z0-9-]+)\b/);
      assert.ok(m, `${label}: conformanceOnly limitation must start with a shipped AC id token; got ${JSON.stringify(r.limitation).slice(0, 200)}`);
      assert.ok(shipped.has(m[1]), `${label}: conformanceOnly limitation names ${m[1]}, which is not a shipped AC on platform-docker-compose-host`);
      // conformanceOnly rows attest to a limitation, not a live
      // observation; identity and observation checks are for
      // anchored rows only.
      continue;
    }
    const ev = (r.evidence && typeof r.evidence === 'object') ? r.evidence : {};
    const engineIdKeysPresent = Object.keys(ev).filter((k) => ENGINE_MINTED_ID_FIELDS.has(k) && isNonEmpty(ev[k]));
    const suppliedEchoPair = findSuppliedEchoPair(ev);
    const observationKeysPresent = Object.keys(ev).filter((k) => DERIVED_OBSERVATION_FIELDS.has(k) && isNonEmpty(ev[k]));
    const hasIdentity = engineIdKeysPresent.length > 0 || suppliedEchoPair !== null;
    assert.ok(hasIdentity, `${label}: row evidence lacks an engine-minted identifier (vendor / resource id, engine request id, or a 64-hex Docker container id from docker inspect) AND lacks a supplied/echo pair with equality; keys observed: ${Object.keys(ev).join(', ')} : ${JSON.stringify(r).slice(0, 400)}`);
    assert.ok(observationKeysPresent.length > 0, `${label}: row evidence lacks a derived observation (excerpt, statusCode, mode, engine timestamp, non-zero count, or structured engine-returned object); keys observed: ${Object.keys(ev).join(', ')} : ${JSON.stringify(r).slice(0, 400)}`);
  }
}

// A supplied/echo pair is any `supplied<Name>` field paired with a
// matching `echoed<Name>` field where both are non-empty and
// strictly equal. Deep equality via JSON stringify covers arrays and
// plain objects.
function findSuppliedEchoPair(ev) {
  for (const k of Object.keys(ev)) {
    if (!k.startsWith('supplied') || k.length <= 'supplied'.length) continue;
    const echoKey = 'echoed' + k.slice('supplied'.length);
    if (!(echoKey in ev)) continue;
    const a = ev[k];
    const b = ev[echoKey];
    if (!isNonEmpty(a) || !isNonEmpty(b)) continue;
    const aRep = typeof a === 'object' ? JSON.stringify(a) : a;
    const bRep = typeof b === 'object' ? JSON.stringify(b) : b;
    if (aRep === bRep) return { key: k, echoKey };
  }
  return null;
}

test('platform-docker-compose-host AC-12001-1 compose layout shape valid', async () => {
  const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(bp.slug, 'platform-docker-compose-host');
  assert.equal(bp.version, '1.1.8');
  assert.equal(bp.category, 'platform');
  assert.deepEqual(bp.capabilities, ['containerHost']);
  const text = await readFile(COMPOSE, 'utf8');
  assert.match(text, /^\s{2}web:\s*$/m, 'compose.yaml declares the web service');
  assert.match(text, /^\s{2}caddy:\s*$/m, 'compose.yaml declares the caddy service');
  assert.match(text, /^networks:\s*$/m, 'compose.yaml declares top-level networks');
  assert.match(text, /^\s{2}web-net:\s*$/m, 'compose.yaml declares web-net named network');
  assert.match(text, /^volumes:\s*$/m, 'compose.yaml declares top-level volumes');
  assert.match(text, /^\s{2}web-data:\s*\{\}\s*$/m, 'compose.yaml declares web-data named volume');
  assert.match(text, /env_file:\s*\n\s+-\s+\.env/, 'compose.yaml references .env via env_file');
});

test('platform-docker-compose-host AC-12101-1 secrets file mount shape', async () => {
  const text = await readFile(COMPOSE, 'utf8');
  assert.match(text, /^secrets:\s*$/m, 'compose.yaml declares top-level secrets');
  assert.match(text, /^\s{2}web-token:\s*\n\s+file:\s+\.\/secrets\/web-token/m, 'web-token secret has file: source');
  assert.match(text, /^\s{4}secrets:\s*\n\s+-\s+source:\s+web-token[\s\S]+?\n\s+mode:\s+0?400/m, 'web service references web-token via long-form secrets: with mode 0400');
  const secretPresent = await readFile(SECRET, 'utf8');
  assert.ok(secretPresent.length > 0, 'fixture secret file exists');
});

test('platform-docker-compose-host AC-12102-1 secrets-as-files scan fails on plaintext', async () => {
  const clean = await runProbe('secrets-as-files-scan');
  await assertRowsCarry7dShape(clean.results, 'secrets-as-files clean');
  assert.ok(!clean.results.some((r) => r.verdict === 'fail'), `expected clean scan to pass, got: ${JSON.stringify(clean.results, null, 2)}`);
  const mutated = await runProbe('secrets-as-files-scan', { SIMULATE_PLAINTEXT_SECRET: 'true' });
  await assertRowsCarry7dShape(mutated.results, 'secrets-as-files mutated');
  const fail = mutated.results.find((r) => r.verdict === 'fail' && r.detail.includes('plaintext secret literal'));
  assert.ok(fail, `expected mutation to fail with plaintext-literal detail, got: ${JSON.stringify(mutated.results, null, 2)}`);
});

test('platform-docker-compose-host AC-12201-1 compose-config-lint refuses missing healthcheck', async () => {
  const clean = await runProbe('compose-config-lint');
  await assertRowsCarry7dShape(clean.results, 'compose-config-lint clean');
  assert.ok(!clean.results.some((r) => r.verdict === 'fail'), `expected canonical compose-config-lint to pass, got: ${JSON.stringify(clean.results.filter((r) => r.verdict === 'fail'), null, 2)}`);
  const mutated = await runProbe('compose-config-lint', { SIMULATE_MISSING_HEALTHCHECK: 'true' });
  await assertRowsCarry7dShape(mutated.results, 'compose-config-lint mutated');
  const fail = mutated.results.find((r) => r.verdict === 'fail' && r.detail.includes('missing a healthcheck'));
  assert.ok(fail, `expected SIMULATE_MISSING_HEALTHCHECK to fail with missing-healthcheck detail, got: ${JSON.stringify(mutated.results, null, 2)}`);
});

test('platform-docker-compose-host AC-12202-1 real-account-minimal-stack-up declared and skipped shape', async () => {
  const modUrl = pathToFileURL(join(PROBES_DIR, 'real-account-minimal-stack-up.mjs')).href;
  const mod = await import(modUrl);
  assert.equal(mod.accountBound, true);
  assert.equal(mod.anchorAcId, 'AC-composeHost-upClean');
  const saved = process.env.CI_HAS_HETZNER_ACCOUNT;
  delete process.env.CI_HAS_HETZNER_ACCOUNT;
  try {
    const out = await mod.default();
    await assertRowsCarry7dShape(out.results, 'minimal-stack-up skip');
    const skipped = out.results.find((r) => r.accountBoundSkipped === true);
    assert.ok(skipped, `expected accountBoundSkipped record without CI_HAS_HETZNER_ACCOUNT, got ${JSON.stringify(out.results)}`);
    assert.equal(skipped.reason, 'CI_HAS_HETZNER_ACCOUNT');
  } finally {
    if (saved !== undefined) process.env.CI_HAS_HETZNER_ACCOUNT = saved;
  }
});

test('platform-docker-compose-host AC-12301-1 restart discipline lint refuses unclassified', async () => {
  const mutated = await runProbe('compose-config-lint', { SIMULATE_UNCLASSIFIED_RESTART: 'true' });
  await assertRowsCarry7dShape(mutated.results, 'compose-config-lint restart mutated');
  const fail = mutated.results.find((r) => r.verdict === 'fail' && r.detail.includes('restart: always'));
  assert.ok(fail, `expected SIMULATE_UNCLASSIFIED_RESTART to fail with restart: always detail, got: ${JSON.stringify(mutated.results, null, 2)}`);
});

test('platform-docker-compose-host AC-12401-1 caddyfile-validate refuses invalid directive', async () => {
  const cf = await readFile(CADDYFILE, 'utf8');
  assert.match(cf, /reverse_proxy web:8080/, 'Caddyfile references the web service');
  const clean = await runProbe('caddyfile-validate');
  await assertRowsCarry7dShape(clean.results, 'caddyfile-validate clean');
  const noFail = !clean.results.some((r) => r.verdict === 'fail');
  assert.ok(noFail, `expected canonical caddyfile-validate not to fail; got: ${JSON.stringify(clean.results, null, 2)}`);
  // Bind-mount read-only de-claim for AC-38107-4 lands on the
  // clean pass as a conformanceOnly row (offline validators have
  // no engine-minted identifier under v1.1.8 semantic anatomy).
  assert.ok(clean.results.some((r) => r.conformanceOnly === true && typeof r.limitation === 'string' && r.limitation.startsWith('AC-38107-4') && r.verdict === 'pass'), 'caddyfile-validate must emit a read-only bind-mount conformanceOnly row limitating AC-38107-4 (pass)');
});

test('platform-docker-compose-host AC-12402-1 real-account-reload-burst declared and skipped shape', async () => {
  const modUrl = pathToFileURL(join(PROBES_DIR, 'real-account-reload-burst.mjs')).href;
  const mod = await import(modUrl);
  assert.equal(mod.accountBound, true);
  assert.equal(mod.anchorAcId, 'AC-composeHost-zeroDowntimeReload');
  const saved = process.env.CI_HAS_HETZNER_ACCOUNT;
  delete process.env.CI_HAS_HETZNER_ACCOUNT;
  try {
    const out = await mod.default();
    await assertRowsCarry7dShape(out.results, 'reload-burst skip');
    const skipped = out.results.find((r) => r.accountBoundSkipped === true);
    assert.ok(skipped, `expected accountBoundSkipped record without CI_HAS_HETZNER_ACCOUNT`);
    assert.equal(skipped.reason, 'CI_HAS_HETZNER_ACCOUNT');
  } finally {
    if (saved !== undefined) process.env.CI_HAS_HETZNER_ACCOUNT = saved;
  }
});

test('platform-docker-compose-host AC-12501-1 log driver classification', async () => {
  const mutated = await runProbe('compose-config-lint', { SIMULATE_UNCLASSIFIED_LOG_DRIVER: 'true' });
  await assertRowsCarry7dShape(mutated.results, 'compose-config-lint log-driver mutated');
  const fail = mutated.results.find((r) => r.verdict === 'fail' && r.detail.includes("logging driver 'syslog'"));
  assert.ok(fail, `expected SIMULATE_UNCLASSIFIED_LOG_DRIVER to fail naming syslog, got: ${JSON.stringify(mutated.results, null, 2)}`);
});

test('platform-docker-compose-host anatomy: README, CHANGELOG, guide and docs/topics.md land with expected contents', async () => {
  const readme = await readFile(README, 'utf8');
  assert.match(readme, /platform-docker-compose-host v1\.0\.0/);
  assert.match(readme, /containerHost/);
  const changelog = await readFile(CHANGELOG, 'utf8');
  assert.match(changelog, /^## 1\.0\.0/m);
  const guide = await readFile(GUIDE, 'utf8');
  assert.match(guide, /When to reach for Caddy vs Traefik vs none/);
  assert.match(guide, /reject; it shadows what the blueprints contract and adds its own DB and UI as a second source of state/);
  const topics = await readFile(OWN_TOPICS, 'utf8');
  assert.match(topics, /\| platform-docker-compose-host \| 38101-38899/);
  const authoring = await readFile(AUTHORING, 'utf8');
  assert.match(authoring, /\| `containerHost` \|/, 'blueprint-authoring section 6a gains the containerHost row');
});

test('platform-docker-compose-host v1.1.4 env vars declared and compose-stack driver wired', async () => {
  const readme = await readFile(join(FIXTURE_ROOT, 'README.md'), 'utf8');
  const section = readme.split('## Declared env vars (platform-docker-compose-host probes)')[1] || '';
  assert.ok(section.length > 0, 'fixture README is missing the platform-docker-compose-host declared env vars section');
  for (const v of [
    'CI_HAS_HETZNER_ACCOUNT', 'HCLOUD_TOKEN', 'GITHUB_RUN_ID',
    'RCF_LITE_CI_SSH_KEY', 'RCF_LITE_CI_SSH_KEY_NAME',
    'REVERSE_PROXY', 'LOG_DRIVER', 'RELOAD_WINDOW_SECONDS',
    'WEB_APP_NAME', 'WEB_LISTEN_PORT', 'WEB_HEALTH_PATH',
  ]) {
    assert.ok(section.includes('`' + v + '`'), 'platform-docker-compose-host declared env vars table missing ' + v);
  }
  const stackUpSkip = await runProbe('real-account-minimal-stack-up', { CI_HAS_HETZNER_ACCOUNT: 'false' });
  await assertRowsCarry7dShape(stackUpSkip.results, 'stack-up skip');
  assert.equal(stackUpSkip.results[0].accountBoundSkipped, true);
  assert.equal(stackUpSkip.results[0].reason, 'CI_HAS_HETZNER_ACCOUNT');
  assert.match(stackUpSkip.results[0].detail, /set-but-not-true/);
  const reloadSkip = await runProbe('real-account-reload-burst', { CI_HAS_HETZNER_ACCOUNT: 'false' });
  await assertRowsCarry7dShape(reloadSkip.results, 'reload-burst skip');
  assert.equal(reloadSkip.results[0].accountBoundSkipped, true);
  assert.equal(reloadSkip.results[0].reason, 'CI_HAS_HETZNER_ACCOUNT');
  // Second-tier skip: CI_HAS_HETZNER_ACCOUNT=true but HCLOUD_TOKEN unset.
  const savedToken = process.env.HCLOUD_TOKEN;
  delete process.env.HCLOUD_TOKEN;
  try {
    const secondTier = await runProbe('real-account-minimal-stack-up', { CI_HAS_HETZNER_ACCOUNT: 'true' });
    await assertRowsCarry7dShape(secondTier.results, 'stack-up second-tier skip');
    assert.equal(secondTier.results[0].accountBoundSkipped, true);
    assert.equal(secondTier.results[0].reason, 'HCLOUD_TOKEN');
  } finally {
    if (savedToken !== undefined) process.env.HCLOUD_TOKEN = savedToken;
  }
  const driverPath = join(FIXTURE_ROOT, 'src', 'compose-stack-driver.mjs');
  const driver = await readFile(driverPath, 'utf8');
  for (const sym of ['export async function bringUpStack', 'export async function httpProbe', 'export async function httpProbeOnServer', 'export async function reloadBurst', 'export async function tearDownStack']) {
    assert.ok(driver.includes(sym), 'compose-stack-driver.mjs missing ' + sym);
  }
});

// Aggregation and empty-result contract (the shape rule).
test('platform-docker-compose-host probe-utils empty results FAIL with detail exactly "no checks ran"', async () => {
  const modUrl = pathToFileURL(join(PROBES_DIR, 'probe-utils.mjs')).href + '?ts=' + Date.now();
  const { aggregate, emptyResultsFail } = await import(modUrl);
  assert.equal(aggregate([]), 'fail');
  assert.equal(aggregate(null), 'fail');
  const row = emptyResultsFail('AC-any');
  assert.equal(row.detail, 'no checks ran');
  assert.equal(row.verdict, 'fail');
});
