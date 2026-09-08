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
node ../../../../../blueprints/object-storage-s3/contributions/probes/run-facade-round-trip.mjs
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

`node ../../../../../blueprints/object-storage-s3/contributions/probes/run-r2-real-account-smoke.mjs`:

- Without `CI_HAS_CLOUDFLARE_ACCOUNT`: exits 0 with `accountBoundSkipped: true` per spec section 3.5.
- With `CI_HAS_CLOUDFLARE_ACCOUNT` set alongside `R2_ACCOUNT_ID`, `R2_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` in `.rcf/secrets/dev.env` (or the environment), runs a real round-trip against the R2 bucket.

## Hetzner Object Storage real-account smoke (added by object-storage-s3 v1.1.0 follow-up)

The v1.1.0 follow-up adapter (round-7 spec section 5.4) adds a Hetzner Object Storage provider value under the shipped S3-API facade. Two new files land in this fixture:

- `src/hetzner-endpoint.mjs`: the sole composer of the vendor endpoint pattern `<bucket>.<location>.your-objectstorage.com` per https://docs.hetzner.com/storage/object-storage/overview. Accepts `{ bucket, location }`; refuses any location outside `{fsn1, hel1, nbg1}` (Falkenstein, Helsinki, Nuremberg per the same page). Also exports `hetznerCredentialsFromEnv`, `makeHetznerEventDecorator` and `assertMetadataOnlyEventRecords` used by the probe.
- `run-hetzner-object-storage-round-trip.mjs`: fixture-root shim that delegates to the blueprint-side probe shim; the file name carries the blueprint slug per the shared-fixture-shim naming convention.

`node ../../../../blueprints/object-storage-s3/contributions/probes/run-hetzner-object-storage-round-trip.mjs` (or `node run-hetzner-object-storage-round-trip.mjs` from this fixture root):

- Without `CI_HAS_HETZNER_OBJECT_STORAGE`: exits 0 with `accountBoundSkipped: true` per spec section 3.5.
- With `CI_HAS_HETZNER_OBJECT_STORAGE` set alongside `HETZNER_OBJECT_STORAGE_ACCESS_KEY_ID`, `HETZNER_OBJECT_STORAGE_SECRET_ACCESS_KEY`, `HETZNER_OBJECT_STORAGE_BUCKET`, `HETZNER_OBJECT_STORAGE_LOCATION` (any of fsn1, hel1, nbg1), composes the endpoint via `composeHetznerEndpoint({ bucket, location })`, runs a 1 KiB byte-equal put/get/delete round-trip against the composed `<bucket>.<location>.your-objectstorage.com` endpoint through the shipped `object-store.mjs` facade (unchanged), asserts every lifecycle event record carries only whitelisted metadata (`event`, `ts`, `endpointHost`, `bucketName`, `location`, `key`, `size`, `contentType`), and deletes the scratch object on exit.

Two fixture-side mutation switches (INPUT-only, per the 2026-09-08 mutation-purity discipline: the probe module reads no `SIMULATE_` variable, every switch lives on this fixture side):

- `SIMULATE_HETZNER_ENDPOINT_MISSHAPEN=true`: `composeHetznerEndpoint` returns `https://<bucket>.<location>.example.invalid` (drops the vendor subdomain); the probe FAILS naming the missing subdomain `your-objectstorage.com` before any network call.
- `SIMULATE_HETZNER_EVENT_LEAK=true`: `makeHetznerEventDecorator` appends fixture-labelled credential fields (`accessKeyId: AKIA-FIXTURE-LEAK-DO-NOT-USE`, `secretAccessKey: FIXTURE-SECRET-LEAK-DO-NOT-USE`) to every event record; `assertMetadataOnlyEventRecords` refuses on the leaked field names.

The R2 smoke stays gated on `CI_HAS_CLOUDFLARE_ACCOUNT` and is not affected by `CI_HAS_HETZNER_OBJECT_STORAGE`; the two smokes skip independently.

## Tear down

```sh
docker compose down -v
```

Removes the container and the anonymous volume; no orphan state on the host.

## T-3 side: messaging-queue-cloudflare fixture

The T-3 slice adds four files under `src/` and one `wrangler.toml` at the fixture root. No new runtime dependencies land in the fixture's `package.json` (the queue driver is dependency-free Node code); the T-2 MinIO branch and this T-3 queue branch coexist under one compose project (no second project name spinning a parallel stack).

