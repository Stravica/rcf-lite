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

// Per-probe requirement map (v1.1.11). Every counting row (a row
// that is not `accountBoundSkipped`, not `notObservableHere`, and
// not `conformanceOnly`) must belong to a probe declared in
// `PROBE_REQUIREMENTS`, match one of its declared rows by
// `anchorAcId`, and carry the row rule's REQUIRED identifier
// (with shape check) plus every REQUIRED observation field in its
// evidence tree. A row from a mapped probe that is missing one of
// these fields FAILS; a row from an UNMAPPED probe (or a mapped
// probe with an unknown `anchorAcId`) FAILS on the spot - unmapped
// probes may only emit skip / conformanceOnly / notObservableHere
// rows.
//
// Identifier shape checks:
//   - vendorId: a positive integer or a non-empty numeric string
//     (`^[0-9]+$`), as the vendor API returns for a resource id.
//   - hex64: a 64-character hex string (`^[a-f0-9]{64}$`, case
//     insensitive), as `docker inspect --format '{{.Id}}'` returns
//     for a Docker container id.
//
// Observation fields are located by a DEEP search into the row's
// `evidence` tree so that a field nested under (for example)
// `evidence.burst` or `evidence.observedSecretModes.observations`
// still counts. Arbitrary cross-probe combinations of fields fail:
// a row anchored to a reload-burst AC must carry the reload-burst
// tuple, not (say) `mode` alone. Generic keys (`observed`, `port`,
// `protocol`, `direction`, bare `id` or `resourceId`) are not part
// of any probe's rule; a supplied/echoed pair is not evidence.
//
// Compose probe rules (this file):
//   real-account-minimal-stack-up / AC-composeHost-upClean
//     identifier: containerId (hex64) - present at
//       evidence.observedSecretModes.observations[].containerId
//     required: observedSecretModes; one of [observedNames,
//       healthcheckKeys]
//   real-account-minimal-stack-up / AC-composeHost-secretShape
//     identifier: containerId (hex64) - top-level on this row
//     required: mode
//   real-account-reload-burst / AC-composeHost-zeroDowntimeReload
//     identifier: serverId (vendorId)
//     required: total, twoXx, drops, overlapCount (all nested
//       under evidence.burst on the live record) AND
//       burst.clockDomain === "server"
//
// Unmapped probes on this blueprint (offline / mock; every row
// must be conformanceOnly or account-bound-skipped):
//   caddyfile-validate, compose-config-lint, secrets-as-files-scan
//
// `notObservableHere` remains reserved for browser-only ACs; the
// platform-docker-compose-host blueprint has no browser-only ACs,
// so BROWSER_ONLY_ACS is EMPTY and any notObservableHere row FAILS.
// `conformanceOnly` rows must carry a `limitation` whose first
// token is a shipped AC id. A row that only carries
// `{probeName, reason}` never counts.
const PROBE_REQUIREMENTS = {
  'real-account-minimal-stack-up': {
    rows: [
      {
        anchorAcId: 'AC-composeHost-upClean',
        identifier: { field: 'containerId', shape: 'hex64' },
        requiredAll: ['observedSecretModes'],
        requiredAnyOf: [['observedNames', 'healthcheckKeys']],
      },
      {
        anchorAcId: 'AC-composeHost-secretShape',
        identifier: { field: 'containerId', shape: 'hex64' },
        requiredAll: ['mode'],
        requiredAnyOf: [],
      },
    ],
  },
  'real-account-reload-burst': {
    rows: [
      {
        anchorAcId: 'AC-composeHost-zeroDowntimeReload',
        identifier: { field: 'serverId', shape: 'vendorId' },
        requiredAll: ['total', 'twoXx', 'drops', 'overlapCount'],
        requiredAnyOf: [],
        requiredExact: [{ field: 'clockDomain', equals: 'server' }],
      },
    ],
  },
};
const UNMAPPED_PROBES_CONFORMANCE_ONLY = new Set([
  'caddyfile-validate', 'compose-config-lint', 'secrets-as-files-scan',
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
function isPresent(v) {
  return v !== undefined && v !== null;
}
function isVendorId(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0;
  if (typeof v === 'string') return /^[0-9]+$/.test(v) && v !== '0';
  return false;
}
function isHex64(v) {
  return typeof v === 'string' && /^[a-f0-9]{64}$/i.test(v);
}
function checkIdShape(shape, value) {
  if (shape === 'vendorId') return isVendorId(value);
  if (shape === 'hex64') return isHex64(value);
  return false;
}
// Per-field value validators (v1.1.11). isPresent-only acceptance is
// gone: an empty string, an empty collection, `false`, `NaN`, or a
// malformed value FAILS. Every required observation field named in
// PROBE_REQUIREMENTS must have an entry here.
function isNonNegInt(v) { return typeof v === 'number' && Number.isInteger(v) && v >= 0; }
function isOctalMode(v) { return typeof v === 'string' && /^0?[0-7]{3}$/.test(v); }
function isNonEmptyStringArray(v) { return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s.length > 0); }
function isObservedSecretModesShape(v) {
  const arr = Array.isArray(v)
    ? v
    : (v && typeof v === 'object' && Array.isArray(v.observations) ? v.observations : null);
  if (!Array.isArray(arr) || arr.length === 0) return false;
  return arr.every((o) => o && typeof o === 'object' && isOctalMode(o.mode));
}
const FIELD_VALIDATORS = {
  observedSecretModes: isObservedSecretModesShape,
  observedNames: isNonEmptyStringArray,
  healthcheckKeys: isNonEmptyStringArray,
  mode: isOctalMode,
  total: isNonNegInt,
  twoXx: isNonNegInt,
  drops: isNonNegInt,
  overlapCount: isNonNegInt,
};
function deepFind(node, fieldName, visited) {
  const seen = visited || new Set();
  if (node === null || typeof node !== 'object' || seen.has(node)) return undefined;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const it of node) {
      const found = deepFind(it, fieldName, seen);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(node, fieldName)) return node[fieldName];
  for (const k of Object.keys(node)) {
    const found = deepFind(node[k], fieldName, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}
// Enforce the per-probe requirement map on ONE counting row.
// Throws an Error naming the missing field / shape mismatch, so
// callers (the anatomy walker AND the negative-proof tests below)
// can convert into an assertion failure with context.
function validateCountingRowAgainstMap(row, probeName) {
  const bundle = PROBE_REQUIREMENTS[probeName];
  if (!bundle) {
    if (UNMAPPED_PROBES_CONFORMANCE_ONLY.has(probeName)) {
      throw new Error(`${probeName}: this probe is UNMAPPED in PROBE_REQUIREMENTS; only skip / conformanceOnly / notObservableHere rows are permitted, but a counting row was produced: ${JSON.stringify(row).slice(0, 300)}`);
    }
    throw new Error(`${probeName}: probe is not declared in PROBE_REQUIREMENTS nor UNMAPPED_PROBES_CONFORMANCE_ONLY; add it before shipping a counting row: ${JSON.stringify(row).slice(0, 300)}`);
  }
  const rule = bundle.rows.find((r) => r.anchorAcId === row.anchorAcId);
  if (!rule) {
    throw new Error(`${probeName}: counting row anchors ${JSON.stringify(row.anchorAcId)}, which is not declared in PROBE_REQUIREMENTS for this probe; declared: ${bundle.rows.map((r) => r.anchorAcId).join(', ')}`);
  }
  const ev = (row.evidence && typeof row.evidence === 'object') ? row.evidence : {};
  const idValue = deepFind(ev, rule.identifier.field);
  if (!checkIdShape(rule.identifier.shape, idValue)) {
    throw new Error(`${probeName} / ${rule.anchorAcId}: identifier ${rule.identifier.field} (shape ${rule.identifier.shape}) missing or malformed; got ${JSON.stringify(idValue)}`);
  }
  for (const obs of rule.requiredAll) {
    const validator = FIELD_VALIDATORS[obs];
    if (!validator) {
      throw new Error(`${probeName} / ${rule.anchorAcId}: no per-field validator registered for required observation ${obs}; add it to FIELD_VALIDATORS`);
    }
    const v = deepFind(ev, obs);
    if (!validator(v)) {
      const seen = JSON.stringify(v);
      throw new Error(`${probeName} / ${rule.anchorAcId}: required observation ${obs} missing or malformed in evidence tree (got ${seen === undefined ? 'undefined' : seen.slice(0, 160)})`);
    }
  }
  for (const group of rule.requiredAnyOf) {
    const some = group.some((f) => {
      const validator = FIELD_VALIDATORS[f];
      return typeof validator === 'function' && validator(deepFind(ev, f));
    });
    if (!some) {
      throw new Error(`${probeName} / ${rule.anchorAcId}: none of the observation alternatives [${group.join(', ')}] are present and valid in evidence tree`);
    }
  }
  for (const exact of rule.requiredExact || []) {
    const v = deepFind(ev, exact.field);
    if (v !== exact.equals) {
      throw new Error(`${probeName} / ${rule.anchorAcId}: required ${exact.field} must equal ${JSON.stringify(exact.equals)}; got ${JSON.stringify(v)}`);
    }
  }
  // Reload-burst cross-field consistency (v1.1.11): twoXx <= total AND
  // drops === total - twoXx. Only applies when the row rule already
  // requires this tuple.
  if ((rule.requiredAll || []).includes('total') && (rule.requiredAll || []).includes('twoXx') && (rule.requiredAll || []).includes('drops')) {
    const total = deepFind(ev, 'total');
    const twoXx = deepFind(ev, 'twoXx');
    const drops = deepFind(ev, 'drops');
    if (twoXx > total) {
      throw new Error(`${probeName} / ${rule.anchorAcId}: burst counters inconsistent: twoXx (${twoXx}) > total (${total})`);
    }
    if (drops !== total - twoXx) {
      throw new Error(`${probeName} / ${rule.anchorAcId}: burst counters inconsistent: drops (${drops}) !== total (${total}) - twoXx (${twoXx})`);
    }
  }
  return true;
}
async function assertRowsCarry7dShape(rows, probeName, label) {
  const displayLabel = label ?? probeName;
  assert.ok(Array.isArray(rows) && rows.length > 0, `${displayLabel}: no results returned`);
  const shipped = await loadShippedAcs();
  for (const r of rows) {
    if (r.accountBoundSkipped === true) {
      assert.ok(
        !UNMAPPED_PROBES_CONFORMANCE_ONLY.has(probeName),
        `${displayLabel}: probe ${probeName} is UNMAPPED (offline / mock) and MUST NOT emit accountBoundSkipped rows - such probes have no declared gate variable to skip on; only conformanceOnly rows are permitted. Row: ${JSON.stringify(r).slice(0, 300)}`,
      );
      assert.ok(
        PROBE_REQUIREMENTS[probeName],
        `${displayLabel}: probe ${probeName} is not declared in PROBE_REQUIREMENTS nor UNMAPPED_PROBES_CONFORMANCE_ONLY; classify it before shipping a skip row: ${JSON.stringify(r).slice(0, 300)}`,
      );
      assert.equal(typeof r.reason, 'string', `${displayLabel}: skip row must carry a string reason: ${JSON.stringify(r).slice(0, 300)}`);
      assert.ok(DECLARED_SKIP_VARS.has(r.reason), `${displayLabel}: skip reason ${JSON.stringify(r.reason)} is not a declared gate variable in the fixture README env-vars section: ${JSON.stringify(r).slice(0, 300)}`);
      continue;
    }
    if (r.notObservableHere) {
      const ac = r.notObservableHere && r.notObservableHere.ac;
      assert.ok(BROWSER_ONLY_ACS.has(ac), `${displayLabel}: notObservableHere is reserved for browser-only ACs; platform-docker-compose-host has NONE, so any notObservableHere row FAILS anatomy. Row claims ac=${JSON.stringify(ac)}: ${JSON.stringify(r).slice(0, 300)}`);
    }
    if (r.conformanceOnly) {
      assert.equal(typeof r.limitation, 'string', `${displayLabel}: conformanceOnly row must carry a limitation string: ${JSON.stringify(r).slice(0, 300)}`);
      assert.equal(r.anchorAcId, null, `${displayLabel}: conformanceOnly row must carry anchorAcId: null: ${JSON.stringify(r).slice(0, 300)}`);
      const m = r.limitation.match(/^(AC-[A-Za-z0-9-]+)\b/);
      assert.ok(m, `${displayLabel}: conformanceOnly limitation must start with a shipped AC id token; got ${JSON.stringify(r.limitation).slice(0, 200)}`);
      assert.ok(shipped.has(m[1]), `${displayLabel}: conformanceOnly limitation names ${m[1]}, which is not a shipped AC on platform-docker-compose-host`);
      // conformanceOnly rows attest to a limitation, not a live
      // observation; identity and observation checks are for
      // counting rows only.
      continue;
    }
    // Counting row: enforce per-probe requirement map (v1.1.11).
    try {
      validateCountingRowAgainstMap(r, probeName);
    } catch (e) {
      assert.fail(`${displayLabel}: ${e.message}`);
    }
  }
}

test('platform-docker-compose-host AC-12001-1 compose layout shape valid', async () => {
  const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(bp.slug, 'platform-docker-compose-host');
  assert.equal(bp.version, '1.1.11');
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
  await assertRowsCarry7dShape(clean.results, 'secrets-as-files-scan', 'secrets-as-files clean');
  assert.ok(!clean.results.some((r) => r.verdict === 'fail'), `expected clean scan to pass, got: ${JSON.stringify(clean.results, null, 2)}`);
  const mutated = await runProbe('secrets-as-files-scan', { SIMULATE_PLAINTEXT_SECRET: 'true' });
  await assertRowsCarry7dShape(mutated.results, 'secrets-as-files-scan', 'secrets-as-files mutated');
  const fail = mutated.results.find((r) => r.verdict === 'fail' && r.detail.includes('plaintext secret literal'));
  assert.ok(fail, `expected mutation to fail with plaintext-literal detail, got: ${JSON.stringify(mutated.results, null, 2)}`);
});

test('platform-docker-compose-host AC-12201-1 compose-config-lint refuses missing healthcheck', async () => {
  const clean = await runProbe('compose-config-lint');
  await assertRowsCarry7dShape(clean.results, 'compose-config-lint', 'compose-config-lint clean');
  assert.ok(!clean.results.some((r) => r.verdict === 'fail'), `expected canonical compose-config-lint to pass, got: ${JSON.stringify(clean.results.filter((r) => r.verdict === 'fail'), null, 2)}`);
  const mutated = await runProbe('compose-config-lint', { SIMULATE_MISSING_HEALTHCHECK: 'true' });
  await assertRowsCarry7dShape(mutated.results, 'compose-config-lint', 'compose-config-lint mutated');
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
    await assertRowsCarry7dShape(out.results, 'real-account-minimal-stack-up', 'minimal-stack-up skip');
    const skipped = out.results.find((r) => r.accountBoundSkipped === true);
    assert.ok(skipped, `expected accountBoundSkipped record without CI_HAS_HETZNER_ACCOUNT, got ${JSON.stringify(out.results)}`);
    assert.equal(skipped.reason, 'CI_HAS_HETZNER_ACCOUNT');
  } finally {
    if (saved !== undefined) process.env.CI_HAS_HETZNER_ACCOUNT = saved;
  }
});

test('platform-docker-compose-host AC-12301-1 restart discipline lint refuses unclassified', async () => {
  const mutated = await runProbe('compose-config-lint', { SIMULATE_UNCLASSIFIED_RESTART: 'true' });
  await assertRowsCarry7dShape(mutated.results, 'compose-config-lint', 'compose-config-lint restart mutated');
  const fail = mutated.results.find((r) => r.verdict === 'fail' && r.detail.includes('restart: always'));
  assert.ok(fail, `expected SIMULATE_UNCLASSIFIED_RESTART to fail with restart: always detail, got: ${JSON.stringify(mutated.results, null, 2)}`);
});

test('platform-docker-compose-host AC-12401-1 caddyfile-validate refuses invalid directive', async () => {
  const cf = await readFile(CADDYFILE, 'utf8');
  assert.match(cf, /reverse_proxy web:8080/, 'Caddyfile references the web service');
  const clean = await runProbe('caddyfile-validate');
  await assertRowsCarry7dShape(clean.results, 'caddyfile-validate', 'caddyfile-validate clean');
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
    await assertRowsCarry7dShape(out.results, 'real-account-reload-burst', 'reload-burst skip');
    const skipped = out.results.find((r) => r.accountBoundSkipped === true);
    assert.ok(skipped, `expected accountBoundSkipped record without CI_HAS_HETZNER_ACCOUNT`);
    assert.equal(skipped.reason, 'CI_HAS_HETZNER_ACCOUNT');
  } finally {
    if (saved !== undefined) process.env.CI_HAS_HETZNER_ACCOUNT = saved;
  }
});

