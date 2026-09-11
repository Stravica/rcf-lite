// Anatomy + shape + probe + fixture + shelf-doc test for the
// deploy-hetzner-server blueprint (deploy-hetzner-server of the Hetzner shipped hetzner-server spec,
// 2026-09-07 section 5.6). Covers TC-140 (nine TCs) on the deploy-hetzner-server repo
// v1.1.5 shape pins.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'deploy-hetzner-server');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'hetzner-throwaway-server');
const MANIFEST_DIR = join(FIXTURE_ROOT, 'hetzner', 'servers');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');
const SCHEMA_PATH = join(BLUEPRINT_ROOT, 'contributions', 'schemas', 'hetzner-server.schema.json');
const TEMPLATE_PATH = join(BLUEPRINT_ROOT, 'contributions', 'templates', 'cloud-init.yaml.tmpl');
const README = join(BLUEPRINT_ROOT, 'README.md');
const CHANGELOG = join(BLUEPRINT_ROOT, 'CHANGELOG.md');
const GUIDE = join(BLUEPRINT_ROOT, 'guide', 'deploy-hetzner-server.md');
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

// Strict evidence shape (rule 14): a row PASSES only if it is
//   (a) an honest skip: accountBoundSkipped === true AND reason is a
//       non-empty string naming the unset variable, OR
//   (b) a notObservableHere row: notObservableHere.ac is a non-empty
//       string naming the AC the observation cannot be made against
//       from here, OR
//   (c) evidence carries BOTH a non-empty resource-identity value AND
//       a non-empty observation value.
// A row that only carries `{probeName, reason}` never counts, and a
// numeric identity value of zero (statusCode 0, exit 0) is not an
// observation.
const IDENTITY_FIELDS = new Set([
  'requestId', 'resourceId', 'id', 'serverId', 'snapshotId', 'imageId',
  'firewallId', 'eventName', 'service', 'secretName', 'manifestName',
  'composeMountLine', 'engineLabel', 'target', 'file', 'path',
  'ruleNames', 'scannedFiles', 'url', 'name', 'containerId',
  'mountPath', 'expectedReader',
]);
const OBSERVATION_FIELDS = new Set([
  'bodyExcerpt', 'tailExcerpt', 'snippet', 'exitStatus', 'payloadKeys',
  'expectedKeys', 'observedKeys', 'source', 'statusCode', 'headers',
  'mode', 'event', 'sourceIps', 'healthcheckKeys', 'driver',
  'observedDrivers', 'observedBinding', 'allowed', 'protocol',
  'direction', 'port', 'ports', 'restart', 'wallClockTime',
  'appearsIn', 'unhealthyServices', 'missingServices', 'expected',
  'observed', 'errorMessage', 'errors',
  'snapshotCadence', 'shippedEnum', 'requiredFields',
  'observedEvents', 'services', 'presentBlocks', 'missingBlocks',
  'renderedByteLength', 'renderHashSample', 'eventCount', 'leaks',
  'unexpectedKeys', 'allowedKeysByEvent', 'distinct',
  'engineNote', 'tail', 'expectedTotal', 'total', 'twoXx', 'drops',
  'reloadDurationMs', 'overlapCount', 'elicitedTimeoutSeconds',
  'outcomes', 'readers', 'readerCount', 'unexpectedReaders',
  'consumingServices', 'declaredMode',
]);
function isNonEmpty(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'number') return v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  if (typeof v === 'boolean') return true;
  return true;
}
function assertRowsCarry7dShape(rows, label) {
  assert.ok(Array.isArray(rows) && rows.length > 0, `${label}: no results returned`);
  for (const r of rows) {
    const skipped = r.accountBoundSkipped === true && typeof r.reason === 'string' && r.reason.length > 0;
    const notObservable = r.notObservableHere && typeof r.notObservableHere === 'object' && typeof r.notObservableHere.ac === 'string' && r.notObservableHere.ac.length > 0;
    if (skipped || notObservable) continue;
    const ev = (r.evidence && typeof r.evidence === 'object') ? r.evidence : {};
    const identityKeysPresent = Object.keys(ev).filter((k) => IDENTITY_FIELDS.has(k) && isNonEmpty(ev[k]));
    const observationKeysPresent = Object.keys(ev).filter((k) => OBSERVATION_FIELDS.has(k) && isNonEmpty(ev[k]));
    assert.ok(identityKeysPresent.length > 0, `${label}: row evidence lacks a non-empty identity field: ${JSON.stringify(r).slice(0, 400)}`);
    assert.ok(observationKeysPresent.length > 0, `${label}: row evidence lacks a non-empty observation field: ${JSON.stringify(r).slice(0, 400)}`);
  }
}

