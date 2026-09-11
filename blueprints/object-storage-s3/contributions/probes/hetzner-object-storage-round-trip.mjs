/**
 * Hetzner Object Storage round-trip probe.
 *
 * Composes the vendor-documented endpoint pattern
 * <bucket>.<location>.your-objectstorage.com through the fixture-side
 * hetzner-endpoint helper (TAC-2904; sole composer of the pattern),
 * opens the shipped v1.0.0 facade (TAC-2901 over @aws-sdk/client-s3
 * per ADR-2901) against the composed endpoint, puts a 1 KiB payload,
 * gets it back byte-equal, deletes the scratch object, and asserts
 * every lifecycle event record carries only whitelisted metadata
 * fields per the fixture-side whitelist.
 *
 * accountBound: true. Skipped in CI without CI_HAS_HETZNER_OBJECT_STORAGE
 * per hetzner-round-7-spec-2026-09-07 section 3.5 and section 5.4.
 *
 * Dependency-load discipline: the fixture-side facade module
 * `object-store.mjs` imports `@aws-sdk/client-s3`, which is a
 * fixture-scoped dependency installed by `npm install` inside the
 * fixture directory (documented in the fixture README). To keep the
 * accountBoundSkipped path loadable without that fixture install
 * (surface inspection under `node --test`, tools that walk the probe
 * module for its `accountBound` flag), the SDK-touching imports are
 * DYNAMIC and gated on the CI_HAS_HETZNER_OBJECT_STORAGE env var.
 *
 * Mutation-purity discipline (per the operator estate hard gate row 2026-09-08): this
 * module reads NO SIMULATE_ variable. Every fixture-side mutation
 * hook (SIMULATE_HETZNER_ENDPOINT_MISSHAPEN,
 * SIMULATE_HETZNER_EVENT_LEAK) lives in
 * packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/hetzner-endpoint.mjs
 * and alters the INPUT the probe assembles (the composed URL or the
 * event-record payload).
 *
 * Anchors AC-28110-1 (label AC-hetznerObjectStorage-endpointRoundTrip).
 */

import { probeKey } from './probe-utils.mjs';

export const accountBound = true;
export const DECLARED_ENV = Object.freeze([
  'CI_HAS_HETZNER_OBJECT_STORAGE',
  'HETZNER_OBJECT_STORAGE_ACCESS_KEY_ID',
  'HETZNER_OBJECT_STORAGE_SECRET_ACCESS_KEY',
  'HETZNER_OBJECT_STORAGE_BUCKET',
  'HETZNER_OBJECT_STORAGE_LOCATION',
]);

const VENDOR_PATTERN = /^https:\/\/[^./]+\.(fsn1|hel1|nbg1)\.your-objectstorage\.com$/;

function skipResult(reason) {
  return {
    results: [{
      anchorAcId: 'AC-28110-1',
      verdict: 'pass',
      detail: `accountBound: skipped (${reason})`,
      accountBoundSkipped: true,
      reason,
    }],
    extra: { accountBoundSkipped: true, reason, envDeclared: [...DECLARED_ENV] },
  };
}

export default async function runProbe() {
  if (process.env.CI_HAS_HETZNER_OBJECT_STORAGE !== 'true') {
    return skipResult('CI_HAS_HETZNER_OBJECT_STORAGE unset');
  }
  for (const varName of [
    'HETZNER_OBJECT_STORAGE_ACCESS_KEY_ID',
    'HETZNER_OBJECT_STORAGE_SECRET_ACCESS_KEY',
    'HETZNER_OBJECT_STORAGE_BUCKET',
    'HETZNER_OBJECT_STORAGE_LOCATION',
  ]) {
    if (!process.env[varName]) return skipResult(`${varName} unset`);
  }

  // Dynamic imports so the accountBoundSkipped path above loads
  // without the fixture-scoped @aws-sdk/client-s3 dependency.
  const {
    composeHetznerEndpoint,
    hetznerCredentialsFromEnv,
    makeHetznerEventDecorator,
    assertMetadataOnlyEventRecords,
    HETZNER_EVENT_WHITELIST,
  } = await import('../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/hetzner-endpoint.mjs');
  const { createObjectStore } = await import('../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/object-store.mjs');

  const { accessKeyId, secretAccessKey, bucket, location } = hetznerCredentialsFromEnv();
  if (!accessKeyId || !secretAccessKey || !bucket || !location) {
    return [{
      anchorAcId: 'AC-28110-1',
      verdict: 'fail',
      detail: 'CI_HAS_HETZNER_OBJECT_STORAGE set but one or more required env vars missing (HETZNER_OBJECT_STORAGE_ACCESS_KEY_ID, HETZNER_OBJECT_STORAGE_SECRET_ACCESS_KEY, HETZNER_OBJECT_STORAGE_BUCKET, HETZNER_OBJECT_STORAGE_LOCATION)',
    }];
  }

  const results = [];
  let endpoint;
  try {
    endpoint = composeHetznerEndpoint({ bucket, location });
  } catch (err) {
    return [{
      anchorAcId: 'AC-28110-1',
      verdict: 'fail',
      detail: `endpoint composition threw on field ${err.field || 'unknown'}: ${err.message}`,
    }];
  }
  if (!VENDOR_PATTERN.test(endpoint)) {
    return [{
      anchorAcId: 'AC-28110-1',
      verdict: 'fail',
      detail: `composed endpoint does not match vendor pattern <bucket>.<location>.your-objectstorage.com; got ${endpoint}; missing subdomain: your-objectstorage.com`,
    }];
  }

  const events = [];
  const store = createObjectStore({
    endpointUrl: endpoint,
    bucket,
    credentialsRef: { accessKeyId, secretAccessKey },
    region: 'auto',
    forcePathStyle: false,
    onEvent: (e) => events.push(makeHetznerEventDecorator({
      event: e.event,
      ts: e.ts,
      endpointHost: e.endpointHost,
      bucketName: e.bucketName,
      location,
      key: e.key,
      size: e.size,
      contentType: e.contentType,
    })),
  });
  const key = probeKey('probe/hetzner-smoke');
  const body = Buffer.alloc(1024, 0x48);
  try {
    await store.ready();
    await store.putObject(key, 'application/octet-stream', body);
    const got = await store.getObject(key);
    const roundTripEqual = got.body.length === 1024 && got.body.equals(body);
    results.push({
      anchorAcId: 'AC-28110-1',
      verdict: roundTripEqual ? 'pass' : 'fail',
      detail: roundTripEqual
        ? `Hetzner Object Storage round-trip byte-equal against ${endpoint} bucket=${bucket} location=${location}`
        : `Hetzner Object Storage round-trip failed byte equality; expected 1024 bytes got ${got.body.length}`,
    });
    const evAssertion = assertMetadataOnlyEventRecords(events);
    results.push({
      anchorAcId: 'AC-28110-1',
      verdict: evAssertion.pass ? 'pass' : 'fail',
      detail: evAssertion.pass
        ? `every lifecycle event carries only whitelisted fields (${[...HETZNER_EVENT_WHITELIST].join(',')})`
        : `event-secrecy leak: forbidden fields present ${evAssertion.leaked.join(',')}`,
    });
  } finally {
    try { await store.deleteObject(key); } catch { /* teardown best effort */ }
    await store.close();
  }
  return results;
}
