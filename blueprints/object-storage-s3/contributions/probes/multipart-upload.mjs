/**
 * Multipart upload probe.
 *
 * Two positive-evidence branches per user-story-28104:
 *
 *   1. Canonical multipart round-trip: puts a 10 MiB payload above the
 *      ADR-2903 threshold, asserts multipart upload completes, get
 *      returns full 10485760 bytes byte-equal, objectPut fires with
 *      size=10485760, and no in-flight multipart upload remains.
 *      Anchors AC-28104-1.
 *
 *   2. Abort-on-failure branch: forces SIMULATE_PART_UPLOAD_FAIL on
 *      the facade for a second put, asserts the promise rejects, and
 *      asserts a follow-up ListMultipartUploads on the failure key
 *      returns zero in-flight uploads (AbortMultipartUpload landed).
 *      Records the observed error and the aborted upload id (if any).
 *      Anchors AC-28104-2.
 *
 * The abort branch is REQUIRED , the probe sets SIMULATE_PART_UPLOAD
 * _FAIL locally on process.env for the second put (restoring the
 * previous value afterwards) so AC-28104-2 always carries observed
 * behaviour, never "path not run" (conformance remark 2026-09-11 on
 * AC-28104-2).
 */

import { createObjectStore, endpointFromEnv, credentialsFromShim, MissingS3EndpointError } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/object-store.mjs';
import { secretsShim } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/secrets.mjs';
import { probeKey } from './probe-utils.mjs';

export const DECLARED_ENV = Object.freeze(['S3_ENDPOINT_URL']);

const AC28104_FIRST8 = 'Given the elicited multipart threshold at 8 MiB';

function skipRow(variable) {
  return {
    anchorAcId: null,
    verdict: 'pass',
    detail: `${AC28104_FIRST8} - accountBound: skipped (${variable} unset)`,
    accountBoundSkipped: true,
    reason: `${variable} unset`,
    evidence: { skip: true, reason: `${variable} unset`, envDeclared: [...DECLARED_ENV] },
  };
}

export default async function runProbe() {
  let endpoint, bucket, region, forcePathStyle;
  try {
    ({ endpoint, bucket, region, forcePathStyle } = endpointFromEnv());
  } catch (err) {
    if (err instanceof MissingS3EndpointError) {
      return { results: [skipRow(err.variable)], extra: { accountBoundSkipped: true, reason: `${err.variable} unset`, envDeclared: [...DECLARED_ENV] } };
    }
    throw err;
  }
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
  for (let i = 0; i < SIZE; i += 1) body[i] = i & 0xff;
  try {
    await store.ready();
    // --- AC-28104-1: canonical multipart round-trip ---
    await store.putObject(key, 'application/octet-stream', body);
    const got = await store.getObject(key);
    const sizePass = got.body.length === SIZE && got.body.equals(body);
    const putEvent = events.find((e) => e.event === 'objectPut' && e.key === key);
    const eventPass = putEvent && putEvent.size === SIZE;
    results.push({
      anchorAcId: 'AC-28104-1',
      verdict: sizePass && eventPass ? 'pass' : 'fail',
      detail: sizePass && eventPass
        ? `Given the elicited multipart threshold at 8 MiB - 10 MiB round-trip byte-equal; objectPut fired with size=${putEvent.size}`
        : `Given the elicited multipart threshold at 8 MiB - sizePass=${sizePass} eventPass=${eventPass} got.size=${got.body.length} put=${JSON.stringify(putEvent)}`,
      evidence: { key, size: SIZE, gotSize: got.body.length, byteEqual: sizePass, objectPutEvent: putEvent || null },
    });
    const inflight = await store.listMultipartUploads(key);
    results.push({
      anchorAcId: 'AC-28104-1',
      verdict: inflight.length === 0 ? 'pass' : 'fail',
      detail: inflight.length === 0
        ? 'Given the elicited multipart threshold at 8 MiB - no in-flight multipart uploads after complete'
        : `Given the elicited multipart threshold at 8 MiB - unexpected in-flight uploads: ${JSON.stringify(inflight)}`,
      evidence: { key, inflightCount: inflight.length, inflight },
    });
    await store.deleteObject(key);

    // --- AC-28104-2: forced abort-on-failure branch ---
    // The probe unconditionally exercises the induced-failure path.
    const before = process.env.SIMULATE_PART_UPLOAD_FAIL;
    process.env.SIMULATE_PART_UPLOAD_FAIL = 'true';
    const failKey = probeKey('probe/multipart-fail');
    let observedError = null;
    let observedUploadId = null;
    let observedAbortError = null;
    try {
      await store.putObject(failKey, 'application/octet-stream', body);
    } catch (err) {
      observedError = { name: err && err.name, message: err && err.message, uploadId: err && err.uploadId };
      observedUploadId = err && err.uploadId;
      observedAbortError = err && err.abortError ? err.abortError : null;
    } finally {
      if (before === undefined) delete process.env.SIMULATE_PART_UPLOAD_FAIL;
      else process.env.SIMULATE_PART_UPLOAD_FAIL = before;
    }
    const failInflight = await store.listMultipartUploads(failKey);
    const uploadIdPresent = typeof observedUploadId === 'string' && observedUploadId.length > 0;
    const abortSucceeded = observedAbortError === null;
    const abortPass = observedError !== null && failInflight.length === 0 && uploadIdPresent && abortSucceeded;
    results.push({
      anchorAcId: 'AC-28104-2',
      verdict: abortPass ? 'pass' : 'fail',
      detail: abortPass
        ? `Given a simulated part-upload failure mid-multipart (SIMULATE_PART_UPLOAD_FAIL fixture) - propagated (${observedError.name || observedError.message}), aborted upload id=${observedUploadId}, no in-flight uploads for ${failKey}, abort call itself succeeded`
        : `Given a simulated part-upload failure mid-multipart (SIMULATE_PART_UPLOAD_FAIL fixture) - abort-on-failure conditions not all met: errorObserved=${observedError !== null} inflightCount=${failInflight.length} uploadIdPresent=${uploadIdPresent} abortSucceeded=${abortSucceeded}${observedAbortError ? ` abortError=${JSON.stringify(observedAbortError)}` : ''}`,
      evidence: {
        failKey,
        observedError,
        observedUploadId,
        abortError: observedAbortError,
        inflightCountAfter: failInflight.length,
        inflightAfter: failInflight,
      },
    });
  } finally {
    await store.close();
  }
  return { results, extra: { key, size: SIZE, events } };
}
