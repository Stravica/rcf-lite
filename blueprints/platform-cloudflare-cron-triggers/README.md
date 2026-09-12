# platform-cloudflare-cron-triggers

A rcf-lite blueprint that ships a small, opinionated wiring over
Cloudflare Workers Cron Triggers. One module holds the scheduled
handler; a dispatcher routes multiple cron expressions to distinct
handlers; every fire emits a metadata-only lifecycle event a
logging companion can render without ever writing a body byte.

- Version: `1.0.0`
- Category: `platform`
- Capabilities: `["scheduledTrigger"]`
- Suggested companions: `logging`, `errorHandling`

## What it gives you

- One place that dereferences the Cloudflare Workers Cron Trigger
  event (`src/scheduled.mjs`), wires the dispatcher and the event
  sink at boot, and emits `cronReady` on the first ready-check.
- An expression-routed dispatcher (`src/dispatcher.mjs`) that maps
  cron expressions to distinct handlers, records `cronUnmatched`
  on an unknown expression, and observes each fire against a
  skew-tolerance window and a soft budget.
- Five metadata-only lifecycle events (`cronReady`, `cronFired`,
  `cronSkewed`, `cronStalled`, `cronUnmatched`) with a bounded
  payload shape `{event, expression, scheduledTime, outcome,
  duration}` plus optional numeric fields (`softBudgetMs`,
  `deltaMs`). Two-layer secrecy assertion in the event-secrecy
  probe.
- A decision-tree cross-reference in the guide to `jobs-background`
  (as of the initial adapter release) and to the follow-up Workflows adapter (deferred, per the jobs-
  background 1.1.0 minor bump per spec section 5.7) for cases that
  need durable, retried, workflow-shaped scheduled work.

## The four REQs

| REQ | What |
| --- | --- |
| `platform-cloudflare-cron-triggers-REQ-001` | The scheduled() handler is the sole reader of the Cron Trigger event and opens on boot with `cronReady`. |
| `platform-cloudflare-cron-triggers-REQ-002` | Multiple cron expressions route to distinct handlers via the expression-router dispatcher. |
| `platform-cloudflare-cron-triggers-REQ-003` | Skew tolerance: fires observed inside the elicited window are `onTime`; outside record `cronSkewed` with the delta. |
| `platform-cloudflare-cron-triggers-REQ-004` | Soft budget: a handler running past the elicited budget fires `cronStalled` but the dispatcher does not terminate; every event record is metadata-only. |

## The wired shape

The scheduled handler is the ONE place the Cron Trigger event lives.
The dispatcher factors the routing, skew and soft-budget concerns
into one seam. The public surface is:

```
createScheduledHandler({ routes, eventSink, skewToleranceMs, softBudgetMs, clock? })
  -> { ready, scheduled }
```

The dispatcher underneath:

```
createDispatcher({ routes, eventSink, skewToleranceMs, softBudgetMs, clock? })
  -> { dispatch }
```

## Elicited parameters

- `cron-expressions` (default `* * * * *`): the cron expressions
  to schedule; the operator's comma-separated list is written into
  `wrangler.toml` under `[triggers] crons`.
- `cron-dispatcher-mode` (default `expression-routed` when the
  elicited list has more than one entry, else `single-handler`):
  the dispatcher mode per `ADR-3302`.
- `cron-skew-tolerance-seconds` (default `30`, floor `5`, ceiling
  `300`): the skew tolerance window per `ADR-3303`.
- `cron-soft-budget-seconds` (default `30`, no floor): the
  per-handler soft budget.

## The five probes

The five probes live under `contributions/probes/`. Each has a
matching `run-<probe-name>.mjs` shim that writes a per-blueprint
report to `.rcf/reports/blueprints/platform-cloudflare-cron-triggers/<probe-name>.json`
under the fixture root.

| Probe | Anchor AC | Account-bound | What it drives |
| --- | --- | --- | --- |
| `wrangler-test-scheduled.mjs` | `AC-32105-1` | no | Spawns `wrangler dev --test-scheduled` on the cf-platform fixture, waits bounded 30 seconds for it to bind, drives `/__scheduled?cron=<expr>`, asserts status 200 and kills wrangler cleanly. Returns `warn` on a CLI regression per spec section 3.1 pass-with-skip. |
| `dispatcher-routing.mjs` | `AC-32102-1` | no | Wires two spy handlers on two expressions, drives the matched expression (asserting only the routed spy fires with the bounded context), then an unmatched expression (asserting `cronUnmatched` fires and no spy runs). Also covers `AC-32102-2`. |
| `skew-tolerance.mjs` | `AC-32103-1` | no | Drives the dispatcher against a fake clock aligned to `scheduledTime` (asserting `cronFired` outcome `onTime`) then advanced 60s past (asserting `cronSkewed` with `deltaMs: 60000` and the handler still runs). Also folds soft-budget as additional results: a spy handler resolving after 250ms with `softBudgetMs=100` fires exactly one `cronStalled` at the crossing and a final `cronFired` follows (covers `AC-32103-2`, `AC-32104-1`, `AC-32104-2`). |
| `event-secrecy.mjs` | `AC-32106-1` | no | Drives the dispatcher with a spy handler that closes over a PII fixture (`{userId, ssn}`); layer-1 asserts every event record's keys are a subset of the allow-list `{event, expression, scheduledTime, outcome, duration, softBudgetMs, deltaMs}`; layer-2 asserts no PII substring in the JSON serialisation. `SIMULATE_PII_LEAK=true` wraps the sink to forward the closure so the mutation-run surfaces the leaked fields and returns `fail`. |
| `real-account-scheduled-smoke.mjs` | `AC-32107-1` | yes | Polls the Cloudflare Workers analytics API for the named Worker every 5s, waits bounded 90s for a scheduled event to appear. Without `CI_HAS_CLOUDFLARE_ACCOUNT` the probe records `accountBoundSkipped: true` and aggregates to `pass` per spec section 3.5. |

## Known limitations (per-AC mechanism reach)

- **`AC-32105-1` (wrangler dev --test-scheduled)** requires the
  fixture's `wrangler` devDependency to be installed
  (`pnpm install --ignore-workspace` in
  `packages/rcf-lite/test/fixtures/cf-platform`). Without it the
  probe returns `warn` with a documented gap; the shipped
  `src/scheduled.mjs` is still exercised end to end by the
  in-process dispatcher probes.
- **`AC-32107-1` (real-account live-cron smoke)** requires a live
  Cloudflare account with a deployed Worker running a per-minute
  cron plus the paired `CI_HAS_CLOUDFLARE_ACCOUNT=true`,
  `CF_ACCOUNT_ID`, `CF_WORKER_NAME` and `CF_API_TOKEN` env vars.
  Without them the probe records `accountBoundSkipped: true` and
  aggregates to `pass` per spec section 3.5. Full mechanism reach
  requires a CI environment with those env vars set and a Worker
  already deployed.
- **The dispatcher does NOT terminate a handler on soft-budget
  breach.** Termination is Cloudflare's platform-level concern
  per https://developers.cloudflare.com/workers/platform/limits/.
  A project that needs hard termination on a stalled fire builds
  it inside the handler code path against `AbortController`; the
  dispatcher's role stops at the `cronStalled` event.
- **The dispatcher matches by exact string equality on the cron
  expression.** Wildcarded expression sets or expression-family
  routing (a single handler for every `*/5 * * * *`-like schedule)
  are not shipped. A follow-up minor could add a matcher-shape
  dispatch mode; today the elicited expression list is a
  one-to-one mapping.
