# infra-s3-and-queue fixture

Shared sample-app fixture for the `object-storage-s3` (T-2) and `messaging-queue-cloudflare` (T-3) blueprints (infra round 5 spec section 3.6). T-2 side: boots MinIO in a container, exposes a facade over `@aws-sdk/client-s3` against MinIO on `http://localhost:9000`, and hosts induced-failure switches the six shipped probes drive against. T-3 side (added 2026-09-06): ships a `wrangler.toml` declaring the Cloudflare Worker queue binding (`RCF_TEST_QUEUE`), DLQ binding (`RCF_TEST_DLQ`), consumer max_retries and batch settings; plus an in-memory queue-driver under `src/queue-driver.mjs` that realises the same Queues binding shape (`send`, `sendBatch` on the producer, batch envelope with per-message `ack` / `retry` on the consumer) so the T-3 producer facade (`src/producer.mjs`) and consumer registration (`src/consumer.mjs`) run against the wrangler-dev-equivalent seam without a live wrangler process (SDR-3-a on US-29107).

## Boot MinIO

Docker (the shipped, verified path):

```sh
docker compose up -d minio
```

Podman (equivalent incantation; not verified in this pass, provided per authoring standard):

```sh
podman-compose up -d minio
```

Or plain Podman without podman-compose:

```sh
podman run -d --name infra-minio-fixture \
  -e MINIO_ROOT_USER=rcf-dev \
  -e MINIO_ROOT_PASSWORD=rcf-dev-only \
  -p 9000:9000 -p 9001:9001 \
  minio/minio:latest server /data --console-address ":9001"
```

If port 9000 or 9001 is already bound on the host, override via
`MINIO_PORT=19000 MINIO_CONSOLE_PORT=19001 docker compose up -d minio`.

Port 4200 is Dave's workspace port; never bind it. This fixture uses 9000 (S3 API) and 9001 (console) by default.

## MinIO console

Once MinIO is up, the browser console is at `http://localhost:9001` with credentials `rcf-dev` / `rcf-dev-only` (fixture-only).

## Credentials and endpoint (elicited parameters realised)

