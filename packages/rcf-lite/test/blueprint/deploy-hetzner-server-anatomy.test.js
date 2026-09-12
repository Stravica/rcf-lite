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

// Per-probe requirement map (v1.1.12). Every counting row (a row
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
//     `serverId`, `snapshotId`, `firewallId`, `imageId`,
//     `vendorRequestId` and `requestId` all use this shape.
//   - hex64: a 64-character hex string (`^[a-f0-9]{64}$`, case
//     insensitive), as `docker inspect --format '{{.Id}}'` returns
//     for a Docker container id.
//
// Observation fields are located by a DEEP search into the row's
// `evidence` tree, so a required field nested under (for example)
// `evidence.burst` or `evidence.observedSecretModes.observations`
// still counts. Arbitrary cross-probe combinations of fields fail:
// a row anchored to a provision AC must carry the provision
// observations, not (say) `baselineChecks`. Generic keys
// (`observed`, `port`, `protocol`, `direction`, bare `id` or
// `resourceId`) are not part of any probe's rule; a
// supplied/echoed pair is not evidence.
//
// Deploy probe rules (this file):
//   real-account-throwaway-server-provision / AC-37103-1
//     identifier: serverId (vendorId)
//     required: primaryIpv4, location
//   real-account-cloud-init-hardened / AC-37105-1
//     identifier: serverId (vendorId)
//     required: baselineChecks; one of [exitStatus, cloudInit]
//       (the live record carries the exit status under
//       cloudInit.code alongside the six baseline outputs).
//   real-account-snapshot-on-demand / AC-37108-1
//     identifier: snapshotId (vendorId)
//     required: postCreateSnapshotIds, postTeardownSnapshotIds
//
// Unmapped probes on this blueprint (offline / mock; every row
// must be conformanceOnly or account-bound-skipped):
//   hcloud-dry-run-mock, manifest-schema-validate,
//   cloud-init-render-lint
//
// `notObservableHere` remains reserved for browser-only ACs; the
// deploy-hetzner-server blueprint has no browser-only ACs, so
// BROWSER_ONLY_ACS is EMPTY and any notObservableHere row FAILS.
// `conformanceOnly` rows must carry a `limitation` whose first
// token is a shipped AC id. A row that only carries
// `{probeName, reason}` never counts.
const PROBE_REQUIREMENTS = {
  'real-account-throwaway-server-provision': {
    rows: [
      {
        anchorAcId: 'AC-37103-1',
        identifier: { field: 'serverId', shape: 'vendorId' },
        requiredAll: ['primaryIpv4', 'location'],
        requiredAnyOf: [],
      },
    ],
  },
  'real-account-cloud-init-hardened': {
    rows: [
      {
        anchorAcId: 'AC-37105-1',
        identifier: { field: 'serverId', shape: 'vendorId' },
        requiredAll: ['baselineChecks'],
        requiredAnyOf: [['exitStatus', 'cloudInit']],
      },
    ],
  },
  'real-account-snapshot-on-demand': {
    rows: [
      {
        anchorAcId: 'AC-37108-1',
        identifier: { field: 'snapshotId', shape: 'vendorId' },
        requiredAll: ['postCreateSnapshotIds', 'postTeardownSnapshotIds'],
        requiredAnyOf: [],
      },
    ],
  },
};
const UNMAPPED_PROBES_CONFORMANCE_ONLY = new Set([
  'hcloud-dry-run-mock', 'manifest-schema-validate', 'cloud-init-render-lint',
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
// Per-field value validators (v1.1.12). isPresent-only acceptance is
// gone: an empty string, an empty collection, `false`, `NaN` or a
// malformed value FAILS. Every required observation field named in
// PROBE_REQUIREMENTS must have an entry here.
function isIpv4(v) {
  if (typeof v !== 'string') return false;
  return /^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[0-9]{1,2})){3}$/.test(v);
}
// Vendor Hetzner location codes the fixture declares. Empty / unknown fails.
const VENDOR_LOCATIONS = new Set(['fsn1', 'nbg1', 'hel1', 'ash', 'hil']);
function isVendorLocation(v) { return typeof v === 'string' && VENDOR_LOCATIONS.has(v); }
function isBaselineChecksArray(v) {
  if (!Array.isArray(v) || v.length === 0) return false;
  for (const c of v) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
    if (typeof c.id !== 'string' || c.id.length === 0) return false;
    const status = c.verdict !== undefined ? c.verdict : c.status;
    // A baseline check counts only when its verdict/status means
    // pass. Strict acceptance (v1.1.12): boolean `true`, or the
    // strings "pass" / "ok"; boolean `false`, `"fail"`, empty
    // string and every other shape FAIL.
    if (status === true) continue;
    if (typeof status === 'string' && (status === 'pass' || status === 'ok')) continue;
    return false;
  }
  return true;
}
function isNonNegInt(v) { return typeof v === 'number' && Number.isInteger(v) && v >= 0; }
function isZeroInt(v) { return typeof v === 'number' && Number.isInteger(v) && v === 0; }
function isCloudInitObj(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  // Cloud-init hardened counts only on a clean exit (v1.1.12): the
  // record's `cloudInit.code` MUST be exactly 0. NaN, Infinity,
  // negatives and any non-zero code FAIL.
  return typeof v.code === 'number' && Number.isInteger(v.code) && v.code === 0;
}
function isNonEmptyVendorIdArray(v) { return Array.isArray(v) && v.length > 0 && v.every(isVendorId); }
function isVendorIdArrayMaybeEmpty(v) { return Array.isArray(v) && v.every(isVendorId); }
const FIELD_VALIDATORS = {
  primaryIpv4: isIpv4,
  location: isVendorLocation,
  baselineChecks: isBaselineChecksArray,
  // exitStatus is the process exit code of the cloud-init run and
  // MUST be exactly 0 for a counting row (v1.1.12).
  exitStatus: isZeroInt,
  cloudInit: isCloudInitObj,
  postCreateSnapshotIds: isNonEmptyVendorIdArray,
  postTeardownSnapshotIds: isVendorIdArrayMaybeEmpty,
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
  // Snapshot on demand cross-field (v1.1.12): the vendor-minted
  // `snapshotId` MUST be present in `postCreateSnapshotIds` (proving
  // the snapshot was created live) AND MUST be absent from
  // `postTeardownSnapshotIds` (proving it was destroyed). Only fires
  // when the row rule requires both inventory fields.
  if ((rule.requiredAll || []).includes('postCreateSnapshotIds') && (rule.requiredAll || []).includes('postTeardownSnapshotIds')) {
    const snap = String(deepFind(ev, 'snapshotId'));
    const create = deepFind(ev, 'postCreateSnapshotIds');
    const teardown = deepFind(ev, 'postTeardownSnapshotIds');
    const inCreate = Array.isArray(create) && create.map(String).includes(snap);
    const inTeardown = Array.isArray(teardown) && teardown.map(String).includes(snap);
    if (!inCreate) {
      throw new Error(`${probeName} / ${rule.anchorAcId}: snapshot inventory inconsistent: snapshotId ${snap} must appear in postCreateSnapshotIds; got ${JSON.stringify(create)}`);
    }
    if (inTeardown) {
      throw new Error(`${probeName} / ${rule.anchorAcId}: snapshot inventory inconsistent: snapshotId ${snap} must NOT appear in postTeardownSnapshotIds; got ${JSON.stringify(teardown)}`);
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
      assert.ok(BROWSER_ONLY_ACS.has(ac), `${displayLabel}: notObservableHere is reserved for browser-only ACs; deploy-hetzner-server has NONE, so any notObservableHere row FAILS anatomy. Row claims ac=${JSON.stringify(ac)}: ${JSON.stringify(r).slice(0, 300)}`);
    }
    if (r.conformanceOnly) {
      assert.equal(typeof r.limitation, 'string', `${displayLabel}: conformanceOnly row must carry a limitation string: ${JSON.stringify(r).slice(0, 300)}`);
      assert.equal(r.anchorAcId, null, `${displayLabel}: conformanceOnly row must carry anchorAcId: null: ${JSON.stringify(r).slice(0, 300)}`);
      const m = r.limitation.match(/^(AC-[A-Za-z0-9-]+)\b/);
      assert.ok(m, `${displayLabel}: conformanceOnly limitation must start with a shipped AC id token; got ${JSON.stringify(r.limitation).slice(0, 200)}`);
      assert.ok(shipped.has(m[1]), `${displayLabel}: conformanceOnly limitation names ${m[1]}, which is not a shipped AC on deploy-hetzner-server`);
      // conformanceOnly rows attest to a limitation, not a live
      // observation; identity and observation checks are for
      // counting rows only.
      continue;
    }
    // Counting row: enforce per-probe requirement map (v1.1.12).
    try {
      validateCountingRowAgainstMap(r, probeName);
    } catch (e) {
      assert.fail(`${displayLabel}: ${e.message}`);
    }
  }
}

