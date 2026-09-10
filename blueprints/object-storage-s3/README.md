# object-storage-s3

Object storage on the S3 API, accessed through a store facade that is the sole reader of the S3 client. Cloudflare R2 is the first adapter, MinIO is the local dev target, any S3-compatible remote (AWS S3, Backblaze B2, Wasabi, self-hosted) composes cleanly. Ships put / get / delete / list, presigned GET URLs with a bounded TTL, and multipart-upload above an elicited threshold, plus a lifecycle-event sink with a metadata-only field discipline. Refuses composition without `security-secrets-management` applied (maintainer decision): the credential pair is a `secretRef`, never a value.

## What this blueprint gives you

- **A store facade** (TAC-2901) that is the sole importer of the S3 client (`@aws-sdk/client-s3` on Node targets or `aws4fetch` on Workers targets per ADR-2901) in your source tree, opens the client on boot, and exposes typed named domain verbs. Emits `facadeReady` on the first successful ready-check.
- **A multipart uploader** (TAC-2902) that the facade delegates to for payloads above the elicited threshold (default 8 MiB per ADR-2903); initiates, part-uploads, completes; aborts in-flight on any part-upload failure so no orphan multipart uploads remain on the bucket.
- **An event sink** (TAC-2903) with a metadata-only field discipline: `facadeReady`, `objectPut`, `objectDeleted`, `presignedIssued`; no body bytes, no user id, no PII drawn from the object body.
- **Six Node-only probes** proving every runtime observable: five against a real MinIO container (facade round-trip, put/get, presigned URL, multipart 10 MiB, event secrecy against a PII fixture) plus one accountBound R2 real-account smoke that skips cleanly without `CI_HAS_CLOUDFLARE_ACCOUNT`.

## The six REQs

| REQ | What it commits |
|---|---|
| REQ-001 | Facade module is the sole reader of the S3 client; opens on boot; emits `facadeReady`. |
| REQ-002 | Put / get / delete / list contract on typed keys with `objectPut` and `objectDeleted` events. |
| REQ-003 | Presigned GET URL with bounded TTL (floor 1 minute, default 15 minutes per ADR-2902); 200 within TTL, 403 after. |
| REQ-004 | Multipart-upload above the ADR-2903 threshold (default 8 MiB); abort-on-failure with no orphan in-flight uploads. |
| REQ-005 | Four lifecycle events with metadata-only fields; event-secrecy probe asserts against a PII fixture. |
| REQ-006 | Credential-pair discipline via `security-secrets-management`; refuses composition without with stable message id `object-storage-s3-no-secrets`. |
| REQ-101 (v1.1.0) | Hetzner Object Storage adapter: endpoint-shape helper composes `<bucket>.<location>.your-objectstorage.com` from an elicited bucket and location; MinIO and R2 paths unchanged. |

## The three TACs

- **TAC-2901 facade**: the object-storage S3 facade module.
- **TAC-2902 multipart uploader**: initiate/part-upload/complete with abort-on-failure.
- **TAC-2903 event sink**: metadata-only lifecycle event contract.
- **TAC-2904 Hetzner endpoint helper (v1.1.0)**: sole composer of `<bucket>.<location>.your-objectstorage.com`; enum-refuses unknown location codes.

## The four ADRs

- **ADR-2901 adapter**: `@aws-sdk/client-s3` on Node targets, `aws4fetch` on Workers targets; elicited, `recommendedDefault: true`. Standards trace clause: AWS S3 API and R2 S3-compatibility notes.
- **ADR-2902 presigned URL TTL**: default 15 minutes, floor 1 minute; elicited ceiling. Standards trace clause: generic enterprise practice.
- **ADR-2903 multipart threshold**: default 8 MiB, elicited. Standards trace clause: generic enterprise practice.
- **ADR-2904 object storage contract** (scope: global, topic `objectStorageContract`): S3 API as the shipped shape; conflicts by design with future non-S3-shape siblings. Standards trace clause: AWS S3 API and R2 S3-compatibility notes.
- **ADR-2905 Hetzner Object Storage provider (v1.1.0)**: recognises `hetznerObjectStorage` as a shipped provider value under the shipped S3-API facade; endpoint pattern `<bucket>.<location>.your-objectstorage.com` composed via TAC-2904; MinIO and R2 paths unchanged. Standards trace clause: Hetzner Object Storage S3 compatibility documented endpoint shape.

## Elicited parameters

Endpoint URL (R2 `https://<account-id>.r2.cloudflarestorage.com`, AWS S3 `https://s3.<region>.amazonaws.com`, MinIO `http://localhost:9000`, Hetzner Object Storage `https://<bucket>.<location>.your-objectstorage.com` composed from a bucket and location via the v1.1.0 helper, any S3-compatible remote); bucket name; credential-pair reference via `security-secrets-management` (never value); adapter (`awsSdk` or `aws4fetch`); presigned-URL default TTL (default 15 minutes); presigned-URL ceiling (elicited, no shipped default, S3 API 7-day outer bound); multipart-upload threshold (default 8 MiB); force path style (`true` for MinIO, `false` for AWS/R2 and Hetzner Object Storage with virtual-hosted style); server-side encryption default (`sseNone` on R2 per the R2 compatibility notes; `sseS3` on AWS S3 when the operator elicits it).

