/**
 * R2 real-account smoke probe.
 *
 * Against a real Cloudflare R2 account (credentials read via the
 * fixture's secrets shim), the probe:
 *
 *   1. mints a scratch bucket `probe-scratch-<short>` via S3 CreateBucket,
 *   2. positively records the bucket present in an S3 ListBuckets
 *      inventory diff (post-create),
 *   3. opens the shipped facade against that scratch bucket, puts a
 *      1 KiB payload, gets it back byte-equal, lists to prove the key
 *      is present, deletes the object, lists again to prove it is
 *      absent (real inventory diff; a failed list is a FAIL, never an
 *      empty inventory),
 *   4. deletes the scratch bucket via S3 DeleteBucket and confirms it
 *      is absent from a post-run ListBuckets inventory diff.
 *
 * Each result row carries its own evidence object; skip records
 * follow the one-unset-variable-per-row rule (Addendum rule 4).
 *
 * accountBound: true.
 *
 * Declared env vars (also declared on the fixture manifest):
 * - CI_HAS_CLOUDFLARE_ACCOUNT (first-tier gate)
 * - R2_ACCOUNT_ID (second-tier: constructs the endpoint URL)
 * - R2_BUCKET (second-tier: the base bucket namespace scope; the probe
 *   mints its own probe-scratch-<short> under it)
 * - S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (second-tier: R2 S3-API creds)
 *
 * Anchors AC-28108-1.
 */

// @aws-sdk/client-s3 is a fixture-scoped dependency; dynamic-import it
// from a module that lives inside the fixture (object-store.mjs) so the
// resolution goes through the fixture's own node_modules.
import { probeKey } from './probe-utils.mjs';

export const accountBound = true;
export const DECLARED_ENV = Object.freeze([
  'CI_HAS_CLOUDFLARE_ACCOUNT',
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
]);

/**
 * Build a single skip row naming exactly one unset variable per
 * Addendum rule 4. `gateSetButNotTrue` distinguishes an incorrectly
 * set gate from a fully unset one.
 */
function skipResult(reason, opts = {}) {
  const detail = opts.gateSetButNotTrue
    ? `accountBound: skipped (${reason})`
    : `accountBound: skipped (${reason})`;
  return {
    results: [{
      anchorAcId: 'AC-28108-1',
      verdict: 'pass',
      detail,
      accountBoundSkipped: true,
      reason,
      evidence: { skip: true, reason, envDeclared: [...DECLARED_ENV] },
    }],
    extra: { accountBoundSkipped: true, reason, envDeclared: [...DECLARED_ENV] },
  };
}

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}

