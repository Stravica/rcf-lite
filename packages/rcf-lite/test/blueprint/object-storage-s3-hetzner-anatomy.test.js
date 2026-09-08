// Anatomy test for the object-storage-s3 v1.1.0 follow-up Hetzner
// Object Storage adapter (round-7 spec section 5.4). Covers TS-170,
// TC-170-hetzner-endpoint-round-trip-and-skipped-shape (AC-14001-1 on
// the repo chain, mirroring AC-28110-1 on the blueprint side).
//
// The probe itself lives at
// blueprints/object-storage-s3/contributions/probes/hetzner-object-storage-round-trip.mjs
// and is exercised end-to-end by the gate-reviewer boot line documented
// in the fixture README. This anatomy test asserts the probe module and
// fixture-side helper anatomy that make the probe legitimate on the
// shipped shape (per the round-5 anatomy test pattern):
//
// - the probe module surface declares accountBound true and records the
//   accountBoundSkipped shape without CI_HAS_HETZNER_OBJECT_STORAGE;
// - the endpoint-shape helper composes the vendor pattern exactly;
// - the two fixture-side mutation switches force FAIL on the shape they
//   are wired against;
// - the probe module itself reads no SIMULATE_ variable
//   (mutation-purity discipline per HQ hard gate row 2026-09-08).

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
const HELPER_PATH = join(FIXTURE_ROOT, 'src', 'hetzner-endpoint.mjs');

test('adapter object-storage-s3 v1.1.0 hetzner AC-14001-1 endpoint round-trip and skipped shape (TC-170-hetzner-endpoint-round-trip-and-skipped-shape)', async (t) => {
  await t.test('probe module surface: accountBound true; anchorAcId AC-28110-1; no SIMULATE_ read on probe file', async () => {
    const mod = await import(HELPER_PATH); // side-effect free import
    void mod; // silence unused
    const probe = await import(PROBE_PATH);
    assert.equal(probe.accountBound, true, 'probe declares accountBound true');
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
  });

  await t.test('accountBoundSkipped shape without CI_HAS_HETZNER_OBJECT_STORAGE: default runProbe returns pass and accountBoundSkipped true', async () => {
    const prev = process.env.CI_HAS_HETZNER_OBJECT_STORAGE;
    delete process.env.CI_HAS_HETZNER_OBJECT_STORAGE;
    try {
      const probe = await import(PROBE_PATH);
      const results = await probe.default();
      assert.equal(results.length, 1);
      assert.equal(results[0].verdict, 'pass');
      assert.equal(results[0].accountBoundSkipped, true);
      assert.equal(results[0].anchorAcId, 'AC-28110-1');
    } finally {
      if (prev !== undefined) process.env.CI_HAS_HETZNER_OBJECT_STORAGE = prev;
    }
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

  await t.test('fixture-root shim delegates to blueprint-side probe shim (shared-fixture-shim naming convention)', async () => {
    const shim = await readFile(join(FIXTURE_ROOT, 'run-hetzner-object-storage-round-trip.mjs'), 'utf8');
    assert.match(shim, /run-hetzner-object-storage-round-trip\.mjs/);
    assert.match(shim, /blueprints\/object-storage-s3\/contributions\/probes/);
  });
});