## Hetzner Object Storage adapter (v1.1.0)

Since v1.1.0 the blueprint recognises `hetznerObjectStorage` as a shipped provider value under the existing S3-API facade contract. Hetzner Object Storage is S3-compatible per https://docs.hetzner.com/storage/object-storage/overview; the endpoint follows the vendor-documented pattern `<bucket>.<location>.your-objectstorage.com`. Three location codes are shipped: `fsn1` (Falkenstein), `hel1` (Helsinki), `nbg1` (Nuremberg), matching the same page. A project applying the blueprint with the Hetzner provider elicits the bucket and location; a small helper (`composeHetznerEndpoint`, TAC-2904) composes the https endpoint URL and hands it to the shipped facade unchanged. `region` defaults to `auto` (matching the R2 shape); `forcePathStyle` defaults to `false` (virtual-hosted-style, matching R2 and AWS S3). The Cloudflare R2 real-account smoke stays gated on `CI_HAS_CLOUDFLARE_ACCOUNT` and does not read the new env vars; the MinIO local emulator flow stays byte-identical. Reach for Hetzner over R2 for a European storage region with a different egress-pricing profile; reach for R2 for the zero-egress-fee posture; reach for MinIO for local dev without any account.

Runtime dependency: none added. The shipped `@aws-sdk/client-s3` client signs and speaks the S3 wire protocol against the composed Hetzner endpoint unchanged.

A new Node-only probe `hetzner-object-storage-round-trip.mjs` binds AC-28110-1: with `CI_HAS_HETZNER_OBJECT_STORAGE` set (plus `HETZNER_OBJECT_STORAGE_ACCESS_KEY_ID`, `HETZNER_OBJECT_STORAGE_SECRET_ACCESS_KEY`, `HETZNER_OBJECT_STORAGE_BUCKET`, `HETZNER_OBJECT_STORAGE_LOCATION`) it round-trips a byte-equal 1 KiB payload against a real Hetzner Object Storage bucket; without the env var it records `accountBoundSkipped: true` per spec section 3.5.

## Companions

- **logging**: every lifecycle event (facadeReady, objectPut, objectDeleted, presignedIssued) writes through the applied logger; a logging companion supplies the factory.
- **errorHandling**: a put failure, a get 404, a presigned-URL malformed request constructs an internal error record; an error-handling companion supplies the record factory and the boundary.

## Composition and conflicts

Consumes `security-secrets-management` v1.0.1+ for the credential pair. Declares `requiresAppliedCapabilities: {capabilities: ["secretsProvider"], allowSkipFlag: "allow-no-secrets-yet", refusalMessageId: "object-storage-s3-no-secrets"}` per the capability mechanism (visual round spec 5.5.1). The apply verb refuses on a project without `secretsProvider` (exit 3, stderr carries `[object-storage-s3-no-secrets]` as the first-line tag and names the required capability, the shipped predecessor, and the override flag). `--allow-no-secrets-yet` overrides for a scaffolding pass and records a `notes` line on `rcf/blueprints/object-storage-s3.applied.json` for later reconciliation. Contributes ADR-2904 as `scope: global` on new topic `objectStorageContract`; future `object-storage-native-gcs` or `object-storage-native-azure` siblings would conflict here by design. `capabilities: ["objectStorage"]`; `providesRoles: []`.

## The six probes

Each probe is a Node module under `contributions/probes/` exporting the round-5 spec section 3.2 verdict envelope, with a matching `run-<probe-name>.mjs` shim that drives the probe against the shared fixture and writes the per-blueprint report at `.rcf/reports/blueprints/object-storage-s3/<probe-name>.json`.

