# object-storage-s3 guide

## What this blueprint gets you

S3-shape object storage on any S3-compatible endpoint: Cloudflare R2 (the shipped first adapter target), AWS S3, MinIO (for local dev), Backblaze B2 in S3-compat mode, Wasabi, or self-hosted MinIO in production. The store facade is the sole reader of the S3 client (`@aws-sdk/client-s3` on Node targets or `aws4fetch` on Workers targets, elicited under ADR-2901). Consumer code calls named domain verbs on the facade and never touches the raw S3 client. Multipart-upload is invisible to consumer code: a payload above the elicited threshold (default 8 MiB per ADR-2903) switches transparently, with `AbortMultipartUpload` on failure so no orphan in-flight uploads remain. Presigned GET URLs come with a bounded TTL (floor 1 minute, default 15 minutes per ADR-2902). Four lifecycle events (`facadeReady`, `objectPut`, `objectDeleted`, `presignedIssued`) fire on the injected event sink with a metadata-only whitelist so consumer logging cannot leak object body bytes, user ids, or PII from the object.

## Apply this blueprint

`security-secrets-management` v1.0.1+ MUST be applied first per REQ-006 (maintainer decision). The blueprint declares `requiresAppliedCapabilities: {capabilities: ["secretsProvider"], allowSkipFlag: "allow-no-secrets-yet", refusalMessageId: "object-storage-s3-no-secrets"}` and the capability mechanism (visual round spec 5.5.1) enforces the refusal at apply time. On a project that has not applied secrets-management:

```sh
rcf define blueprint add object-storage-s3
```

exits 3 with `[object-storage-s3-no-secrets]` on stderr as the first-line tag; the message names the required capability (`secretsProvider`), the shipped predecessor (`security-secrets-management` v1.0.1+), and `--allow-no-secrets-yet` as the override for a scaffolding pass. The override applies the blueprint cleanly and records a `notes` line on `rcf/blueprints/object-storage-s3.applied.json` naming the missing predecessor so a later `rcf define validate` pass can flag the surface as not-yet-activated. Apply secrets-management first, then:

```sh
rcf define blueprint add security-secrets-management
rcf define blueprint add object-storage-s3
```

On a project that already applied `object-storage-s3` and later needs a different wire-shape (a native-GCS or native-Azure sibling), `rcf define blueprint add object-storage-native-gcs` (once minted) surfaces a DELIBERATE conflict on the `objectStorageContract` global-ADR topic; resolve with one project-level ADR.

## Facade shape

```js
import { createObjectStore } from './object-store.mjs';
import { secretsShim } from './secrets.mjs';

const credentials = await secretsShim.getSecret('objectStorageCredentials');
const store = createObjectStore({
  endpointUrl: process.env.S3_ENDPOINT_URL, // https://<account-id>.r2.cloudflarestorage.com on R2
  bucket: process.env.S3_BUCKET,            // rcf-test on the fixture
  credentialsRef: credentials,              // { accessKeyId, secretAccessKey } via security-secrets-management
  region: 'auto',                           // 'auto' for R2; 'eu-west-2' etc. for AWS S3
  forcePathStyle: false,                    // true for MinIO; false for R2 and AWS with virtual-hosted style
  onEvent: (record) => logger.log('object-storage', record),
});

await store.ready();

// put a 1 KiB payload
await store.putObject('uploads/report.pdf', 'application/pdf', pdfBuffer);

// get and stream to a caller
const { body, contentType } = await store.getObject('uploads/report.pdf');

// presign a GET URL with a bounded TTL
const url = await store.presignGetUrl('uploads/report.pdf', 300); // 5 minutes

// delete
await store.deleteObject('uploads/report.pdf');

// list under a prefix
const { keys, isTruncated } = await store.listObjects('uploads/');
```

The facade is the sole importer of `@aws-sdk/client-s3` in your source tree per REQ-001. A project-side call site that reaches into the SDK directly is refused at author-side review.

## Adapter choice per deploy target

ADR-2901 elicits the adapter per deploy target:

- **Node process** (server, container, non-Workers serverless): `@aws-sdk/client-s3` (AWS SDK v3, modular client-s3 package). Ships every op the v1.0.0 surface needs.
- **Cloudflare Workers**: `aws4fetch` (lightweight fetch-native S3 client). Sits within the Workers CPU-time budget where the AWS SDK's Node polyfills do not.

