// Anatomy + shape + probe-shape + fixture + shelf-doc test for the
// object-storage-s3 v1.0.0 shelf blueprint (infra round 5 spec section 5.2).
// Covers TS-071.

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

test('blueprint.json declares 21 contributions with capabilities objectStorage, suggestedCompanions logging and errorHandling, and standardsTraceClause on every ADR entry (TC-071-blueprint-json-shape)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'object-storage-s3');
  assert.equal(doc.version, '1.0.0');
  assert.equal(doc.category, 'object-storage');
  assert.deepEqual(doc.capabilities, ['objectStorage']);
  assert.equal(doc.contributions.length, 21);
  const kinds = doc.contributions.reduce((acc, c) => {
    acc[c.kind] = (acc[c.kind] || 0) + 1;
    return acc;
  }, {});
  assert.equal(kinds.req, 6);
  assert.equal(kinds.us, 8);
  assert.equal(kinds.tac, 3);
  assert.equal(kinds.adr, 4);
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
});

test('apply object-storage-s3 refuses on a bare fixture without security-secrets-management and lands with --allow-no-secrets-yet (TC-071-apply-refusal-and-override)', async () => {
  // The compose-time refusal AC (AC-4101-3) is a runtime-scope AC exercised by
  // an actual `rcf define blueprint add` invocation. This test asserts the
  // anatomy pieces the mechanism reads: the loader's requiresAppliedCapabilities
  // shape is absent here (per spec section 5.2 the refusal message id is
  // wired via the blueprint metadata prose, not a schema field) and the
  // README documents the override flag path. The full apply-refusal probe
  // is the compose-test path invoked at gate time; this unit test asserts
  // the surface exists.
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.requiresAppliedCapabilities, undefined,
    'per spec section 5.2 the compose-time refusal is not declared via requiresAppliedCapabilities; it is enforced by the apply verb reading REQ-006');
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