test('T-1 deploy-hetzner-server AC-11001-1 provisioner boot and sole reader (TC-140)', async () => {
  const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(bp.slug, 'deploy-hetzner-server');
  assert.equal(bp.version, '1.1.5');
  assert.equal(bp.category, 'deploy');
  assert.deepEqual(bp.capabilities, ['cloudHost']);
  const out = await runProbe('hcloud-dry-run-mock');
  assertRowsCarry7dShape(out.results, 'hcloud-dry-run-mock');
  const readyResult = out.results.find((r) => r.anchorAcId === 'AC-37101-1' && r.detail.includes('provisionerReady fired'));
  assert.ok(readyResult, `expected a provisionerReady pass result; got: ${JSON.stringify(out.results, null, 2)}`);
  assert.equal(readyResult.verdict, 'pass');
  assert.ok(readyResult.evidence && readyResult.evidence.eventName === 'provisionerReady', 'evidence must carry eventName');
  const facadeText = await readFile(join(FIXTURE_ROOT, 'src/provisioner-facade.mjs'), 'utf8');
  const otherTokenReaders = facadeText.split('\n').filter((l) => l.includes('HETZNER_ACCOUNT_API_KEY'));
  assert.equal(otherTokenReaders.length, 0, `facade must not name HETZNER_ACCOUNT_API_KEY (it captures via the injected token; grep found: ${otherTokenReaders.join(' | ')})`);
});

test('T-1 deploy-hetzner-server AC-11101-1 manifest schema shape valid (TC-140-manifest-schema-shape-valid)', async () => {
  const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));
  const required = ['name', 'serverType', 'location', 'image', 'sshKeyIds', 'firewallId', 'cloudInitPath', 'labels', 'firewallRules', 'snapshotCadence'];
  for (const f of required) assert.ok(schema.required.includes(f), `schema.required missing ${f}`);
  const entries = (await readdir(MANIFEST_DIR)).filter((f) => f.endsWith('.json'));
  assert.ok(entries.length >= 1, `fixture holds ${entries.length} manifests, expected >=1`);
  for (const name of entries) {
    const doc = JSON.parse(await readFile(join(MANIFEST_DIR, name), 'utf8'));
    for (const f of required) assert.ok(f in doc, `manifest ${name} missing ${f}`);
  }
  const out = await runProbe('manifest-schema-validate');
  assertRowsCarry7dShape(out.results, 'manifest-schema-validate');
  const bad = out.results.find((r) => r.verdict !== 'pass');
  assert.ok(!bad, `manifest-schema-validate should pass on the shipped fixture, got: ${bad ? bad.detail : ''}`);
  // Per-property anchoring: at least one row anchors to AC-37106-1
  // (firewall) and one to AC-37107-1 (snapshotCadence).
  assert.ok(out.results.some((r) => r.anchorAcId === 'AC-37106-1'), 'manifest-schema-validate must emit a firewall-anchored row');
  assert.ok(out.results.some((r) => r.anchorAcId === 'AC-37107-1'), 'manifest-schema-validate must emit a snapshotCadence-anchored row');
});

