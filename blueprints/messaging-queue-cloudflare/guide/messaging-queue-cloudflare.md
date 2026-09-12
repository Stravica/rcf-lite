# messaging-queue-cloudflare guide

## What this blueprint gets you

A directed producer-to-consumer worklist queue on Cloudflare Queues: publish, consume, ack, retry, DLQ. The producer facade is the sole reader of the Queues binding declared in your wrangler config (a `[[queues.producers]]` block); the consumer registration attaches to the Worker's `queue` handler through the paired `[[queues.consumers]]` block. Consumer code calls typed named domain verbs on the facade (`publish`, `publishBatch`) and never touches the raw binding. Every publish attaches a producer-supplied trace-id header so downstream consumers stitch the enqueue-to-process boundary; every consumer receipt records `messageAcked` on the sink with the stable platform-assigned message-id.

Four lifecycle events fire on the injected event sink with a rigid metadata-only whitelist (`event`, `ts`, `messageId`, `queueName`, `attempts`); consumer logging cannot leak object body bytes, header values, consumer-context fields or PII from the message body. The whitelist is enforced in code by the sink adapter (`event-sink.mjs`), not just documented.

The reserved sibling `messaging-queue-postgres` (sibling reservation, deferred v1.0.0 pending demand) mints on demand and conflicts by design on `deliverySemantics` with this blueprint; the operator picks one queue backend per project via a project-level ADR.

## Apply this blueprint

`deploy-cloudflare-workers` is the composition target this blueprint expects on a Workers project. The v1.0.0 shipped shape does NOT declare a `requiresAppliedCapabilities` block: the queue binding is wired through wrangler config (not through the capability mechanism), and `jobs-background` composes on the `queue` capability this blueprint provides (per spec section 5.6).

```sh
rcf define blueprint add messaging-queue-cloudflare
```

Exits 0 on any Workers-adjacent project. Contributes ADR-3002 on `scope: global` topic `deliverySemantics` (at-least-once as the shipped shape); a project that already declares a different answer on `deliverySemantics` (an exactly-once or at-most-once sibling minted on demand) surfaces a DELIBERATE conflict for operator resolution.

## Producer facade shape

```js
import { createProducer, queueConfigFromEnv } from './producer.mjs';

const cfg = queueConfigFromEnv();
const producer = createProducer({
  binding: env.RCF_TEST_QUEUE, // the wrangler-bound Queues producer
  queueName: cfg.queueName,
  onEvent: (record) => logger.log('messaging-queue', record),
});

await producer.ready;

// publish one message with a producer-supplied trace-id
const { id } = await producer.publish({ userId: '42', action: 'sendConfirmation' }, {
  headers: { 'x-trace-id': crypto.randomUUID() },
});

// publish a batch
await producer.publishBatch([
  { body: { seq: 1 }, headers: { 'x-trace-id': 'trace-order-1001' } },
  { body: { seq: 2 }, headers: { 'x-trace-id': 'trace-order-1002' } },
]);
```

The `x-trace-id` header and the publish and publishBatch verbs are owned at `TAC-3001.interfaces[2].description`; the values above are illustrative.

The facade is the sole holder of the queue binding reference per REQ-001. A call site that reaches into `env.<binding>.send()` directly is refused at the author-side check.

## Consumer registration shape

```js
import { createConsumer } from './consumer.mjs';

export default {
  queue: createConsumer({
    handler: async (msg) => {
      // msg.id, msg.body, msg.headers, msg.attempts, msg.timestamp
      try {
        await processBackgroundWork(msg.body);
        return 'ack';
      } catch (err) {
        // Return 'retry' to redeliver with an incremented attempt counter;
        // after max_retries the message lands on the DLQ per REQ-004.
        return 'retry';
      }
    },
    onEvent: (record) => logger.log('messaging-queue', record),
    env: process.env,
  }),
};
```

## Wrangler dev section

Local iteration on the fixture uses `wrangler dev` (v3.1.0+ per the Cloudflare Queues local-development doc). The wrangler-dev seam brings up producer and consumer in a single command with `--persist-to` for reproducible state:

```sh
cd packages/rcf-lite/test/fixtures/infra-s3-and-queue
npx wrangler dev --persist-to .wrangler-state
```

