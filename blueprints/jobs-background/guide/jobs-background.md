# jobs-background guide

The v1.0.0 background-jobs discipline. Composes on any applied blueprint declaring `capabilities: ["queue"]`; the shipped provider today is `messaging-queue-cloudflare` v1.0.0. Refuses apply on a bare project.

## When to apply this

You have background work that runs asynchronously from a request boundary, in-process on a Node server or in a Cloudflare Worker: welcome emails, cache refreshes, reindexing, receipt PDF generation. You want:

- A uniform job-definition shape so every module in `./jobs/` follows one contract.
- A scheduler that ships POSIX cron plus one-shot-delayed shapes and elicits the runtime placement (`inProcess`, `workerCron`, `external`).
- Retry that inherits the applied queue's max-attempts ceiling; no hand-rolled retry loops.
- Metadata-only observability by default; the domain PII on the job body cannot leak through the run log even by accident.

You do NOT want:

- A stateful multi-step workflow orchestration with durable execution and rollbacks. That is either a future Temporal-shape or Airflow-shape sibling (conflicts on `backgroundJobModel`), or the reserved v1.1.0 `workflows` scheduler mode inside this blueprint.
- A pub-sub broadcast surface. That is a queue with fan-out semantics; this blueprint composes on a directed producer-to-consumer worklist queue.

## Apply

On a fresh project with `messaging-queue-cloudflare` already applied:

```sh
rcf define blueprint add jobs-background
```

Applies 22 contributions and writes the sidecar `rcf/blueprints/jobs-background.applied.json` with `appliedCapabilities: ["queue"]` (discovered through the T-5 capability mechanism).

On a bare project (no queue provider applied), apply refuses:

```sh
rcf define blueprint add jobs-background
# exit 3
# [jobs-background-no-queue] jobs-background requires an applied blueprint declaring
# at least one of: queue.
# ...
# Or override for a scaffolding pass (records a note on source.notes so
# later validation flags the surface as not-yet-activated):
#     rcf define blueprint add jobs-background --allow-no-queue-yet
```

Override:

```sh
rcf define blueprint add jobs-background --allow-no-queue-yet
```

Exits 0 and writes the sidecar with `allowNoAuthYet: true`, `appliedCapabilities: []`, `notes: "no queue yet: applied under --allow-no-queue-yet; surfaces gated on queue will refuse at runtime until a queue blueprint is applied."`.

## Writing a job

Every job module in `./jobs/` exports a plain object:

```js
export default {
  name: 'send-welcome-email',
  inputSchema: mySchemaLibrary.object({ userId: mySchemaLibrary.number(), email: mySchemaLibrary.string() }),
  retryPolicy: { maxAttempts: 3, backoff: 'exponential' },
  timeoutMs: 60000,
  async handler(input, ctx) {
    await ctx.logger.info('sending welcome email', { userId: input.userId });
    await ctx.http.post('/api/mail', input);
    return { sent: true };
  },
};
```

Backoff shapes:

- `exponential`: base * 2^(attempts - 1), capped at 10 minutes.
- `constant`: base seconds between every attempt.
- `linear`: base * attempts.

The `retryPolicy.maxAttempts` must not exceed the applied queue's ceiling; Cloudflare Queues caps at 100 per ADR-3003 in the messaging-queue-cloudflare blueprint.

## Scheduling

Two shipping shapes at REQ-003:

```js
// POSIX cron, every minute:
export default {
  name: 'refresh-cache',
  cron: '* * * * *',
  // ...
};

// One-shot delayed, invoked from application code:
await scheduler.delayed({ jobName: 'send-welcome-email', delayMs: 5 * 60 * 1000, input: { userId, email } });
```

## Running with Cloudflare Queues

The shipped composition target is a Cloudflare Worker deploy with `messaging-queue-cloudflare` applied. The `workerCron` scheduler mode wires Cloudflare Cron Triggers to a Worker handler that publishes to the applied queue; the same Worker consumes the queue and dispatches to registered job handlers.

Wrangler config (extract):

```toml
[triggers]
crons = ["* * * * *"]

[[queues.producers]]
binding = "RCF_TEST_QUEUE"
queue = "rcf-test-queue"

[[queues.consumers]]
queue = "rcf-test-queue"
dead_letter_queue = "rcf-test-dlq"
max_retries = 3
```

Boot line for local development against the T-3 in-memory queue-driver seam:

```sh
node ../../../../blueprints/jobs-background/contributions/probes/run-fake-clock-cron.mjs
```

## Operator-facing surface (REQ-006)

Elicited between `cli`, `httpEndpoint`, or `none` at apply time.

- `cli`: the applying project builds a thin Node CLI shim against the jobs-runtime that supports `jobs list`, `jobs run <name>`, `jobs status <jobId>`.
- `httpEndpoint`: the applying project mounts a small HTTP surface through its own HTTP shape (`GET /jobs`, `POST /jobs/:name/run`, `GET /jobs/status/:jobId`).
- `none`: no operator surface; the run log is the only observability. Default for fresh scaffolds.

The blueprint ships the contract these shims build against; the shim itself is the applying project's concern.

## Reserved v1.1.0 Workflows adapter

The `workflows` scheduler mode arrives at v1.1.0 per Baz section 5.7 and round-6 decision (b). It wraps the same job-definition contract with Cloudflare Workflows `step.do` orchestration, adding durable multi-step execution without changing the outward job-definition shape. What changes:

- One new enum value at ADR-3102: `scheduler: "workflows"`.
- One new section in this guide covering how to declare durable steps through the workflow adapter.
- The `fake-clock-cron.mjs` probe gains a `workflows-scheduler` variant.

What does NOT change:

- The `backgroundJobModel` topic answer (still retry-and-schedule at ADR-3101).
- The job-definition module shape (`name`, `handler`, `inputSchema`, `retryPolicy`, `timeoutMs`).
- The run-log envelope whitelist (`event`, `jobId`, `jobName`, `attempts`, `duration`, `timestamp`, optional `terminalErrorCode`).
- The `requiresAppliedCapabilities` block on the applying blueprint.

## Composition with other blueprints

- `observability-logging` (companion): supplies the run-log upstream so the four lifecycle events flow through the applied logger's channel policy.
- `application-error-handling` (companion): supplies the error record factory a `jobFailed` constructs on the terminal path.
- `messaging-queue-cloudflare`: the shipped `queue` capability provider today. The `messaging-queue-postgres` sibling (reserved slug per Baz decision 7 in the T-3 documentation) mints on demand and composes here without any change to `jobs-background`.