test('T-1 deploy-hetzner-server AC-11102-1 manifest applies to mocked provision (TC-140-manifest-applies-mocked-provision)', async () => {
  const out = await runProbe('hcloud-dry-run-mock');
  assertRowsCarry7dShape(out.results, 'hcloud-dry-run-mock');
  // v1.1.4 v1.1.5: the mock-path row that observes the
  // hetznerServerProvisioned event shape is de-claimed (anchorAcId: null,
  // conformanceOnly, notObservableHere.ac = 'AC-37103-1') because the AC
  // requires the real-account inventory diff; the live evidence lives on
  // real-account-throwaway-server-provision. Assert the de-claim shape.
  const provisionedResult = out.results.find((r) => r.notObservableHere && r.notObservableHere.ac === 'AC-37103-1' && r.evidence && r.evidence.eventName === 'hetznerServerProvisioned');
  assert.ok(provisionedResult, `expected a de-claimed row for AC-37103-1 observing the hetznerServerProvisioned event shape; got: ${JSON.stringify(out.results, null, 2)}`);
  assert.equal(provisionedResult.anchorAcId, null);
  assert.equal(provisionedResult.conformanceOnly, true);
  assert.ok(typeof provisionedResult.limitation === 'string' && provisionedResult.limitation.length > 0, 'de-claimed row must carry a limitation string');
  assert.equal(provisionedResult.verdict, 'pass');
  assert.equal(provisionedResult.evidence.location, 'fsn1');
  assert.equal(provisionedResult.evidence.serverType, 'cx23');
});

test('T-1 deploy-hetzner-server AC-11201-1 cloud-init render baseline present (TC-140-cloud-init-render-baseline-present)', async () => {
  const tmpl = await readFile(TEMPLATE_PATH, 'utf8');
  assert.match(tmpl, /PermitRootLogin no/);
  assert.match(tmpl, /PasswordAuthentication no/);
  assert.match(tmpl, /ufw default deny incoming/);
  assert.match(tmpl, /DOCKER-USER/);
  assert.match(tmpl, /fail2ban/);
  assert.match(tmpl, /50unattended-upgrades/);
  const out = await runProbe('cloud-init-render-lint');
  assertRowsCarry7dShape(out.results, 'cloud-init-render-lint');
  const bad = out.results.find((r) => r.verdict !== 'pass');
  assert.ok(!bad, `cloud-init-render-lint should pass on the shipped fixture, got: ${bad ? bad.detail : ''}`);
});

test('T-1 deploy-hetzner-server AC-11202-1 cloud-init hardened account-bound probe declared (TC-140-cloud-init-hardened-account-bound-probe)', async () => {
  const modUrl = pathToFileURL(join(PROBES_DIR, 'real-account-cloud-init-hardened.mjs')).href;
  const mod = await import(modUrl);
  assert.equal(mod.accountBound, true);
  const readme = await readFile(join(FIXTURE_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /six ssh baseline checks/);
  const out = await runProbe('real-account-cloud-init-hardened', { CI_HAS_HETZNER_ACCOUNT: 'false' });
  assertRowsCarry7dShape(out.results, 'real-account-cloud-init-hardened skip');
  assert.equal(out.results[0].accountBoundSkipped, true);
  assert.equal(out.results[0].reason, 'CI_HAS_HETZNER_ACCOUNT');
});

test('T-1 deploy-hetzner-server AC-11301-1 firewall shape valid and refuses open ssh (TC-140-firewall-shape-valid-and-refuses-open-ssh)', async () => {
  const modUrl = pathToFileURL(join(PROBES_DIR, 'manifest-schema-validate.mjs')).href + '?ts=' + Date.now();
  const { validate } = await import(modUrl);
  const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));
  const good = JSON.parse(await readFile(join(MANIFEST_DIR, 'ci-throwaway.json'), 'utf8'));
  assert.deepEqual(validate(schema, good), []);
  const bad = JSON.parse(JSON.stringify(good));
  const ssh = bad.firewallRules.find((r) => r.name === 'ssh');
  ssh.sourceIps = ['0.0.0.0/0'];
  const errors = validate(schema, bad);
  assert.ok(errors.some((e) => (e.message || '').includes('0.0.0.0/0')), `expected refusal for open-ssh mutation, got: ${JSON.stringify(errors)}`);
});

test('T-1 deploy-hetzner-server AC-11401-1 snapshot cadence enum (TC-140-snapshot-cadence-enum)', async () => {
  const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));
  assert.deepEqual(schema.properties.snapshotCadence.enum.sort(), ['daily', 'off', 'weekly']);
});

