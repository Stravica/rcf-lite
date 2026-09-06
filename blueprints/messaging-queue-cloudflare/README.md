# messaging-queue-cloudflare

A directed producer-to-consumer worklist queue on Cloudflare Queues, accessed through a producer facade that is the sole reader of the Queues binding. Cloudflare Queues is the first adapter (queue binding under wrangler config, consumer registered on the Worker `queue` handler); the reserved `messaging-queue-postgres` sibling (Baz decision 7) mints on demand. Ships publish, consume, ack, retry, and DLQ; four lifecycle events (`producerReady`, `messagePublished`, `messageAcked`, `messageDeadLettered`) with a metadata-only field discipline. Composes on `deploy-cloudflare-workers` transitively via the wrangler binding, not through the capability mechanism, so `capabilities: ["queue"]` is what `jobs-background` reads to obtain the producer facade at apply time; no `requiresAppliedCapabilities` block ships at v1.0.0.

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

Composes on `deploy-cloudflare-workers` transitively via the wrangler binding (not through the capability mechanism), so no `requiresAppliedCapabilities` block ships at v1.0.0. Contributes ADR-3002 as `scope: global` on new topic `deliverySemantics`; a future `messaging-queue-postgres` sibling (Baz decision 7, deferred v1.0.0 pending demand) or an exactly-once / at-most-once sibling would conflict here by design. `capabilities: ["queue"]`; `providesRoles: []`.

## Reserved sibling

`messaging-queue-postgres` (Baz decision 7). Reserved slug beside the `queue` capability row in `packages/rcf-lite/docs/blueprint-authoring.md` section 6a. When demand mints it, the sibling composes on `persistence-data-postgres` as its transport and conflicts by design on `deliverySemantics` with this blueprint; the operator picks one queue backend per project via a project-level ADR.

## The six probes

Each probe is a Node module under `contributions/probes/` exporting the round-5 spec section 3.2 verdict envelope, with a matching `run-<probe-name>.mjs` shim that drives the probe against the shared fixture's T-3 slice and writes the per-blueprint report at `.rcf/reports/blueprints/messaging-queue-cloudflare/<probe-name>.json`.

| Probe | Anchor AC | What it proves | accountBound |
|---|---|---|---|
| `producer-facade-ready` | AC-29101-1 | Producer facade opens against the queue binding; `producerReady` fires with `queueName`. | false |
| `publish-to-delivery` | AC-29102-1, AC-29102-2, AC-29105-1, AC-29108-1 | 5 messages round-trip body byte-equal with stable message-ids and producer-supplied trace-ids preserved; per-message ack; wrangler-dev-equivalent seam. | false |
| `retry-and-dlq` | AC-29103-1, AC-29104-1 | Consumer returning `retry` observes same stable message-id with attempts 1..max_retries; DLQ landing fires `messageDeadLettered` at `max_retries + 1`; DLQ contents body byte-equal via the DLQ inspector helper. | false |
| `event-secrecy` | AC-29106-1 | Every event record carries only the whitelist (event, ts, messageId, queueName, attempts); no PII fixture text on JSON grep. | false |
| `real-account-concurrency-smoke` | AC-29108-2 | Real 500-message round-trip against `rcf-lite-ci-queue-smoke` when `CI_HAS_CLOUDFLARE_ACCOUNT` set; records `accountBoundSkipped: true` when not. | true |

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

## Known limitations

- Cloudflare Queues local development does not support consumer concurrency and does not support Wrangler's remote mode (`wrangler dev --remote`) per https://developers.cloudflare.com/queues/configuration/local-development/. The concurrency assertion is the `accountBound: true` real-account smoke; the local wrangler-dev-equivalent seam proves the facade contract but not concurrency.
- Cloudflare Queues per-message size cap is 128 KB per https://developers.cloudflare.com/queues/platform/limits/. A project sending larger payloads either chunks or moves the body out-of-band to `object-storage-s3`.
- The Miniflare Queues sub-page returned 404 during spec ratification (2026-09-06); the Cloudflare Queues local-development page above is the authoritative reference and the only URL the guide cites for the local seam.

## What this blueprint does not do

- No fan-out / broadcast pub-sub semantics; that lives in the parked `messaging-eventbus` candidate on a different global topic.
- No exactly-once transport (Cloudflare Queues implements at-least-once with a stable message-id for consumer-side dedup per ADR-3002); consumer code that needs exactly-once processing dedups on the stable message-id.
- No schema registry; message bodies are opaque to this blueprint.
