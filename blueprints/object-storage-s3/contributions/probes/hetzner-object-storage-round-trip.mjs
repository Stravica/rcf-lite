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

const AC28110_1 = 'Given the extended infra-s3-and-queue fixture at packages/rcf-lite/test/fixtures/infra-s3-and-queue/ carrying';
const REQ001 = 'The application accesses object storage through a single';

function skipResult(reason) {
  return {
    results: [{
      anchorAcId: 'AC-28110-1',
      verdict: 'pass',
      detail: `${AC28110_1} - accountBound: skipped (${reason})`,
      accountBoundSkipped: true,
      reason,
      evidence: { skip: true, reason, envDeclared: [...DECLARED_ENV] },
    }],
    extra: { accountBoundSkipped: true, reason, envDeclared: [...DECLARED_ENV] },
  };
}

export default async function runProbe() {
  const gate = process.env.CI_HAS_HETZNER_OBJECT_STORAGE;
  if (gate == null || gate === '') {
    return skipResult('CI_HAS_HETZNER_OBJECT_STORAGE unset');
  }
  if (gate !== 'true') {
    return skipResult(`CI_HAS_HETZNER_OBJECT_STORAGE set to ${JSON.stringify(gate)} (not "true")`);
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
      detail: `${AC28110_1} - CI_HAS_HETZNER_OBJECT_STORAGE set but one or more required env vars missing (HETZNER_OBJECT_STORAGE_ACCESS_KEY_ID, HETZNER_OBJECT_STORAGE_SECRET_ACCESS_KEY, HETZNER_OBJECT_STORAGE_BUCKET, HETZNER_OBJECT_STORAGE_LOCATION)`,
      evidence: { envSet: false },
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
      detail: `${AC28110_1} - endpoint composition threw on field ${err.field || 'unknown'}: ${err.message}`,
      evidence: { endpointCompositionError: err && err.message, endpointField: err.field || 'unknown' },
    }];
  }
  if (!VENDOR_PATTERN.test(endpoint)) {
    return [{
      anchorAcId: 'AC-28110-1',
      verdict: 'fail',
      detail: `${AC28110_1} - composed endpoint does not match vendor pattern <bucket>.<location>.your-objectstorage.com; got ${endpoint}; missing subdomain: your-objectstorage.com`,
      evidence: { composedEndpoint: endpoint, vendorPatternMatched: false },
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
        ? `${AC28110_1} - Hetzner Object Storage round-trip byte-equal against the composed vendor endpoint`
        : `${AC28110_1} - Hetzner Object Storage round-trip failed byte equality; expected 1024 bytes got ${got.body.length}`,
      evidence: { endpointVendorPatternMatched: true, bucketNamePresent: Boolean(bucket), locationCode: location, byteCount: got.body.length },
    });
    const evAssertion = assertMetadataOnlyEventRecords(events);
    results.push({
      anchorAcId: 'AC-28110-1',
      verdict: evAssertion.pass ? 'pass' : 'fail',
      detail: evAssertion.pass
        ? `${AC28110_1} - every lifecycle event carries only whitelisted fields (${[...HETZNER_EVENT_WHITELIST].join(',')})`
        : `${AC28110_1} - event-secrecy leak: forbidden fields present ${evAssertion.leaked.join(',')}`,
      evidence: { whitelistedFields: [...HETZNER_EVENT_WHITELIST], leakedFields: evAssertion.leaked || [], eventCount: events.length },
    });
  } finally {
    // Teardown outcomes are recorded on the results per authoring-standard rule
    // 5; a teardown FAILURE fails the verdict.
    const teardown = { deleteObject: null };
    try {
      await store.deleteObject(key);
      teardown.deleteObject = { key, ok: true };
    } catch (err) {
      teardown.deleteObject = { key, ok: false, error: err && err.message };
    }
    let facadeCloseError = null;
    try { await store.close(); } catch (err) { facadeCloseError = err && err.message; }
    if (facadeCloseError) {
      results.push({
        anchorReqId: 'object-storage-s3-REQ-001',
        verdict: 'fail',
        detail: `${REQ001} - facade close FAILED on Hetzner teardown: ${facadeCloseError}`,
        evidence: { teardownStep: 'facade close', error: facadeCloseError },
      });
    }
    results.push({
      anchorAcId: 'AC-28110-1',
      verdict: teardown.deleteObject && teardown.deleteObject.ok ? 'pass' : 'fail',
      detail: teardown.deleteObject && teardown.deleteObject.ok
        ? `${AC28110_1} - scratch object ${key} deleted on teardown`
        : `${AC28110_1} - scratch object teardown FAILED: ${JSON.stringify(teardown.deleteObject)}`,
      evidence: { teardown },
    });
  }
  return { results, extra: { envDeclared: [...DECLARED_ENV] } };
}
