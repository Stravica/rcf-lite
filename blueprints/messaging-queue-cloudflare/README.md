# messaging-queue-cloudflare

A directed producer-to-consumer worklist queue on Cloudflare Queues, accessed through a producer facade that is the sole reader of the Queues binding. Cloudflare Queues is the first adapter (queue binding under wrangler config, consumer registered on the Worker `queue` handler); the reserved `messaging-queue-postgres` sibling (maintainer decision) mints on demand. Ships publish, consume, ack, retry, and DLQ; four lifecycle events (`producerReady`, `messagePublished`, `messageAcked`, `messageDeadLettered`) with a metadata-only field discipline. Composes on `deploy-cloudflare-workers` transitively via the wrangler binding, not through the capability mechanism, so `capabilities: ["queue"]` is what `jobs-background` reads to obtain the producer facade at apply time; no `requiresAppliedCapabilities` block ships at v1.0.0.

## What this blueprint gives you

- **A producer facade** (TAC-3001) that is the sole reader of the queue binding (`env.RCF_TEST_QUEUE` in the fixture; the elicited binding name in a real project) in your source tree, opens on boot, and exposes typed named domain verbs (`publish`, `publishBatch`). Emits `producerReady` on the first successful ready-check.
- **A consumer registration** (TAC-3002) on the Worker's `queue` handler; reads a batch, dispatches per-message to the registered handler, acks per message, returns `retry` on retryable failure, drives the retry-to-DLQ trajectory at the elicited `max_retries` per ADR-3003.
- **An event sink** (TAC-3003) with a metadata-only field discipline: `producerReady`, `messagePublished`, `messageAcked`, `messageDeadLettered`; no body bytes, no header value, no consumer context, no producer context.
- **Six Node-only probes** proving every runtime observable: four against the wrangler-dev-equivalent seam (`producer-facade-ready`, `publish-to-delivery`, `retry-and-dlq`, `event-secrecy`) plus one accountBound `real-account-concurrency-smoke` that skips cleanly without `CI_HAS_CLOUDFLARE_ACCOUNT` per spec section 3.5, and a shared `probe-utils.mjs` helper module.

## The six REQs

| REQ | What it commits |
|---|---|
| REQ-001 | Producer facade sole reader of the Queues binding; opens on boot; emits `producerReady`. |
| REQ-002 | Publish / consume / ack contract with stable message-id and producer-supplied trace-id. |
| REQ-003 | Retry contract: consumer returning `retry` re-delivers with an incremented attempt counter. |
| REQ-004 | Dead-letter contract: elicited `max_retries` (default 3 per Cloudflare Queues), DLQ per-consumer via wrangler `dead_letter_queue` field, DLQ retention 4 days per https://developers.cloudflare.com/queues/configuration/dead-letter-queues/. |
| REQ-005 | Batch consume: elicited `max_batch_size` (default 10, ceiling 100) and `max_batch_timeout` (default 5 seconds, ceiling 60 seconds) per https://developers.cloudflare.com/queues/platform/limits/. |
| REQ-006 | Four lifecycle events with metadata-only fields; event-secrecy probe asserts against a PII fixture body. |

## The three TACs

- **TAC-3001 producer facade**: sole reader of the queue binding; `publish` and `publishBatch` are the outward surface.
- **TAC-3002 consumer registration**: the Worker `queue` handler surface; batch envelope; per-message ack / retry semantics.
- **TAC-3003 event sink**: metadata-only lifecycle event contract; whitelist enforced in code.

## The four ADRs

- **ADR-3001 adapter**: Cloudflare Queues v1.0.0 shipped first adapter. `recommendedDefault: true`. Standards trace clause: Cloudflare Queues documented per-message and per-batch limits.
- **ADR-3002 delivery semantics** (`scope: global`, topic `deliverySemantics`): at-least-once as the shipped shape; conflicts by design with future exactly-once or at-most-once siblings. Standards trace clause: WSD-005 clauses on at-least-once and out-of-order tolerance.
- **ADR-3003 max-attempts floor**: `max_retries` default 3, floor 1, ceiling 100 per Cloudflare Queues platform limits. `elicited: true`. Standards trace clause: Cloudflare Queues default retry limit 3 and documented ceiling 100.
- **ADR-3004 batch defaults**: `max_batch_size` default 10 (ceiling 100), `max_batch_timeout` default 5 seconds (ceiling 60 seconds). `elicited: true`. Standards trace clause: Cloudflare Queues per-consumer batch settings.

