/**
 * Object-storage S3 facade fixture.
 *
 * Realises the object-storage-s3 blueprint's facade contract (TAC-2901).
 * Sole reader of @aws-sdk/client-s3 in this fixture. Every other module
 * that touches object storage imports this module and calls its named
 * domain verbs.
 *
 * The facade emits lifecycle events (facadeReady, objectPut,
 * objectDeleted, presignedIssued) with metadata-only fields per REQ-005
 * and TAC-2903. The multipart uploader (TAC-2902) lives inline; a
 * payload above the elicited threshold routes through
 * CreateMultipartUpload / UploadPart / CompleteMultipartUpload, with
 * AbortMultipartUpload on any thrown part-upload error.
 */

// The @aws-sdk client and its presigner are loaded LAZILY inside
// `createObjectStore` and via the exported `loadSdk()` helper so this
// module can be imported (by probes, tools that walk the probe module
// for its accountBound flag, or the anatomy test surface) under a CI
// condition where the fixture's `node_modules` has not been installed
// and S3_ENDPOINT_URL is unset. Every code path that resolves
// @aws-sdk runs only after S3_ENDPOINT_URL is present and
// `createObjectStore` is invoked, or a probe explicitly calls
// `loadSdk()` on the run path (Dave ruling 2026-09-11).
export async function loadSdk() {
  return await import('@aws-sdk/client-s3');
}

async function loadSdkAndSigner() {
  const awsS3 = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  return { awsS3, getSignedUrl };
}

const DEFAULT_MULTIPART_THRESHOLD = 8 * 1024 * 1024; // 8 MiB per ADR-2903
const DEFAULT_PART_SIZE = 8 * 1024 * 1024;
const DEFAULT_PRESIGN_TTL = 15 * 60; // 15 minutes per ADR-2902
const PRESIGN_TTL_FLOOR = 60; // 1 minute per ADR-2902

/**
 * Named error kind emitted when S3_ENDPOINT_URL is not set. Probes
 * catch this and convert it to the exact-one-variable
 * accountBoundSkipped row the anatomy asserts on; no literal endpoint
 * host default lives in shipped fixture code (Dave ruling 2026-09-11).
 */
export class MissingS3EndpointError extends Error {
  constructor() {
    super('S3_ENDPOINT_URL is not set; set S3_ENDPOINT_URL to a reachable S3-compatible endpoint before invoking endpointFromEnv');
    this.name = 'MissingS3EndpointError';
    this.kind = 'missingS3Endpoint';
    this.variable = 'S3_ENDPOINT_URL';
  }
}

/**
 * Read the endpoint URL and bucket from environment defaults. S3_ENDPOINT_URL
 * is a required declared variable with no literal default; when it is
 * unset the helper throws MissingS3EndpointError so consumers can emit
 * the exact-one-variable accountBoundSkipped row rather than a generic
 * driver failure.
 */
export function endpointFromEnv() {
  const endpoint = process.env.S3_ENDPOINT_URL;
  if (!endpoint) throw new MissingS3EndpointError();
  return {
    endpoint,
    bucket: process.env.S3_BUCKET || 'rcf-test',
    region: process.env.S3_REGION || 'auto',
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || 'true') === 'true',
  };
}

/**
 * Read the credential pair via the security-secrets-management shim.
 * The shim delegates to a project-local .rcf/secrets/dev.env file so
 * plain credential values never appear on the public facade surface.
 */
export async function credentialsFromShim(secretsShim) {
  const creds = await secretsShim.getSecret('objectStorageCredentials');
  return {
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
  };
}

/**
 * Create the S3 store facade. onEvent is a synchronous callback the
 * facade invokes with { event, ts, ... } payloads. multipartThreshold
 * defaults to 8 MiB per ADR-2903; defaultPresignTtl to 15 minutes per
 * ADR-2902; presignTtlFloor to 60 seconds per the same ADR.
 */
