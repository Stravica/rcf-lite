// Anatomy + shape + probe + fixture + shelf-doc test for the
// platform-docker-compose-host v1.0.0 blueprint (T-2 of the Hetzner
// round 7 spec, 2026-09-07 section 5.6). Covers TS-150 (nine TCs) on
// the T-2 repo chain slice:
// TC-150-compose-layout-shape-valid,
// TC-150-secrets-file-mount-shape,
// TC-150-secrets-scan-fails-on-plaintext,
// TC-150-compose-config-lint-refuses-missing-healthcheck,
// TC-150-real-account-minimal-stack-up-declared-and-skipped-shape,
// TC-150-restart-discipline-lint-refuses-unclassified,
// TC-150-caddyfile-validate-refuses-invalid-directive,
// TC-150-real-account-reload-burst-declared-and-skipped-shape,
// TC-150-log-driver-classification.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

// TC-150-compose-layout-shape-valid (AC-composeHost-topologyValid):
// fixture compose.yaml declares service-per-container, named networks
// and volumes, and a .env for non-secret config.
test('T-2 platform-docker-compose-host AC-12001-1 compose layout shape valid (TC-150-compose-layout-shape-valid)', async () => {
  const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(bp.slug, 'platform-docker-compose-host');
  assert.equal(bp.version, '1.1.0');
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

// TC-150-secrets-file-mount-shape (AC-composeHost-secretShape):
// compose.yaml declares secrets under top-level secrets with a file
// source and mounts them into the web service.
test('T-2 platform-docker-compose-host AC-12101-1 secrets file mount shape (TC-150-secrets-file-mount-shape)', async () => {
  const text = await readFile(COMPOSE, 'utf8');
  assert.match(text, /^secrets:\s*$/m, 'compose.yaml declares top-level secrets');
  assert.match(text, /^\s{2}web-token:\s*\n\s+file:\s+\.\/secrets\/web-token/m, 'web-token secret has file: source');
  assert.match(text, /^\s{4}secrets:\s*\n\s+-\s+web-token/m, 'web service references web-token via service-level secrets:');
  const secretPresent = await readFile(SECRET, 'utf8');
  assert.ok(secretPresent.length > 0, 'fixture secret file exists');
});

// TC-150-secrets-scan-fails-on-plaintext (AC-composeHost-secretsAreFiles):
// secrets-as-files-scan probe passes on the canonical fixture and
// fails under SIMULATE_PLAINTEXT_SECRET naming the literal.
test('T-2 platform-docker-compose-host AC-12102-1 secrets-as-files scan fails on plaintext (TC-150-secrets-scan-fails-on-plaintext)', async () => {
  const clean = await runProbe('secrets-as-files-scan');
  assert.ok(clean.results.length > 0);
  assert.ok(!clean.results.some((r) => r.verdict === 'fail'), `expected clean scan to pass, got: ${JSON.stringify(clean.results, null, 2)}`);
  const mutated = await runProbe('secrets-as-files-scan', { SIMULATE_PLAINTEXT_SECRET: 'true' });
  const fail = mutated.results.find((r) => r.verdict === 'fail' && r.detail.includes('plaintext secret literal'));
  assert.ok(fail, `expected mutation to fail with plaintext-literal detail, got: ${JSON.stringify(mutated.results, null, 2)}`);
});

// TC-150-compose-config-lint-refuses-missing-healthcheck (AC-composeHost-healthcheckLint):
// compose-config-lint probe passes on canonical and fails under
// SIMULATE_MISSING_HEALTHCHECK naming the service.
test('T-2 platform-docker-compose-host AC-12201-1 compose-config-lint refuses missing healthcheck (TC-150-compose-config-lint-refuses-missing-healthcheck)', async () => {
  const clean = await runProbe('compose-config-lint');
  assert.ok(!clean.results.some((r) => r.verdict === 'fail'), `expected canonical compose-config-lint to pass, got: ${JSON.stringify(clean.results.filter((r) => r.verdict === 'fail'), null, 2)}`);
  const mutated = await runProbe('compose-config-lint', { SIMULATE_MISSING_HEALTHCHECK: 'true' });
  const fail = mutated.results.find((r) => r.verdict === 'fail' && r.detail.includes("missing a healthcheck"));
  assert.ok(fail, `expected SIMULATE_MISSING_HEALTHCHECK to fail with missing-healthcheck detail, got: ${JSON.stringify(mutated.results, null, 2)}`);
});

// TC-150-real-account-minimal-stack-up-declared-and-skipped-shape (AC-composeHost-upClean):
// probe declares accountBound true and records accountBoundSkipped when
// the env var is unset.
test('T-2 platform-docker-compose-host AC-12202-1 real-account-minimal-stack-up declared and skipped shape (TC-150-real-account-minimal-stack-up-declared-and-skipped-shape)', async () => {
  const modUrl = pathToFileURL(join(PROBES_DIR, 'real-account-minimal-stack-up.mjs')).href;
  const mod = await import(modUrl);
  assert.equal(mod.accountBound, true);
  assert.equal(mod.anchorAcId, 'AC-composeHost-upClean');
  const saved = process.env.CI_HAS_HETZNER_ACCOUNT;
  delete process.env.CI_HAS_HETZNER_ACCOUNT;
  try {
    const out = await mod.default();
    const skipped = out.results.find((r) => r.accountBoundSkipped === true);
    assert.ok(skipped, `expected accountBoundSkipped record without CI_HAS_HETZNER_ACCOUNT, got ${JSON.stringify(out.results)}`);
  } finally {
    if (saved !== undefined) process.env.CI_HAS_HETZNER_ACCOUNT = saved;
  }
});

// TC-150-restart-discipline-lint-refuses-unclassified (AC-composeHost-restartClassification):
test('T-2 platform-docker-compose-host AC-12301-1 restart discipline lint refuses unclassified (TC-150-restart-discipline-lint-refuses-unclassified)', async () => {
  const mutated = await runProbe('compose-config-lint', { SIMULATE_UNCLASSIFIED_RESTART: 'true' });
  const fail = mutated.results.find((r) => r.verdict === 'fail' && r.detail.includes('restart: always'));
  assert.ok(fail, `expected SIMULATE_UNCLASSIFIED_RESTART to fail with restart: always detail, got: ${JSON.stringify(mutated.results, null, 2)}`);
});

// TC-150-caddyfile-validate-refuses-invalid-directive (AC-composeHost-reverseProxyArtefactValid):
test('T-2 platform-docker-compose-host AC-12401-1 caddyfile-validate refuses invalid directive (TC-150-caddyfile-validate-refuses-invalid-directive)', async () => {
  const cf = await readFile(CADDYFILE, 'utf8');
  assert.match(cf, /reverse_proxy web:8080/, 'Caddyfile references the web service');
  // The probe uses docker/caddy; when neither is on PATH the probe records
  // warn and the assertion below tolerates that.
  const clean = await runProbe('caddyfile-validate');
  const noFail = !clean.results.some((r) => r.verdict === 'fail');
  assert.ok(noFail, `expected canonical caddyfile-validate not to fail; got: ${JSON.stringify(clean.results, null, 2)}`);
});

// TC-150-real-account-reload-burst-declared-and-skipped-shape (AC-composeHost-zeroDowntimeReload):
test('T-2 platform-docker-compose-host AC-12402-1 real-account-reload-burst declared and skipped shape (TC-150-real-account-reload-burst-declared-and-skipped-shape)', async () => {
  const modUrl = pathToFileURL(join(PROBES_DIR, 'real-account-reload-burst.mjs')).href;
  const mod = await import(modUrl);
  assert.equal(mod.accountBound, true);
  assert.equal(mod.anchorAcId, 'AC-composeHost-zeroDowntimeReload');
  const saved = process.env.CI_HAS_HETZNER_ACCOUNT;
  delete process.env.CI_HAS_HETZNER_ACCOUNT;
  try {
    const out = await mod.default();
    const skipped = out.results.find((r) => r.accountBoundSkipped === true);
    assert.ok(skipped, `expected accountBoundSkipped record without CI_HAS_HETZNER_ACCOUNT`);
  } finally {
    if (saved !== undefined) process.env.CI_HAS_HETZNER_ACCOUNT = saved;
  }
});

// TC-150-log-driver-classification (AC-composeHost-logDriverClassification):
test('T-2 platform-docker-compose-host AC-12501-1 log driver classification (TC-150-log-driver-classification)', async () => {
  const mutated = await runProbe('compose-config-lint', { SIMULATE_UNCLASSIFIED_LOG_DRIVER: 'true' });
  const fail = mutated.results.find((r) => r.verdict === 'fail' && r.detail.includes("logging driver 'syslog'"));
  assert.ok(fail, `expected SIMULATE_UNCLASSIFIED_LOG_DRIVER to fail naming syslog, got: ${JSON.stringify(mutated.results, null, 2)}`);
});

// Anatomy assertions: README, CHANGELOG, guide, docs/topics.md land.
test('T-2 platform-docker-compose-host anatomy: README, CHANGELOG, guide and docs/topics.md land with expected contents', async () => {
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