test('T-1 deploy-hetzner-server AC-11402-1 snapshot on demand account-bound probe declared (TC-140-snapshot-on-demand-account-bound-probe)', async () => {
  const modUrl = pathToFileURL(join(PROBES_DIR, 'real-account-snapshot-on-demand.mjs')).href;
  const mod = await import(modUrl);
  assert.equal(mod.accountBound, true);
  const out = await runProbe('real-account-snapshot-on-demand', { CI_HAS_HETZNER_ACCOUNT: 'false' });
  assertRowsCarry7dShape(out.results, 'real-account-snapshot-on-demand skip');
  assert.equal(out.results[0].accountBoundSkipped, true);
  assert.equal(out.results[0].reason, 'CI_HAS_HETZNER_ACCOUNT');
});

test('T-1 deploy-hetzner-server AC-11501-1 lifecycle events metadata only (TC-140-lifecycle-events-metadata-only)', async () => {
  const out = await runProbe('hcloud-dry-run-mock');
  assertRowsCarry7dShape(out.results, 'hcloud-dry-run-mock');
  const secrecy = out.results.find((r) => r.anchorAcId === 'AC-37109-1');
  assert.ok(secrecy, `expected an event-secrecy scan result`);
  assert.equal(secrecy.verdict, 'pass', `event-secrecy scan should pass on canonical state; got: ${secrecy.detail}`);
  const eventNames = new Set(out.extra.events.map((e) => e.event));
  for (const n of ['provisionerReady', 'hetznerServerProvisioned', 'hetznerSnapshotTaken', 'hetznerServerDestroyed']) {
    assert.ok(eventNames.has(n), `expected event ${n} in the lifecycle; got ${[...eventNames].join(', ')}`);
  }
});

