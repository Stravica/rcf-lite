# cf-platform sample-app fixture

Shared fixture for the round 6 Cloudflare blueprint train. T-0 mints
it; T-1 (KV) extends it with the KV binding and the facade modules;
T-2 (cron), T-3 (Durable Objects) and T-5's Turnstile sub-fixture
extend it later. The fixture ships a minimal Workers project that
applies the `deploy-cloudflare-workers` v1.2.0 blueprint in its
ratified Workers-with-static-assets shape.

## Layout

- `wrangler.toml` declares the Worker entry, the Cloudflare
  compatibility date, the `[assets]` block, and the T-1
  `[[kv_namespaces]]` binding block (name `CACHE`, placeholder
  ids the fixture never talks to a real namespace with). The T-0
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

The switches never mutate the base wrangler.toml or the shipped
modules; each probe cleans up its state on exit.

## Chain-slice pointers

- The T-0 anatomy test at `packages/rcf-lite/test/blueprint/deploy-
cloudflare-workers-v-1-2-0-anatomy.test.js` binds `TS-073`,
`TS-074`, `TS-075` to the T-0 fixture files.
- The T-1 anatomy test at `packages/rcf-lite/test/blueprint/platform-
cloudflare-kv-anatomy.test.js` binds `TS-076` through `TS-083` to
the T-1 fixture files and probe modules.
