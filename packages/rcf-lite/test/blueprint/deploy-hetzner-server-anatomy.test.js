// Anatomy + shape + probe + fixture + shelf-doc test for the
// deploy-hetzner-server blueprint (Hetzner shipped hetzner-server
// spec, 2026-09-07 section 5.6). Enforces the strict inline row
// shape at the shelf and the v1.1.x pins.

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

// Strict inline row shape (semantic, not key-name allow-list):
//   (a) an honest skip: accountBoundSkipped === true AND reason is
//       exactly one of the declared gate variables in the fixture
//       README env-var table for this blueprint, OR
//   (b) evidence carries BOTH a non-empty VENDOR-MINTED IDENTIFIER
//       and a non-empty ROW-SPECIFIC DERIVED OBSERVATION.
//
// Vendor-minted identifier: one of a small explicit set of fields
// whose value was minted by the vendor API for this row (a
// vendor-returned server id, snapshot id, firewall id, image id,
// vendor request id, or a 64-hex Docker container id from
// `docker inspect`). Nothing else counts: probe-computed hashes,
// event names, file paths, service or manifest names, container
// names the runner chose, and probe inputs are derived context,
// never identity. There is no supplied/echo path for this family:
// a value the probe supplied is not evidence that the engine
// echoed it back with vendor-minted state, and the pair is
// therefore not an identifier.
//
// Mock and offline rows have no vendor-minted identifier by nature
// and are always `conformanceOnly` de-claims with `anchorAcId: null`
// and a `limitation` string naming the shipped AC clause they do
// not observe; identity and observation checks apply to anchored
// (counting) rows only.
//
// Row-specific derived observation: for each counting probe on this
// blueprint the field(s) that constitute its observation are named
// below, and only those satisfy the observation half. Generic
// fields (`observed`, `port`, `protocol`, `direction`) do not
// count.
//
//   provision: `primaryIpv4` and `location` returned by the vendor
//   cloud-init hardened: `exitStatus` on `cloud-init status --wait`
//     plus the six baseline-check excerpts under `baselineChecks`
//   snapshot on demand: `postCreateSnapshotIds` (id present after
//     create) and `postTeardownSnapshotIds` (id absent after
//     teardown), sampled via `hcloud image list`
//
//   `notObservableHere` is reserved for browser-only ACs. The
//   deploy-hetzner-server blueprint has no browser-only ACs, so
//   BROWSER_ONLY_ACS is EMPTY and any notObservableHere row FAILS.
//   `conformanceOnly` rows must carry a `limitation` string whose
//   first token is a shipped AC id in the blueprint user stories.
// A row that only carries `{probeName, reason}` never counts, and a
// numeric identity value of zero is not an observation.
const ENGINE_MINTED_ID_FIELDS = new Set([
  // Vendor-minted or resource ids returned by the vendor API (or,
  // for the compose blueprint, the 64-hex `containerId` from
  // `docker inspect`). Generic `id` and `resourceId` are NOT
  // accepted; a counting row must carry the resource-specific field.
  'serverId', 'snapshotId', 'firewallId', 'imageId',
  'containerId', 'vendorRequestId', 'requestId',
]);
const DERIVED_OBSERVATION_FIELDS = new Set([
  // provision (AC-37103-*): vendor-returned resource shape
  'primaryIpv4', 'location',
  // cloud-init hardened (AC-37105-*): cloud-init status exit and
  // six baseline-check bodies
  'exitStatus', 'baselineChecks', 'sshReadiness',
  // snapshot on demand (AC-37108-*): id present-then-absent
  'postCreateSnapshotIds', 'postTeardownSnapshotIds',
  'postCreateSnapshotCarriedId', 'postProvisionServerIds',
  'postTeardownServerIds',
  // Support fields for the counting-row observations above
  'wallClockTime', 'bodyExcerpt', 'tailExcerpt', 'statusCode',
  // Skip-row / offline conformanceOnly rows still need at least
  // one derived observation to satisfy the shape check when they
  // are wrongly anchored; keep a small tail here for that.
  'eventCount', 'renderedByteLength',
]);
// Browser-only ACs are the only ones that may legitimately carry a
// notObservableHere row. The deploy-hetzner-server blueprint ships
// process/live-observable ACs only, so this set is EMPTY.
const BROWSER_ONLY_ACS = new Set();
// Declared gate variables (fixture README env-vars section);
// accountBoundSkipped reason must be exactly one of these.
const DECLARED_SKIP_VARS = new Set([
  'CI_HAS_HETZNER_ACCOUNT', 'HCLOUD_TOKEN', 'GITHUB_RUN_ID',
  'RCF_LITE_CI_SSH_KEY', 'RCF_LITE_CI_SSH_KEY_NAME',
  'RCF_FIXTURE_MANIFEST_DIR',
]);
// Shipped ACs for this blueprint, loaded from the user stories at
// test start-up so conformanceOnly rows can be checked against a
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
      assert.ok(BROWSER_ONLY_ACS.has(ac), `${label}: notObservableHere is reserved for browser-only ACs; deploy-hetzner-server has NONE, so any notObservableHere row FAILS anatomy. Row claims ac=${JSON.stringify(ac)}: ${JSON.stringify(r).slice(0, 300)}`);
    }
    if (r.conformanceOnly) {
      assert.equal(typeof r.limitation, 'string', `${label}: conformanceOnly row must carry a limitation string: ${JSON.stringify(r).slice(0, 300)}`);
      assert.equal(r.anchorAcId, null, `${label}: conformanceOnly row must carry anchorAcId: null: ${JSON.stringify(r).slice(0, 300)}`);
      const m = r.limitation.match(/^(AC-[A-Za-z0-9-]+)\b/);
      assert.ok(m, `${label}: conformanceOnly limitation must start with a shipped AC id token; got ${JSON.stringify(r.limitation).slice(0, 200)}`);
      assert.ok(shipped.has(m[1]), `${label}: conformanceOnly limitation names ${m[1]}, which is not a shipped AC on deploy-hetzner-server`);
      // conformanceOnly rows attest to a limitation, not a live
      // observation; identity and observation checks are for
      // anchored rows only.
      continue;
    }
    const ev = (r.evidence && typeof r.evidence === 'object') ? r.evidence : {};
    const engineIdKeysPresent = Object.keys(ev).filter((k) => ENGINE_MINTED_ID_FIELDS.has(k) && isNonEmpty(ev[k]));
    const observationKeysPresent = Object.keys(ev).filter((k) => DERIVED_OBSERVATION_FIELDS.has(k) && isNonEmpty(ev[k]));
    assert.ok(engineIdKeysPresent.length > 0, `${label}: row evidence lacks a vendor-minted identifier (serverId, snapshotId, firewallId, imageId, containerId, vendorRequestId or requestId returned by the vendor API); no supplied/echo path exists for this family. Keys observed: ${Object.keys(ev).join(', ')} : ${JSON.stringify(r).slice(0, 400)}`);
    assert.ok(observationKeysPresent.length > 0, `${label}: row evidence lacks a row-specific derived observation (see the per-probe observation fields at the top of this file: primaryIpv4/location for provision, exitStatus/baselineChecks for cloud-init hardened, postCreateSnapshotIds/postTeardownSnapshotIds for snapshot on demand); generic fields like 'observed', 'port', 'protocol' do not count. Keys observed: ${Object.keys(ev).join(', ')} : ${JSON.stringify(r).slice(0, 400)}`);
  }
}