- `wrangler.toml`: declares a Cloudflare Worker with a queue producer binding named `RCF_TEST_QUEUE` on queue `rcf-test-queue`, a consumer block with `dead_letter_queue = "rcf-test-dlq"`, `max_retries = 3` (per ADR-3003 and the fetched Cloudflare Queues dead-letter documentation at https://developers.cloudflare.com/queues/configuration/dead-letter-queues/), `max_batch_size = 10`, `max_batch_timeout = 5` (per ADR-3004 and the fetched Cloudflare Queues platform limits at https://developers.cloudflare.com/queues/platform/limits/), and a producer binding on the DLQ named `RCF_TEST_DLQ`. Main entry is `src/worker.mjs`.
- `src/worker.mjs`: minimal Cloudflare Worker main. Exports `fetch` (POST /publish endpoint for quick smoke publishes from `curl -X POST http://127.0.0.1:8787/publish -d '{...}'`) and `queue` (Worker queue-handler Cloudflare Queues invokes on delivery). Forwards to the shipped producer and consumer facades under `src/producer.mjs` and `src/consumer.mjs`.
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
- `SIMULATE_LEAK_BODY_TO_SINK=true`: the consumer path deliberately hands the sink adapter a body-bearing payload (body, headers, userId, ssn, consumerContext) on `messageAcked` so the whitelist boundary at `src/event-sink.mjs` is exercised end-to-end. Added per PR #159 gate finding 2 to give the `event-secrecy` probe teeth: a reviewer disabling the whitelist and rerunning the probe with this switch on observes the probe FAIL on the leaked fields; the shipped code with the whitelist in place passes cleanly.

### Two-line gate-reviewer boot for T-3 probes

The T-3 probes do not require Docker; the queue-driver runs in-process on Node 24. Boot line:

```sh
node ../../../../../blueprints/messaging-queue-cloudflare/contributions/probes/run-producer-facade-ready.mjs
node ../../../../../blueprints/messaging-queue-cloudflare/contributions/probes/run-publish-to-delivery.mjs
```

The remaining three probe shims (`run-retry-and-dlq.mjs`, `run-event-secrecy.mjs`, `run-real-account-concurrency-smoke.mjs`) follow the same pattern and each write a per-blueprint probe report at `.rcf/reports/blueprints/messaging-queue-cloudflare/<probe-name>.json` per spec section 3.4.

### Real-account concurrency smoke (accountBound)

`node ../../../../../blueprints/messaging-queue-cloudflare/contributions/probes/run-real-account-concurrency-smoke.mjs`:

- Without `CI_HAS_CLOUDFLARE_ACCOUNT`: exits 0 with `accountBoundSkipped: true` per spec section 3.5.
- With `CI_HAS_CLOUDFLARE_ACCOUNT` set alongside credentials for the shared HQ queue `rcf-lite-ci-queue-smoke` (Q2 default per spec section 10) wired via `security-secrets-management`, a live-account run is queued as a follow-up (v1.0.0 ships the skipped-record shape; the live-account run rides `deploy-cloudflare-workers`' surface, not a Node probe module).

### Known limitations (not mechanism-reach gaps)

- Cloudflare Queues local development does not support consumer concurrency per https://developers.cloudflare.com/queues/configuration/local-development/. The concurrency assertion is the `accountBound: true` real-account smoke; the wrangler-dev-equivalent seam (in-memory driver) proves the facade contract but not concurrency.
- Cloudflare Queues does not support Wrangler's remote mode (`wrangler dev --remote`) per the same page. A real-account run happens through a deployed Worker.
- Cloudflare Queues per-message size cap is 128 KB per https://developers.cloudflare.com/queues/platform/limits/. A project sending larger payloads either chunks or moves the body out-of-band to `object-storage-s3` (the guide names both patterns).

## T-4 side: jobs-background fixture

The T-4 slice extends the fixture with a `jobs/` directory carrying two toy job-definition modules, `src/jobs-runtime.mjs` realising the runtime that reads applied capabilities from the sidecar and dispatches messages from the applied queue, `src/scheduler.mjs` realising the `inProcess` scheduler with a fake-clock seam, and `src/job-run-log.mjs` realising the T-4-owned event sink (whitelist `event, jobId, jobName, attempts, duration, timestamp` plus optional `terminalErrorCode`; the T-3 event sink at `src/event-sink.mjs` is untouched, its whitelist `event, ts, messageId, queueName, attempts` stays frozen at v1.0.0 per the round-5 spec). No new runtime dependencies land in the fixture's `package.json`; the jobs runtime is dependency-free Node code and composes on top of the T-3 in-memory queue seam.

- `jobs/send-welcome-email.mjs`: toy one-shot delayed job. `name`, `handler`, `inputSchema` (opaque), `retryPolicy: { maxAttempts: 3, backoff: 'exponential' }`, `timeoutMs: 60000` (ADR-3104 default).
- `jobs/refresh-cache.mjs`: toy POSIX cron job. Adds `cron: '* * * * *'`, `retryPolicy: { maxAttempts: 5, backoff: 'constant' }`, `timeoutMs: 10000`.
- `src/jobs-runtime.mjs`: reads the `jobs/` directory at boot, registers job handlers by name, drives the driver's delivery loop, and fires the four lifecycle events (`jobScheduled`, `jobStarted`, `jobCompleted`, `jobFailed`) on the injected run-log sink.
- `src/scheduler.mjs`: `inProcess` mode. Injects a `clock` seam (real system clock in production, the fake clock in probes) so `fake-clock-cron.mjs` drives POSIX cron fires deterministically without wall-clock waits. Registered schedules can be POSIX cron strings or one-shot delayed shapes.
- `src/job-run-log.mjs`: T-4 event-sink whitelist enforced in code; refuses `jobFailed` records missing a `terminalErrorCode`.

### T-4 elicited parameters realised

- `jobsDir` (default `./jobs/`; the runtime reads modules from this directory at boot).
- `defaultRetryPolicy` (`{ maxAttempts: 3, backoff: 'exponential' }` per REQ-002; each job may override).
- `defaultTimeoutMs` (`60000` per ADR-3104).
- `schedulerMode` (`inProcess`, `workerCron`, or `external` per ADR-3102; the fixture ships `inProcess` and reserves `workerCron` and `external` for real deployments).
- `operatorSurface` (`cli`, `httpEndpoint`, or `none` per REQ-006; the fixture ships `none`).
- `fireToleranceMs` (`30000` per US-30108; the tolerance window a cron fire is expected to hit).

### T-4 induced-failure switches

Two switches simulate the retry and PII-leak paths the T-4 probes exercise. Each is wired end-to-end in `src/jobs-runtime.mjs` and drives the paired probe:

- `SIMULATE_HANDLER_THROW=true`: the runtime throws a retryable error on every dispatch regardless of the handler's own outcome; the `retry-and-fail` probe drives this path and asserts three `jobStarted` events with the same `jobId` and attempts `1, 2, 3` followed by a terminal `jobFailed` event with a `terminalErrorCode` matching `SIMULATE_HANDLER_THROW`.
- `SIMULATE_PII_IN_JOB_INPUT=true`: the runtime dispatches with a PII fixture input `{ userId: 1234, ssn: "123-45-6789", email: "test@example.com" }`; the `event-secrecy` probe asserts the run-log whitelist blocks every PII input field from appearing in any event record.

### Two-line gate-reviewer boot for T-4 probes

The T-4 probes do not require Docker or a real `wrangler dev` process; the jobs-runtime plus in-memory queue-driver run in-process on Node 24. Boot line:

```sh
node ../../../../../blueprints/jobs-background/contributions/probes/run-apply-time-refusal.mjs
node ../../../../../blueprints/jobs-background/contributions/probes/run-fake-clock-cron.mjs
```

The remaining three probe shims (`run-apply-time-override.mjs`, `run-retry-and-fail.mjs`, `run-event-secrecy.mjs`) follow the same pattern and each write a per-blueprint probe report at `.rcf/reports/blueprints/jobs-background/<probe-name>.json` per spec section 3.4.

### Known limitations (per-AC mechanism-reach form, round-3 checklist 6.g)

- AC-jobs-requiresQueue: PROVEN via the shipped `apply-time-refusal.mjs` probe against a bare scratch project on this shipped head (exit 3 and stable message-id assertions run in-process). No live-only gap.
- AC-jobs-overrideRecorded: PROVEN via the shipped `apply-time-override.mjs` probe on this shipped head (sidecar note grep asserts `no queue yet` and `--allow-no-queue-yet` and family word `queue`). No live-only gap.
- AC-jobs-scheduledRunsOnCron: PROVEN via `fake-clock-cron.mjs` on this shipped head against the in-memory queue-driver seam plus the injected fake-clock scheduler seam. LIVE `wrangler dev` cron-trigger firing under `workerCron` scheduler mode is the gate-reviewer's follow-up run per SDR-3-a; the shipped local seam proves the scheduler and runtime dispatch chain without a Cloudflare Queues account.
- AC-jobs-retryOnHandlerFailure: PROVEN via `retry-and-fail.mjs` on this shipped head (three `jobStarted` records at attempts 1, 2, 3 followed by terminal `jobFailed`). The in-memory queue-driver re-delivery loop matches the Cloudflare Queues retry semantics per T-3's opaque-adapter clause; a live-account run against Cloudflare Queues is the T-3 real-account concurrency smoke's territory, not T-4's.
- AC-jobs-eventSecrecy: PROVEN via `event-secrecy.mjs` on this shipped head (grep on the serialised run-log stream returns zero matches for every PII fixture literal). No live-only gap; the whitelist enforcement lives in code, not in a runtime environment.

The reserved v1.1.0 `workflows` scheduler mode is documented in the guide but not shipped at v1.0.0; the `fake-clock-cron.mjs` probe adds a `workflows-scheduler` variant when the v1.1.0 minor lands per section 5.7 of the spec.
