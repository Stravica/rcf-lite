// Anatomy + shape + probe + fixture + shelf-doc test for the
// deploy-hetzner-server v1.0.0 blueprint (T-1 of the Hetzner round 7
// spec, 2026-09-07 section 5.6). Covers TS-140 (nine TCs) on the T-1
// repo chain slice: TC-140-manifest-schema-shape-valid,
// TC-140-manifest-applies-mocked-provision,
// TC-140-cloud-init-render-baseline-present,
// TC-140-cloud-init-hardened-account-bound-probe,
// TC-140-firewall-shape-valid-and-refuses-open-ssh,
// TC-140-snapshot-cadence-enum,
// TC-140-snapshot-on-demand-account-bound-probe,
// TC-140-lifecycle-events-metadata-only,
// and the provisioner boot + sole reader assertion via the mocked
// dry-run path (TC-140-provisioner-boot-and-sole-reader).

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

// TC-140-provisioner-boot-and-sole-reader (AC-11001-1 / AC-37101-1):
// the hcloud dry-run mock drives the facade through its lifecycle and
// asserts provisionerReady fires with metadata-only payload; the
// facade module is grep-clean of any secondary token reader.
test('T-1 deploy-hetzner-server AC-11001-1 provisioner boot and sole reader (TC-140)', async () => {
  const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(bp.slug, 'deploy-hetzner-server');
  assert.equal(bp.version, '1.1.1');
  assert.equal(bp.category, 'deploy');
  assert.deepEqual(bp.capabilities, ['cloudHost']);
  const out = await runProbe('hcloud-dry-run-mock');
  const readyResult = out.results.find((r) => r.detail.includes('provisionerReady fired'));
  assert.ok(readyResult, `expected a provisionerReady pass result; got: ${JSON.stringify(out.results, null, 2)}`);
  assert.equal(readyResult.verdict, 'pass');
  const facadeText = await readFile(join(FIXTURE_ROOT, 'src/provisioner-facade.mjs'), 'utf8');
  const otherTokenReaders = facadeText.split('\n').filter((l) => l.includes('HETZNER_ACCOUNT_API_KEY'));
  assert.equal(otherTokenReaders.length, 0, `facade must not name HETZNER_ACCOUNT_API_KEY (it captures via the injected token; grep found: ${otherTokenReaders.join(' | ')})`);
});

// TC-140-manifest-schema-shape-valid (AC-11101-1 / AC-37102-1):
// schema validates the shipped fixture manifest and every required
// field is present.
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
  const bad = out.results.find((r) => r.verdict !== 'pass');
  assert.ok(!bad, `manifest-schema-validate should pass on the shipped fixture, got: ${bad ? bad.detail : ''}`);
});

// TC-140-manifest-applies-mocked-provision (AC-11102-1 / AC-37103-1):
// the mocked dry-run path drives createServer and captures a
// hetznerServerProvisioned event with the expected fields.
test('T-1 deploy-hetzner-server AC-11102-1 manifest applies to mocked provision (TC-140-manifest-applies-mocked-provision)', async () => {
  const out = await runProbe('hcloud-dry-run-mock');
  const provisionedResult = out.results.find((r) => r.detail.includes('hetznerServerProvisioned fired'));
  assert.ok(provisionedResult, `expected a hetznerServerProvisioned pass result; got: ${JSON.stringify(out.results, null, 2)}`);
  assert.equal(provisionedResult.verdict, 'pass');
  assert.match(provisionedResult.detail, /location=fsn1/);
  assert.match(provisionedResult.detail, /serverType=cx23/);
});

// TC-140-cloud-init-render-baseline-present (AC-11201-1 / AC-37104-1):
// the six baseline blocks appear in the rendered YAML; template is
// declaratively wired.
test('T-1 deploy-hetzner-server AC-11201-1 cloud-init render baseline present (TC-140-cloud-init-render-baseline-present)', async () => {
  const tmpl = await readFile(TEMPLATE_PATH, 'utf8');
  assert.match(tmpl, /PermitRootLogin no/);
  assert.match(tmpl, /PasswordAuthentication no/);
  assert.match(tmpl, /ufw default deny incoming/);
  assert.match(tmpl, /DOCKER-USER/);
  assert.match(tmpl, /fail2ban/);
  assert.match(tmpl, /50unattended-upgrades/);
  const out = await runProbe('cloud-init-render-lint');
  const bad = out.results.find((r) => r.verdict !== 'pass');
  assert.ok(!bad, `cloud-init-render-lint should pass on the shipped fixture, got: ${bad ? bad.detail : ''}`);
});