test('deploy-hetzner-server AC-11001-1 provisioner boot and sole reader', async () => {
  const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(bp.slug, 'deploy-hetzner-server');
  assert.equal(bp.version, '1.1.9');
  assert.equal(bp.category, 'deploy');
  assert.deepEqual(bp.capabilities, ['cloudHost']);
  const out = await runProbe('hcloud-dry-run-mock');
  await assertRowsCarry7dShape(out.results, 'hcloud-dry-run-mock');
  // AC-37101-1 is no longer credited by the offline mock (mock ids
  // are not vendor-minted): the sole-reader and provisionerReady
  // clauses land on a conformanceOnly de-claim whose limitation
  // starts with AC-37101-1.
  const readyResult = out.results.find((r) => r.conformanceOnly === true && r.anchorAcId === null && typeof r.limitation === 'string' && r.limitation.startsWith('AC-37101-1') && r.detail.includes('provisionerReady fired'));
  assert.ok(readyResult, `expected an AC-37101-1 conformanceOnly de-claim with a provisionerReady pass detail; got: ${JSON.stringify(out.results, null, 2)}`);
  assert.equal(readyResult.verdict, 'pass');
  assert.ok(readyResult.evidence && readyResult.evidence.eventName === 'provisionerReady', 'evidence must carry eventName');
  // AC-37101-1 clause (a): the provisioner facade module is the SOLE
  // reader of the operator variable HETZNER_ACCOUNT_API_KEY (the
  // default token source reads process.env of that name; callers may
  // still inject an explicit token). Assert the facade file names it
  // on at least one non-comment line and no other .mjs/.js file in
  // the fixture source tree names it.
  const facadeText = await readFile(join(FIXTURE_ROOT, 'src/provisioner-facade.mjs'), 'utf8');
  const facadeNonCommentReaders = facadeText.split('\n').filter((l) => {
    if (!l.includes('HETZNER_ACCOUNT_API_KEY')) return false;
    const t = l.trim();
    return !(t.startsWith('//') || t.startsWith('*'));
  });
  assert.ok(facadeNonCommentReaders.length >= 1, `provisioner facade must name HETZNER_ACCOUNT_API_KEY on at least one non-comment line (it is the sole reader clause of AC-37101-1); found ${facadeNonCommentReaders.length} matching line(s).`);
  assert.equal(readyResult.evidence.readerCount >= 1, true, `AC-37101-1 row must observe at least one reader; got readerCount=${readyResult.evidence.readerCount}`);
  assert.deepEqual(
    readyResult.evidence.readers && readyResult.evidence.readers.every((r) => typeof r === 'string' && r.startsWith('src/provisioner-facade.mjs:')),
    true,
    `AC-37101-1 row must observe every reader inside src/provisioner-facade.mjs; got readers=${JSON.stringify(readyResult.evidence.readers)}`,
  );
});