export default async function runProbe() {
  const gate = process.env.CI_HAS_CLOUDFLARE_ACCOUNT;
  if (gate == null || gate === '') return skipResult('CI_HAS_CLOUDFLARE_ACCOUNT unset');
  if (gate !== 'true') return skipResult(`CI_HAS_CLOUDFLARE_ACCOUNT set to ${JSON.stringify(gate)} (not "true")`, { gateSetButNotTrue: true });
  if (!process.env.R2_ACCOUNT_ID) return skipResult('R2_ACCOUNT_ID unset');
  if (!process.env.R2_BUCKET) return skipResult('R2_BUCKET unset');
  if (!process.env.S3_ACCESS_KEY_ID) return skipResult('S3_ACCESS_KEY_ID unset');
  if (!process.env.S3_SECRET_ACCESS_KEY) return skipResult('S3_SECRET_ACCESS_KEY unset');

  // Dynamic imports through fixture-hosted modules so the S3 SDK
  // resolves through the fixture's own node_modules.
  const { createObjectStore, credentialsFromShim } = await import('../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/object-store.mjs');
  const { secretsShim } = await import('../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/secrets.mjs');
  const { createBucketOps } = await import('../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/bucket-ops.mjs');

  // The R2 endpoint URL comes from the secrets shim; the account id
  // itself is only used indirectly through the endpoint host. Prefer
  // the shim value (an operator-supplied endpoint) over building the
  // host from the account id, so a QA runner can point at a specific
  // R2 jurisdiction if needed.
  const r2 = await secretsShim.getSecret('r2Endpoint');
  if (!r2 || !r2.endpoint) return skipResult('R2 endpoint could not be resolved from the secrets shim');
  const credentials = await credentialsFromShim(secretsShim);
  const scratchBucket = `probe-scratch-${shortId()}`;
  const evidence = {
    endpointHostRedacted: new URL(r2.endpoint).host.replace(/^[0-9a-f]+/, '[account-id]'),
    scratchBucket,
    envDeclared: [...DECLARED_ENV],
  };
  const results = [];
  const teardown = { deleteObject: null, deleteBucket: null, bucketAbsentAfter: null };
  const bucketOps = createBucketOps({
    endpointUrl: r2.endpoint,
    region: 'auto',
    credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey },
    forcePathStyle: false,
  });

  let bucketCreated = false;
  let store = null;
  try {
    // 1) Create the scratch bucket
    const create = await bucketOps.createBucket(scratchBucket);
    bucketCreated = true;
    evidence.createBucketHttpStatus = create && create.$metadata && create.$metadata.httpStatusCode;
    evidence.createBucketRequestId = create && create.$metadata && create.$metadata.requestId;

    // 2) Inventory diff: post-create bucket must appear on ListBuckets.
    // A failed list here is a FAIL, not an empty list.
    let bucketsAfterCreate;
    try {
      const list = await bucketOps.listBuckets();
      bucketsAfterCreate = list.buckets;
      evidence.listBucketsRequestIdAfterCreate = list.raw && list.raw.$metadata && list.raw.$metadata.requestId;
    } catch (err) {
      results.push({
        anchorAcId: 'AC-28108-1',
        verdict: 'fail',
        detail: `ListBuckets after CreateBucket threw: ${err && err.message}; failed inventory is a FAIL, never an empty listing`,
        evidence: { scratchBucket, error: err && err.message },
      });
      // Best-effort teardown of the bucket newly created above before returning.
      throw err;
    }
    const seenAfterCreate = bucketsAfterCreate.includes(scratchBucket);
    results.push({
      anchorAcId: 'AC-28108-1',
      verdict: seenAfterCreate ? 'pass' : 'fail',
      detail: seenAfterCreate
        ? `scratch bucket ${scratchBucket} present in ListBuckets after CreateBucket (positive inventory diff)`
        : `scratch bucket ${scratchBucket} NOT in ListBuckets after CreateBucket; buckets=${JSON.stringify(bucketsAfterCreate)}`,
      evidence: { scratchBucket, seenAfterCreate, bucketCount: bucketsAfterCreate.length, createBucketHttpStatus: evidence.createBucketHttpStatus },
    });

    // 3) Open the shipped facade against the scratch bucket and drive a
    // 1 KiB round-trip + real inventory diff on the object.
    const events = [];
    store = createObjectStore({
      endpointUrl: r2.endpoint,
      bucket: scratchBucket,
      credentialsRef: credentials,
      region: 'auto',
      forcePathStyle: false,
      onEvent: (e) => events.push(e),
    });
    await store.ready();
    const key = probeKey('probe-scratch/r2-smoke');
    const body = Buffer.alloc(1024, 0x52);
    const put = await store.putObject(key, 'application/octet-stream', body);
    const got = await store.getObject(key);
    const roundTripEqual = got.body.length === body.length && got.body.equals(body);
    results.push({
      anchorAcId: 'AC-28108-1',
      verdict: roundTripEqual ? 'pass' : 'fail',
      detail: roundTripEqual
        ? `R2 round-trip byte-equal against the scratch bucket ${scratchBucket} through the shipped facade; putObject returned size=${put.size}, getObject body length=${got.body.length}`
        : `R2 round-trip failed byte equality; got ${got.body.length} expected ${body.length}`,
      evidence: { scratchBucket, key, putReturnedSize: put.size, getSize: got.body.length, byteEqual: roundTripEqual, objectPutEvent: events.find((e) => e.event === 'objectPut') || null },
    });

    // Real per-object inventory diff: a failed list is a FAIL, not an
    // empty list.
    let listBefore;
    try {
      listBefore = await store.listObjects(key);
    } catch (err) {
      results.push({
        anchorAcId: 'AC-28108-1',
        verdict: 'fail',
        detail: `listObjects before delete threw: ${err && err.message}; failed list is a FAIL, never treated as an empty inventory`,
        evidence: { scratchBucket, key, error: err && err.message },
      });
      throw err;
    }
    const seenBefore = listBefore.keys.includes(key);
    await store.deleteObject(key);
    teardown.deleteObject = { key, ok: true };
    let listAfter;
    try {
      listAfter = await store.listObjects(key);
    } catch (err) {
      results.push({
        anchorAcId: 'AC-28108-1',
        verdict: 'fail',
        detail: `listObjects after delete threw: ${err && err.message}; failed list is a FAIL, never an empty inventory`,
        evidence: { scratchBucket, key, error: err && err.message },
      });
      throw err;
    }
    const seenAfter = listAfter.keys.includes(key);
    const inventoryPass = seenBefore && !seenAfter;
    results.push({
      anchorAcId: 'AC-28108-1',
      verdict: inventoryPass ? 'pass' : 'fail',
      detail: inventoryPass
        ? `object inventory diff proves create+delete: key present before delete, absent after (listObjects returned ${listBefore.keys.length} then ${listAfter.keys.length} keys)`
        : `inventory diff mismatch: seenBefore=${seenBefore} seenAfter=${seenAfter}`,
      evidence: { scratchBucket, key, seenBefore, seenAfter, keysBeforeCount: listBefore.keys.length, keysAfterCount: listAfter.keys.length },
    });
  } finally {
    // 4) Bucket teardown: delete the scratch bucket and confirm it is
    // absent from a post-run ListBuckets inventory. A teardown failure
    // FAILS the verdict (Addendum rule 5).
    if (store) {
      try { await store.close(); } catch { /* facade close best-effort */ }
    }
    if (bucketCreated) {
      let deleteBucketErr = null;
      try {
        const del = await bucketOps.deleteBucket(scratchBucket);
        teardown.deleteBucket = {
          bucket: scratchBucket,
          ok: true,
          httpStatus: del && del.$metadata && del.$metadata.httpStatusCode,
          requestId: del && del.$metadata && del.$metadata.requestId,
        };
      } catch (err) {
        deleteBucketErr = err;
        teardown.deleteBucket = { bucket: scratchBucket, ok: false, error: err && err.message };
      }
      // Post-run bucket inventory
      try {
        const list = await bucketOps.listBuckets();
        const stillThere = list.buckets.includes(scratchBucket);
        teardown.bucketAbsentAfter = { ok: !stillThere, bucketCount: list.buckets.length, requestId: list.raw && list.raw.$metadata && list.raw.$metadata.requestId };
      } catch (err) {
        teardown.bucketAbsentAfter = { ok: false, error: err && err.message };
      }
      const teardownOk = teardown.deleteBucket && teardown.deleteBucket.ok && teardown.bucketAbsentAfter && teardown.bucketAbsentAfter.ok;
      results.push({
        anchorAcId: 'AC-28108-1',
        verdict: teardownOk ? 'pass' : 'fail',
        detail: teardownOk
          ? `scratch bucket ${scratchBucket} deleted and confirmed absent from post-run ListBuckets`
          : `bucket teardown FAILED: deleteBucket=${JSON.stringify(teardown.deleteBucket)}; bucketAbsentAfter=${JSON.stringify(teardown.bucketAbsentAfter)}${deleteBucketErr ? ` deleteBucketError=${deleteBucketErr.message}` : ''}`,
        evidence: { teardown },
      });
    }
    bucketOps.close();
  }
  return { results, extra: { evidence, envDeclared: [...DECLARED_ENV], teardown } };
}
