/**
 * Facade round-trip probe.
 *
 * Opens the fixture's facade against a running MinIO container, drives
 * a HeadBucket ready-check, asserts facadeReady fires on the injected
 * event sink with endpointHost and bucketName.
 *
 * Anchors AC-28101-1.
 */

import { createObjectStore, endpointFromEnv, credentialsFromShim } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/object-store.mjs';
import { secretsShim } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/secrets.mjs';

const AC28101_1 = 'On process boot, the facade opens against';

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
  try {
    await store.ready();
    const ready = events.find((e) => e.event === 'facadeReady');
    const endpointHost = new URL(endpoint).host;
    // Drive a HeadBucket call directly through the fixture's SDK
    // client so the row carries a real vendor request id and HTTP
    // status excerpt (follow-up review: facade-ready + event-secrecy
    // rows need per-row vendor evidence).
    let vendorMetadata = null;
    try {
      const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
      const head = await store.getClient().send(new HeadBucketCommand({ Bucket: bucket }));
      vendorMetadata = head && head.$metadata ? {
        httpStatusCode: head.$metadata.httpStatusCode,
        requestId: head.$metadata.requestId,
        extendedRequestId: head.$metadata.extendedRequestId,
      } : null;
    } catch (err) {
      vendorMetadata = { error: err && err.message, httpStatusCode: err && err.$metadata && err.$metadata.httpStatusCode };
    }
    const pass = ready && ready.endpointHost === endpointHost && ready.bucketName === bucket && vendorMetadata && vendorMetadata.httpStatusCode === 200;
    results.push({
      anchorAcId: 'AC-28101-1',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `${AC28101_1} - facadeReady fired with endpointHost=${ready.endpointHost} bucketName=${ready.bucketName}; HeadBucket returned ${vendorMetadata.httpStatusCode} (requestId=${vendorMetadata.requestId})`
        : `${AC28101_1} - facadeReady did not fire cleanly; ready=${JSON.stringify(ready)} vendorMetadata=${JSON.stringify(vendorMetadata)}`,
      evidence: {
        facadeReadyEvent: ready || null,
        endpointHost,
        bucketName: bucket,
        vendorRequestId: vendorMetadata && vendorMetadata.requestId,
        vendorHttpStatus: vendorMetadata && vendorMetadata.httpStatusCode,
        vendorMetadata,
        allEvents: events,
      },
    });
  } finally {
    await store.close();
  }
  return results;
}
