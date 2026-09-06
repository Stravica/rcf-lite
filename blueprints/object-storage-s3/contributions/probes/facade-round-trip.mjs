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
    const pass = ready && ready.endpointHost === endpointHost && ready.bucketName === bucket;
    results.push({
      anchorAcId: 'AC-28101-1',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `facadeReady fired with endpointHost=${ready.endpointHost} bucketName=${ready.bucketName}`
        : `facadeReady did not fire cleanly; events=${JSON.stringify(events)}`,
    });
  } finally {
    await store.close();
  }
  return results;
}