- Endpoint URL: `http://localhost:9000` (S3_ENDPOINT_URL env override).
- Bucket: `rcf-test` (S3_BUCKET env override).
- Credential pair: `rcf-dev` / `rcf-dev-only` (matches MINIO_ROOT_USER / MINIO_ROOT_PASSWORD; wired via the fixture's `src/secrets.mjs` shim that realises the security-secrets-management `secretRef` contract).
- Region: `auto`.
- Force path style: `true` (MinIO requires; R2 also supports).

## Create the bucket once (one-shot)

```sh
docker compose up -d minio && sleep 4 && npm install --silent && node src/create-bucket.mjs
```

Idempotent: exits 0 whether the bucket exists or was created.

## Two-line gate-reviewer boot

```sh
docker compose up -d minio && sleep 4 && npm install --silent && node src/create-bucket.mjs
node ../../../../blueprints/object-storage-s3/contributions/probes/run-facade-round-trip.mjs
```

The first line brings up MinIO, waits, installs the fixture's own `@aws-sdk/client-s3` runtime dep, and creates the `rcf-test` bucket. The second line runs the first probe; the remaining five probe shims live alongside it and follow the same shape.

## Induced-failure switches

Four switches simulate failure modes the negative-run probes exercise. Each is wired end-to-end at v1.0.0 and each was proven fail-verdict on the shipped head:

- `SIMULATE_MINIO_DOWN=true`: unbind the port before the probe runs (`docker compose stop minio`); the `facade-round-trip` probe surfaces a HeadBucket connection error, aggregate verdict fail, node exit 1.
- `SIMULATE_403_ON_GET=true`: the facade's `getObject` throws a synthetic AccessDenied 403 shape; the `put-get-round-trip` probe surfaces the fail on AC-28102-1, node exit 1.
- `SIMULATE_PART_UPLOAD_FAIL=true`: the multipart uploader refuses part 2 with a thrown error; the `multipart-upload` probe surfaces the fail (the initial 10 MiB put propagates the mid-multipart error and the AbortMultipartUpload path runs in the facade before the rejection reaches the caller), node exit 1.
- `SIMULATE_PRESIGN_MALFORMED=true`: the facade tampers the returned URL's X-Amz-Signature; the `presigned-url` probe's first fetch returns 403 instead of 200, aggregate verdict fail, node exit 1.

Two additional switches from the spec's original enumeration (event-secrecy leak simulation and above-cap large-payload simulation) are not carried at v1.0.0: the event-secrecy whitelist is enforced in code (not via a runtime switch), and the 10 MiB multipart probe already exercises the above-threshold path. A future v1.1 may add either if a runtime-switched form yields something the shipped path does not already prove.

## Presigned URL wall-clock TTL test

`SIMULATE_PRESIGN_EXPIRE=true` on the `presigned-url` probe issues a 60 s TTL, waits 62 s, and asserts the second fetch returns 403. Without the switch the probe asserts the tampered-signature 403 shape instead so CI does not spend a full minute waiting.

## R2 real-account smoke

`node ../../../../blueprints/object-storage-s3/contributions/probes/run-r2-real-account-smoke.mjs`:

- Without `CI_HAS_CLOUDFLARE_ACCOUNT`: exits 0 with `accountBoundSkipped: true` per spec section 3.5.
- With `CI_HAS_CLOUDFLARE_ACCOUNT` set alongside `R2_ACCOUNT_ID`, `R2_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` in `.rcf/secrets/dev.env` (or the environment), runs a real round-trip against the R2 bucket.

## Tear down

```sh
docker compose down -v
```

Removes the container and the anonymous volume; no orphan state on the host.

## T-3 side: messaging-queue-cloudflare fixture

The T-3 slice adds four files under `src/` and one `wrangler.toml` at the fixture root. No new runtime dependencies land in the fixture's `package.json` (the queue driver is dependency-free Node code); the T-2 MinIO branch and this T-3 queue branch coexist under one compose project (no second project name spinning a parallel stack).

- `wrangler.toml`: declares a Cloudflare Worker with a queue producer binding named `RCF_TEST_QUEUE` on queue `rcf-test-queue`, a consumer block with `dead_letter_queue = "rcf-test-dlq"`, `max_retries = 3` (per ADR-3003 and the fetched Cloudflare Queues dead-letter documentation at https://developers.cloudflare.com/queues/configuration/dead-letter-queues/), `max_batch_size = 10`, `max_batch_timeout = 5` (per ADR-3004 and the fetched Cloudflare Queues platform limits at https://developers.cloudflare.com/queues/platform/limits/), and a producer binding on the DLQ named `RCF_TEST_DLQ`.
- `src/queue-driver.mjs`: in-memory queue-driver realising the Cloudflare Queues binding shape. Producer methods (`send`, `sendBatch`) mint stable message-ids and append to the queue; consumer `pull(maxBatchSize)` returns a batch envelope whose per-message `ack` / `retry` drive the retry-to-DLQ trajectory bounded by `max_retries`.
- `src/producer.mjs`: producer facade realising TAC-3001. Sole reader of the queue binding; exposes typed `publish(body, {headers})` and `publishBatch(messages)`. Emits `producerReady` on the first successful ready-check and `messagePublished` per publish.
- `src/consumer.mjs`: consumer registration realising TAC-3002. Exports `createConsumer({handler, onEvent, dlqProducer, env})` returning the queue-handler function shape a real Worker registers under the `[triggers]` queue binding.
- `src/dlq-inspector.mjs`: DLQ inspector helper for the retry-and-dlq probe (production analogue: `wrangler queues consumer add --dead-letter-queue` per the fetched Cloudflare Queues dead-letter documentation).
- `src/event-sink.mjs`: lifecycle-event sink adapter realising TAC-3003; enforces the metadata-only field whitelist (`event`, `ts`, `messageId`, `queueName`, `attempts`) in code (aligned with T-2's `{event, ts, ...}` common envelope prefix so a future v1.1 minor can promote one shared shape to schema enforcement).

### Wrangler dev port

The T-3 side, when a real `wrangler dev` process is available, binds `WRANGLER_DEV_PORT` (default `8787`, distinct from MinIO's `9000`/`9001` so the two branches of this fixture never race for a port). Overrides:

```sh
WRANGLER_DEV_PORT=18787 npx wrangler dev
```

### T-3 queue elicited parameters realised

- `RCF_QUEUE_NAME` (default `rcf-test-queue`).
- `RCF_DLQ_NAME` (default `rcf-test-dlq`).
- `RCF_MAX_RETRIES` (default `3`, floor `1`, ceiling `100` per ADR-3003 and the Cloudflare Queues limits doc).
- `RCF_BATCH_SIZE` (default `10`, ceiling `100`).
- `RCF_BATCH_TIMEOUT_MS` (default `5000` ms, ceiling `60000` ms).

### T-3 induced-failure switches

Three switches simulate the negative-run paths the T-3 probes exercise. Each is wired end-to-end in the fixture code and was proven at build time:

- `SIMULATE_CONSUMER_RETRY=true`: the consumer classifies every delivery as `retry` regardless of the handler outcome; the `retry-and-dlq` probe drives this path and asserts the DLQ landing at `max_retries + 1` with the same stable message-id.
- `SIMULATE_DLQ_OVERFLOW=true`: the consumer forces DLQ landing on the FIRST delivery (overrides `SIMULATE_CONSUMER_RETRY`); observed baseline behaviour when set is one `messageDeadLettered` from the direct DLQ send plus the DLQ inspector reads one entry on the DLQ.
- `SIMULATE_PII_IN_BODY=true`: the consumer is invoked with a PII fixture body (`userId: 1234, ssn: "123-45-6789"`) supplied by the `event-secrecy` probe; the whitelist enforcement in `src/event-sink.mjs` is what stops the PII from leaking into any lifecycle-event record.

### Two-line gate-reviewer boot for T-3 probes

The T-3 probes do not require Docker; the queue-driver runs in-process on Node 24. Boot line:

```sh
node ../../../../blueprints/messaging-queue-cloudflare/contributions/probes/run-producer-facade-ready.mjs
node ../../../../blueprints/messaging-queue-cloudflare/contributions/probes/run-publish-to-delivery.mjs
```

The remaining three probe shims (`run-retry-and-dlq.mjs`, `run-event-secrecy.mjs`, `run-real-account-concurrency-smoke.mjs`) follow the same pattern and each write a per-blueprint probe report at `.rcf/reports/blueprints/messaging-queue-cloudflare/<probe-name>.json` per spec section 3.4.

### Real-account concurrency smoke (accountBound)

`node ../../../../blueprints/messaging-queue-cloudflare/contributions/probes/run-real-account-concurrency-smoke.mjs`:

- Without `CI_HAS_CLOUDFLARE_ACCOUNT`: exits 0 with `accountBoundSkipped: true` per spec section 3.5.
- With `CI_HAS_CLOUDFLARE_ACCOUNT` set alongside credentials for the shared HQ queue `rcf-lite-ci-queue-smoke` (Q2 default per spec section 10) wired via `security-secrets-management`, a live-account run is queued as a follow-up (v1.0.0 ships the skipped-record shape; the live-account run rides `deploy-cloudflare-workers`' surface, not a Node probe module).

### Known limitations (not mechanism-reach gaps)

- Cloudflare Queues local development does not support consumer concurrency per https://developers.cloudflare.com/queues/configuration/local-development/. The concurrency assertion is the `accountBound: true` real-account smoke; the wrangler-dev-equivalent seam (in-memory driver) proves the facade contract but not concurrency.
- Cloudflare Queues does not support Wrangler's remote mode (`wrangler dev --remote`) per the same page. A real-account run happens through a deployed Worker.
- Cloudflare Queues per-message size cap is 128 KB per https://developers.cloudflare.com/queues/platform/limits/. A project sending larger payloads either chunks or moves the body out-of-band to `object-storage-s3` (the guide names both patterns).