test('platform-docker-compose-host AC-12501-1 log driver classification', async () => {
  const mutated = await runProbe('compose-config-lint', { SIMULATE_UNCLASSIFIED_LOG_DRIVER: 'true' });
  await assertRowsCarry7dShape(mutated.results, 'compose-config-lint', 'compose-config-lint log-driver mutated');
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
  await assertRowsCarry7dShape(stackUpSkip.results, 'real-account-minimal-stack-up', 'stack-up skip');
  assert.equal(stackUpSkip.results[0].accountBoundSkipped, true);
  assert.equal(stackUpSkip.results[0].reason, 'CI_HAS_HETZNER_ACCOUNT');
  assert.match(stackUpSkip.results[0].detail, /set-but-not-true/);
  const reloadSkip = await runProbe('real-account-reload-burst', { CI_HAS_HETZNER_ACCOUNT: 'false' });
  await assertRowsCarry7dShape(reloadSkip.results, 'real-account-reload-burst', 'reload-burst skip');
  assert.equal(reloadSkip.results[0].accountBoundSkipped, true);
  assert.equal(reloadSkip.results[0].reason, 'CI_HAS_HETZNER_ACCOUNT');
  // Second-tier skip: CI_HAS_HETZNER_ACCOUNT=true but HCLOUD_TOKEN unset.
  const savedToken = process.env.HCLOUD_TOKEN;
  delete process.env.HCLOUD_TOKEN;
  try {
    const secondTier = await runProbe('real-account-minimal-stack-up', { CI_HAS_HETZNER_ACCOUNT: 'true' });
    await assertRowsCarry7dShape(secondTier.results, 'real-account-minimal-stack-up', 'stack-up second-tier skip');
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

// Per-probe requirement map: negative proof for v1.1.11.
// A synthetic counting row from a MAPPED probe is accepted only when
// its identifier has the right shape AND every required observation
// is present in the evidence tree (deep-search); missing fields, a
// non-vendor identifier value, or cross-probe combinations FAIL.
const HEX64 = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
test('compose anatomy per-probe map: valid upClean row accepted (containerId deep under observedSecretModes)', async () => {
  const row = { anchorAcId: 'AC-composeHost-upClean', verdict: 'pass', evidence: {
    serverId: 424245,
    observedNames: ['rcf-lite-throwaway-caddy', 'rcf-lite-throwaway-web'],
    observedSecretModes: {
      observations: [{ service: 'web', containerId: HEX64, mode: '400' }],
    },
  } };
  assert.equal(validateCountingRowAgainstMap(row, 'real-account-minimal-stack-up'), true);
});
test('compose anatomy per-probe map: valid secretShape row accepted', async () => {
  const row = { anchorAcId: 'AC-composeHost-secretShape', verdict: 'pass', evidence: { containerId: HEX64, mode: '400', mountPath: '/run/secrets/web-token' } };
  assert.equal(validateCountingRowAgainstMap(row, 'real-account-minimal-stack-up'), true);
});
test('compose anatomy per-probe map: valid reload-burst row accepted (fields nested under evidence.burst)', async () => {
  const row = { anchorAcId: 'AC-composeHost-zeroDowntimeReload', verdict: 'pass', evidence: {
    serverId: 424246,
    burst: { total: 6192, twoXx: 6192, drops: 0, overlapCount: 225, clockDomain: 'server' },
  } };
  assert.equal(validateCountingRowAgainstMap(row, 'real-account-reload-burst'), true);
});
test('compose anatomy per-probe map: row missing a required observation FAILS', async () => {
  // upClean without observedSecretModes:
  const bad = { anchorAcId: 'AC-composeHost-upClean', verdict: 'pass', evidence: { containerId: HEX64, observedNames: ['x'] } };
  assert.throws(() => validateCountingRowAgainstMap(bad, 'real-account-minimal-stack-up'), /observedSecretModes missing/);
  // reload-burst without overlapCount:
  const bad2 = { anchorAcId: 'AC-composeHost-zeroDowntimeReload', verdict: 'pass', evidence: { serverId: 424246, burst: { total: 10, twoXx: 10, drops: 1, clockDomain: 'server' } } };
  assert.throws(() => validateCountingRowAgainstMap(bad2, 'real-account-reload-burst'), /overlapCount missing/);
});
test('compose anatomy per-probe map: cross-probe combination of fields FAILS', async () => {
  // reload-burst tuple carried under minimal-stack-up produces no containerId; FAILS on identity.
  const bad = { anchorAcId: 'AC-composeHost-upClean', verdict: 'pass', evidence: { serverId: 424246, burst: { total: 10, twoXx: 10, drops: 0, overlapCount: 0, clockDomain: 'server' } } };
  assert.throws(() => validateCountingRowAgainstMap(bad, 'real-account-minimal-stack-up'), /identifier containerId .* missing or malformed/);
  // stack-up secretShape id + observedNames declared as a reload-burst row FAILS on required tuple.
  const bad2 = { anchorAcId: 'AC-composeHost-zeroDowntimeReload', verdict: 'pass', evidence: { containerId: HEX64, mode: '400' } };
  assert.throws(() => validateCountingRowAgainstMap(bad2, 'real-account-reload-burst'), /identifier serverId .* missing or malformed/);
});
test('compose anatomy per-probe map: non-hex64 containerId FAILS shape check', async () => {
  const bad = { anchorAcId: 'AC-composeHost-secretShape', verdict: 'pass', evidence: { containerId: 'rcf-lite-throwaway-web', mode: '400' } };
  assert.throws(() => validateCountingRowAgainstMap(bad, 'real-account-minimal-stack-up'), /identifier containerId .* missing or malformed/);
  const bad2 = { anchorAcId: 'AC-composeHost-secretShape', verdict: 'pass', evidence: { containerId: HEX64.slice(0, 32), mode: '400' } };
  assert.throws(() => validateCountingRowAgainstMap(bad2, 'real-account-minimal-stack-up'), /identifier containerId .* missing or malformed/);
});
test('compose anatomy per-probe map: reload-burst clockDomain must equal "server"', async () => {
  const bad = { anchorAcId: 'AC-composeHost-zeroDowntimeReload', verdict: 'pass', evidence: { serverId: 424246, burst: { total: 10, twoXx: 10, drops: 0, overlapCount: 1, clockDomain: 'runner' } } };
  assert.throws(() => validateCountingRowAgainstMap(bad, 'real-account-reload-burst'), /clockDomain must equal .server./);
});
test('compose anatomy per-probe map: UNMAPPED probe producing a counting row FAILS', async () => {
  const bad = { anchorAcId: 'AC-composeHost-healthcheckLint', verdict: 'pass', evidence: { containerId: HEX64, mode: '400' } };
  assert.throws(() => validateCountingRowAgainstMap(bad, 'compose-config-lint'), /UNMAPPED in PROBE_REQUIREMENTS/);
});
test('compose anatomy per-probe map: nested reload-burst tuple under evidence.burst is found by deep search', async () => {
  const row = { anchorAcId: 'AC-composeHost-zeroDowntimeReload', verdict: 'pass', evidence: {
    serverId: 424246,
    warm: { statusCode: 200 },
    burst: { total: 6192, twoXx: 6192, drops: 0, overlapCount: 225, clockDomain: 'server' },
  } };
  assert.equal(validateCountingRowAgainstMap(row, 'real-account-reload-burst'), true);
});

// Per-field value validators: negative cases (v1.1.11). isPresent-
// only acceptance is gone; each required field runs its own
// per-field validator and empty / malformed values FAIL. HEX64 above
// is a synthetic 64-hex value ("deadbeef" repeated eight times); no
// live-account container id is in this file.
test('compose anatomy field validators: observedSecretModes must be non-empty and every entry carries an octal mode', async () => {
  // Every row also carries a top-level containerId so the identifier
  // check passes and the failure is on observedSecretModes.
  const upCleanRowWith = (osm) => ({
    anchorAcId: 'AC-composeHost-upClean',
    verdict: 'pass',
    evidence: { serverId: 424246, containerId: HEX64, observedNames: ['x'], observedSecretModes: osm },
  });
  // empty
  assert.throws(() => validateCountingRowAgainstMap(upCleanRowWith({ observations: [] }), 'real-account-minimal-stack-up'), /observedSecretModes missing or malformed/);
  assert.throws(() => validateCountingRowAgainstMap(upCleanRowWith([]), 'real-account-minimal-stack-up'), /observedSecretModes missing or malformed/);
  // entries lacking mode
  assert.throws(() => validateCountingRowAgainstMap(upCleanRowWith({ observations: [{ containerId: HEX64 }] }), 'real-account-minimal-stack-up'), /observedSecretModes missing or malformed/);
  // entries with non-octal mode
  assert.throws(() => validateCountingRowAgainstMap(upCleanRowWith({ observations: [{ containerId: HEX64, mode: 'ffff' }] }), 'real-account-minimal-stack-up'), /observedSecretModes missing or malformed/);
  assert.throws(() => validateCountingRowAgainstMap(upCleanRowWith({ observations: [{ containerId: HEX64, mode: '' }] }), 'real-account-minimal-stack-up'), /observedSecretModes missing or malformed/);
  // top-level string is not a valid shape
  assert.throws(() => validateCountingRowAgainstMap(upCleanRowWith('not-an-array'), 'real-account-minimal-stack-up'), /observedSecretModes missing or malformed/);
});
test('compose anatomy field validators: observedNames / healthcheckKeys anyOf FAILS when both empty or malformed', async () => {
  const row = { anchorAcId: 'AC-composeHost-upClean', verdict: 'pass', evidence: { containerId: HEX64, observedSecretModes: { observations: [{ containerId: HEX64, mode: '400' }] }, observedNames: [], healthcheckKeys: '' } };
  assert.throws(() => validateCountingRowAgainstMap(row, 'real-account-minimal-stack-up'), /none of the observation alternatives \[observedNames, healthcheckKeys\]/);
});
test('compose anatomy field validators: mode must match octal pattern (400 / 0400 pass, other values FAIL)', async () => {
  const good = { anchorAcId: 'AC-composeHost-secretShape', verdict: 'pass', evidence: { containerId: HEX64, mode: '0400' } };
  assert.equal(validateCountingRowAgainstMap(good, 'real-account-minimal-stack-up'), true);
  for (const v of ['', 'abc', '9', '400 ', '4000']) {
    const bad = { anchorAcId: 'AC-composeHost-secretShape', verdict: 'pass', evidence: { containerId: HEX64, mode: v } };
    assert.throws(() => validateCountingRowAgainstMap(bad, 'real-account-minimal-stack-up'), /mode missing or malformed/, `expected FAIL on mode=${JSON.stringify(v)}`);
  }
});
test('compose anatomy field validators: burst counters must be non-negative integers', async () => {
  for (const field of ['total', 'twoXx', 'drops', 'overlapCount']) {
    const burst = { total: 100, twoXx: 100, drops: 0, overlapCount: 42, clockDomain: 'server' };
    burst[field] = -1;
    const bad = { anchorAcId: 'AC-composeHost-zeroDowntimeReload', verdict: 'pass', evidence: { serverId: 424246, burst } };
    assert.throws(() => validateCountingRowAgainstMap(bad, 'real-account-reload-burst'), new RegExp(`${field} missing or malformed`), `expected FAIL on ${field}=-1`);
  }
  const badFloat = { anchorAcId: 'AC-composeHost-zeroDowntimeReload', verdict: 'pass', evidence: { serverId: 424246, burst: { total: 1.5, twoXx: 1.5, drops: 0, overlapCount: 0, clockDomain: 'server' } } };
  assert.throws(() => validateCountingRowAgainstMap(badFloat, 'real-account-reload-burst'), /total missing or malformed/);
});
test('compose anatomy field validators: burst counters must satisfy twoXx <= total and drops === total - twoXx', async () => {
  // twoXx > total (drops is a non-neg int so per-field passes; the cross-field guard fires):
  const bad1 = { anchorAcId: 'AC-composeHost-zeroDowntimeReload', verdict: 'pass', evidence: { serverId: 424246, burst: { total: 10, twoXx: 11, drops: 0, overlapCount: 0, clockDomain: 'server' } } };
  assert.throws(() => validateCountingRowAgainstMap(bad1, 'real-account-reload-burst'), /counters inconsistent/);
  // drops !== total - twoXx:
  const bad2 = { anchorAcId: 'AC-composeHost-zeroDowntimeReload', verdict: 'pass', evidence: { serverId: 424246, burst: { total: 10, twoXx: 8, drops: 5, overlapCount: 0, clockDomain: 'server' } } };
  assert.throws(() => validateCountingRowAgainstMap(bad2, 'real-account-reload-burst'), /counters inconsistent/);
  // consistent counters accepted (drops = total - twoXx):
  const good = { anchorAcId: 'AC-composeHost-zeroDowntimeReload', verdict: 'pass', evidence: { serverId: 424246, burst: { total: 10, twoXx: 8, drops: 2, overlapCount: 0, clockDomain: 'server' } } };
  assert.equal(validateCountingRowAgainstMap(good, 'real-account-reload-burst'), true);
});

// Unmapped-probe skip rule (v1.1.11). Offline probes on this
// blueprint (caddyfile-validate, compose-config-lint,
// secrets-as-files-scan) have no declared gate variable to skip on:
// their entire row set is either conformanceOnly / notObservableHere.
// An accountBoundSkipped row from any of them FAILS anatomy.
test('compose anatomy: unmapped probe emitting accountBoundSkipped FAILS anatomy', async () => {
  const rows = [{ accountBoundSkipped: true, reason: 'CI_HAS_HETZNER_ACCOUNT', detail: 'set-but-not-true' }];
  await assert.rejects(
    async () => assertRowsCarry7dShape(rows, 'compose-config-lint', 'unmapped-skip-negative'),
    /MUST NOT emit accountBoundSkipped/,
  );
});
test('compose anatomy: mapped live probe emitting the exact one-variable skip is accepted', async () => {
  const rows = [{ accountBoundSkipped: true, reason: 'HCLOUD_TOKEN', detail: 'HCLOUD_TOKEN not set' }];
  await assertRowsCarry7dShape(rows, 'real-account-minimal-stack-up', 'mapped-skip-positive');
});

// Record walk (v1.1.11). When a local run has produced records under
// `.rcf/reports/blueprints/platform-docker-compose-host/`, validate
// every counting row against the per-probe map and check that the
// mapped identifier appears in the record's own inventory or event
// trail. For serverId, in eventTrail / postRunInventory /
// postTeardownServerIds / teardown. For containerId, in the record's
// observedSecretModes.observations tree (which is where docker
// exec/inspect ran to obtain the id) or in the compose ps listing
// (evidence.services / evidence.observedNames when the row carries
// a containerName matching one of them). When no records are present
// the walk reports "no local records" and does not fail (CI path).
function walkComposeRecordRow({ row, probeName, name, shipped, record }) {
  if (row.accountBoundSkipped === true) {
    assert.ok(!UNMAPPED_PROBES_CONFORMANCE_ONLY.has(probeName), `${name}: unmapped probe ${probeName} produced accountBoundSkipped in walk.`);
    assert.equal(typeof row.reason, 'string');
    assert.ok(DECLARED_SKIP_VARS.has(row.reason), `${name}: skip reason ${row.reason} not declared.`);
    return { walked: true, inventoryHit: false, counted: false };
  }
  if (row.conformanceOnly) {
    assert.equal(typeof row.limitation, 'string');
    assert.equal(row.anchorAcId, null);
    const m = row.limitation.match(/^(AC-[A-Za-z0-9-]+)\b/);
    assert.ok(m && shipped.has(m[1]), `${name}: conformanceOnly limitation names ${m ? m[1] : '(none)'}, not shipped on this blueprint.`);
    return { walked: true, inventoryHit: false, counted: false };
  }
  if (row.notObservableHere) {
    assert.ok(BROWSER_ONLY_ACS.has(row.notObservableHere && row.notObservableHere.ac), `${name}: notObservableHere reserved for browser-only ACs (none shipped).`);
    return { walked: true, inventoryHit: false, counted: false };
  }
  validateCountingRowAgainstMap(row, probeName);
  const rule = PROBE_REQUIREMENTS[probeName].rows.find((r) => r.anchorAcId === row.anchorAcId);
  const ev = row.evidence || {};
  const searchSpace = record || ev;
  const idField = rule.identifier.field;
  const idValue = deepFind(ev, idField);
  const idStr = String(idValue);
  let inventoryHit = false;
  if (idField === 'serverId') {
    const trail = deepFind(searchSpace, 'eventTrail');
    const inv = deepFind(searchSpace, 'postRunInventory');
    const teardownIds = deepFind(searchSpace, 'postTeardownServerIds');
    const teardown = deepFind(searchSpace, 'teardown');
    const trailHit = Array.isArray(trail) && trail.some((t) => JSON.stringify(t).includes(idStr));
    const invHit = Array.isArray(inv) && inv.some((s) => (s && typeof s === 'object') ? String(s.id) === idStr : String(s) === idStr);
    const teardownHit = Array.isArray(teardownIds) && teardownIds.map(String).includes(idStr);
    const teardownRefHit = !!teardown && typeof teardown === 'object' && (String(teardown.destroyed) === idStr || String(teardown.provisioned) === idStr);
    inventoryHit = trailHit || invHit || teardownHit || teardownRefHit;
    assert.ok(inventoryHit, `${name}: serverId ${idStr} is not present in this record's eventTrail / postRunInventory / postTeardownServerIds / teardown.`);
  } else if (idField === 'containerId') {
    const osm = deepFind(searchSpace, 'observedSecretModes');
    const arr = Array.isArray(osm) ? osm : (osm && Array.isArray(osm.observations) ? osm.observations : []);
    const osmHit = arr.some((o) => o && String(o.containerId) === idStr);
    const services = deepFind(searchSpace, 'services');
    const composeNames = Array.isArray(services) ? services.map((s) => (s && typeof s === 'object' && typeof s.name === 'string') ? s.name : null).filter(Boolean) : [];
    const observedNames = deepFind(searchSpace, 'observedNames') || [];
    const containerName = deepFind(ev, 'containerName');
    const nameHit = typeof containerName === 'string' && (composeNames.includes(containerName) || (Array.isArray(observedNames) && observedNames.includes(containerName)));
    inventoryHit = osmHit || nameHit;
    assert.ok(inventoryHit, `${name}: containerId ${idStr} is not present in this record's observedSecretModes tree, and its containerName is absent from the compose ps listing.`);
  } else {
    inventoryHit = true;
  }
  return { walked: true, inventoryHit, counted: true };
}
test('platform-docker-compose-host v1.1.11 record walk: local records validate against the per-probe map with inventory correlation, or report no records', async () => {
  const reportsDir = join(REPO_ROOT, '.rcf', 'reports', 'blueprints', 'platform-docker-compose-host');
  let entries = [];
  try {
    entries = (await readdir(reportsDir)).filter((f) => f.endsWith('.json'));
  } catch (e) {
    console.log('platform-docker-compose-host v1.1.11 record walk: no local records under .rcf/reports/blueprints/platform-docker-compose-host (CI path).');
    return;
  }
  if (entries.length === 0) {
    console.log('platform-docker-compose-host v1.1.11 record walk: no local records under .rcf/reports/blueprints/platform-docker-compose-host (CI path).');
    return;
  }
  const shipped = await loadShippedAcs();
  let walkableRows = 0;
  let inventoryHits = 0;
  let countingRows = 0;
  let stubs = 0;
  for (const fileName of entries) {
    const rec = JSON.parse(await readFile(join(reportsDir, fileName), 'utf8'));
    const probeName = rec.probeName || fileName.replace(/\.json$/, '');
    const rows = Array.isArray(rec.results) ? rec.results : [];
    for (const row of rows) {
      const hasShape = !!row && (
        row.evidence !== undefined
        || (row.conformanceOnly && typeof row.limitation === 'string')
        || (row.accountBoundSkipped === true && typeof row.reason === 'string')
        || (row.notObservableHere && row.notObservableHere.ac)
      );
      if (!hasShape) { stubs++; continue; }
      walkableRows++;
      const r = walkComposeRecordRow({ row, probeName, name: fileName, shipped, record: rec });
      if (r.counted) countingRows++;
      if (r.inventoryHit) inventoryHits++;
    }
  }
  if (walkableRows === 0) {
    console.log(`platform-docker-compose-host v1.1.11 record walk: no walkable rows in ${entries.length} record file(s) (${stubs} stub row(s)); no local records path.`);
    return;
  }
  console.log(`platform-docker-compose-host v1.1.11 record walk: ${walkableRows} walkable row(s), ${countingRows} counting row(s), ${inventoryHits} inventory correlation(s), ${stubs} stub row(s) skipped across ${entries.length} record file(s).`);
});
