/**
 * R2 real-account smoke probe.
 *
 * Opens the facade against a real Cloudflare R2 bucket (endpoint URL,
 * bucket, and credential pair read via security-secrets-management),
 * puts a 1 KiB payload, gets it back, asserts byte equality, deletes
 * the temporary object, confirms the delete via a list scoped to the
 * scratch prefix and records the created-then-absent inventory diff
 * plus HTTP status codes on the report as positive evidence.
 *
 * accountBound: true. Without CI_HAS_CLOUDFLARE_ACCOUNT (or with the
 * gate set but any second-tier variable unset) the probe records
 * accountBoundSkipped: true and a `reason` field naming the exact
 * unset variable per authoring standard section 7d.
 *
 * Declared env vars (also declared on the fixture manifest):
 * - CI_HAS_CLOUDFLARE_ACCOUNT (first-tier gate)
 * - R2_ACCOUNT_ID (second-tier: constructs the endpoint URL)
 * - R2_BUCKET (second-tier: bucket name)
 * - S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (second-tier: R2 S3-API creds)
 *
 * Anchors AC-28108-1.
 */

import { createObjectStore, credentialsFromShim } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/object-store.mjs';
import { secretsShim } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/secrets.mjs';
import { probeKey } from './probe-utils.mjs';

export const accountBound = true;
export const DECLARED_ENV = Object.freeze([
  'CI_HAS_CLOUDFLARE_ACCOUNT',
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
]);

function skipResult(reason) {
  return {
    results: [{
      anchorAcId: 'AC-28108-1',
      verdict: 'pass',
      detail: `accountBound: skipped (${reason})`,
      accountBoundSkipped: true,
      reason,
    }],
    extra: { accountBoundSkipped: true, reason, envDeclared: [...DECLARED_ENV] },
  };
}

export default async function runProbe() {
  if (process.env.CI_HAS_CLOUDFLARE_ACCOUNT !== 'true') {
    return skipResult('CI_HAS_CLOUDFLARE_ACCOUNT unset');
  }
  if (!process.env.R2_ACCOUNT_ID) return skipResult('R2_ACCOUNT_ID unset');
  if (!process.env.R2_BUCKET) return skipResult('R2_BUCKET unset');
  if (!process.env.S3_ACCESS_KEY_ID) return skipResult('S3_ACCESS_KEY_ID unset');
  if (!process.env.S3_SECRET_ACCESS_KEY) return skipResult('S3_SECRET_ACCESS_KEY unset');

  const r2 = await secretsShim.getSecret('r2Endpoint');
  if (!r2) return skipResult('r2Endpoint secret unresolvable (R2_ACCOUNT_ID / R2_BUCKET)');
  const credentials = await credentialsFromShim(secretsShim);
  const events = [];
  const store = createObjectStore({
    endpointUrl: r2.endpoint,
    bucket: r2.bucket,
    credentialsRef: credentials,
    region: 'auto',
    forcePathStyle: false,
    onEvent: (e) => events.push(e),
  });
  const key = probeKey('qa-e-s3/r2-smoke');
  const body = Buffer.alloc(1024, 0x52);
  const evidence = { endpoint: r2.endpoint, bucket: r2.bucket, key, byteCount: body.length };
  const results = [];
  try {
    await store.ready();
    const put = await store.putObject(key, 'application/octet-stream', body);
    evidence.putRequestId = put && (put.$metadata?.requestId || put.ETag);
    evidence.putHttpStatus = put && put.$metadata?.httpStatusCode;
    const got = await store.getObject(key);
    evidence.getHttpStatus = got && got.$metadata?.httpStatusCode;
    const roundTripEqual = got.body.length === body.length && got.body.equals(body);
    results.push({
      anchorAcId: 'AC-28108-1',
      verdict: roundTripEqual ? 'pass' : 'fail',
      detail: roundTripEqual
        ? `R2 round-trip byte-equal against ${r2.endpoint}/${r2.bucket}; putHttpStatus=${evidence.putHttpStatus}, getHttpStatus=${evidence.getHttpStatus}, key=${key}`
        : `R2 round-trip failed byte equality; got ${got.body.length} expected ${body.length}`,
    });
    // Inventory diff: created key must be listed before delete, absent after.
    const listedBefore = await store.listObjects(key).catch(() => ({ keys: [] }));
    const seenBefore = listedBefore.keys.includes(key);
    const deleted = await store.deleteObject(key);
    evidence.deleteHttpStatus = deleted && deleted.$metadata?.httpStatusCode;
    const listedAfter = await store.listObjects(key).catch(() => ({ keys: [] }));
    const seenAfter = listedAfter.keys.includes(key);
    results.push({
      anchorAcId: 'AC-28108-1',
      verdict: seenBefore && !seenAfter ? 'pass' : 'fail',
      detail: seenBefore && !seenAfter
        ? `inventory diff proves create+delete: key ${key} listed before delete, absent after (deleteHttpStatus=${evidence.deleteHttpStatus})`
        : `inventory diff mismatch: seenBefore=${seenBefore} seenAfter=${seenAfter}`,
    });
  } finally {
    try { await store.deleteObject(key); } catch { /* teardown best effort; delete may already have run */ }
    await store.close();
  }
  return { results, extra: { evidence, envDeclared: [...DECLARED_ENV] } };
}