// TC-140-cloud-init-hardened-account-bound-probe (AC-11202-1 /
// AC-37105-1): probe module declares accountBound true; fixture README
// documents the ssh baseline checks.
test('T-1 deploy-hetzner-server AC-11202-1 cloud-init hardened account-bound probe declared (TC-140-cloud-init-hardened-account-bound-probe)', async () => {
  const modUrl = pathToFileURL(join(PROBES_DIR, 'real-account-cloud-init-hardened.mjs')).href;
  const mod = await import(modUrl);
  assert.equal(mod.accountBound, true);
  const readme = await readFile(join(FIXTURE_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /six ssh baseline checks/);
  // Ensure the probe reports skipped when the env var is unset.
  const out = await runProbe('real-account-cloud-init-hardened', { CI_HAS_HETZNER_ACCOUNT: 'false' });
  assert.equal(out.results[0].accountBoundSkipped, true);
});

// TC-140-firewall-shape-valid-and-refuses-open-ssh (AC-11301-1 /
// AC-37106-1): schema accepts the fixture and refuses a mutation that
// opens 22 to 0.0.0.0/0.
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

// TC-140-snapshot-cadence-enum (AC-11401-1 / AC-37107-1): schema enum
// is {weekly, daily, off}.
test('T-1 deploy-hetzner-server AC-11401-1 snapshot cadence enum (TC-140-snapshot-cadence-enum)', async () => {
  const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));
  assert.deepEqual(schema.properties.snapshotCadence.enum.sort(), ['daily', 'off', 'weekly']);
});

// TC-140-snapshot-on-demand-account-bound-probe (AC-11402-1 /
// AC-37108-1): probe module declares accountBound true; skipped
// record when env var is unset.
test('T-1 deploy-hetzner-server AC-11402-1 snapshot on demand account-bound probe declared (TC-140-snapshot-on-demand-account-bound-probe)', async () => {
  const modUrl = pathToFileURL(join(PROBES_DIR, 'real-account-snapshot-on-demand.mjs')).href;
  const mod = await import(modUrl);
  assert.equal(mod.accountBound, true);
  const out = await runProbe('real-account-snapshot-on-demand', { CI_HAS_HETZNER_ACCOUNT: 'false' });
  assert.equal(out.results[0].accountBoundSkipped, true);
});

// TC-140-lifecycle-events-metadata-only (AC-11501-1 / AC-37109-1): the
// dry-run mock accumulates four events, event-secrecy scan finds no
// leaked token / private key / user-data content in any body.
test('T-1 deploy-hetzner-server AC-11501-1 lifecycle events metadata only (TC-140-lifecycle-events-metadata-only)', async () => {
  const out = await runProbe('hcloud-dry-run-mock');
  const secrecy = out.results.find((r) => r.anchorAcId === 'AC-37109-1');
  assert.ok(secrecy, `expected an event-secrecy scan result`);
  assert.equal(secrecy.verdict, 'pass', `event-secrecy scan should pass on canonical state; got: ${secrecy.detail}`);
  const eventNames = new Set(out.extra.events.map((e) => e.event));
  for (const n of ['provisionerReady', 'hetznerServerProvisioned', 'hetznerSnapshotTaken', 'hetznerServerDestroyed']) {
    assert.ok(eventNames.has(n), `expected event ${n} in the lifecycle; got ${[...eventNames].join(', ')}`);
  }
});

// Shelf shape assertion: section 6a cloudHost row is present on the
// authoring doc; docs/topics.md carries the deploy-hetzner-server row
// on every shipped blueprint's registry.
test('T-1 shelf shape: section 6a cloudHost row and docs/topics.md registry entries', async () => {
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

// TC-175-mock-consumes-rendered-file-and-probe-purity (AC-14501-1):
// H-1 hardening block asserts that (a) the hcloud-dry-run-mock probe
// reads back the SAME rendered cloud-init file the real path consumes,
// with an ssh public-key line for the deploy user and a NOPASSWD
// directive naming that user; and (b) none of the three T-1 mocked
// probe modules read process.env.SIMULATE_ inside the probe body.
test('H-1 deploy-hetzner-server AC-14501-1 mock consumes the same rendered cloud-init and probes carry no SIMULATE reads (TC-175-mock-consumes-rendered-file-and-probe-purity)', async () => {
  const out = await runProbe('hcloud-dry-run-mock');
  const rendered = out.results.find((r) => r.anchorAcId === 'AC-14501-1');
  assert.ok(rendered, 'expected a rendered-file assertion result');
  assert.equal(rendered.verdict, 'pass', `rendered-file assertion should pass; got: ${rendered.detail}`);
  assert.ok(out.extra.renderedPath, 'probe should report the rendered path');
  assert.equal(out.extra.renderedAssertions.sshKeyLine, true);
  assert.equal(out.extra.renderedAssertions.nopasswdLine, true);

  // Mutation-purity: no probe body reads process.env.SIMULATE_.
  const probes = ['cloud-init-render-lint', 'manifest-schema-validate', 'hcloud-dry-run-mock'];
  for (const name of probes) {
    const body = await readFile(join(PROBES_DIR, `${name}.mjs`), 'utf8');
    // Strip block and line comments before scanning; the assertion
    // must fail on process.env.SIMULATE_ reads only, not documentation.
    const stripped = body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.ok(
      !/process\.env\.SIMULATE_/.test(stripped),
      `${name}.mjs probe body reads a process.env.SIMULATE_ switch; move it to the fixture-side shim per H-1 mutation-purity gate row.`,
    );
  }
});
