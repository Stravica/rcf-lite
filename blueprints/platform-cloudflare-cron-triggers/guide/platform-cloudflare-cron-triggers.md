# platform-cloudflare-cron-triggers guide

## When to reach for this blueprint

You reach for `platform-cloudflare-cron-triggers` when your Worker
needs to run scheduled work on a recurring cadence, the workload
is stateless per fire, and you are already on Cloudflare Workers.
The blueprint ships the scheduled() handler wiring, an
expression-routed dispatcher, a skew-tolerance classifier and a
soft-budget observer. Every fire emits a metadata-only lifecycle
event a logging companion renders directly.

If your scheduled work is stateful across fires (a workflow that
retries partial progress, a long-running fan-out with state per
step), reach for the follow-up Workflows adapter on
`jobs-background` v1.1.0 instead (round-6 minor bump, per spec
section 5.7). If your scheduled work is a background job produced
by a request handler (a queue push that runs later, not on a fixed
cadence), reach for `jobs-background` v1.0.0 directly.

## Decision tree

- Recurring cadence, stateless per fire, Cloudflare Workers ->
  this blueprint (Cron Triggers).
- Background job produced by a request, retried and observed ->
 `jobs-background` v1.0.0 over `messaging-queue-cloudflare`.
- Durable workflow with state across steps, retried per step ->
  follow-up Workflows adapter on `jobs-background` v1.1.0 (round-6
  minor bump).
- Not on Cloudflare Workers -> reach for a platform-native
  cron adapter when one ships; the shelf has no non-Cloudflare
  cron blueprint today.

## The apply-time answers

Answer four elicits at `rcf define blueprint add` time:

- `cron-expressions`: your cron cadences as a comma-separated
  list. Standard POSIX cron strings. Example: `* * * * *,*/5 * * * *`
  runs one handler every minute and a second handler every five
  minutes.
- `cron-dispatcher-mode`: `single-handler` when you elicited one
  expression and want every fire to run one handler;
 `expression-routed` when you elicited more than one expression
  and want the dispatcher to route by exact expression match. The
  recommended default follows your `cron-expressions` list: one
  entry -> `single-handler`; more than one -> `expression-routed`.
- `cron-skew-tolerance-seconds`: the drift window inside which a
  fire is `onTime` and outside which the dispatcher records
 `cronSkewed`. Default `30`, floor `5`, ceiling `300`.
- `cron-soft-budget-seconds`: the per-handler duration past which
  the dispatcher records `cronStalled`. Default `30`. The
  dispatcher never terminates the handler; termination is
  Cloudflare's platform-level concern per
  https://developers.cloudflare.com/workers/platform/limits/.

## The event shape

Every scheduled-side event on the sink carries only:

```
{ event, expression, scheduledTime, outcome, duration }
```

Plus optional numeric fields:

- `softBudgetMs` on `cronStalled` records
- `deltaMs` on `cronSkewed` records

The event-secrecy probe drives a spy handler that closes over a
PII fixture (`{userId, ssn}`) and asserts neither the closure nor
any PII substring survives the sink boundary. See
`contributions/probes/event-secrecy.mjs` for the two-layer assertion.

## Verifying at mechanism reach

The blueprint ships five Node-only probes under
`contributions/probes/`. Run them from the cf-platform fixture:

```
cd packages/rcf-lite/test/fixtures/cf-platform
pnpm install --ignore-workspace
node ../../../../../blueprints/platform-cloudflare-cron-triggers/contributions/probes/run-wrangler-test-scheduled.mjs
node ../../../../../blueprints/platform-cloudflare-cron-triggers/contributions/probes/run-dispatcher-routing.mjs
node ../../../../../blueprints/platform-cloudflare-cron-triggers/contributions/probes/run-skew-tolerance.mjs
node ../../../../../blueprints/platform-cloudflare-cron-triggers/contributions/probes/run-event-secrecy.mjs
```

Each writes a report under
`.rcf/reports/blueprints/platform-cloudflare-cron-triggers/<probe-name>.json`.
The real-account smoke:

```
node ../../../../../blueprints/platform-cloudflare-cron-triggers/contributions/probes/run-real-account-scheduled-smoke.mjs
```

Without `CI_HAS_CLOUDFLARE_ACCOUNT=true` and the paired env vars,
the probe records `accountBoundSkipped: true` and exits 0 per spec
section 3.5.

## Induced-failure switches

- `SIMULATE_PII_LEAK=true`: wraps the sink on the event-secrecy
  probe so it forwards the closure onto every record. The probe
  surfaces the forbidden keys and the PII substrings and returns
 `aggregateVerdict: fail`. Use this before shipping to confirm
  the whitelist assertion is teeth-bearing.
- `SIMULATE_SLOW_HANDLER=true`: extends the spy handler on the
  skew-tolerance probe past `softBudgetMs` on every dispatch so
  a reviewer can see `cronStalled` fires without editing the
  probe. The shipped path already exercises the soft-budget
  branch; the switch is a reviewer aid.

## References

- Cloudflare Cron Triggers documentation: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare Workers scheduled handler contract: https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/
- Cloudflare Workers platform limits: https://developers.cloudflare.com/workers/platform/limits/
- Wrangler `wrangler dev` documentation (carries the `--test-scheduled` flag under the `dev` command): https://developers.cloudflare.com/workers/wrangler/commands/