The facade's outward interface is unchanged across adapters; only the import at the top of the facade module changes. A future adapter (a GCS shim, an Azure Blob shim under a sibling blueprint) slots in at the same boundary.

## Presigned URL discipline

ADR-2902 sets the default TTL to 15 minutes and the floor to 1 minute. The facade refuses a presign below 60 seconds; the ceiling is elicited (no shipped default). Every `presignedIssued` event carries `{event, ts, key, ttl}` so downstream logging can flag long-lived URLs. The URL is signed at the client edge with the applied credentials; the browser or downstream caller fetches from the storage endpoint directly.

## Multipart upload

ADR-2903 sets the default multipart threshold to 8 MiB (matches AWS SDK convention). Below the threshold, `putObject` goes single-part; above, it delegates to the multipart uploader (TAC-2902):

1. `CreateMultipartUpload` returns an `UploadId`.
2. `UploadPart` per fixed-size chunk (default 8 MiB per part) with a stable `PartNumber` and captured `ETag`.
3. `CompleteMultipartUpload` with the ordered part list.

On any part-upload failure, `AbortMultipartUpload` runs before the error propagates so no orphan multipart upload remains on the bucket. `ListMultipartUploads(prefix=key)` after a successful completion returns zero uploads.

**R2 multipart re-upload gotcha** (per https://developers.cloudflare.com/r2/api/s3/api/): re-uploading to the same part number replaces the previous part with loss-on-fail semantics. If a re-upload fails, the original part is gone. The facade avoids the case in its shipped path (parts are single-attempt; abort-on-failure covers the mid-multipart error), but a consumer that layers its own retry on top of `putObject` should retry the whole put, not a partial multipart.

## Lifecycle events and PII discipline

The facade emits four events on the injected sink with a fixed metadata-only field discipline (TAC-2903):

| Event | Fields |
|---|---|
| `facadeReady` | `event`, `ts`, `endpointHost`, `bucketName` |
| `objectPut` | `event`, `ts`, `key`, `size`, `contentType` |
| `objectDeleted` | `event`, `ts`, `key` |
| `presignedIssued` | `event`, `ts`, `key`, `ttl` |

No record carries object body bytes, no body checksum, no user id field, no PII drawn from the object body. The `event-secrecy` probe (AC-28105-1) drives put/get/presign/delete against a PII fixture (key `users/1234/passport.jpg`, body containing `PII-FIXTURE-DO-NOT-LOG`) and asserts the whitelist compliance at ship time.

## R2 deviations from full S3

Cloudflare R2 is S3-compatible per https://developers.cloudflare.com/r2/api/s3/api/ but explicitly does not implement:

- **ACLs**: no per-object or per-bucket ACLs; use Cloudflare account roles and bucket-level API tokens.
- **Bucket policies**: no S3-style JSON bucket policies.
- **Object Lock**: no WORM or retention hold surface.
- **Versioning**: no object versioning; a put replaces the object.
- **Lifecycle policies**: R2 marks lifecycle configuration as "feature implementation is currently in progress"; do not depend on time-based expiration or class transitions on R2 at v1.0.0.

An operator relying on any of the four either picks a different endpoint (AWS S3 covers all four) or handles the equivalent semantics application-side.

## CI seam

The `object-storage-s3` facade needs an S3-compatible endpoint reachable from the CI runner. On GitHub Actions the standard shape is a `services:` block with MinIO as a service container. Per https://docs.github.com/en/actions/using-containerized-services/about-service-containers the runner exposes the service either at the label hostname (for container-hosted jobs) or at the mapped port (for host-runner jobs). The blueprint's applying project realises this block in its own `.github/workflows/pull-request-checks.yml`:

**Container-hosted job (hostname exposure):**

```yaml
jobs:
  gate:
    runs-on: ubuntu-latest
    container: node:24
    services:
      minio:
        image: minio/minio:latest
        env:
          MINIO_ROOT_USER: rcf-dev
          MINIO_ROOT_PASSWORD: rcf-dev-only
        ports:
          - 9000:9000
          - 9001:9001
        options: >-
          --entrypoint sh -c "minio server /data --console-address ':9001'"
          --health-cmd "curl -f http://localhost:9000/minio/health/live"
          --health-interval 3s --health-timeout 3s --health-retries 20
    env:
      S3_ENDPOINT_URL: http://minio:9000
      S3_BUCKET: rcf-test
      S3_ACCESS_KEY_ID: rcf-dev
      S3_SECRET_ACCESS_KEY: rcf-dev-only
      S3_FORCE_PATH_STYLE: 'true'
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install
      - run: node packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/create-bucket.mjs
      - run: node blueprints/object-storage-s3/contributions/probes/run-facade-round-trip.mjs
```

**Host-runner job (mapped port exposure):**

```yaml
jobs:
  gate:
    runs-on: ubuntu-latest
    services:
      minio:
        image: minio/minio:latest
        env:
          MINIO_ROOT_USER: rcf-dev
          MINIO_ROOT_PASSWORD: rcf-dev-only
        ports:
          - 9000:9000
    env:
      S3_ENDPOINT_URL: http://localhost:9000
      S3_BUCKET: rcf-test
      S3_ACCESS_KEY_ID: rcf-dev
      S3_SECRET_ACCESS_KEY: rcf-dev-only
      S3_FORCE_PATH_STYLE: 'true'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24' }
      - run: pnpm install
      - run: sleep 4 && node packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/create-bucket.mjs
      - run: node blueprints/object-storage-s3/contributions/probes/run-facade-round-trip.mjs
      # ... plus the other four MinIO probes and the R2 smoke
```

Alternate providers (GitLab CI, CircleCI, Buildkite) map through the same four-point contract per `blueprints/delivery-ci-workflows/assets/ci-provider-examples/notes.md`: job trigger, Node setup, entry-point invocation, artefact upload. The MinIO service container is the extension point.

## R2 real-account smoke

`node blueprints/object-storage-s3/contributions/probes/run-r2-real-account-smoke.mjs` behaves per spec section 3.5:

- Without `CI_HAS_CLOUDFLARE_ACCOUNT`: exits 0, writes a report with `verdict: pass, detail: "accountBound: skipped (no CI_HAS_CLOUDFLARE_ACCOUNT)", accountBoundSkipped: true`. Aggregate verdict pass.
- With `CI_HAS_CLOUDFLARE_ACCOUNT` set alongside `R2_ACCOUNT_ID`, `R2_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` on the runner env (or `.rcf/secrets/dev.env` locally): opens the facade against the R2 endpoint, puts a 1 KiB payload, gets it back byte-equal, deletes the temporary object on exit. Aggregate verdict pass.

The `accountBound` flag on the probe module surface flips the delivery-ci-workflows aggregate to pass on the skipped path per section 3.5.

## Hetzner Object Storage adapter (v1.1.0)

The v1.1.0 follow-up recognises Hetzner Object Storage as a shipped provider value under the same S3-API facade. Hetzner Object Storage is S3-compatible per https://docs.hetzner.com/storage/object-storage/overview and speaks the S3 wire protocol through `@aws-sdk/client-s3` unchanged; the one thing that differs from R2 and AWS S3 is that the endpoint URL is composed from two elicited values, a bucket name and a location code (one of `fsn1` Falkenstein, `hel1` Helsinki, `nbg1` Nuremberg per the same page), rather than pasted whole.

A small helper in the applying project composes the endpoint:

```js
import { composeHetznerEndpoint } from './hetzner-endpoint.mjs';

const endpoint = composeHetznerEndpoint({
  bucket: process.env.HETZNER_OBJECT_STORAGE_BUCKET,
  location: process.env.HETZNER_OBJECT_STORAGE_LOCATION, // fsn1 | hel1 | nbg1
});
// endpoint === 'https://<bucket>.<location>.your-objectstorage.com'
```

The composed URL feeds `createObjectStore` unchanged through the elicited `endpointUrl` parameter; `region` defaults to `auto`, `forcePathStyle` defaults to `false` (virtual-hosted-style). The credential pair reaches the facade through the same `security-secrets-management` surface; a Hetzner-shaped project stores the key pair as `HETZNER_OBJECT_STORAGE_ACCESS_KEY_ID` / `HETZNER_OBJECT_STORAGE_SECRET_ACCESS_KEY` and reads them through the secrets facade.

The helper refuses composition on any location code outside `{fsn1, hel1, nbg1}` (throws a named `Error` with `err.field === 'location'`), so an applying project cannot silently ship an invalid endpoint by editing a config file. A future vendor location code lands as a v1.2.0 minor bump on this blueprint (helper edit plus one more enum entry), not a project-side workaround.

`node blueprints/object-storage-s3/contributions/probes/run-hetzner-object-storage-round-trip.mjs`:

- Without `CI_HAS_HETZNER_OBJECT_STORAGE`: exits 0, writes a report with `verdict: pass, detail: "accountBound: skipped (no CI_HAS_HETZNER_OBJECT_STORAGE)", accountBoundSkipped: true`. Aggregate verdict pass.
- With `CI_HAS_HETZNER_OBJECT_STORAGE` set alongside `HETZNER_OBJECT_STORAGE_ACCESS_KEY_ID`, `HETZNER_OBJECT_STORAGE_SECRET_ACCESS_KEY`, `HETZNER_OBJECT_STORAGE_BUCKET`, `HETZNER_OBJECT_STORAGE_LOCATION` on the runner env (or `.rcf/secrets/dev.env` locally): composes the endpoint, puts a 1 KiB payload, gets it back byte-equal, deletes the temporary object on exit, and asserts every lifecycle event carries only whitelisted metadata (`event`, `ts`, `endpointHost`, `bucketName`, `location`, `key`, `size`, `contentType`). Aggregate verdict pass.

The Cloudflare R2 smoke stays gated on `CI_HAS_CLOUDFLARE_ACCOUNT` and is not affected by the Hetzner env var; the two smokes skip independently.

### When to reach for Hetzner Object Storage

- Storage region matters (European data-locality requirements or lower-latency reads from EU-hosted workloads). `fsn1`, `hel1`, `nbg1` cover Germany and Finland; R2 does not surface a per-region locality on the public shape.
- Egress-pricing profile differs from R2's zero-egress-fee posture; a workload with high internal-only egress may prefer R2, while a workload with predictable public egress may prefer Hetzner's flat per-TB pricing.
- The applying project already runs on Hetzner Cloud (deploy-hetzner-server v1.0.0 shipped in round 7) and pairing the storage on the same vendor account is operationally simpler.

Reach for R2 for the zero-egress-fee posture, for AWS S3 for the widest feature surface (Object Lock, versioning, lifecycle policies), and for MinIO for local dev without any account.

## Elicited parameters

| Parameter | Default | Notes |
|---|---|---|
| endpointUrl | none | R2: `https://<account-id>.r2.cloudflarestorage.com`; AWS S3: `https://s3.<region>.amazonaws.com`; MinIO: `http://localhost:9000`. |
| bucket | none | The elicited bucket name. |
| credentialsRef | via `security-secrets-management` | `secretRef` opaque-string agreed with security-secrets-management. |
| adapter | `awsSdk` (Node) / `aws4fetch` (Workers) | ADR-2901. |
| defaultPresignTtlSeconds | 900 (15 minutes) | ADR-2902; floor 60 s enforced by facade. |
| multipartThresholdBytes | 8388608 (8 MiB) | ADR-2903. |
| forcePathStyle | `false` | `true` for MinIO. |
| region | `auto` | `auto` for R2; standard AWS region for AWS S3. |
| serverSideEncryption | none shipped | R2 is SSE-C only; AWS S3 supports `sseS3`; elicited per deploy target. |

## Standards trace

- Cloudflare R2 S3-compatibility surface: https://developers.cloudflare.com/r2/api/s3/api/ (supported ops, four deviations).
- Cloudflare R2 overview and presigned URLs: https://developers.cloudflare.com/r2/.
- MinIO S3 compatibility: https://docs.min.io/community/minio-object-store/administration/object-management/object-lifecycle-management.html.
- Hetzner Object Storage overview (v1.1.0): https://docs.hetzner.com/storage/object-storage/overview (S3 compatibility, endpoint pattern `<bucket>.<location>.your-objectstorage.com`, three location codes fsn1, hel1, nbg1).
- GitHub Actions service containers: https://docs.github.com/en/actions/using-containerized-services/about-service-containers.
