// Anatomy test for the object-storage-s3 v1.1.0 follow-up Hetzner
// Object Storage adapter (round-7 spec section 5.4). Covers TS-170,
// TC-170-hetzner-endpoint-round-trip-and-skipped-shape (AC-14001-1 on
// the repo chain, mirroring AC-28110-1 on the blueprint side).
//
// The probe itself lives at
// blueprints/object-storage-s3/contributions/probes/hetzner-object-storage-round-trip.mjs
// and is exercised end-to-end by the gate-reviewer boot line documented
// in the fixture README (requires the fixture's own `npm install` for
// @aws-sdk/client-s3). This anatomy test asserts the probe module and
// fixture-side helper anatomy that make the probe legitimate on the
// shipped shape (per the round-5 anatomy test pattern):
//
// - the probe module source declares accountBound and anchors AC-28110-1;
// - the probe module reads no SIMULATE_ variable (mutation-purity
//   discipline per HQ hard gate row 2026-09-08);
// - the endpoint-shape helper composes the vendor pattern exactly and
//   refuses unknown location codes;
// - the two fixture-side mutation switches force the shape they are
//   wired against, checked against the helper directly (no probe
//   import so this test does not need the fixture's @aws-sdk/client-s3
//   dependency installed);
// - the fixture-root shim delegates to the blueprint-side probe shim.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'object-storage-s3');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'infra-s3-and-queue');
const PROBE_PATH = join(BLUEPRINT_ROOT, 'contributions', 'probes', 'hetzner-object-storage-round-trip.mjs');
const PROBE_SHIM_PATH = join(BLUEPRINT_ROOT, 'contributions', 'probes', 'run-hetzner-object-storage-round-trip.mjs');
const HELPER_PATH = join(FIXTURE_ROOT, 'src', 'hetzner-endpoint.mjs');
const FIXTURE_SHIM_PATH = join(FIXTURE_ROOT, 'run-hetzner-object-storage-round-trip.mjs');