| Probe | Anchor AC | What it proves | accountBound |
|---|---|---|---|
| `facade-round-trip` | AC-28101-1 | Facade opens against MinIO; `facadeReady` fires with endpointHost and bucketName. | false |
| `put-get-round-trip` | AC-28102-1, AC-28102-2, AC-28102-3 | 1 KiB round-trip byte-equal; delete and list round-trip; `objectPut` and `objectDeleted` fire. | false |
| `presigned-url` | AC-28103-1 | Presign at 60 s TTL returns 200 within TTL, 403 on tampered signature (or full TTL wall-clock with `SIMULATE_PRESIGN_EXPIRE=true`); floor refusal at 30 s. | false |
| `multipart-upload` | AC-28104-1, AC-28104-2 | 10 MiB payload above the 8 MiB threshold round-trips byte-equal via multipart; no orphan in-flight uploads after complete; abort-on-failure with `SIMULATE_PART_UPLOAD_FAIL=true`. | false |
| `event-secrecy` | AC-28105-1 | Every event record carries only whitelisted metadata fields; no PII fixture text; no forbidden field name. | false |
| `r2-real-account-smoke` | AC-28108-1 | Real R2 round-trip when `CI_HAS_CLOUDFLARE_ACCOUNT` is set; records `accountBoundSkipped: true` when it is not. | true |
| `hetzner-object-storage-round-trip` (v1.1.0) | AC-28110-1 | Composes `<bucket>.<location>.your-objectstorage.com` via `composeHetznerEndpoint`; real Hetzner Object Storage round-trip when `CI_HAS_HETZNER_OBJECT_STORAGE` is set; records `accountBoundSkipped: true` when it is not. | true |

## How to run the probes locally

```sh
cd packages/rcf-lite/test/fixtures/infra-s3-and-queue
docker compose up -d minio
sleep 4
npm install --silent
node src/create-bucket.mjs
node ../../../../blueprints/object-storage-s3/contributions/probes/run-facade-round-trip.mjs
node ../../../../blueprints/object-storage-s3/contributions/probes/run-put-get-round-trip.mjs
node ../../../../blueprints/object-storage-s3/contributions/probes/run-presigned-url.mjs
node ../../../../blueprints/object-storage-s3/contributions/probes/run-multipart-upload.mjs
node ../../../../blueprints/object-storage-s3/contributions/probes/run-event-secrecy.mjs
node ../../../../blueprints/object-storage-s3/contributions/probes/run-r2-real-account-smoke.mjs
node ../../../../blueprints/object-storage-s3/contributions/probes/run-hetzner-object-storage-round-trip.mjs
docker compose down -v
```

Each shim exits 0 on aggregate pass and 1 otherwise; every per-blueprint report at `.rcf/reports/blueprints/object-storage-s3/<probe-name>.json` carries `aggregateVerdict pass` on the canonical fixture state. The R2 smoke exits 0 with `accountBoundSkipped: true` when `CI_HAS_CLOUDFLARE_ACCOUNT` is unset.

## R2 deviations from full S3

Cloudflare R2 is S3-compatible per https://developers.cloudflare.com/r2/api/s3/api/ but explicitly does not implement:

- **ACLs**: no per-object or per-bucket ACLs; permissions go through Cloudflare account roles and bucket-level API tokens.
- **Bucket policies**: no S3-style JSON bucket policies.
- **Object Lock**: no WORM or retention hold surface.
- **Versioning**: no object versioning; a put replaces the object.
- **Lifecycle policies**: R2 marks lifecycle-configuration surface as "feature implementation is currently in progress"; do not depend on time-based expiration or class transitions on R2 at v1.0.0.

An operator relying on any of the four either picks a different endpoint (AWS S3 covers all four) or handles the equivalent semantics application-side. The guide's "R2 deviations" section names each and points at the vendor doc.

## The multipart re-upload gotcha

Per the R2 doc: re-uploading to the same part number replaces the previous part with loss-on-fail semantics. If a re-upload fails, the original part is gone. The facade avoids the case in the shipped path (part uploads are single-attempt; abort-on-failure covers the mid-multipart failure), but a project that layers its own retry on top of the facade's `putObject` should retry the whole put, not a partial multipart.

## Known mechanism-reach gaps

- **Adapter choice (ADR-2901)** is elicited at apply time; the facade's public surface is adapter-neutral so a consumer cannot tell at import time which adapter was picked. Mitigation: the checklist row on the applied blueprint records the adapter chosen; the shipped Node fixture uses `@aws-sdk/client-s3` for probe verifiability.
- **Server-side encryption default (elicited)** is set at apply time; the facade does not enforce a shipped default because R2 differs from AWS S3 here (R2: SSE-C only, no AWS KMS; AWS: sseS3 available). Mitigation: the guide's "Encryption at rest" section names the two per-target defaults and the applied ADR records the operator choice.
- **Multipart part re-upload loss-on-fail** per the R2 doc: the facade avoids the case internally but a consumer-side retry loop can walk into it. Mitigation: the README calls it out; the guide's "Retry semantics" section names the shipped-path guarantees.

## Standards trace

- Cloudflare R2 S3-compatibility surface: https://developers.cloudflare.com/r2/api/s3/api/ (documents supported ops and the four deviations enumerated above; SSE-C only; auto region only).
- Cloudflare R2 overview and presigned URLs: https://developers.cloudflare.com/r2/ (S3 API, zero egress fees, presigned URLs).
- MinIO S3 compatibility for local dev: https://docs.min.io/community/minio-object-store/administration/object-management/object-lifecycle-management.html.
- GitHub Actions service container shape (for the CI seam): https://docs.github.com/en/actions/using-containerized-services/about-service-containers.
