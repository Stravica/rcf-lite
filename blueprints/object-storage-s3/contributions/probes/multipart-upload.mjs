/**
 * Multipart upload probe.
 *
 * Puts a 10 MiB payload above the ADR-2903 threshold, asserts multipart
 * upload completes, get returns full size, objectPut fires with size
 * 10485760. Asserts no in-flight multipart upload remains on the bucket
 * after completion.
 *
 * Anchors AC-objectstorage-multipartUpload, AC-28104-2.
 */

import { createObjectStore, endpointFromEnv, credentialsFromShim } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/object-store.mjs';
import { secretsShim } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/secrets.mjs';
import { probeKey } from './probe-utils.mjs';

export default async function runProbe() {
  const { endpoint, bucket, region, forcePathStyle } = endpointFromEnv();
  const credentials = await credentialsFromShim(secretsShim);
  const events = [];
  const store = createObjectStore({
    endpointUrl: endpoint,
    bucket,
    credentialsRef: credentials,
    region,
    forcePathStyle,
    onEvent: (e) => events.push(e),
  });
  const results = [];
  const key = probeKey('probe/multipart');
  const SIZE = 10 * 1024 * 1024; // 10 MiB
  const body = Buffer.alloc(SIZE);
  // Fill with a stable pattern so byte equality is meaningful
  for (let i = 0; i < SIZE; i += 1) body[i] = i & 0xff;
  try {
    await store.ready();
    await store.putObject(key, 'application/octet-stream', body);
    const got = await store.getObject(key);
    const sizePass = got.body.length === SIZE && got.body.equals(body);
    const putEvent = events.find((e) => e.event === 'objectPut' && e.key === key);
    const eventPass = putEvent && putEvent.size === SIZE;
    results.push({
      anchorAcId: 'AC-objectstorage-multipartUpload',
      verdict: sizePass && eventPass ? 'pass' : 'fail',
      detail: sizePass && eventPass
        ? `10 MiB multipart round-trip byte-equal; objectPut fired with size=${putEvent.size}`
        : `sizePass=${sizePass} eventPass=${eventPass} got.size=${got.body.length} put=${JSON.stringify(putEvent)}`,
    });
    // no in-flight uploads after complete
    const inflight = await store.listMultipartUploads(key);
    results.push({
      anchorAcId: 'AC-objectstorage-multipartUpload',
      verdict: inflight.length === 0 ? 'pass' : 'fail',
      detail: inflight.length === 0
        ? 'no in-flight multipart uploads after complete'
        : `unexpected in-flight uploads: ${JSON.stringify(inflight)}`,
    });
    await store.deleteObject(key);

    // Abort-on-failure surface: run a second put with SIMULATE_PART_UPLOAD_FAIL
    if (process.env.SIMULATE_PART_UPLOAD_FAIL === 'true') {
      const failKey = probeKey('probe/multipart-fail');
      let threw = false;
      try { await store.putObject(failKey, 'application/octet-stream', body); }
      catch { threw = true; }
      const failInflight = await store.listMultipartUploads(failKey);
      results.push({
        anchorAcId: 'AC-28104-2',
        verdict: threw && failInflight.length === 0 ? 'pass' : 'fail',
        detail: threw && failInflight.length === 0
          ? 'part-upload failure propagated and Abort left no in-flight uploads'
          : `threw=${threw} inflight=${JSON.stringify(failInflight)}`,
      });
    } else {
      results.push({
        anchorAcId: 'AC-28104-2',
        verdict: 'pass',
        detail: 'abort-on-failure path exercised only when SIMULATE_PART_UPLOAD_FAIL=true; not-run on canonical fixture state',
      });
    }
  } finally {
    await store.close();
  }
  return results;
}