Consumer concurrency is NOT supported under `wrangler dev` per https://developers.cloudflare.com/queues/configuration/local-development/; the local run proves the facade contract, publish, consume, ack, retry, and DLQ landing, but does not exercise the 250-invocation concurrency cap. That assertion is the accountBound `real-account-concurrency-smoke` probe. Similarly, Cloudflare Queues does not support `wrangler dev --remote` per the same page.

The shipped v1.0.0 probes drive the wrangler-dev-equivalent seam (in-memory queue driver realising the same binding shape) so CI stays reproducible without a live Cloudflare account; the boundary at the facade is indistinguishable from a live-Queues run.

## Miniflare in CI section

Miniflare (`https://developers.cloudflare.com/workers/testing/miniflare/`, fetched 2026-09-06 status 200) documents itself as full-featured and supports KV, Durable Objects, WebSockets, modules, and more, without listing Queues explicitly. The Miniflare Queues sub-page returned 404 during spec ratification, so no citation ships at that URL. In CI, the wrangler-dev-equivalent seam the fixture ships is the reference; a project that needs the full Miniflare surface for a broader integration test wires it separately and defers to the Cloudflare Queues local-development page above for the Queues-specific behaviour.

## Real-account smoke section

`node ../../../../blueprints/messaging-queue-cloudflare/contributions/probes/run-real-account-concurrency-smoke.mjs` is the accountBound probe. Without `CI_HAS_CLOUDFLARE_ACCOUNT` it exits 0 with `accountBoundSkipped: true` per spec section 3.5 and the per-blueprint report reads `aggregateVerdict: pass`. With `CI_HAS_CLOUDFLARE_ACCOUNT=1` plus credentials for the shared CI queue `rcf-lite-ci-queue-smoke` (Q2 default) wired via `security-secrets-management`, a live-account run is queued as a v1.0.0 follow-up: the run itself rides `deploy-cloudflare-workers`' surface (not a Node probe module) since Cloudflare Queues does not support `wrangler dev --remote`, and the v1.0.0 probe stops short of driving deployment machinery.

## Retry and DLQ discipline

ADR-3003 sets `max_retries` to 3 (matching the Cloudflare Queues documented default at https://developers.cloudflare.com/queues/configuration/dead-letter-queues/) with a floor of 1 and a ceiling of 100 (matching the Cloudflare Queues documented per-message max at https://developers.cloudflare.com/queues/platform/limits/). On overflow, the message lands on the elicited DLQ declared via the `dead_letter_queue` field on the wrangler `[[queues.consumers]]` block; the DLQ has its own retention (4 days when no active consumer is attached per the DLQ doc). A DLQ inspector helper (`src/dlq-inspector.mjs` in the fixture; `wrangler queues consumer add --dead-letter-queue` in production per the DLQ doc's CLI form) reads the DLQ contents for triage.

## Batch consume discipline

ADR-3004 sets `max_batch_size` to 10 (ceiling 100) and `max_batch_timeout` to 5 seconds (ceiling 60 seconds) per the Cloudflare Queues platform limits. Batch settings live on the `[[queues.consumers]]` block in wrangler config; a project running closer to the ceiling changes the config values, not the code. Per-message ack semantics keep one bad message in a batch from rolling back its peers.

## Composition with jobs-background

`jobs-background` (round-5 sibling on the jobs track) declares `requiresAppliedCapabilities: ["queue"]`; applying `jobs-background` on a project that already applied `messaging-queue-cloudflare` gets the apply-time capability check to pass with the `queue` capability discovered on the applied manifest. The jobs-background blueprint enqueues jobs through the producer facade this blueprint exposes; the retry-and-DLQ trajectory is what turns transient job failures into eventual success and permanent failures into a DLQ receipt.

## What this blueprint does not do

- No exactly-once transport (Cloudflare Queues does not implement transport-level dedup); consumer code that needs exactly-once processing dedups on the stable message-id.
- No fan-out / broadcast pub-sub; that shape lives in the parked `messaging-eventbus` candidate on a different global topic.
- No schema registry on the message bodies (they are opaque to the blueprint boundary).