## Elicited parameters

Queue name (or binding name in a Workers deploy); `max_retries` before DLQ (default 3, floor 1, ceiling 100); DLQ queue name (a second Cloudflare Queue declared via `dead_letter_queue` in wrangler config); `max_batch_size` (default 10, ceiling 100); `max_batch_timeout` (default 5 seconds, ceiling 60 seconds); producer-supplied trace-id header key (default `x-trace-id`).

## Companions

- **logging**: every publish, every ack, and every DLQ landing writes through the applied logger; a logging companion supplies the factory.
- **errorHandling**: a publish failure, a DLQ overflow constructs an internal error record; an error-handling companion supplies the record factory and the boundary.

## Composition and conflicts

Composes on `deploy-cloudflare-workers` transitively via the wrangler binding (not through the capability mechanism), so no `requiresAppliedCapabilities` block ships at v1.0.0. Contributes ADR-3002 as `scope: global` on new topic `deliverySemantics`; a future `messaging-queue-postgres` sibling (maintainer decision, deferred v1.0.0 pending demand) or an exactly-once / at-most-once sibling would conflict here by design. `capabilities: ["queue"]`; `providesRoles: []`.

## Reserved sibling

`messaging-queue-postgres` (maintainer decision). Reserved slug beside the `queue` capability row in `packages/rcf-lite/docs/blueprint-authoring.md` section 6a. When demand mints it, the sibling composes on `persistence-data-postgres` as its transport and conflicts by design on `deliverySemantics` with this blueprint; the operator picks one queue backend per project via a project-level ADR.

## The six probes

Each probe is a Node module under `contributions/probes/` exporting the shipped verdict envelope, with a matching `run-<probe-name>.mjs` shim that drives the probe against the shared fixture's slice and writes the per-blueprint report at `.rcf/reports/blueprints/messaging-queue-cloudflare/<probe-name>.json`.

| Probe | Anchor AC | What it proves | accountBound |
|---|---|---|---|
| `producer-facade-ready` | AC-29101-1 | Producer facade opens against the queue binding; `producerReady` fires with `queueName`. | false |
| `publish-to-delivery` | AC-29102-1, AC-29102-2, AC-29105-1, AC-29108-1 | 5 messages round-trip body byte-equal with stable message-ids and producer-supplied trace-ids preserved; per-message ack; wrangler-dev-equivalent seam. | false |
| `retry-and-dlq` | AC-29103-1, AC-29104-1 | Consumer returning `retry` observes same stable message-id with attempts 1..max_retries; DLQ landing fires `messageDeadLettered` at `max_retries + 1`; DLQ contents body byte-equal via the DLQ inspector helper. | false |
| `event-secrecy` | AC-29106-1 | Every event record carries only the whitelist (event, ts, messageId, queueName, attempts); no PII fixture text on JSON grep. | false |
| `real-account-concurrency-smoke` | AC-29108-2 | Self-provisioning (v1.0.2): the fixture shim (`packages/rcf-lite/test/fixtures/cf-platform/h2-cf-queue-real-account-shim.mjs`) mints a scratch Cloudflare Queue under the CI scratch prefix `h2-cf-probe-integrity-scratch-q-`, a scratch KV namespace for consumer telemetry under `h2-cf-probe-integrity-scratch-kv-tel-`, and a throwaway consumer Worker under `h2-cf-probe-integrity-scratch-w-` bound to the queue (consumer) with `RCF_TEST_QUEUE` (shipped queue binding name) + `RCF_TEST_TELEMETRY_KV` bindings. The Worker has NO fetch surface and NO workers.dev subdomain is enabled (operator ruling): the consumer is invoked BY THE QUEUE, not over HTTP. Driver publishes 500 messages in 10 concurrent 50-message batches via the Cloudflare Queues REST publish endpoint, polls the telemetry KV namespace via the KV REST list + get endpoints until drained, and asserts `totalConsumed === published` and `1 < maxConcurrent <= 250` per https://developers.cloudflare.com/queues/platform/limits/. Teardown deletes Worker, Queue and telemetry KV namespace on exit; the shim's separate `sweepOrphans` path lists over the account with full pagination (operator ruling item 5) and deletes any prefixed residue after a mid-run crash. **The local proof exercises OUR lifecycle logic against a mock of Cloudflare's contract; the real-account gate is the only surface that proves the wire format.** Without `CI_HAS_CLOUDFLARE_ACCOUNT` records `accountBoundSkipped: true`. | true |