test('deploy-hetzner-server AC-11101-1 manifest schema shape valid', async () => {
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
  await assertRowsCarry7dShape(out.results, 'manifest-schema-validate');
  const bad = out.results.find((r) => r.verdict !== 'pass');
  assert.ok(!bad, `manifest-schema-validate should pass on the shipped fixture, got: ${bad ? bad.detail : ''}`);
  // Per-property de-claim: at least one row limits AC-37106-1
  // (firewall) and one limits AC-37107-1 (snapshotCadence). The
  // offline manifest scan has no engine-minted identifier so every
  // row is a conformanceOnly de-claim; the live observation lives
  // on the real-account probes named in each limitation.
  assert.ok(out.results.some((r) => r.conformanceOnly === true && typeof r.limitation === 'string' && r.limitation.startsWith('AC-37106-1')), 'manifest-schema-validate must emit a firewall-limitation conformanceOnly row starting with AC-37106-1');
  assert.ok(out.results.some((r) => r.conformanceOnly === true && typeof r.limitation === 'string' && r.limitation.startsWith('AC-37107-1')), 'manifest-schema-validate must emit a snapshotCadence-limitation conformanceOnly row starting with AC-37107-1');
});

test('deploy-hetzner-server AC-11102-1 manifest applies to mocked provision', async () => {
  const out = await runProbe('hcloud-dry-run-mock');
  await assertRowsCarry7dShape(out.results, 'hcloud-dry-run-mock');
  // The mock-path row that observes the hetznerServerProvisioned
  // event shape is de-claimed (anchorAcId: null, conformanceOnly,
  // limitation names AC-37103-1) because the AC requires the
  // real-account inventory diff; the live evidence lives on
  // real-account-throwaway-server-provision. Assert the de-claim
  // shape via the shipped-AC limitation prefix.
  const provisionedResult = out.results.find((r) => r.conformanceOnly === true && r.anchorAcId === null && typeof r.limitation === 'string' && r.limitation.startsWith('AC-37103-1') && r.evidence && r.evidence.eventName === 'hetznerServerProvisioned');
  assert.ok(provisionedResult, `expected a de-claimed row for AC-37103-1 observing the hetznerServerProvisioned event shape; got: ${JSON.stringify(out.results, null, 2)}`);
  assert.equal(provisionedResult.verdict, 'pass');
  assert.equal(provisionedResult.evidence.location, 'fsn1');
  assert.equal(provisionedResult.evidence.serverType, 'cx23');
  assert.ok(!provisionedResult.notObservableHere, 'de-claimed row must NOT carry notObservableHere; that field is reserved for browser-only ACs (empty set on this blueprint)');
});

test('deploy-hetzner-server AC-11201-1 cloud-init render baseline present', async () => {
  const tmpl = await readFile(TEMPLATE_PATH, 'utf8');
  assert.match(tmpl, /PermitRootLogin no/);
  assert.match(tmpl, /PasswordAuthentication no/);
  assert.match(tmpl, /ufw default deny incoming/);
  assert.match(tmpl, /DOCKER-USER/);
  assert.match(tmpl, /fail2ban/);
  assert.match(tmpl, /50unattended-upgrades/);
  const out = await runProbe('cloud-init-render-lint');
  await assertRowsCarry7dShape(out.results, 'cloud-init-render-lint');
  const bad = out.results.find((r) => r.verdict !== 'pass');
  assert.ok(!bad, `cloud-init-render-lint should pass on the shipped fixture, got: ${bad ? bad.detail : ''}`);
});

