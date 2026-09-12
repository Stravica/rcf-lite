/**
 * R2 real-account smoke probe.
 *
 * Against a real Cloudflare R2 account (credentials read via the
 * fixture's secrets shim), the probe:
 *
 *   1. mints a scratch bucket via S3 CreateBucket,
 *   2. positively records the bucket present in an S3 ListBuckets
 *      inventory diff (post-create),
 *   3. opens the shipped facade against that scratch bucket, puts a
 *      1 KiB payload, gets it back byte-equal, lists to prove the key
 *      is present, deletes the object, lists again to prove it is
 *      absent (real inventory diff; a failed list is a FAIL, never an
 *      empty inventory),
 *   4. deletes the scratch bucket via S3 DeleteBucket and confirms it
 *      is absent from a post-run ListBuckets inventory diff, recording
 *      the HTTP status of the DeleteBucket call and the ListBuckets
 *      call on the row itself.
 *
 * Each result row carries its own evidence object; skip records
 * follow the one-unset-variable-per-row rule.
 *
 * Row anchoring:
 *  - The account-bound skip anchors AC-28108-1 (the skip acceptance).
 *  - The object round trip + inventory diff anchor AC-28108-2 (the
 *    live-account round trip).
 *  - Bucket lifecycle rows (bucket create / bucket delete / post-run
 *    bucket-inventory diff) are recorded as `conformanceOnly: true`
 *    with `anchorAcId: null`: no shipped AC states bucket-lifecycle
 *    behaviour, and REQ-002's verb contract is the four object-level
 *    verbs (putObject / getObject / deleteObject / listObjects), not
 *    CreateBucket / DeleteBucket / ListBuckets. The `limitation`
 *    field on each row names REQ-002 and explains the gap so a
 *    reader sees the property that was NOT observed alongside the
 *    observation that WAS made.
 *  - Endpoint-resolution failure after the preflight gates all pass
 *    is a FAIL anchored to REQ-001 (facade opens on boot), never a
 *    compound account skip.
 *
 * accountBound: true.
 */

import { probeKey } from './probe-utils.mjs';

export const accountBound = true;
export const DECLARED_ENV = Object.freeze([
  'CI_HAS_CLOUDFLARE_ACCOUNT',
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
]);

const AC28108_1_FIRST8 = 'Given CI_HAS_CLOUDFLARE_ACCOUNT is unset, when the r2-real-account-smoke.mjs shim';
const AC28108_2_FIRST8 = 'Given CI_HAS_CLOUDFLARE_ACCOUNT set alongside a real R2 endpoint';
const REQ001_FIRST8 = 'The application accesses object storage through a single';
const AC28108_2_INVENTORY_LIMITATION = 'AC-28108-2: Given CI_HAS_CLOUDFLARE_ACCOUNT set alongside a real R2 endpoint URL, bucket name, and credential pair (all from security-secrets-management), when the r2-real-account-smoke.mjs shim runs, then the facade opens against the R2 bucket, puts a 1 KiB payload, gets it back byte-equal, deletes the temporary object on exit, and the report carries aggregateVerdict pass with accountBoundSkipped absent or false. Not observed on this row: the object round-trip clause is observed on the byte-equal put/get row that anchors AC-28108-2 with the engine-returned ETag; this row records the per-object inventory diff (listObjects before delete, delete, listObjects after delete) which R2 does not surface a per-object engine-returned identifier for (S3 SDK $metadata.requestId returns null on Cloudflare R2 for object-level verbs).';
const AC28108_2_BUCKET_LIMITATION = 'AC-28108-2: Given CI_HAS_CLOUDFLARE_ACCOUNT set alongside a real R2 endpoint URL, bucket name, and credential pair (all from security-secrets-management), when the r2-real-account-smoke.mjs shim runs, then the facade opens against the R2 bucket, puts a 1 KiB payload, gets it back byte-equal, deletes the temporary object on exit, and the report carries aggregateVerdict pass with accountBoundSkipped absent or false. Not observed on this row: the AC states an object-level round trip on an already-provisioned bucket; this row records bucket-level lifecycle (CreateBucket / DeleteBucket / ListBuckets), which the AC does not state.';

