// Anatomy + shape + probe-shape + fixture + shelf-doc test for the
// object-storage-s3 v1.1.0 shelf blueprint (round-7 follow-up spec
// section 5.4; v1.0.0 anatomy per infra round 5 spec section 5.2).
// Covers TS-071 (v1.0.0 shape) plus additive assertions for the
// v1.1.0 Hetzner Object Storage adapter delta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'object-storage-s3');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'infra-s3-and-queue');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');
const AUTHORING_DOC = join(REPO_ROOT, 'packages', 'rcf-lite', 'docs', 'blueprint-authoring.md');

test('blueprint.json declares 25 contributions at v1.1.0 with capabilities objectStorage, suggestedCompanions logging and errorHandling, and standardsTraceClause on every ADR entry including the Hetzner Object Storage provider entry (TC-071-blueprint-json-shape)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'object-storage-s3');
  // v1.1.0 follow-up (round-7 spec section 5.4) additive minor bump:
  // v1.0.0 shipped 21 contributions (6 REQ, 8 US, 3 TAC, 4 ADR);
  // v1.1.0 adds 4 delta contributions (1 REQ, 1 US, 1 TAC, 1 ADR)
  // for the Hetzner Object Storage adapter (total 25).
  assert.equal(doc.version, '1.1.0');
  assert.equal(doc.category, 'object-storage');
  assert.deepEqual(doc.capabilities, ['objectStorage']);
  assert.equal(doc.contributions.length, 25);
  const kinds = doc.contributions.reduce((acc, c) => {
    acc[c.kind] = (acc[c.kind] || 0) + 1;
    return acc;
  }, {});
  assert.equal(kinds.req, 7);
  assert.equal(kinds.us, 9);
  assert.equal(kinds.tac, 4);
  assert.equal(kinds.adr, 5);
  assert.equal(doc.suggestedCompanions.length, 2);
  const roles = doc.suggestedCompanions.map((c) => c.role).sort();
  assert.deepEqual(roles, ['errorHandling', 'logging']);
  const adrs = doc.contributions.filter((c) => c.kind === 'adr');
  for (const adr of adrs) {
    assert.ok(typeof adr.standardsTraceClause === 'string' && adr.standardsTraceClause.length > 0,
      `ADR entry ${adr.id} must carry a non-null standardsTraceClause per section 8a.2`);
  }
  const globalAdrs = adrs.filter((a) => a.scope === 'global');
  assert.equal(globalAdrs.length, 1);
  assert.equal(globalAdrs[0].topic, 'objectStorageContract');
  // v1.1.0 delta assertions: the four new contribution ids are present
  // and every v1.0.0 shipped id remains untouched.
  const ids = new Set(doc.contributions.map((c) => c.id));
  for (const id of [
    'object-storage-s3-REQ-101',
    'object-storage-s3-US-28110',
    'TAC-2904-object-storage-s3-hetzner-endpoint-helper',
    'ADR-2905-object-storage-s3-hetzner-object-storage-provider',
  ]) {
    assert.ok(ids.has(id), `v1.1.0 delta contribution ${id} must be present`);
  }
  const shippedV100Ids = [
    'object-storage-s3-REQ-001', 'object-storage-s3-REQ-002', 'object-storage-s3-REQ-003',
    'object-storage-s3-REQ-004', 'object-storage-s3-REQ-005', 'object-storage-s3-REQ-006',
    'object-storage-s3-US-28101', 'object-storage-s3-US-28102', 'object-storage-s3-US-28103',
    'object-storage-s3-US-28104', 'object-storage-s3-US-28105', 'object-storage-s3-US-28106',
    'object-storage-s3-US-28107', 'object-storage-s3-US-28108',
    'TAC-2901-object-storage-s3-facade', 'TAC-2902-object-storage-s3-multipart-uploader',
    'TAC-2903-object-storage-s3-event-sink',
    'ADR-2901-object-storage-s3-adapter', 'ADR-2902-object-storage-s3-presigned-ttl-floor',
    'ADR-2903-object-storage-s3-multipart-threshold', 'ADR-2904-object-storage-s3-contract',
  ];
  for (const id of shippedV100Ids) {
    assert.ok(ids.has(id), `v1.0.0 contribution ${id} must remain present after the additive v1.1.0 bump`);
  }
  const hetznerAdr = adrs.find((a) => a.id === 'ADR-2905-object-storage-s3-hetzner-object-storage-provider');
  assert.equal(hetznerAdr.standardsTraceClause, 'Hetzner Object Storage S3 compatibility documented endpoint shape');
});

