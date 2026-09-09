# cf-platform sample-app fixture

Shared fixture for the round 6 Cloudflare blueprint train. T-0 mints
it; T-1 (KV) extends it with the KV binding and the facade modules;
T-2 (cron) extends it with the [triggers] crons block, the
sole-reader scheduled handler and the expression-routed
dispatcher; T-3 (Durable Objects) and T-5's Turnstile sub-fixture
extend it later. The fixture ships a minimal Workers project that
applies the `deploy-cloudflare-workers` v1.2.0 blueprint in its
ratified Workers-with-static-assets shape.

## Layout

- `wrangler.toml` declares the Worker entry, the Cloudflare
  compatibility date, the `[assets]` block, the T-1
  `[[kv_namespaces]]` binding block (name `CACHE`, placeholder
  ids the fixture never talks to a real namespace with) and the
  T-2 `[triggers] crons` block with two expressions (`* * * * *`
  and `*/5 * * * *`) exercising the expression-router. The T-0
  elicited answers are baked in verbatim:
    - `assets-directory = "./dist"` (Workers-with-static-assets
      shape, per T-0 REQ-013)
    - `run_worker_first = true` (SPA fallback discipline, per
      T-0 REQ-014)
- `dist/index.html` is the single static asset the Cloudflare
  runtime serves at the edge.
- `src/index.mjs` is the minimal Worker fetch handler; `wrangler
  dev` boots it at whatever port wrangler picks (the fixture does
  NOT bind port 4200). The Worker exposes a `/kv/<key>` round-trip
  path via the facade (T-1).
- `src/kv-facade.mjs` is the T-1 KV facade module. It is the SOLE
  reader of the `env.CACHE` binding per T-1 REQ-001; every other
  path calls the facade's typed verbs (`get`, `getWithMetadata`,
  `put`, `delete`, `list`). Emits lifecycle events (`facadeReady`,
  `kvHit`, `kvMiss`, `kvWrite`) whose payload is metadata-only
  (`{key, size, ttl, timestamp}`) per T-1 REQ-004.
- `src/cache-aside.mjs` is the T-1 cache-aside helper per T-1
  REQ-003. Wraps a domain-origin call with a facade read: on hit,
  returns the cached value; on miss, invokes the origin and
  writes back with the elicited TTL. TTL floor is 1 second per
  ADR-3202.
- `src/kv-driver.mjs` is an in-memory KV driver realising the
  Cloudflare Workers KV binding shape (`get`, `getWithMetadata`,
  `put`, `delete`, `list`). The four local probes drive the
  facade against this driver so the shelf gains no wrangler-dev
  or miniflare-workerd runtime dependency (per the shelf norm,
  aligned with the T-3 messaging-queue-cloudflare in-memory
  driver).
- `src/scheduled.mjs` is the T-2 platform-cloudflare-cron-triggers
  scheduled() handler. It is the SOLE reader of the Cloudflare
  Workers Cron Trigger event per T-2 REQ-001; every other module
  imports the exported `createScheduledHandler` factory instead
  of touching the raw event. On boot it wires the dispatcher and
  emits `cronReady`; on every scheduled invocation it delegates
  to `dispatcher.dispatch` with `ctx.waitUntil` so `cronStalled`
  and `cronFired` both land on the sink before the Worker
  context tears down. The scheduled handler does NOT dereference
  `env.CACHE`; the T-1 KV facade retains sole-reader ownership
  of the KV binding.
- `src/dispatcher.mjs` is the T-2 expression-routed dispatcher
  per T-2 REQ-002. It matches the incoming Cron Trigger event's
  cron expression against `routes[].expression` by exact string
  equality, applies the elicited skew-tolerance window (T-2
  REQ-003) and soft budget (T-2 REQ-004), and delegates to the
  routed handler with a bounded context. Emits `cronReady`,
  `cronFired`, `cronSkewed`, `cronStalled`, `cronUnmatched` on
  the injected sink; every payload is metadata-only per T-2
  REQ-004.
- `package.json` declares `wrangler` as a devDependency with the
  pinned major version; `pnpm start` runs `wrangler dev`. The
  five probe scripts are exposed as `kv-probe-*`.
