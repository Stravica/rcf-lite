# jobs-background v1.0.0

Background-jobs discipline over an applied `queue` capability. Ships a job-definition contract, a POSIX-cron plus one-shot-delayed scheduler, a retry contract that inherits the applied queue's max-attempts ceiling, and a metadata-only run-log event stream at four moments. Composes on the applied-capability mechanism; refuses apply on a bare project with exit 3 and the stable message id `jobs-background-no-queue`.

## What this gives you

- A job-definition module shape you export from `./jobs/*.mjs`, owned on TAC-3101-jobs-background-job-definition.interfaces.jobModule.default; the shape's fields are the ones the owner names.
- A scheduler with POSIX cron and one-shot-delayed shapes, elicited across `inProcess` (a Node long-lived process), `workerCron` (Cloudflare Cron Triggers) and `external` (a Kubernetes CronJob, a systemd timer, GitHub Actions schedule). A `workflows` mode is reserved for the v1.1.0 minor per section 5.7 of the spec.
- A retry contract that inherits the applied queue's max-attempts ceiling (Cloudflare Queues at 100 per the messaging-queue-cloudflare ADR-3003) and expresses the elicited backoff shape (`exponential`, `constant`, `linear`).
- A metadata-only run-log at four moments (`jobScheduled`, `jobStarted`, `jobCompleted`, `jobFailed`). Record whitelist: `{ jobId, jobName, attempts, duration, timestamp }` plus optional `terminalErrorCode`. No job input, no handler output, no user id, no email, no SSN, ever.
- An operator-facing surface elicited across `cli`, `httpEndpoint`, or `none`. The blueprint ships the contract; the applying project builds the thin shim.

## The six REQs

| REQ | Contract |
|---|---|
| `jobs-background-REQ-001` | Requires an applied `queue` capability; refuses apply on a bare project with exit 3 and the stable message id `jobs-background-no-queue`. |
| `jobs-background-REQ-002` | Job-definition contract: shape owned on `TAC-3101-jobs-background-job-definition.interfaces.jobModule.default`. |
| `jobs-background-REQ-003` | Scheduler contract: POSIX cron string and one-shot delayed. |
| `jobs-background-REQ-004` | Retry contract: handler throws retryable error re-delivers via the applied queue; max-attempts elicited within the applied queue's own ceiling. |
| `jobs-background-REQ-005` | Job-run event log: `jobScheduled`, `jobStarted`, `jobCompleted`, `jobFailed`; metadata-only whitelist. |
| `jobs-background-REQ-006` | Operator-facing surface (elicited): `cli`, `httpEndpoint`, or `none`. |

## Capability composition

`requiresAppliedCapabilities` on `blueprint.json`:

```json
{
  "capabilities": ["queue"],
  "allowSkipFlag": "allow-no-queue-yet",
  "refusalMessageId": "jobs-background-no-queue"
}
```

Apply refuses on a bare project (no applied blueprint declares `capabilities: ["queue"]`) with exit 3 and the stable first-line tag `[jobs-background-no-queue]`. The refusal message explicitly names `messaging-queue-cloudflare` as the shipped provider and `--allow-no-queue-yet` as the override.

The `--allow-no-queue-yet` override records a note on the sidecar `rcf/blueprints/jobs-background.applied.json` (`notes: "no queue yet: applied under --allow-no-queue-yet; surfaces gated on queue will refuse at runtime until a queue blueprint is applied."`). Note: the spec section 5.4 prose reference to `manifest.blueprints[jobs-background].source.notes` is superseded by the shipped mechanism which writes the note on the sidecar because the applied-blueprint-record schema in rcf-schemas 0.6.1 is closed and cannot carry a `notes` field. `rcf define validate` reads the sidecar to flag surfaces that never activated.

## Scheduler mode ADR (ADR-3102)

Scheduler mode is elicited across three values at v1.0.0 and reserves a fourth for v1.1.0:

- `inProcess`: a long-lived Node process holding `setInterval` per cron string and `setTimeout` per one-shot delay. Fits Node-server deploys; unsuitable for Cloudflare Workers.
- `workerCron`: Cloudflare Cron Triggers wire the scheduled event to a Worker handler that publishes to the applied queue, per the Cloudflare Cron Triggers documentation. Cron-trigger semantics are per-cron-string on the Worker's wrangler config, not per-job-cron on the runtime; the guide names the alignment. Refuses `workerCron` when the applied queue has no cron surface.
- `external`: an external cron runner (Kubernetes CronJob, GitHub Actions schedule, systemd timer) invokes an operator surface with a fire-now command.
- Reserved `workflows` (v1.1.0): wraps the same job-definition contract with Cloudflare Workflows `step.do` orchestration per section 5.7 of the spec and the round-6 proposal decision (b). Adds one enum value at ADR-3102 and one section to the guide; no facade re-shape.

## Timeout ceiling (ADR-3104)

Default handler `timeoutMs` is 60000 (60 seconds); floor is 1000 (1 second); ceiling is bounded by the applied queue's consumer wall-clock. Cloudflare Queues caps consumer wall-clock at 15 minutes per the platform limits documentation; a job-definition module declaring a `timeoutMs` above the ceiling refuses at boot with a clear error naming the ceiling and the applied provider.

## Companions and capabilities

- `capabilities: ["backgroundJobs"]` (per section 6a of `packages/rcf-lite/docs/blueprint-authoring.md`; a consumer blueprint reads this capability to obtain the job-definition and scheduler surfaces at apply time).
- `providesRoles`: absent.
- `suggestedCompanions`:
  - `logging`: every `jobStarted` / `jobCompleted` / `jobFailed` event writes through the applied logger; a logging companion supplies the factory.
  - `errorHandling`: a `jobFailed` constructs an internal error record with the terminal error code and the correlation id; an error-handling companion supplies the record factory and the boundary.

## The five probes

Each probe module lives under `contributions/probes/` and exports the spec section 3.2 verdict envelope with an `anchorAcId` matching a contributed AC id on the blueprint. Each has a matching `run-<probe-name>.mjs` shim writing a per-blueprint report at `.rcf/reports/blueprints/jobs-background/<probe-name>.json` per spec section 3.4.

- `apply-time-refusal.mjs` (anchors `AC-jobs-requiresQueue`): invokes `rcf define blueprint add ./blueprints/jobs-background` against a bare Node scratch fixture with NO queue applied; asserts exit 3, greps stderr for the first-line tag `[jobs-background-no-queue]`, greps stderr for the explicit provider name `messaging-queue-cloudflare` and the override flag `--allow-no-queue-yet`. Q3 default per spec section 10: asserts BOTH exit code AND stable message id.
- `apply-time-override.mjs` (anchors `AC-jobs-overrideRecorded`): same bare scratch fixture, but with `--allow-no-queue-yet`; asserts exit 0 and the sidecar `rcf/blueprints/jobs-background.applied.json` records `slug: jobs-background`, `allowNoAuthYet: true`, `appliedCapabilities: []`, and a `notes` field containing `no queue yet` and `--allow-no-queue-yet` and `queue` (but not the auth or secrets-management family words).
- `fake-clock-cron.mjs` (anchors `AC-jobs-scheduledRunsOnCron`): with `messaging-queue-cloudflare` and `jobs-background` both applied on the shared sample-app fixture, drives the fixture's fake-clock scheduler through one POSIX cron minute for the refresh-cache job; asserts `jobStarted` fires within the elicited `fireToleranceMs` window (default 30000 ms) and `jobCompleted` fires within the elicited `timeoutMs` (10000 ms for refresh-cache).
- `retry-and-fail.mjs` (anchors `AC-jobs-retryOnHandlerFailure`): with `SIMULATE_HANDLER_THROW=true` on the fixture, schedules a send-welcome-email job (`maxAttempts: 3`), drives the queue through re-deliveries; asserts three `jobStarted` events fire with the same `jobId` and attempts counter 1, 2, 3, followed by a terminal `jobFailed` with a `terminalErrorCode`.
- `event-secrecy.mjs` (anchors `AC-jobs-eventSecrecy`): with `SIMULATE_PII_IN_JOB_INPUT=true` on the fixture, schedules a job with a PII fixture input `{ userId: 1234, ssn: "123-45-6789", email: "test@example.com" }`; drives to completion; asserts every event record carries only the whitelist `{ event, jobId, jobName, attempts, duration, timestamp }` (plus optional `terminalErrorCode`) and NO PII literal.