test('deploy-hetzner-server AC-11001-1 provisioner boot and sole reader', async () => {
  const bp = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(bp.slug, 'deploy-hetzner-server');
  assert.equal(bp.version, '1.1.12');
  assert.equal(bp.category, 'deploy');
  assert.deepEqual(bp.capabilities, ['cloudHost']);
  const out = await runProbe('hcloud-dry-run-mock');
  await assertRowsCarry7dShape(out.results, 'hcloud-dry-run-mock', 'hcloud-dry-run-mock');
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
  await assertRowsCarry7dShape(out.results, 'manifest-schema-validate', 'manifest-schema-validate');
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
  await assertRowsCarry7dShape(out.results, 'hcloud-dry-run-mock', 'hcloud-dry-run-mock');
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
  await assertRowsCarry7dShape(out.results, 'cloud-init-render-lint', 'cloud-init-render-lint');
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
  await assertRowsCarry7dShape(out.results, 'real-account-cloud-init-hardened', 'real-account-cloud-init-hardened skip');
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
  await assertRowsCarry7dShape(out.results, 'real-account-snapshot-on-demand', 'real-account-snapshot-on-demand skip');
  assert.equal(out.results[0].accountBoundSkipped, true);
  assert.equal(out.results[0].reason, 'CI_HAS_HETZNER_ACCOUNT');
});