- `run-assets-manifest-scan.mjs` is the run-shim for the T-0
  `assets-manifest-scan.mjs` probe module.

## Manual boot line

```
cd packages/rcf-lite/test/fixtures/cf-platform
pnpm install
pnpm start
```

`wrangler dev` picks its own port and prints the local URL; the
fixture never binds 4200 (Dave's workspace server owns that port).

## Two-line gate-reviewer boot for the T-0 probe

```
cd packages/rcf-lite/test/fixtures/cf-platform
node ./run-assets-manifest-scan.mjs
```

Expected: exit 0 with `aggregateVerdict: pass` and a detail record
naming `directory: "./dist"` and `run_worker_first: true`.

## Two-line gate-reviewer boot for the four T-1 local probes

```
cd packages/rcf-lite/test/fixtures/cf-platform
node ../../../../../blueprints/platform-cloudflare-kv/contributions/probes/run-facade-round-trip.mjs
node ../../../../../blueprints/platform-cloudflare-kv/contributions/probes/run-cache-aside-hit-then-miss.mjs
node ../../../../../blueprints/platform-cloudflare-kv/contributions/probes/run-event-secrecy.mjs
node ../../../../../blueprints/platform-cloudflare-kv/contributions/probes/run-list-with-prefix.mjs
```

## Two-line gate-reviewer boot for the T-2 local probes

```
cd packages/rcf-lite/test/fixtures/cf-platform
pnpm install --ignore-workspace
node ../../../../../blueprints/platform-cloudflare-cron-triggers/contributions/probes/run-wrangler-test-scheduled.mjs
node ../../../../../blueprints/platform-cloudflare-cron-triggers/contributions/probes/run-dispatcher-routing.mjs
node ../../../../../blueprints/platform-cloudflare-cron-triggers/contributions/probes/run-skew-tolerance.mjs
node ../../../../../blueprints/platform-cloudflare-cron-triggers/contributions/probes/run-event-secrecy.mjs
```

Each returns exit 0 with `aggregateVerdict: pass`. The reports
land at `.rcf/reports/blueprints/platform-cloudflare-cron-triggers/<probe-name>.json`
under the fixture root. The wrangler-test-scheduled probe requires
the fixture's `wrangler` devDependency (`pnpm install
--ignore-workspace`); without it the probe returns
`aggregateVerdict: warn` per spec section 3.1 pass-with-skip.

The T-2 real-account smoke:

```
cd packages/rcf-lite/test/fixtures/cf-platform
node ../../../../../blueprints/platform-cloudflare-cron-triggers/contributions/probes/run-real-account-scheduled-smoke.mjs
```

Without `CI_HAS_CLOUDFLARE_ACCOUNT=true` (and `CF_ACCOUNT_ID`,
`CF_WORKER_NAME`, `CF_API_TOKEN`) the probe records
`accountBoundSkipped: true`, aggregates to `pass`, and exits 0
per spec section 3.5.

Each returns exit 0 with `aggregateVerdict: pass`. The reports land
at `.rcf/reports/blueprints/platform-cloudflare-kv/<probe-name>.json`
under the fixture root.

The real-account smoke:

```
cd packages/rcf-lite/test/fixtures/cf-platform
node ../../../../../blueprints/platform-cloudflare-kv/contributions/probes/run-real-account-eventual-consistency-smoke.mjs
```

Without `CI_HAS_CLOUDFLARE_ACCOUNT=true` (and `CF_ACCOUNT_ID`,
`CF_KV_NAMESPACE_ID`, `CF_API_TOKEN`) the probe records
`accountBoundSkipped: true`, aggregates to `pass`, and exits 0 per
spec section 3.5.

The sweep-safety test carries a live-inventory variant alongside
its mock-only variants:

```
node --test packages/rcf-lite/test/fixtures/cf-platform/test/h2-cf-sweep-safety.test.mjs
```

Without `CI_HAS_CLOUDFLARE_ACCOUNT=true` (and `CF_ACCOUNT_ID`,
`CF_API_TOKEN`) the live-inventory subtest records
`accountBoundSkipped: true` naming the required env var and passes;
the mock-only variants still run unconditionally. With the env set,
the variant reads the account's Workers, KV namespaces and Queues
via the paginated listers and runs the shims' pure
`selectSweepCandidates` / `selectWorkerSweepCandidates` /
`selectQueueSweepCandidates` / `selectTelemetryKvSweepCandidates`
selection functions over the live listings, asserting each selects
zero. No delete path is exercised.

## Induced-failure switches

T-0 (assets-manifest-scan):

- `SIMULATE_MIXED_SHAPE=true node ./run-assets-manifest-scan.mjs`
  copies `wrangler.toml` into a scratch path with a
  `pages_build_output_dir` field appended; the probe returns
  `aggregateVerdict: fail`.
- `SIMULATE_EMPTY_ASSETS=true node ./run-assets-manifest-scan.mjs`
  copies `wrangler.toml` into a scratch path with the `[assets]`
  block removed; the probe records the bare-Worker shape and
  passes.

T-1 (platform-cloudflare-kv):

- `SIMULATE_PII_LEAK=true node ../../../../../blueprints/platform-cloudflare-kv/contributions/probes/run-event-secrecy.mjs`
  drives the event sink with a body-bearing event record; the
  event-secrecy probe surfaces the forbidden `body`, `ssn` and
  `userId` fields on the parsed record and returns
  `aggregateVerdict: fail`.
- `SIMULATE_CACHE_MISS=true node ../../../../../blueprints/platform-cloudflare-kv/contributions/probes/run-cache-aside-hit-then-miss.mjs`
  disables the cache-aside writeback path; the probe surfaces two
  origin calls where one was expected and returns
  `aggregateVerdict: fail`.

T-2 (platform-cloudflare-cron-triggers):

- `SIMULATE_PII_LEAK=true node ../../../../../blueprints/platform-cloudflare-cron-triggers/contributions/probes/run-event-secrecy.mjs`
  wraps the sink so it forwards a handler closure with a PII
  fixture body; the event-secrecy probe surfaces the forbidden
  `body`, `ssn` and `userId` fields on the parsed records and
  returns `aggregateVerdict: fail`.
- `SIMULATE_SLOW_HANDLER=true node ../../../../../blueprints/platform-cloudflare-cron-triggers/contributions/probes/run-skew-tolerance.mjs`
  extends the spy handler on the soft-budget probe run past
  `softBudgetMs` on every dispatch so a reviewer can see
  `cronStalled` fire without editing the probe. The shipped path
  already exercises the soft-budget branch; the switch is a
  reviewer aid, not a mutation gate.

The switches never mutate the base wrangler.toml or the shipped
modules; each probe cleans up its state on exit.

## Chain-slice pointers

- The T-0 anatomy test at `packages/rcf-lite/test/blueprint/deploy-
cloudflare-workers-v-1-2-0-anatomy.test.js` binds `TS-073`,
`TS-074`, `TS-075` to the T-0 fixture files.
- The T-1 anatomy test at `packages/rcf-lite/test/blueprint/platform-
cloudflare-kv-anatomy.test.js` binds `TS-076` through `TS-083` to
the T-1 fixture files and probe modules.
- The T-2 anatomy test at `packages/rcf-lite/test/blueprint/platform-
cloudflare-cron-triggers-anatomy.test.js` binds `TS-090` through
`TS-096` to the T-2 fixture files, the scheduled handler, the
dispatcher and the five probe modules.

## Two-line gate-reviewer boot for the seven T-3 in-process probes

```
cd packages/rcf-lite/test/fixtures/cf-platform
pnpm install --ignore-workspace
node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-namespace-facade-ready.mjs
node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-single-cell-concurrent-increment.mjs
node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-storage-round-trip.mjs
node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-alarm-fires-once.mjs
node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-websocket-hub-broadcast.mjs
node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-sole-reader-scan.mjs
```

Each returns exit 0 with `aggregateVerdict: pass`. The reports
land at `.rcf/reports/blueprints/platform-cloudflare-durable-objects/<probe-name>.json`
under the fixture root. The shipped probes drive the DO facade
and both DO classes in-process against the in-memory DO storage
driver (`src/do-storage.mjs`) and a fake websocket state pair; no
`wrangler dev` process is required for the six local probes.

The T-3 real-account smoke:

```
cd packages/rcf-lite/test/fixtures/cf-platform
node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-real-account-storage-smoke.mjs
```

Without `CI_HAS_CLOUDFLARE_ACCOUNT=true` (and `CF_ACCOUNT_ID`,
`CF_DO_NAMESPACE_ID`, `CF_API_TOKEN`) the probe records
`accountBoundSkipped: true`, aggregates to `pass`, and exits 0
per spec section 3.5.

## T-3 wrangler dev boot

The eighth T-3 probe (`wrangler-seam.mjs`) spawns `wrangler dev
--local` itself against the fixture; the six pre-wrangler local
probes drive the shipped DO facade + classes in-process against
the in-memory driver and a fake WebSocket state. To exercise the
DO bindings against a real wrangler runtime by hand, boot the
fixture in a separate shell:

```
cd packages/rcf-lite/test/fixtures/cf-platform
pnpm install --ignore-workspace
pnpm start
```

`wrangler dev` picks its own port (the fixture never binds 4200).
The `[[durable_objects.bindings]]` blocks resolve `env.CELL` to
`SingleCellObject` and `env.HUB` to `HubObject` as re-exported from
`src/index.mjs`. The paired `[[migrations]]` block records both
class names under `tag = "v1"` per REQ-077 and the Cloudflare
migration documentation.

## T-3 induced-failure switches

- `SIMULATE_NON_FACADE_IMPORT=true node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-sole-reader-scan.mjs`
  writes a synthetic scratch file at `$TMPDIR/t3-sole-reader-scratch-<pid>/leaky-consumer.mjs` that dereferences
  `env.CELL` and `env.HUB` outside the facade; the scan surfaces the
  leak and returns `aggregateVerdict: fail`. The scratch is removed
  on exit.
- `SIMULATE_HUB_HANG=true node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-websocket-hub-broadcast.mjs`
  wraps the broadcast handler with a 750 ms artificial delay past
  the 500 ms window; the probe surfaces the hang and returns
  `aggregateVerdict: fail` on the broadcast-within-window check.
- `SIMULATE_PII_LEAK=true node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-websocket-hub-broadcast.mjs`
  wraps the sink with a leaky variant that injects `body`, `ssn`
  and `userId` into every record; the event-secrecy result on the
  same probe surfaces the forbidden keys and returns fail on
  AC-33106-1.
- `SIMULATE_STORAGE_BACKEND_MISMATCH=true node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-storage-round-trip.mjs`
  passes an unrecognised backend answer; the shipped factory clamps
  it to `sql` per ADR-3403 recommendedDefault and the probe surfaces
  the observation as a fail so a reviewer can see the clamp.

The switches never mutate the base `wrangler.toml` or the shipped
modules; each probe cleans up its state on exit.

## Chain-slice pointers (T-3)

- The T-3 anatomy test at `packages/rcf-lite/test/blueprint/platform-cloudflare-durable-objects-anatomy.test.js` binds `TS-100` through `TS-109` to the T-3 fixture files, the DO facade, the SingleCellObject class, the HubObject class, the in-memory DO storage driver and the seven probe modules.

## Two-line gate-reviewer boot for the T-3 wrangler-seam probe

```
cd packages/rcf-lite/test/fixtures/cf-platform
pnpm install --ignore-workspace
node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-wrangler-seam.mjs
```

The probe spawns `wrangler dev --local --port 0` on the fixture,
waits bounded 45 seconds for the CLI to bind, then drives two
concurrent `POST /cell/<id>/increment` requests against
`env.CELL` via the DO facade and one WebSocket upgrade against
`/hub/<id>/connect` via `env.HUB` (also through the facade),
then kills wrangler on exit. Returns `aggregateVerdict: pass` on
the shipped path with three result rows (AC-33108-1 wrangler.toml
grep, AC-33113-1 serialisation observed under workerd, AC-33105-1
one WebSocket broadcast frame received on connect). Warn per
spec section 3.1 pass-with-skip if the wrangler devDependency is
missing or the CLI fails to bind; a handler thrown at the workerd
boundary is a genuine fail.