test('T-1 deploy-hetzner-server shelf shape: section 6a cloudHost row and docs/topics.md registry entries', async () => {
  const authoring = await readFile(AUTHORING, 'utf8');
  assert.match(authoring, /^\|\s*`cloudHost`\s*\|/m, 'blueprint-authoring.md section 6a is missing the cloudHost row');
  const readme = await readFile(README, 'utf8');
  assert.match(readme, /deploy-hetzner-server/);
  const changelog = await readFile(CHANGELOG, 'utf8');
  assert.match(changelog, /^##\s*1\.0\.0/m, 'blueprint CHANGELOG.md is missing the 1.0.0 heading');
  const guide = await readFile(GUIDE, 'utf8');
  assert.match(guide, /## When to reach for `cx23` vs `cx33`/);
  const ownTopics = await readFile(OWN_TOPICS, 'utf8');
  assert.match(ownTopics, /deploy-hetzner-server/);
});

// TC-175-mock-consumes-rendered-file-and-probe-purity (RCF chain
// AC-14501-1 / the H hardening story / the H hardening requirement / the H mock-purity suite in packages/rcf-lite/rcf/):
// the mocked probe path renders the shipped cloud-init.yaml.tmpl and
// consumes the same rendered file the real path consumes; the fixture
// renderer output carries an ssh public-key line under the deploy user
// and a NOPASSWD sudoers.d directive naming that user. Plus the hardening
// mutation-purity assertion that no probe body reads
// process.env.SIMULATE_. The blueprint-contributed probe rows no
// longer anchor to AC-14501-1 (v1.1.5:
// blueprint user stories do not declare AC-14501-1); the RCF chain
// artefacts remain the sole owners of that AC and this test carries
// the observation on their behalf.
test('H-1 deploy-hetzner-server AC-14501-1 mock consumes the same rendered cloud-init and probes carry no SIMULATE reads (TC-175-mock-consumes-rendered-file-and-probe-purity)', async () => {
  const rendererPath = pathToFileURL(join(FIXTURE_ROOT, 'src/cloud-init-renderer.mjs')).href;
  const { renderCloudInitToFile } = await import(rendererPath);
  const manifest = JSON.parse(await readFile(join(FIXTURE_ROOT, 'hetzner/servers/ci-throwaway.json'), 'utf8'));
  const publicKeys = ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakePubKeyForAnatomyTest rcf-lite-ci-anatomy'];
  const { renderedPath } = await renderCloudInitToFile(manifest, { publicKeys });
  const renderedFromDisk = await readFile(renderedPath, 'utf8');
  assert.ok(/(ssh-ed25519|ssh-rsa)\s+/i.test(renderedFromDisk), 'rendered cloud-init must carry an ssh public-key line under the deploy user');
  assert.ok(/deploy\s+ALL\s*=\s*\(ALL\)\s+NOPASSWD/i.test(renderedFromDisk), 'rendered cloud-init must carry a NOPASSWD directive for the deploy user');

  // Mutation-purity: no deploy-hetzner-server mocked probe body reads
  // process.env.SIMULATE_. The switches live in the fixture-side shims.
  const probes = ['cloud-init-render-lint', 'manifest-schema-validate', 'hcloud-dry-run-mock'];
  for (const name of probes) {
    const body = await readFile(join(PROBES_DIR, `${name}.mjs`), 'utf8');
    const stripped = body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.ok(
      !/process\.env\.SIMULATE_/.test(stripped),
      `${name}.mjs probe body reads a process.env.SIMULATE_ switch; move it to the fixture-side shim per mutation-purity gate row.`,
    );
  }
});

// TC-140-env-vars-declared-on-fixture-manifest (positive-evidence gate
// row 7d): every env var the deploy-hetzner-server probes read is declared on the fixture
// manifest, and skip reasons on the three real-account probes name
// their gate variables literally with the honest set-but-not-true /
// unset distinction.
test('deploy-hetzner-server v1.1.4 env vars declared and skip reasons name variables literally', async () => {
  const readme = await readFile(join(FIXTURE_ROOT, 'README.md'), 'utf8');
  const section = readme.split('## Declared env vars (deploy-hetzner-server probes)')[1] || '';
  assert.ok(section.length > 0, 'fixture README is missing the deploy-hetzner-server declared env vars section');
  for (const v of ['CI_HAS_HETZNER_ACCOUNT', 'HCLOUD_TOKEN', 'GITHUB_RUN_ID', 'RCF_LITE_CI_SSH_KEY', 'RCF_LITE_CI_SSH_KEY_NAME', 'RCF_FIXTURE_MANIFEST_DIR']) {
    assert.ok(section.includes('`' + v + '`'), 'deploy-hetzner-server declared env vars table missing ' + v);
  }
  const provisionSkip = await runProbe('real-account-throwaway-server-provision', { CI_HAS_HETZNER_ACCOUNT: 'false' });
  assertRowsCarry7dShape(provisionSkip.results, 'provision skip');
  assert.equal(provisionSkip.results[0].accountBoundSkipped, true);
  assert.equal(provisionSkip.results[0].reason, 'CI_HAS_HETZNER_ACCOUNT');
  assert.match(provisionSkip.results[0].detail, /set-but-not-true/);
  // Second-tier skip: CI_HAS_HETZNER_ACCOUNT=true but HCLOUD_TOKEN unset.
  const savedToken = process.env.HCLOUD_TOKEN;
  delete process.env.HCLOUD_TOKEN;
  try {
    const provSecondTier = await runProbe('real-account-throwaway-server-provision', { CI_HAS_HETZNER_ACCOUNT: 'true' });
    assertRowsCarry7dShape(provSecondTier.results, 'provision second-tier skip');
    assert.equal(provSecondTier.results[0].accountBoundSkipped, true);
    assert.equal(provSecondTier.results[0].reason, 'HCLOUD_TOKEN');
  } finally {
    if (savedToken !== undefined) process.env.HCLOUD_TOKEN = savedToken;
  }
  const utilsPath = join(PROBES_DIR, 'probe-utils.mjs');
  const utils = await readFile(utilsPath, 'utf8');
  assert.match(utils, /export async function runShim/);
  assert.match(utils, /export function firstTierGateSkipResult/);
  assert.match(utils, /export function secondTierMissingSkipResult/);
});

// Aggregation and empty-result contract (the shape rule).
test('T-1 deploy-hetzner-server probe-utils empty results FAIL with detail exactly "no checks ran"', async () => {
  const modUrl = pathToFileURL(join(PROBES_DIR, 'probe-utils.mjs')).href + '?ts=' + Date.now();
  const { aggregate, emptyResultsFail } = await import(modUrl);
  assert.equal(aggregate([]), 'fail');
  assert.equal(aggregate(null), 'fail');
  const row = emptyResultsFail('AC-any');
  assert.equal(row.detail, 'no checks ran');
  assert.equal(row.verdict, 'fail');
});