function skipResult(reason) {
  return {
    results: [{
      anchorAcId: 'AC-28108-1',
      verdict: 'pass',
      detail: `${AC28108_1_FIRST8} - accountBound: skipped (${reason})`,
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
  if (gate !== 'true') return skipResult('CI_HAS_CLOUDFLARE_ACCOUNT (not "true")');
  if (!process.env.R2_ACCOUNT_ID) return skipResult('R2_ACCOUNT_ID unset');
  if (!process.env.R2_BUCKET) return skipResult('R2_BUCKET unset');
  if (!process.env.S3_ACCESS_KEY_ID) return skipResult('S3_ACCESS_KEY_ID unset');
  if (!process.env.S3_SECRET_ACCESS_KEY) return skipResult('S3_SECRET_ACCESS_KEY unset');

  const { createObjectStore, credentialsFromShim } = await import('../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/object-store.mjs');
  const { secretsShim } = await import('../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/secrets.mjs');
  const { createBucketOps } = await import('../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/bucket-ops.mjs');

  const r2 = await secretsShim.getSecret('r2Endpoint');
  if (!r2 || !r2.endpoint) {
    // All preflight gates passed; endpoint resolution failure is a
    // real facade-open failure, not an account-bound skip.
    return {
      results: [{
        anchorReqId: 'object-storage-s3-REQ-001',
        verdict: 'fail',
        detail: `${REQ001_FIRST8} - endpoint could not be resolved from the secrets shim after all preflight gates passed; this is a facade-open failure, not an account skip`,
        evidence: { endpointResolved: false, envDeclared: [...DECLARED_ENV] },
      }],
      extra: { envDeclared: [...DECLARED_ENV] },
    };
  }
  const credentials = await credentialsFromShim(secretsShim);
  const scratchBucket = `qa-e-s3-${shortId()}`;
  const endpointHostRedacted = new URL(r2.endpoint).host.replace(/^[0-9a-f]+/, '[account-id]');
  const evidence = { endpointHostRedacted, scratchBucket, envDeclared: [...DECLARED_ENV] };
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
    // 1) Create scratch bucket (anchor REQ-002: put verb).
    const create = await bucketOps.createBucket(scratchBucket);
    bucketCreated = true;
    const createHttpStatus = create && create.$metadata && create.$metadata.httpStatusCode;
    const createRequestId = create && create.$metadata && create.$metadata.requestId;

    // 2) Inventory diff (REQ-002 list verb): post-create bucket must
    // appear on ListBuckets. Failed list is a FAIL.
    let bucketsAfterCreate;
    let listAfterCreateHttpStatus;
    let listAfterCreateRequestId;
    try {
      const list = await bucketOps.listBuckets();
      bucketsAfterCreate = list.buckets;
      listAfterCreateHttpStatus = list.raw && list.raw.$metadata && list.raw.$metadata.httpStatusCode;
      listAfterCreateRequestId = list.raw && list.raw.$metadata && list.raw.$metadata.requestId;
    } catch (err) {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: AC28108_2_BUCKET_LIMITATION,
        verdict: 'fail',
        detail: `conformanceOnly (${AC28108_2_BUCKET_LIMITATION}) - ListBuckets after CreateBucket threw: ${err && err.message}; failed inventory is a FAIL`,
        evidence: { scratchBucket, error: err && err.message, endpointHostRedacted },
      });
      throw err;
    }
    const seenAfterCreate = bucketsAfterCreate.includes(scratchBucket);
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: AC28108_2_BUCKET_LIMITATION,
      verdict: seenAfterCreate ? 'pass' : 'fail',
      detail: seenAfterCreate
        ? `conformanceOnly (${AC28108_2_BUCKET_LIMITATION}) - scratch bucket ${scratchBucket} present in ListBuckets after CreateBucket (positive inventory diff on bucket-level lifecycle)`
        : `conformanceOnly (${AC28108_2_BUCKET_LIMITATION}) - scratch bucket ${scratchBucket} NOT in ListBuckets after CreateBucket; buckets=${JSON.stringify(bucketsAfterCreate)}`,
      evidence: {
        scratchBucket,
        seenAfterCreate,
        bucketCount: bucketsAfterCreate.length,
        createBucketHttpStatus: createHttpStatus,
        createBucketRequestId: createRequestId,
        listBucketsHttpStatus: listAfterCreateHttpStatus,
        listBucketsRequestId: listAfterCreateRequestId,
        endpointHostRedacted,
      },
    });

    // 3) Open facade against scratch bucket and round-trip (AC-28108-2).
    const events = [];
    store = await createObjectStore({
      endpointUrl: r2.endpoint,
      bucket: scratchBucket,
      credentialsRef: credentials,
      region: 'auto',
      forcePathStyle: false,
      onEvent: (e) => events.push(e),
    });
    await store.ready();
    const key = probeKey('qa-e-s3/r2-smoke');
    const body = Buffer.alloc(1024, 0x52);
    const put = await store.putObject(key, 'application/octet-stream', body);
    const got = await store.getObject(key);
    const roundTripEqual = got.body.length === body.length && got.body.equals(body);
    results.push({
      anchorAcId: 'AC-28108-2',
      verdict: roundTripEqual ? 'pass' : 'fail',
      detail: roundTripEqual
        ? `${AC28108_2_FIRST8} - R2 round-trip byte-equal against ${scratchBucket} through the shipped facade; putObject returned size=${put.size}, getObject body length=${got.body.length}`
        : `${AC28108_2_FIRST8} - R2 round-trip failed byte equality; got ${got.body.length} expected ${body.length}`,
      evidence: {
        eTag: (put && put.eTag) || (got && got.eTag) || null,
        vendorRequestId: (put && put.requestId) || (got && got.requestId) || null,
        scratchBucket,
        key,
        putReturnedSize: put.size,
        getSize: got.body.length,
        byteEqual: roundTripEqual,
        objectPutEvent: events.find((e) => e.event === 'objectPut') || null,
        endpointHostRedacted,
      },
    });

    // Real per-object inventory diff (AC-28108-2 covers the delete on
    // exit). A failed list is a FAIL.
    let listBefore;
    try { listBefore = await store.listObjects(key); }
    catch (err) {
      results.push({
        anchorAcId: 'AC-28108-2',
        verdict: 'fail',
        detail: `${AC28108_2_FIRST8} - listObjects before delete threw: ${err && err.message}`,
        evidence: { scratchBucket, key, error: err && err.message },
      });
      throw err;
    }
    const seenBefore = listBefore.keys.includes(key);
    const delRes = await store.deleteObject(key);
    teardown.deleteObject = { key, ok: true, requestId: (delRes && delRes.requestId) || null };
    let listAfter;
    try { listAfter = await store.listObjects(key); }
    catch (err) {
      results.push({
        anchorAcId: 'AC-28108-2',
        verdict: 'fail',
        detail: `${AC28108_2_FIRST8} - listObjects after delete threw: ${err && err.message}`,
        evidence: { scratchBucket, key, error: err && err.message },
      });
      throw err;
    }
    const seenAfter = listAfter.keys.includes(key);
    const inventoryPass = seenBefore && !seenAfter;
    // R2 does not surface a per-object $metadata.requestId on the
    // object-level list/delete verbs, so the inventory-diff row has
    // no engine-returned scalar id. The AC-28108-2 object round-trip
    // clause is anchored on the byte-equal put/get row above (which
    // carries the engine-returned ETag). This row is conformanceOnly
    // and records the per-object inventory diff as positive evidence
    // toward AC-28108-2 without falsely counting as an anchor.
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: AC28108_2_INVENTORY_LIMITATION,
      verdict: inventoryPass ? 'pass' : 'fail',
      detail: inventoryPass
        ? `conformanceOnly (${AC28108_2_INVENTORY_LIMITATION}) - object inventory diff proves create+delete: key present before delete, absent after (listObjects returned ${listBefore.keys.length} then ${listAfter.keys.length} keys)`
        : `conformanceOnly (${AC28108_2_INVENTORY_LIMITATION}) - inventory diff mismatch: seenBefore=${seenBefore} seenAfter=${seenAfter}`,
      evidence: {
        scratchBucket,
        key,
        seenBefore,
        seenAfter,
        keysBeforeCount: listBefore.keys.length,
        keysAfterCount: listAfter.keys.length,
        endpointHostRedacted,
      },
    });
  } finally {
    if (store) {
      try { await store.close(); }
      catch (err) { teardown.facadeClose = { ok: false, error: err && err.message }; }
    }
    if (bucketCreated) {
      let deleteBucketErr = null;
      let del = null;
      try {
        del = await bucketOps.deleteBucket(scratchBucket);
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
      let postList = null;
      try {
        postList = await bucketOps.listBuckets();
        const stillThere = postList.buckets.includes(scratchBucket);
        teardown.bucketAbsentAfter = {
          ok: !stillThere,
          bucketCount: postList.buckets.length,
          httpStatus: postList.raw && postList.raw.$metadata && postList.raw.$metadata.httpStatusCode,
          requestId: postList.raw && postList.raw.$metadata && postList.raw.$metadata.requestId,
        };
      } catch (err) {
        teardown.bucketAbsentAfter = { ok: false, error: err && err.message };
      }
      const facadeCloseOk = !teardown.facadeClose || teardown.facadeClose.ok !== false;
      const teardownOk = teardown.deleteBucket && teardown.deleteBucket.ok
        && teardown.bucketAbsentAfter && teardown.bucketAbsentAfter.ok
        && facadeCloseOk;
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: AC28108_2_BUCKET_LIMITATION,
        verdict: teardownOk ? 'pass' : 'fail',
        detail: teardownOk
          ? `conformanceOnly (${AC28108_2_BUCKET_LIMITATION}) - scratch bucket ${scratchBucket} deleted and confirmed absent from post-run ListBuckets (deleteBucket http=${teardown.deleteBucket.httpStatus}, listBuckets http=${teardown.bucketAbsentAfter.httpStatus})`
          : `conformanceOnly (${AC28108_2_BUCKET_LIMITATION}) - bucket teardown FAILED: deleteBucket=${JSON.stringify(teardown.deleteBucket)}; bucketAbsentAfter=${JSON.stringify(teardown.bucketAbsentAfter)}; facadeClose=${JSON.stringify(teardown.facadeClose)}${deleteBucketErr ? ` deleteBucketError=${deleteBucketErr.message}` : ''}`,
        evidence: {
          teardown,
          scratchBucket,
          deleteBucketHttpStatus: teardown.deleteBucket && teardown.deleteBucket.httpStatus,
          deleteBucketRequestId: teardown.deleteBucket && teardown.deleteBucket.requestId,
          postRunListHttpStatus: teardown.bucketAbsentAfter && teardown.bucketAbsentAfter.httpStatus,
          postRunListRequestId: teardown.bucketAbsentAfter && teardown.bucketAbsentAfter.requestId,
          facadeCloseOk,
        },
      });
    }
    bucketOps.close();
  }
  return { results, extra: { evidence, envDeclared: [...DECLARED_ENV], teardown } };
}