export async function createObjectStore({
  endpointUrl,
  bucket,
  credentialsRef,
  region = 'auto',
  forcePathStyle = true,
  multipartThresholdBytes = DEFAULT_MULTIPART_THRESHOLD,
  partSizeBytes = DEFAULT_PART_SIZE,
  defaultPresignTtlSeconds = DEFAULT_PRESIGN_TTL,
  presignTtlFloorSeconds = PRESIGN_TTL_FLOOR,
  onEvent = () => {},
}) {
  if (!credentialsRef) {
    throw new Error('object-storage-s3: credentialsRef is required; wire via security-secrets-management');
  }
  const { awsS3, getSignedUrl } = await loadSdkAndSigner();
  const {
    S3Client,
    HeadBucketCommand,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
    ListMultipartUploadsCommand,
  } = awsS3;
  const client = new S3Client({
    endpoint: endpointUrl,
    region,
    credentials: credentialsRef,
    forcePathStyle,
  });
  const endpointHost = (() => {
    try { return new URL(endpointUrl).host; } catch { return endpointUrl; }
  })();

  let readyFired = false;
  const readyPromise = client.send(new HeadBucketCommand({ Bucket: bucket })).then(() => {
    if (!readyFired) {
      readyFired = true;
      onEvent({ event: 'facadeReady', ts: Date.now(), endpointHost, bucketName: bucket });
    }
    return true;
  });

  async function withReady(fn) { await readyPromise; return fn(); }

  async function putSinglePart({ key, contentType, body }) {
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, ContentType: contentType, Body: body,
    }));
    return body.length;
  }

  async function putMultipart({ key, contentType, body, partSize }) {
    const create = await client.send(new CreateMultipartUploadCommand({
      Bucket: bucket, Key: key, ContentType: contentType,
    }));
    const uploadId = create.UploadId;
    const parts = [];
    try {
      let partNumber = 1;
      for (let offset = 0; offset < body.length; offset += partSize) {
        if (process.env.SIMULATE_PART_UPLOAD_FAIL === 'true' && partNumber === 2) {
          throw new Error('SIMULATE_PART_UPLOAD_FAIL: part 2 refused');
        }
        const chunk = body.subarray(offset, Math.min(offset + partSize, body.length));
        const upload = await client.send(new UploadPartCommand({
          Bucket: bucket, Key: key, UploadId: uploadId,
          PartNumber: partNumber, Body: chunk,
        }));
        parts.push({ ETag: upload.ETag, PartNumber: partNumber });
        partNumber += 1;
      }
      await client.send(new CompleteMultipartUploadCommand({
        Bucket: bucket, Key: key, UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }));
      return body.length;
    } catch (err) {
      // Attach the uploadId to the propagated error so a probe can
      // positively record which upload was aborted; do NOT swallow an
      // abort failure - attach it to the error too.
      err.uploadId = uploadId;
      try {
        await client.send(new AbortMultipartUploadCommand({
          Bucket: bucket, Key: key, UploadId: uploadId,
        }));
      } catch (abortErr) {
        err.abortError = { message: abortErr && abortErr.message, name: abortErr && abortErr.name };
      }
      throw err;
    }
  }

  return {
    getClient() { return client; },
    getBucket() { return bucket; },
    async ready() { return readyPromise; },

    async putObject(key, contentType, body) {
      return withReady(async () => {
        const size = body.length >= multipartThresholdBytes
          ? await putMultipart({ key, contentType, body, partSize: partSizeBytes })
          : await putSinglePart({ key, contentType, body });
        onEvent({ event: 'objectPut', ts: Date.now(), key, size, contentType });
        return { size };
      });
    },

    async getObject(key) {
      return withReady(async () => {
        if (process.env.SIMULATE_403_ON_GET === 'true') {
          const err = new Error('SIMULATE_403_ON_GET: access denied');
          err.name = 'AccessDenied';
          err.$metadata = { httpStatusCode: 403 };
          throw err;
        }
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const chunks = [];
        for await (const chunk of res.Body) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        return { body, contentType: res.ContentType };
      });
    },

    async deleteObject(key) {
      return withReady(async () => {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        onEvent({ event: 'objectDeleted', ts: Date.now(), key });
      });
    },

    async listObjects(prefix, continuationToken) {
      return withReady(async () => {
        const res = await client.send(new ListObjectsV2Command({
          Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken,
        }));
        return {
          keys: (res.Contents || []).map((o) => o.Key),
          isTruncated: Boolean(res.IsTruncated),
          nextContinuationToken: res.NextContinuationToken || null,
        };
      });
    },

    async presignGetUrl(key, ttlSeconds) {
      return withReady(async () => {
        const ttl = ttlSeconds ?? defaultPresignTtlSeconds;
        if (ttl < presignTtlFloorSeconds) {
          throw new Error(`object-storage-s3: presign ttl ${ttl}s below floor ${presignTtlFloorSeconds}s per ADR-2902`);
        }
        const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
        const url = await getSignedUrl(client, cmd, { expiresIn: ttl });
        onEvent({ event: 'presignedIssued', ts: Date.now(), key, ttl });
        if (process.env.SIMULATE_PRESIGN_MALFORMED === 'true') {
          return url.replace(/X-Amz-Signature=[^&]*/, 'X-Amz-Signature=CORRUPTED');
        }
        return url;
      });
    },

    async listMultipartUploads(prefix) {
      return withReady(async () => {
        const res = await client.send(new ListMultipartUploadsCommand({
          Bucket: bucket, Prefix: prefix,
        }));
        return (res.Uploads || []).map((u) => ({ key: u.Key, uploadId: u.UploadId }));
      });
    },

    async close() {
      client.destroy();
    },
  };
}