test('adapter object-storage-s3 v1.1.0 hetzner AC-14001-1 endpoint round-trip and skipped shape (TC-170-hetzner-endpoint-round-trip-and-skipped-shape)', async (t) => {
  await t.test('probe module source: declares accountBound; anchors AC-28110-1; reads no process.env.SIMULATE_ variable', async () => {
    const src = await readFile(PROBE_PATH, 'utf8');
    // Mutation-purity discipline (per HQ hard gate row 2026-09-08): the
    // probe module MUST NOT read a SIMULATE_ environment variable; every
    // switch lives on the fixture side.
    const readerMatches = src.match(/process\.env\.SIMULATE_/g) || [];
    assert.equal(readerMatches.length, 0, 'probe module must not read any process.env.SIMULATE_ variable');
    // The probe binds AC-28110-1 as the anchor (blueprint-side numeric
    // AC id under the shipped 28xxx band; label
    // AC-hetznerObjectStorage-endpointRoundTrip is documented).
    assert.match(src, /'AC-28110-1'/, 'probe anchors AC-28110-1');
    // The probe module surface declares accountBound = true and
    // documents the CI_HAS_HETZNER_OBJECT_STORAGE gate env var.
    assert.match(src, /export\s+const\s+accountBound\s*=\s*true/, 'probe exports accountBound true');
    assert.match(src, /CI_HAS_HETZNER_OBJECT_STORAGE/, 'probe references the gate env var');
    // The probe uses the fixture-side helper as the sole composer of
    // the vendor pattern (TAC-2904); no in-probe URL construction.
    assert.match(src, /composeHetznerEndpoint/, 'probe imports composeHetznerEndpoint from the fixture helper');
    // Vendor URL cited in a comment or code so the standards-trace claim
    // is grep-verifiable at gate time.
    assert.match(src, /your-objectstorage\.com/, 'probe carries the vendor endpoint pattern');
  });

  await t.test('endpoint-shape helper composes vendor pattern <bucket>.<location>.your-objectstorage.com and refuses unknown locations', async () => {
    const helper = await import(HELPER_PATH);
    for (const location of ['fsn1', 'hel1', 'nbg1']) {
      const url = helper.composeHetznerEndpoint({ bucket: 'my-bkt', location });
      assert.equal(url, `https://my-bkt.${location}.your-objectstorage.com`);
    }
    assert.throws(() => helper.composeHetznerEndpoint({ bucket: 'my-bkt', location: 'lax1' }), (err) => err.field === 'location');
    assert.throws(() => helper.composeHetznerEndpoint({ bucket: '', location: 'fsn1' }), (err) => err.field === 'bucket');
  });

  await t.test('SIMULATE_HETZNER_ENDPOINT_MISSHAPEN mutation drops the vendor subdomain (fixture-side, INPUT-only)', async () => {
    const helper = await import(HELPER_PATH);
    const prev = process.env.SIMULATE_HETZNER_ENDPOINT_MISSHAPEN;
    process.env.SIMULATE_HETZNER_ENDPOINT_MISSHAPEN = 'true';
    try {
      const url = helper.composeHetznerEndpoint({ bucket: 'my-bkt', location: 'fsn1' });
      assert.equal(url, 'https://my-bkt.fsn1.example.invalid');
      assert.doesNotMatch(url, /your-objectstorage\.com/);
    } finally {
      if (prev !== undefined) process.env.SIMULATE_HETZNER_ENDPOINT_MISSHAPEN = prev;
      else delete process.env.SIMULATE_HETZNER_ENDPOINT_MISSHAPEN;
    }
  });

  await t.test('SIMULATE_HETZNER_EVENT_LEAK mutation appends forbidden credential fields to event records (fixture-side, INPUT-only)', async () => {
    const helper = await import(HELPER_PATH);
    const prev = process.env.SIMULATE_HETZNER_EVENT_LEAK;
    process.env.SIMULATE_HETZNER_EVENT_LEAK = 'true';
    try {
      const record = helper.makeHetznerEventDecorator({
        event: 'hetznerFacadeReady',
        ts: 1,
        endpointHost: 'my-bkt.fsn1.your-objectstorage.com',
        bucketName: 'my-bkt',
      });
      assert.equal(record.accessKeyId, 'AKIA-FIXTURE-LEAK-DO-NOT-USE');
      assert.equal(record.secretAccessKey, 'FIXTURE-SECRET-LEAK-DO-NOT-USE');
      const scan = helper.assertMetadataOnlyEventRecords([record]);
      assert.equal(scan.pass, false);
      assert.ok(scan.leaked.includes('accessKeyId'));
      assert.ok(scan.leaked.includes('secretAccessKey'));
    } finally {
      if (prev !== undefined) process.env.SIMULATE_HETZNER_EVENT_LEAK = prev;
      else delete process.env.SIMULATE_HETZNER_EVENT_LEAK;
    }
  });

  await t.test('shim files delegate to the probe module: probe shim runs the probe; fixture shim delegates to the probe shim (shared-fixture-shim naming convention)', async () => {
    const probeShim = await readFile(PROBE_SHIM_PATH, 'utf8');
    assert.match(probeShim, /hetzner-object-storage-round-trip\.mjs/);
    assert.match(probeShim, /runShim/);
    const fixtureShim = await readFile(FIXTURE_SHIM_PATH, 'utf8');
    assert.match(fixtureShim, /run-hetzner-object-storage-round-trip\.mjs/);
    assert.match(fixtureShim, /blueprints\/object-storage-s3\/contributions\/probes/);
  });

  await t.test('blueprint.json v1.1.0 delta: the four new contribution files exist on disk with the expected ids', async () => {
    const files = {
      'contributions/requirements/object-storage-s3-req-101.json': ['reqId', 'object-storage-s3-REQ-101'],
      'contributions/user-stories/object-storage-s3-us-28110.json': ['usId', 'object-storage-s3-US-28110'],
      'contributions/tacs/tac-2904-object-storage-s3-hetzner-endpoint-helper.json': ['tacId', 'TAC-2904-object-storage-s3-hetzner-endpoint-helper'],
      'contributions/adrs/adr-2905-object-storage-s3-hetzner-object-storage-provider.json': ['adrId', 'ADR-2905-object-storage-s3-hetzner-object-storage-provider'],
    };
    for (const [rel, [field, id]] of Object.entries(files)) {
      const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, rel), 'utf8'));
      assert.equal(doc[field], id, `${rel} carries ${field}=${id}`);
    }
  });
});