## Running the probes

The probes drive against the shared sample-app fixture at `packages/rcf-lite/test/fixtures/infra-s3-and-queue/` (extended with `jobs/`, `src/jobs-runtime.mjs`, `src/scheduler.mjs`, `src/job-run-log.mjs`). No Docker, no `wrangler dev` process required; the in-memory queue-driver seam is the shipped local seam per the wrangler-dev-equivalent seam decision.

Two-line boot for the two headline probes:

```sh
node ../../../../blueprints/jobs-background/contributions/probes/run-apply-time-refusal.mjs
node ../../../../blueprints/jobs-background/contributions/probes/run-fake-clock-cron.mjs
```

The remaining three shims (`run-apply-time-override.mjs`, `run-retry-and-fail.mjs`, `run-event-secrecy.mjs`) follow the same pattern.

## Elicited parameters

- `jobsDir` (default `./jobs/`).
- `defaultRetryPolicy` (`{ maxAttempts: 3, backoff: "exponential" }`).
- `defaultTimeoutMs` (60000).
- `schedulerMode` (`inProcess` | `workerCron` | `external`; reserved `workflows` at v1.1.0).
- `operatorSurface` (`cli` | `httpEndpoint` | `none`).
- `fireToleranceMs` (default 30000).

## Known limitations (per-AC mechanism-reach form, round-3 checklist 6.g)

- AC-jobs-requiresQueue: PROVEN via `apply-time-refusal.mjs` against a bare scratch project on the shipped head (exit code and message id assertions run in-process). No live-only gap.
- AC-jobs-overrideRecorded: PROVEN via `apply-time-override.mjs` on the shipped head (sidecar note grep asserts `no queue yet`, `--allow-no-queue-yet`, and family word `queue`). No live-only gap.
- AC-jobs-scheduledRunsOnCron: PROVEN via `fake-clock-cron.mjs` on the shipped head against the in-memory queue-driver seam plus the injected fake-clock scheduler seam. LIVE `wrangler dev` cron-trigger firing under `workerCron` scheduler mode is the gate reviewer's follow-up run per the wrangler-dev-equivalent seam decision; the shipped local seam proves the scheduler and runtime dispatch chain without a Cloudflare Queues account.
- AC-jobs-retryOnHandlerFailure: PROVEN via `retry-and-fail.mjs` on the shipped head (three `jobStarted` records at attempts 1, 2, 3 followed by terminal `jobFailed`). The in-memory queue-driver's re-delivery loop matches Cloudflare Queues' retry semantics per the messaging-queue-cloudflare opaque-adapter clause; a live-account run against Cloudflare Queues is the messaging-queue-cloudflare real-account concurrency smoke's territory, not this blueprint's.
- AC-jobs-eventSecrecy: PROVEN via `event-secrecy.mjs` on the shipped head (grep on the serialised run-log stream returns zero matches for every PII fixture literal). No live-only gap; the whitelist enforcement lives in code, not in a runtime environment.
- `workerCron` refuses on an applied queue with no cron surface: DOCUMENTED at ADR-3102 in this blueprint's contribution set; not exercised at v1.0.0 because the shipped provider (`messaging-queue-cloudflare` v1.0.0) does not itself claim a cron surface (the cron surface is Workers-side per Cloudflare Cron Triggers, not Queues-side). A follow-up train fires the refusal live once a `queue`-capability provider with a cron surface ships.
- Reserved v1.1.0 `workflows` scheduler mode: DOCUMENTED at ADR-3102; the `fake-clock-cron.mjs` probe grows a `workflows-scheduler` variant when the v1.1.0 minor lands per section 5.7 of the spec.

## Reserved v1.1.0 minor: Workflows adapter

The v1.1.0 minor adds a fourth `scheduler` value (`workflows`) at ADR-3102, wrapping the same job-definition contract with Cloudflare Workflows `step.do` orchestration per section 5.7 of the spec. No topic conflict (the `backgroundJobModel` topic answer stays retry-and-schedule), no facade re-shape. Adds one section to this guide.