## Anatomy

```
blueprints/messaging-queue-cloudflare/
  blueprint.json
  README.md
  CHANGELOG.md
  guide/
    messaging-queue-cloudflare.md
  docs/
    topics.md
  contributions/
    requirements/
      messaging-queue-cloudflare-req-001.json ... req-006.json
    user-stories/
      messaging-queue-cloudflare-us-29101.json ... us-29108.json
    tacs/
      tac-3001-messaging-queue-cloudflare-producer-facade.json
      tac-3002-messaging-queue-cloudflare-consumer-registration.json
      tac-3003-messaging-queue-cloudflare-event-sink.json
    adrs/
      adr-3001-messaging-queue-cloudflare-adapter.json
      adr-3002-messaging-queue-cloudflare-delivery-semantics.json
      adr-3003-messaging-queue-cloudflare-max-attempts-floor.json
      adr-3004-messaging-queue-cloudflare-batch-defaults.json
    probes/
      probe-utils.mjs
      producer-facade-ready.mjs                 (+ run-producer-facade-ready.mjs)
      publish-to-delivery.mjs                   (+ run-publish-to-delivery.mjs)
      retry-and-dlq.mjs                         (+ run-retry-and-dlq.mjs)
      event-secrecy.mjs                         (+ run-event-secrecy.mjs)
      real-account-concurrency-smoke.mjs        (+ run-real-account-concurrency-smoke.mjs)
```

## Known limitations and mechanism-reach gaps

The five local probes drive the fixture's in-memory queue-driver (`src/queue-driver.mjs`), which realises the Cloudflare Queues binding shape (`send` / `sendBatch` on the producer side, batch envelope with per-message `ack` / `retry` on the consumer side) so the producer facade module and consumer registration are indistinguishable from a live Queues run at the facade boundary. The wrangler-dev-equivalent seam (SDR-3-a on US-29107) is a deliberate v1.0.0 posture: rcf-lite gains no runtime dependency, CI stays reproducible without a live Cloudflare account, and Cloudflare Queues does not support consumer concurrency under `wrangler dev` per https://developers.cloudflare.com/queues/configuration/local-development/ (that assertion is what `real-account-concurrency-smoke` carries as `accountBound: true`).

Two live paths are unproven at v1.0.0 and are recorded per AC below so the gate reviewer and any downstream composing blueprint see exactly what is and is not proven for each AC. The gate reviewer's own single `wrangler dev` run and the `accountBound` smoke are what promote these gaps to proven.