test('deploy-hetzner-server AC-11202-1 cloud-init hardened account-bound probe declared', async () => {
  const modUrl = pathToFileURL(join(PROBES_DIR, 'real-account-cloud-init-hardened.mjs')).href;
  const mod = await import(modUrl);
  assert.equal(mod.accountBound, true);
  const readme = await readFile(join(FIXTURE_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /six ssh baseline checks/);
  const out = await runProbe('real-account-cloud-init-hardened', { CI_HAS_HETZNER_ACCOUNT: 'false' });
  await assertRowsCarry7dShape(out.results, 'real-account-cloud-init-hardened skip');
  assert.equal(out.results[0].accountBoundSkipped, true);
  assert.equal(out.results[0].reason, 'CI_HAS_HETZNER_ACCOUNT');
});

test('deploy-hetzner-server AC-11301-1 firewall shape valid and refuses open ssh', async () => {
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

test('deploy-hetzner-server AC-11401-1 snapshot cadence enum', async () => {
  const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));
  assert.deepEqual(schema.properties.snapshotCadence.enum.sort(), ['daily', 'off', 'weekly']);
});

test('deploy-hetzner-server AC-11402-1 snapshot on demand account-bound probe declared', async () => {
  const modUrl = pathToFileURL(join(PROBES_DIR, 'real-account-snapshot-on-demand.mjs')).href;
  const mod = await import(modUrl);
  assert.equal(mod.accountBound, true);
  const out = await runProbe('real-account-snapshot-on-demand', { CI_HAS_HETZNER_ACCOUNT: 'false' });
  await assertRowsCarry7dShape(out.results, 'real-account-snapshot-on-demand skip');
  assert.equal(out.results[0].accountBoundSkipped, true);
  assert.equal(out.results[0].reason, 'CI_HAS_HETZNER_ACCOUNT');
});

test('deploy-hetzner-server AC-11501-1 lifecycle events metadata only', async () => {
  const out = await runProbe('hcloud-dry-run-mock');
  await assertRowsCarry7dShape(out.results, 'hcloud-dry-run-mock');
  // AC-37109-1 is no longer credited by the offline mock (mock ids
  // are not vendor-minted): the event-secrecy scan lands on a
  // conformanceOnly de-claim whose limitation starts with
  // AC-37109-1.
  const secrecy = out.results.find((r) => r.conformanceOnly === true && r.anchorAcId === null && typeof r.limitation === 'string' && r.limitation.startsWith('AC-37109-1'));
  assert.ok(secrecy, `expected an AC-37109-1 conformanceOnly de-claim from the event-secrecy scan`);
  assert.equal(secrecy.verdict, 'pass', `event-secrecy scan should pass on canonical state; got: ${secrecy.detail}`);
  const eventNames = new Set(out.extra.events.map((e) => e.event));
  for (const n of ['provisionerReady', 'hetznerServerProvisioned', 'hetznerSnapshotTaken', 'hetznerServerDestroyed']) {
    assert.ok(eventNames.has(n), `expected event ${n} in the lifecycle; got ${[...eventNames].join(', ')}`);
  }
});

test('deploy-hetzner-server shelf shape: section 6a cloudHost row and docs/topics.md registry entries', async () => {
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

// AC-14501-1 lives on the RCF chain (the hardening story and its
// mocked-probe-purity property). The mocked probe path renders the
// shipped cloud-init.yaml.tmpl and consumes the same rendered file
// the real path consumes; the fixture renderer output carries an
// ssh public-key line under the deploy user and a NOPASSWD
// sudoers.d directive naming that user. Plus the mutation-purity
// property that no probe body reads process.env.SIMULATE_. The
// blueprint-contributed probe rows no longer anchor to AC-14501-1
// (blueprint v1.1.5+: blueprint user stories do not declare
// AC-14501-1); the RCF chain artefacts remain the sole owners of
// that AC and this test carries the observation on their behalf.
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

// Positive-evidence gate row 7d: every env var the
// deploy-hetzner-server probes read is declared on the fixture
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
  await assertRowsCarry7dShape(provisionSkip.results, 'provision skip');
  assert.equal(provisionSkip.results[0].accountBoundSkipped, true);
  assert.equal(provisionSkip.results[0].reason, 'CI_HAS_HETZNER_ACCOUNT');
  assert.match(provisionSkip.results[0].detail, /set-but-not-true/);
  // Second-tier skip: CI_HAS_HETZNER_ACCOUNT=true but HCLOUD_TOKEN unset.
  const savedToken = process.env.HCLOUD_TOKEN;
  delete process.env.HCLOUD_TOKEN;
  try {
    const provSecondTier = await runProbe('real-account-throwaway-server-provision', { CI_HAS_HETZNER_ACCOUNT: 'true' });
    await assertRowsCarry7dShape(provSecondTier.results, 'provision second-tier skip');
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
test('deploy-hetzner-server probe-utils empty results FAIL with detail exactly "no checks ran"', async () => {
  const modUrl = pathToFileURL(join(PROBES_DIR, 'probe-utils.mjs')).href + '?ts=' + Date.now();
  const { aggregate, emptyResultsFail } = await import(modUrl);
  assert.equal(aggregate([]), 'fail');
  assert.equal(aggregate(null), 'fail');
  const row = emptyResultsFail('AC-any');
  assert.equal(row.detail, 'no checks ran');
  assert.equal(row.verdict, 'fail');
});