test('deploy-hetzner-server AC-11501-1 lifecycle events metadata only', async () => {
  const out = await runProbe('hcloud-dry-run-mock');
  await assertRowsCarry7dShape(out.results, 'hcloud-dry-run-mock', 'hcloud-dry-run-mock');
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
  await assertRowsCarry7dShape(provisionSkip.results, 'real-account-throwaway-server-provision', 'provision skip');
  assert.equal(provisionSkip.results[0].accountBoundSkipped, true);
  assert.equal(provisionSkip.results[0].reason, 'CI_HAS_HETZNER_ACCOUNT');
  assert.match(provisionSkip.results[0].detail, /set-but-not-true/);
  // Second-tier skip: CI_HAS_HETZNER_ACCOUNT=true but HCLOUD_TOKEN unset.
  const savedToken = process.env.HCLOUD_TOKEN;
  delete process.env.HCLOUD_TOKEN;
  try {
    const provSecondTier = await runProbe('real-account-throwaway-server-provision', { CI_HAS_HETZNER_ACCOUNT: 'true' });
    await assertRowsCarry7dShape(provSecondTier.results, 'real-account-throwaway-server-provision', 'provision second-tier skip');
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

// Per-probe requirement map: negative proof for v1.1.12.
// A synthetic counting row from a MAPPED probe is accepted only when
// its identifier has the right shape AND every required observation
// is present in the evidence tree (deep-search); missing fields, a
// non-vendor identifier value, or cross-probe combinations FAIL.
test('deploy anatomy per-probe map: valid provision row accepted', async () => {
  const row = { anchorAcId: 'AC-37103-1', verdict: 'pass', evidence: { serverId: 424242, primaryIpv4: '198.51.100.10', location: 'fsn1' } };
  assert.equal(validateCountingRowAgainstMap(row, 'real-account-throwaway-server-provision'), true);
});
test('deploy anatomy per-probe map: valid cloud-init row accepted (cloudInit.code satisfies exitStatus/cloudInit anyOf)', async () => {
  const row = { anchorAcId: 'AC-37105-1', verdict: 'pass', evidence: { serverId: 424243, cloudInit: { code: 0 }, baselineChecks: [{ id: 'sshKeyOnly', verdict: 'pass' }] } };
  assert.equal(validateCountingRowAgainstMap(row, 'real-account-cloud-init-hardened'), true);
});
test('deploy anatomy per-probe map: valid snapshot row accepted (empty postTeardownSnapshotIds proves absence)', async () => {
  // The live-record semantic: postTeardownSnapshotIds must be
  // PRESENT to prove the check ran; an empty array is a valid
  // observation (snapshot destroyed and absent from inventory).
  const row = { anchorAcId: 'AC-37108-1', verdict: 'pass', evidence: { snapshotId: 4242424, postCreateSnapshotIds: [4242424], postTeardownSnapshotIds: [] } };
  assert.equal(validateCountingRowAgainstMap(row, 'real-account-snapshot-on-demand'), true);
  // A missing key (undefined) still FAILS.
  const bad = { anchorAcId: 'AC-37108-1', verdict: 'pass', evidence: { snapshotId: 4242424, postCreateSnapshotIds: [4242424] } };
  assert.throws(() => validateCountingRowAgainstMap(bad, 'real-account-snapshot-on-demand'), /postTeardownSnapshotIds missing/);
});
test('deploy anatomy per-probe map: row missing a required observation FAILS', async () => {
  // provision missing location:
  const bad = { anchorAcId: 'AC-37103-1', verdict: 'pass', evidence: { serverId: 424242, primaryIpv4: '198.51.100.10' } };
  assert.throws(() => validateCountingRowAgainstMap(bad, 'real-account-throwaway-server-provision'), /location missing/);
  // cloud-init missing baselineChecks:
  const bad2 = { anchorAcId: 'AC-37105-1', verdict: 'pass', evidence: { serverId: 424243, cloudInit: { code: 0 } } };
  assert.throws(() => validateCountingRowAgainstMap(bad2, 'real-account-cloud-init-hardened'), /baselineChecks missing/);
});
test('deploy anatomy per-probe map: cross-probe combination of fields FAILS', async () => {
  // baselineChecks + primaryIpv4 supplied under the provision probe is a cross-probe combination;
  // the provision rule requires location, which is absent.
  const bad = { anchorAcId: 'AC-37103-1', verdict: 'pass', evidence: { serverId: 424242, primaryIpv4: '198.51.100.10', baselineChecks: [{ id: 'x', verdict: 'pass' }] } };
  assert.throws(() => validateCountingRowAgainstMap(bad, 'real-account-throwaway-server-provision'), /location missing/);
  // snapshot rule anchored under provision probe FAILS (wrong AC for this probe):
  const bad2 = { anchorAcId: 'AC-37108-1', verdict: 'pass', evidence: { snapshotId: 4242424, postCreateSnapshotIds: [4242424], postTeardownSnapshotIds: [999] } };
  assert.throws(() => validateCountingRowAgainstMap(bad2, 'real-account-throwaway-server-provision'), /not declared in PROBE_REQUIREMENTS/);
});
test('deploy anatomy per-probe map: non-vendor identifier value FAILS shape check', async () => {
  const bad = { anchorAcId: 'AC-37103-1', verdict: 'pass', evidence: { serverId: 'not-a-vendor-id', primaryIpv4: '1.2.3.4', location: 'fsn1' } };
  assert.throws(() => validateCountingRowAgainstMap(bad, 'real-account-throwaway-server-provision'), /identifier serverId .* missing or malformed/);
  const bad2 = { anchorAcId: 'AC-37103-1', verdict: 'pass', evidence: { serverId: 0, primaryIpv4: '1.2.3.4', location: 'fsn1' } };
  assert.throws(() => validateCountingRowAgainstMap(bad2, 'real-account-throwaway-server-provision'), /identifier serverId .* missing or malformed/);
});
test('deploy anatomy per-probe map: UNMAPPED probe producing a counting row FAILS', async () => {
  const bad = { anchorAcId: 'AC-37101-1', verdict: 'pass', evidence: { serverId: 424242 } };
  assert.throws(() => validateCountingRowAgainstMap(bad, 'hcloud-dry-run-mock'), /UNMAPPED in PROBE_REQUIREMENTS/);
});
test('deploy anatomy per-probe map: nested observation under evidence.<group> is found by deep search', async () => {
  // Simulate a shape where observations live nested under a sub-object.
  const row = { anchorAcId: 'AC-37105-1', verdict: 'pass', evidence: { serverId: 424243, results: { cloudInit: { code: 0 }, baselineChecks: [{ id: 'ok', verdict: 'pass' }] } } };
  assert.equal(validateCountingRowAgainstMap(row, 'real-account-cloud-init-hardened'), true);
});

// Per-field value validators: negative cases (v1.1.12). isPresent-
// only acceptance is gone; each required field runs its own
// per-field validator and empty / malformed values FAIL. Synthetic
// values below sit in the documentation ranges (198.51.100.0/24) or
// carry unmistakably synthetic vendor-id integers; no live-account
// fragments.
test('deploy anatomy field validators: malformed primaryIpv4 FAILS', async () => {
  for (const v of ['', '999.1.1.1', 'not-an-ip', '10.0.0', '10.0.0.0.0']) {
    const bad = { anchorAcId: 'AC-37103-1', verdict: 'pass', evidence: { serverId: 424242, primaryIpv4: v, location: 'fsn1' } };
    assert.throws(() => validateCountingRowAgainstMap(bad, 'real-account-throwaway-server-provision'), /primaryIpv4 missing or malformed/, `expected FAIL on primaryIpv4=${JSON.stringify(v)}`);
  }
});
test('deploy anatomy field validators: empty or unknown location FAILS', async () => {
  for (const v of ['', 'not-a-location', 'FSN1']) {
    const bad = { anchorAcId: 'AC-37103-1', verdict: 'pass', evidence: { serverId: 424242, primaryIpv4: '198.51.100.10', location: v } };
    assert.throws(() => validateCountingRowAgainstMap(bad, 'real-account-throwaway-server-provision'), /location missing or malformed/, `expected FAIL on location=${JSON.stringify(v)}`);
  }
});
test('deploy anatomy field validators: empty or malformed baselineChecks FAILS', async () => {
  const shapes = [
    [],
    [{ id: 'x' }],                                // no verdict/status
    [{ id: '', verdict: 'pass' }],                // empty name
    [{ verdict: 'pass' }],                        // missing id
    [{ id: 'x', verdict: '' }],                   // empty status string
    'string-not-array',
  ];
  for (const v of shapes) {
    const bad = { anchorAcId: 'AC-37105-1', verdict: 'pass', evidence: { serverId: 424243, cloudInit: { code: 0 }, baselineChecks: v } };
    assert.throws(() => validateCountingRowAgainstMap(bad, 'real-account-cloud-init-hardened'), /baselineChecks missing or malformed/, `expected FAIL on baselineChecks=${JSON.stringify(v)}`);
  }
});
test('deploy anatomy field validators: cloud-init anyOf FAILS when both alternatives malformed', async () => {
  // exitStatus non-integer AND cloudInit lacks numeric code:
  const bad = { anchorAcId: 'AC-37105-1', verdict: 'pass', evidence: { serverId: 424243, baselineChecks: [{ id: 'ok', verdict: 'pass' }], exitStatus: '0', cloudInit: {} } };
  assert.throws(() => validateCountingRowAgainstMap(bad, 'real-account-cloud-init-hardened'), /none of the observation alternatives \[exitStatus, cloudInit\]/);
  // both absent:
  const bad2 = { anchorAcId: 'AC-37105-1', verdict: 'pass', evidence: { serverId: 424243, baselineChecks: [{ id: 'ok', verdict: 'pass' }] } };
  assert.throws(() => validateCountingRowAgainstMap(bad2, 'real-account-cloud-init-hardened'), /none of the observation alternatives \[exitStatus, cloudInit\]/);
});
test('deploy anatomy field validators: postCreateSnapshotIds must be non-empty vendor-id array', async () => {
  for (const v of [[], [-1], ['abc'], [0], 'not-array']) {
    const bad = { anchorAcId: 'AC-37108-1', verdict: 'pass', evidence: { snapshotId: 4242424, postCreateSnapshotIds: v, postTeardownSnapshotIds: [] } };
    assert.throws(() => validateCountingRowAgainstMap(bad, 'real-account-snapshot-on-demand'), /postCreateSnapshotIds missing or malformed/, `expected FAIL on postCreateSnapshotIds=${JSON.stringify(v)}`);
  }
});
test('deploy anatomy field validators: postTeardownSnapshotIds must be vendor-id array (empty is fine, malformed entries FAIL)', async () => {
  // empty is fine:
  const ok = { anchorAcId: 'AC-37108-1', verdict: 'pass', evidence: { snapshotId: 4242424, postCreateSnapshotIds: [4242424], postTeardownSnapshotIds: [] } };
  assert.equal(validateCountingRowAgainstMap(ok, 'real-account-snapshot-on-demand'), true);
  // malformed entries FAIL:
  for (const v of ['not-array', [-1], ['abc']]) {
    const bad = { anchorAcId: 'AC-37108-1', verdict: 'pass', evidence: { snapshotId: 4242424, postCreateSnapshotIds: [4242424], postTeardownSnapshotIds: v } };
    assert.throws(() => validateCountingRowAgainstMap(bad, 'real-account-snapshot-on-demand'), /postTeardownSnapshotIds missing or malformed/, `expected FAIL on postTeardownSnapshotIds=${JSON.stringify(v)}`);
  }
});

// Per-field validator strictness (v1.1.12): every numeric field
// registered in FIELD_VALIDATORS rejects `NaN`, `Infinity`,
// `-Infinity` and negative values, and the process exit code / cloud-
// init code fields require exactly 0. Snapshot inventory cross-field
// (v1.1.12) is proved below: the snapshotId must appear in
// postCreateSnapshotIds and MUST NOT appear in postTeardownSnapshotIds.
test('deploy anatomy field validators: exitStatus must equal 0 (v1.1.12); NaN, Infinity, -Infinity, negative, and non-zero integer all FAIL', async () => {
  // exitStatus alternative present, cloudInit absent so the anyOf
  // resolves on exitStatus alone.
  for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 1, 2, 137]) {
    const bad = { anchorAcId: 'AC-37105-1', verdict: 'pass', evidence: { serverId: 424243, baselineChecks: [{ id: 'ok', verdict: 'pass' }], exitStatus: v } };
    assert.throws(
      () => validateCountingRowAgainstMap(bad, 'real-account-cloud-init-hardened'),
      /none of the observation alternatives \[exitStatus, cloudInit\]/,
      `expected FAIL on exitStatus=${String(v)}`,
    );
  }
  // exitStatus === 0 accepted:
  const good = { anchorAcId: 'AC-37105-1', verdict: 'pass', evidence: { serverId: 424243, baselineChecks: [{ id: 'ok', verdict: 'pass' }], exitStatus: 0 } };
  assert.equal(validateCountingRowAgainstMap(good, 'real-account-cloud-init-hardened'), true);
});
test('deploy anatomy field validators: cloudInit.code must equal 0 (v1.1.12); NaN, Infinity, -Infinity, negative, and non-zero integer all FAIL', async () => {
  for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 1, 137]) {
    const bad = { anchorAcId: 'AC-37105-1', verdict: 'pass', evidence: { serverId: 424243, baselineChecks: [{ id: 'ok', verdict: 'pass' }], cloudInit: { code: v } } };
    assert.throws(
      () => validateCountingRowAgainstMap(bad, 'real-account-cloud-init-hardened'),
      /none of the observation alternatives \[exitStatus, cloudInit\]/,
      `expected FAIL on cloudInit.code=${String(v)}`,
    );
  }
  const good = { anchorAcId: 'AC-37105-1', verdict: 'pass', evidence: { serverId: 424243, baselineChecks: [{ id: 'ok', verdict: 'pass' }], cloudInit: { code: 0 } } };
  assert.equal(validateCountingRowAgainstMap(good, 'real-account-cloud-init-hardened'), true);
});
test('deploy anatomy field validators: baselineChecks with a boolean `false` verdict FAILS (v1.1.12)', async () => {
  const bad = { anchorAcId: 'AC-37105-1', verdict: 'pass', evidence: { serverId: 424243, cloudInit: { code: 0 }, baselineChecks: [{ id: 'sshKeyOnly', verdict: false }] } };
  assert.throws(() => validateCountingRowAgainstMap(bad, 'real-account-cloud-init-hardened'), /baselineChecks missing or malformed/);
  const badFail = { anchorAcId: 'AC-37105-1', verdict: 'pass', evidence: { serverId: 424243, cloudInit: { code: 0 }, baselineChecks: [{ id: 'sshKeyOnly', verdict: 'fail' }] } };
  assert.throws(() => validateCountingRowAgainstMap(badFail, 'real-account-cloud-init-hardened'), /baselineChecks missing or malformed/);
  // boolean true accepted:
  const okTrue = { anchorAcId: 'AC-37105-1', verdict: 'pass', evidence: { serverId: 424243, cloudInit: { code: 0 }, baselineChecks: [{ id: 'sshKeyOnly', verdict: true }] } };
  assert.equal(validateCountingRowAgainstMap(okTrue, 'real-account-cloud-init-hardened'), true);
  // "pass" / "ok" strings accepted:
  const okPass = { anchorAcId: 'AC-37105-1', verdict: 'pass', evidence: { serverId: 424243, cloudInit: { code: 0 }, baselineChecks: [{ id: 'sshKeyOnly', verdict: 'pass' }] } };
  assert.equal(validateCountingRowAgainstMap(okPass, 'real-account-cloud-init-hardened'), true);
});
test('deploy anatomy cross-field: snapshotId MUST appear in postCreateSnapshotIds and MUST NOT appear in postTeardownSnapshotIds (v1.1.12)', async () => {
  // snapshotId missing from create:
  const bad1 = { anchorAcId: 'AC-37108-1', verdict: 'pass', evidence: { snapshotId: 4242424, postCreateSnapshotIds: [9999999], postTeardownSnapshotIds: [] } };
  assert.throws(() => validateCountingRowAgainstMap(bad1, 'real-account-snapshot-on-demand'), /must appear in postCreateSnapshotIds/);
  // snapshotId still present in teardown:
  const bad2 = { anchorAcId: 'AC-37108-1', verdict: 'pass', evidence: { snapshotId: 4242424, postCreateSnapshotIds: [4242424], postTeardownSnapshotIds: [4242424] } };
  assert.throws(() => validateCountingRowAgainstMap(bad2, 'real-account-snapshot-on-demand'), /must NOT appear in postTeardownSnapshotIds/);
  // both fine (created then destroyed):
  const good = { anchorAcId: 'AC-37108-1', verdict: 'pass', evidence: { snapshotId: 4242424, postCreateSnapshotIds: [4242424], postTeardownSnapshotIds: [] } };
  assert.equal(validateCountingRowAgainstMap(good, 'real-account-snapshot-on-demand'), true);
});
test('deploy anatomy field validators: vendor-id array entries reject NaN, Infinity, -Infinity and negative integers (v1.1.12)', async () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
    const badRow = { anchorAcId: 'AC-37108-1', verdict: 'pass', evidence: { snapshotId: 4242424, postCreateSnapshotIds: [bad], postTeardownSnapshotIds: [] } };
    assert.throws(() => validateCountingRowAgainstMap(badRow, 'real-account-snapshot-on-demand'), /postCreateSnapshotIds missing or malformed/, `expected FAIL on postCreateSnapshotIds=[${String(bad)}]`);
    const badRow2 = { anchorAcId: 'AC-37108-1', verdict: 'pass', evidence: { snapshotId: 4242424, postCreateSnapshotIds: [4242424], postTeardownSnapshotIds: [bad] } };
    assert.throws(() => validateCountingRowAgainstMap(badRow2, 'real-account-snapshot-on-demand'), /postTeardownSnapshotIds missing or malformed/, `expected FAIL on postTeardownSnapshotIds=[${String(bad)}]`);
  }
});