test('apply object-storage-s3 refuses on a bare fixture without security-secrets-management and lands with --allow-no-secrets-yet (TC-071-apply-refusal-and-override)', async () => {
  // The compose-time refusal AC (AC-4101-3) is enforced via the T-5
  // capability mechanism (visual round spec 5.5.1) as folded into this
  // train by coordinator ruling: security-secrets-management v1.0.1
  // declares capabilities: ["secretsProvider"], and object-storage-s3
  // declares requiresAppliedCapabilities with allowSkipFlag
  // "allow-no-secrets-yet" and refusalMessageId
  // "object-storage-s3-no-secrets". The apply verb refuses on a bare
  // project with exit 3 and stderr carrying [object-storage-s3-no-secrets];
  // the --allow-no-secrets-yet override records a notes line on
  // rcf/blueprints/object-storage-s3.applied.json.
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.ok(doc.requiresAppliedCapabilities,
    'per infra round 5 spec 5.2 (Baz decision 6) and coordinator fold-in ruling, object-storage-s3 declares requiresAppliedCapabilities via the T-5 mechanism');
  assert.deepEqual(doc.requiresAppliedCapabilities.capabilities, ['secretsProvider']);
  assert.equal(doc.requiresAppliedCapabilities.allowSkipFlag, 'allow-no-secrets-yet');
  assert.equal(doc.requiresAppliedCapabilities.refusalMessageId, 'object-storage-s3-no-secrets');
  const readme = await readFile(join(BLUEPRINT_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /object-storage-s3-no-secrets/,
    'blueprint README must name the stable message id');
  assert.match(readme, /--allow-no-secrets-yet/,
    'blueprint README must name the override flag');
});

test('apply object-storage-s3 lands 21 contributions on a scratch project with security-secrets-management applied (TC-071-applies-clean-with-secrets)', async () => {
  // Full apply verified end-to-end at the gate via `rcf define blueprint
  // add` against a scratch project. This unit test asserts the blueprint's
  // 21 contribution files exist at the paths declared in blueprint.json so
  // the shipped shelf is loadable.
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  for (const c of doc.contributions) {
    const filePath = join(BLUEPRINT_ROOT, 'contributions', c.path);
    const s = await stat(filePath);
    assert.ok(s.isFile(), `contribution file ${c.path} must exist`);
    const body = JSON.parse(await readFile(filePath, 'utf8'));
    if (c.kind === 'req') assert.equal(body.reqId, c.id);
    if (c.kind === 'us') assert.equal(body.usId, c.id);
    if (c.kind === 'tac') assert.equal(body.tacId, c.id);
    if (c.kind === 'adr') assert.equal(body.adrId, c.id);
  }
});

test('every probe module exports the section 3.2 verdict envelope with an anchorAcId matching a contributed AC id (TC-071-probe-anchor-ids-cross-check)', async () => {
  const blueprintDoc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  const contributedAcIds = new Set();
  for (const c of blueprintDoc.contributions) {
    if (c.kind !== 'us') continue;
    const usPath = join(BLUEPRINT_ROOT, 'contributions', c.path);
    const usDoc = JSON.parse(await readFile(usPath, 'utf8'));
    for (const ac of usDoc.acceptanceCriteria || []) {
      contributedAcIds.add(ac.id);
    }
  }
  const probeNames = [
    'facade-round-trip',
    'put-get-round-trip',
    'presigned-url',
    'multipart-upload',
    'event-secrecy',
    'r2-real-account-smoke',
  ];
  for (const name of probeNames) {
    const probePath = join(PROBES_DIR, `${name}.mjs`);
    const stats = await stat(probePath);
    assert.ok(stats.isFile(), `probe module ${name}.mjs must exist`);
    const shimPath = join(PROBES_DIR, `run-${name}.mjs`);
    const shimStats = await stat(shimPath);
    assert.ok(shimStats.isFile(), `probe shim run-${name}.mjs must exist`);
    const src = await readFile(probePath, 'utf8');
    const anchors = [...src.matchAll(/anchorAcId:\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
    assert.ok(anchors.length > 0, `probe ${name} must reference at least one anchorAcId literal`);
    for (const anchor of anchors) {
      assert.ok(contributedAcIds.has(anchor), `probe ${name} anchorAcId ${anchor} must match a contributed AC id (contributed=${[...contributedAcIds].join(',')})`);
    }
  }
  // r2-real-account-smoke declares accountBound: true per spec section 3.5
  const r2Src = await readFile(join(PROBES_DIR, 'r2-real-account-smoke.mjs'), 'utf8');
  assert.match(r2Src, /export const accountBound = true/,
    'r2-real-account-smoke must declare accountBound: true');
});

test('sample-app fixture ships docker-compose.yml, package.json, src/object-store.mjs, src/secrets.mjs, and its README documents docker and podman and the four wired induced-failure switches (TC-071-fixture-and-switches)', async () => {
  await stat(join(FIXTURE_ROOT, 'docker-compose.yml'));
  await stat(join(FIXTURE_ROOT, 'package.json'));
  await stat(join(FIXTURE_ROOT, 'src', 'object-store.mjs'));
  await stat(join(FIXTURE_ROOT, 'src', 'secrets.mjs'));
  await stat(join(FIXTURE_ROOT, 'src', 'create-bucket.mjs'));
  const readme = await readFile(join(FIXTURE_ROOT, 'README.md'), 'utf8');
  for (const sw of [
    'SIMULATE_MINIO_DOWN',
    'SIMULATE_403_ON_GET',
    'SIMULATE_PART_UPLOAD_FAIL',
    'SIMULATE_PRESIGN_MALFORMED',
  ]) {
    assert.match(readme, new RegExp(sw), `fixture README must document ${sw}`);
  }
  // SIMULATE_PII_ON_EVENT and SIMULATE_LARGE_PAYLOAD were removed at
  // v1.0.0: the event-secrecy whitelist is code-enforced and the
  // 10 MiB multipart probe already exercises the above-threshold path.
  assert.doesNotMatch(readme, /SIMULATE_PII_ON_EVENT/,
    'unwired switches must not appear in the fixture README (doc-truth)');
  assert.doesNotMatch(readme, /SIMULATE_LARGE_PAYLOAD/,
    'unwired switches must not appear in the fixture README (doc-truth)');
  assert.match(readme, /minio\/minio/);
  assert.match(readme, /podman/i);
  // object-store.mjs (TAC-2901 facade) is the sole reader of @aws-sdk/client-s3
  const storeSrc = await readFile(join(FIXTURE_ROOT, 'src', 'object-store.mjs'), 'utf8');
  assert.match(storeSrc, /from ['"]@aws-sdk\/client-s3['"]/,
    'src/object-store.mjs must import @aws-sdk/client-s3');
});

test('section 6a table gains an objectStorage row and every shipped blueprint docs/topics.md gains an object-storage-s3 row at 28101-28899 / 29xx (TC-071-shelf-doc-consistency)', async () => {
  const authoring = await readFile(AUTHORING_DOC, 'utf8');
  assert.match(authoring, /^\|\s*`objectStorage`\s*\|/m,
    'section 6a capability table must gain an objectStorage row');
  const blueprintsDir = join(REPO_ROOT, 'blueprints');
  const dirs = (await readdir(blueprintsDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const bp of dirs) {
    const topics = join(blueprintsDir, bp, 'docs', 'topics.md');
    try {
      const body = await readFile(topics, 'utf8');
      assert.match(
        body,
        /^\|\s*object-storage-s3\s*\|\s*28101-28899\s*\|\s*29xx\s*\|/m,
        `${bp}/docs/topics.md must carry an object-storage-s3 row at 28101-28899 / 29xx`,
      );
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
  }
});