- **AC-29101-1** (producer facade opens on boot; `producerReady` fires with `queueName`): proven against the in-memory realisation of the Cloudflare Queues binding shape (probe `producer-facade-ready`, verdict pass); live Queues delivery unproven pending a reviewer `wrangler dev` run or the accountBound smoke.
- **AC-29101-2** (sole-reader grep on the applied fixture): proven against the in-memory realisation (source-tree scan of `src/producer.mjs` against `src/consumer.mjs` peers); live-Queues source-tree posture is identical (the grep target is the fixture tree, not the vendor surface), so this AC has no live-only gap.
- **AC-29102-1** (5 messages round-trip body byte-equal with stable message-id and producer-supplied trace-id): proven against the in-memory realisation of the binding shape (probe `publish-to-delivery`, verdict pass); live Queues delivery of the same 5-message batch unproven pending a reviewer `wrangler dev` run or the accountBound smoke.
- **AC-29102-2** (`messageAcked` fires per successful consumer return; message not redelivered): proven against the in-memory realisation of the binding shape (probe `publish-to-delivery`, verdict pass); live Queues per-message ack behaviour unproven pending a reviewer `wrangler dev` run or the accountBound smoke.
- **AC-29103-1** (retry trajectory: same stable message-id across attempts 1..max_retries with incrementing attempt counter): proven against the in-memory realisation of the binding shape (probe `retry-and-dlq`, verdict pass with attempts 1,2,3 on the same message-id); live Queues retry counter observation unproven pending a reviewer `wrangler dev` run or the accountBound smoke.
- **AC-29104-1** (DLQ landing at `max_retries + 1` with `messageDeadLettered` event and body byte-equal on DLQ inspection): proven against the in-memory realisation of the binding shape (probe `retry-and-dlq`, verdict pass with DLQ landing at attempts=4 and byte-equal body); live Queues DLQ landing via wrangler `dead_letter_queue` field and inspection via `wrangler queues consumer add --dead-letter-queue` unproven pending a reviewer `wrangler dev` run or the accountBound smoke.
- **AC-29105-1** (batch consume: 5 messages in one batch, per-message ack semantics under `max_batch_size = 10`): proven against the in-memory realisation of the binding shape (probe `publish-to-delivery`, verdict pass); live Queues `max_batch_size` / `max_batch_timeout` behaviour on the [[queues.consumers]] block unproven pending a reviewer `wrangler dev` run or the accountBound smoke.
- **AC-29106-1** (metadata-only event whitelist; no PII body / header value / consumer context leaks): proven end-to-end against the in-memory realisation (probe `event-secrecy`, verdict pass; the whitelist is code-enforced in `src/event-sink.mjs`, independent of transport); live-Queues run does not change the sink code path, so this AC has no live-only gap.
- **AC-29108-1** (wrangler-dev-equivalent seam round-trip): proven end-to-end against the in-memory realisation of the binding shape (probe `publish-to-delivery`, verdict pass); a live `wrangler dev` process was not driven in this pass. Rationale: SDR-3-a on US-29107 makes the wrangler-dev-equivalent seam the shipped local seam because Cloudflare Queues does not support consumer concurrency under `wrangler dev` and does not support `wrangler dev --remote` per the local-development doc, so a live-wrangler run adds observability (a real process on port 8787) but does not add facade-contract certainty over the in-memory realisation. The gate reviewer drives one live `wrangler dev` run in their own scratch to close the observability gap.
- **AC-29108-2** (real-account concurrency smoke: 500 messages, consumer concurrency up to 250): as of v1.0.2 the probe SELF-PROVISIONS the throwaway Queue + consumer Worker + telemetry KV namespace under the CI scratch prefixes and requires no hand-provisioned CI infrastructure . Declared env for a live run: `CI_HAS_CLOUDFLARE_ACCOUNT` + `CF_ACCOUNT_ID` + `CF_API_TOKEN`. Without `CI_HAS_CLOUDFLARE_ACCOUNT` the probe records `accountBoundSkipped: true` per spec section 3.5 and the per-blueprint report carries `aggregateVerdict: pass` on the skipped shape. **The local proof harness under `packages/rcf-lite/test/fixtures/cf-platform/test/` is a mock of Cloudflare's REST contract, not the wire; the local runs exercise OUR lifecycle logic against that mock, and the real-account gate is the only surface that proves the wire format.**

## Other limitations (not mechanism-reach gaps)

- Cloudflare Queues per-message size cap is 128 KB per https://developers.cloudflare.com/queues/platform/limits/. A project sending larger payloads either chunks or moves the body out-of-band to `object-storage-s3`. This is a boundary the shipped facade does not police; it is a project-level concern the guide names.
- The Miniflare Queues sub-page returned 404 during spec ratification (2026-09-06); the Cloudflare Queues local-development page above is the authoritative reference and the only URL the guide cites for the local seam.

## What this blueprint does not do

- No fan-out / broadcast pub-sub semantics; that lives in the parked `messaging-eventbus` candidate on a different global topic.
- No exactly-once transport (Cloudflare Queues implements at-least-once with a stable message-id for consumer-side dedup per ADR-3002); consumer code that needs exactly-once processing dedups on the stable message-id.
- No schema registry; message bodies are opaque to this blueprint.