// Unmapped-probe skip rule (v1.1.12). Offline / mock probes on this
// blueprint (hcloud-dry-run-mock, manifest-schema-validate,
// cloud-init-render-lint) have no declared gate variable to skip on:
// their entire row set is either conformanceOnly / notObservableHere.
// An accountBoundSkipped row from any of them FAILS anatomy, even
// when the reason names a declared skip variable.
test('deploy anatomy: unmapped probe emitting accountBoundSkipped FAILS anatomy', async () => {
  const rows = [{ accountBoundSkipped: true, reason: 'CI_HAS_HETZNER_ACCOUNT', detail: 'set-but-not-true' }];
  await assert.rejects(
    async () => assertRowsCarry7dShape(rows, 'hcloud-dry-run-mock', 'unmapped-skip-negative'),
    /MUST NOT emit accountBoundSkipped/,
  );
});
test('deploy anatomy: mapped live probe emitting the exact one-variable skip is accepted (declared gate variable, absent)', async () => {
  const rows = [{ accountBoundSkipped: true, reason: 'HCLOUD_TOKEN', detail: 'HCLOUD_TOKEN not set' }];
  await assertRowsCarry7dShape(rows, 'real-account-throwaway-server-provision', 'mapped-skip-positive');
});

// Record walk (v1.1.12). When a local run has produced records under
// `.rcf/reports/blueprints/deploy-hetzner-server/`, validate every
// counting row against the per-probe map and check that the mapped
// identifier appears in the record's own inventory or event trail
// (serverId in `eventTrail` / `postRunInventory` / `postTeardownServerIds` /
// `teardown`; snapshotId in `postCreateSnapshotIds`). When no
// records are present the walk reports "no local records" and does
// not fail (CI path).
function walkRecordRow({ row, probeName, name, shipped, record }) {
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
    assert.ok(BROWSER_ONLY_ACS.has(row.notObservableHere && row.notObservableHere.ac), `${name}: notObservableHere reserved for browser-only ACs (none shipped on this blueprint).`);
    return { walked: true, inventoryHit: false, counted: false };
  }
  // Counting row: per-probe map first.
  validateCountingRowAgainstMap(row, probeName);
  // Inventory correlation is against the WHOLE record (the identifier
  // must appear in the record's own inventory or event trail), not
  // just the row's evidence subtree.
  const rule = PROBE_REQUIREMENTS[probeName].rows.find((r) => r.anchorAcId === row.anchorAcId);
  const ev = row.evidence || {};
  const searchSpace = record || ev;
  const idField = rule.identifier.field;
  const idValue = deepFind(ev, idField);
  let inventoryHit = false;
  if (idField === 'serverId') {
    const trail = deepFind(searchSpace, 'eventTrail');
    const inv = deepFind(searchSpace, 'postRunInventory');
    const teardownIds = deepFind(searchSpace, 'postTeardownServerIds');
    const teardown = deepFind(searchSpace, 'teardown');
    const idStr = String(idValue);
    const trailHit = Array.isArray(trail) && trail.some((t) => JSON.stringify(t).includes(idStr));
    const invHit = Array.isArray(inv) && inv.some((s) => (s && typeof s === 'object') ? String(s.id) === idStr : String(s) === idStr);
    const teardownHit = Array.isArray(teardownIds) && teardownIds.map(String).includes(idStr);
    const teardownRefHit = !!teardown && typeof teardown === 'object' && (String(teardown.destroyed) === idStr || String(teardown.provisioned) === idStr);
    inventoryHit = trailHit || invHit || teardownHit || teardownRefHit;
    assert.ok(inventoryHit, `${name}: serverId ${idStr} is not present in this record's eventTrail / postRunInventory / postTeardownServerIds / teardown.`);
  } else if (idField === 'snapshotId') {
    const create = deepFind(searchSpace, 'postCreateSnapshotIds');
    inventoryHit = Array.isArray(create) && create.map(String).includes(String(idValue));
    assert.ok(inventoryHit, `${name}: snapshotId ${idValue} is not present in this record's postCreateSnapshotIds.`);
  } else {
    // Not a serverId/snapshotId identifier (e.g. containerId). This blueprint has none, so nothing to correlate.
    inventoryHit = true;
  }
  return { walked: true, inventoryHit, counted: true };
}
test('deploy-hetzner-server v1.1.12 record walk: every row of every present local record is validated (no stubs skipped), or report no records only when the directory has no record files', async () => {
  const reportsDir = join(REPO_ROOT, '.rcf', 'reports', 'blueprints', 'deploy-hetzner-server');
  let entries = [];
  try {
    entries = (await readdir(reportsDir)).filter((f) => f.endsWith('.json'));
  } catch (e) {
    console.log('deploy-hetzner-server v1.1.12 record walk: no local records under .rcf/reports/blueprints/deploy-hetzner-server (CI path).');
    return;
  }
  if (entries.length === 0) {
    console.log('deploy-hetzner-server v1.1.12 record walk: no local records under .rcf/reports/blueprints/deploy-hetzner-server (CI path).');
    return;
  }
  const shipped = await loadShippedAcs();
  let walkableRows = 0;
  let inventoryHits = 0;
  let countingRows = 0;
  for (const fileName of entries) {
    const rec = JSON.parse(await readFile(join(reportsDir, fileName), 'utf8'));
    const probeName = rec.probeName || fileName.replace(/\.json$/, '');
    const rows = Array.isArray(rec.results) ? rec.results : [];
    for (const row of rows) {
      // v1.1.12: no more stub-skip. Every row of every present local
      // record MUST carry a row-shape marker (evidence for a counting
      // row, `limitation` for a conformanceOnly de-claim, `reason`
      // for an accountBoundSkipped row, or `notObservableHere.ac`).
      // A row lacking all four FAILS - malformed rows previously
      // escaped validation.
      const hasShape = !!row && (
        row.evidence !== undefined
        || (row.conformanceOnly && typeof row.limitation === 'string')
        || (row.accountBoundSkipped === true && typeof row.reason === 'string')
        || (row.notObservableHere && row.notObservableHere.ac)
      );
      assert.ok(
        hasShape,
        `${fileName}: row lacking evidence / limitation / skip reason FAILS the record walk (v1.1.12; no more stub-skip): ${JSON.stringify(row).slice(0, 300)}`,
      );
      walkableRows++;
      const r = walkRecordRow({ row, probeName, name: fileName, shipped, record: rec });
      if (r.counted) countingRows++;
      if (r.inventoryHit) inventoryHits++;
    }
  }
  console.log(`deploy-hetzner-server v1.1.12 record walk: ${walkableRows} walkable row(s), ${countingRows} counting row(s), ${inventoryHits} inventory correlation(s) across ${entries.length} record file(s).`);
});

// Malformed-row negative case (v1.1.12): a synthetic record whose
// results include a row lacking evidence, limitation and reason
// MUST be rejected by the walker. Proved without touching the real
// records directory.
test('deploy-hetzner-server v1.1.12 record walk: a malformed row (no evidence / limitation / reason) is REJECTED', async () => {
  const stubRow = { anchorAcId: 'AC-37103-1', verdict: 'pass', detail: 'no observations, no evidence, no skip reason' };
  const rec = { slug: 'deploy-hetzner-server', probeName: 'real-account-throwaway-server-provision', results: [stubRow] };
  const rows = rec.results;
  let threw = false;
  try {
    for (const row of rows) {
      const hasShape = !!row && (
        row.evidence !== undefined
        || (row.conformanceOnly && typeof row.limitation === 'string')
        || (row.accountBoundSkipped === true && typeof row.reason === 'string')
        || (row.notObservableHere && row.notObservableHere.ac)
      );
      assert.ok(hasShape, 'stub row must FAIL the walker');
    }
  } catch (e) {
    threw = true;
    assert.match(String(e && e.message), /stub row must FAIL/);
  }
  assert.equal(threw, true, 'expected the walker shape-check to reject a malformed row synthesised for this negative-proof test');
});
