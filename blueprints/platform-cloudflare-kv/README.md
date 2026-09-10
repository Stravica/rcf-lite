# platform-cloudflare-kv

A rcf-lite blueprint that ships a small, opinionated facade over
Cloudflare Workers KV plus a cache-aside helper. One module holds the
KV binding; every other module reads through typed domain verbs; every
KV operation emits a metadata-only lifecycle event a logging companion
can render without ever writing a body byte.

- Version: `1.0.0`
- Category: `platform`
- Capabilities: `["keyValueStore"]`
- Suggested companions: `logging`, `errorHandling`

## What it gives you

- One place that reads `env.<binding>` (the KV binding) and exports
  typed verbs (`get`, `getWithMetadata`, `put`, `delete`, `list`).
- A cache-aside helper (`getOr(key, originFn, {ttl?})`) that reads
  local first, invokes origin on miss, writes back with the elicited
  TTL, and returns the fresh value.
- Four metadata-only lifecycle events (`facadeReady`, `kvHit`,
 `kvMiss`, `kvWrite`) with payload `{event, key, size, ttl,
  timestamp}` and nothing else. Two-layer secrecy assertion in the
  event-secrecy probe.
- A decision-tree cross-reference in the guide to
 `platform-cloudflare-durable-objects` (round-6) for cases that
  need strong-consistency semantics.

## The five REQs

| REQ | What |
| --- | --- |
| `platform-cloudflare-kv-REQ-001` | The facade module is the sole reader of the KV binding and opens on boot with `facadeReady`. |
| `platform-cloudflare-kv-REQ-002` | Typed `put get delete list` verbs with the metadata field pattern realise the Workers KV binding shape behind the facade. |
| `platform-cloudflare-kv-REQ-003` | The cache-aside helper reads local first, falls back to origin, writes back with elicited TTL (floor 1 second). |
| `platform-cloudflare-kv-REQ-004` | Lifecycle events carry only `{event, key, size, ttl, timestamp}`; the event-secrecy probe drives this at mechanism reach. |
| `platform-cloudflare-kv-REQ-005` | Eventual-consistency note in the guide: a write may not appear on a global read within the same request; the elicited TTL sets the staleness ceiling. |

## The two-path facade shape

The facade is the ONE place the KV binding lives. Every other module
imports the facade and calls its typed verbs. The public surface is:

```
createKvFacade({ binding, eventSink, keyPrefix?, defaultCacheTtl? })
  -> { ready, get, getWithMetadata, put, delete, list }
```

The cache-aside helper wraps the facade:

```
createCacheAside({ facade, defaultTtl })
  -> { getOr(key, originFn, {ttl?}) }
```

## Elicited parameters

- `kv-binding-name` (default `CACHE`): the KV namespace binding name
  written into `wrangler.toml` under `[[kv_namespaces]]`.
- `kv-default-cache-ttl-seconds` (default `60`, floor `1`): the
  cache-aside default TTL. The cache-aside helper enforces the floor
  at its own seam per `ADR-3202`.
- `kv-metadata-field-pattern` (default `{"v":1}`): the recommended
  per-key metadata shape for a schema version marker.
- `kv-key-naming-convention` (default `prefixed`): whether the applied
  project uses a domain prefix on keys (`users/`, `flags/`) or a flat
  keyspace. See `ADR-3203`.

## The five probes

The five probes live under `contributions/probes/`. Each has a
matching `run-<probe-name>.mjs` shim that writes a per-blueprint
report to
`.rcf/reports/blueprints/platform-cloudflare-kv/<probe-name>.json`
under the fixture root.

| Probe | Anchor AC | Account-bound | What it drives |
| --- | --- | --- | --- |
| `facade-round-trip.mjs` | `AC-31103-1` | no | Opens the facade against the in-memory KV driver, puts a fixture key, reads it back, deletes it, asserts the paired lifecycle events. Also covers `AC-31103-2` and `AC-31104-1`. |
| `cache-aside-hit-then-miss.mjs` | `AC-31105-1` | no | Wraps a spy origin function with the cache-aside helper, drives one call within TTL (hit, no origin call), advances the fake clock past TTL, drives another call (miss, second origin call). |
| `event-secrecy.mjs` | `AC-31108-1` | no | Two-layer assertion: whitelist check on every event record and PII-substring scan on the JSON serialisation. A mutation-run under `SIMULATE_PII_LEAK` flips the probe to fail. |
| `list-with-prefix.mjs` | `AC-31104-1` | no | Puts 10 keys under `flags/` plus one decoy outside the prefix, calls `list({prefix: flags/})`, asserts all 10 return with correct metadata shape and the decoy is absent. |
| `real-account-eventual-consistency-smoke.mjs` | `AC-31108-1` | yes | Self-provisioning: the fixture shim (`packages/rcf-lite/test/fixtures/cf-platform/h2-cf-kv-real-account-shim.mjs`) mints a scratch KV namespace under the throwaway prefix `h2-cf-probe-integrity-scratch-kv-`, writes a fixture key under the `h2-storage-smoke-` prefix, polls up to 60 seconds bounded for same-region visibility, deletes the key, and destroys the namespace on exit. Positive evidence captured: namespace id, exact scratch title, key, PUT / GET / DELETE status codes, elapsed ms. Idempotent prefix-sweep entry point (`sweepOrphans`) filters over the account by the frozen throwaway prefix and deletes each match by exact id and exact name; the sweep is structurally unable to select a non-prefixed name, paginates KV namespaces to completion, and is exercised by the fixture's sweep-safety test against the ten live production script names on the operator account plus a 250-per-type multi-page cover. Without `CI_HAS_CLOUDFLARE_ACCOUNT` records `accountBoundSkipped: true` and aggregates `pass` per spec section 3.5. **The local proof exercises OUR lifecycle logic against a mock of Cloudflare's contract; the real-account gate is the only surface that proves the wire format.** |

## How to run the probes

Two-line boot from the `cf-platform` sample-app fixture:

```
cd packages/rcf-lite/test/fixtures/cf-platform
node ../../../../../blueprints/platform-cloudflare-kv/contributions/probes/run-facade-round-trip.mjs
```

The other three local probes follow the same pattern. Reports land
in `.rcf/reports/blueprints/platform-cloudflare-kv/`.

Induced-failure switches:

- `SIMULATE_PII_LEAK=true` on the `event-secrecy` shim: forwards a
  body-bearing event record; the probe surfaces `forbiddenKeys` and
 `piiHits` and returns `aggregateVerdict: fail`.
- `SIMULATE_CACHE_MISS=true` on the `cache-aside-hit-then-miss`
  shim: disables the writeback path; the probe surfaces two origin
  calls where one was expected and returns `aggregateVerdict: fail`.

The real-account smoke needs `CI_HAS_CLOUDFLARE_ACCOUNT=true` plus
the paired `CF_ACCOUNT_ID` and `CF_API_TOKEN` env vars. The fixture
mints its own throwaway KV namespace under the throwaway prefix; no
pre-provisioned namespace is required (the earlier `CF_KV_NAMESPACE_ID`
gate is removed as of v1.1.0). A test
override `CF_API_BASE_URL` points the shim at a local mock CF REST
API for local proof; the mock and its test lives under
`packages/rcf-lite/test/fixtures/cf-platform/test/`.

## Known mechanism-reach gaps

- The four local probes drive an in-memory KV driver whose binding
  shape matches Workers KV at the facade boundary. Vendor surface
  changes beyond that boundary (a new list cursor format, a
  header-only per-request limit) are not caught by the local probes.
  The `real-account-eventual-consistency-smoke` probe is the
  mechanism-reach closure for that gap; in CI without the account,
  the aggregate flips to `pass` with `accountBoundSkipped: true` per
  spec section 3.5. Full mechanism reach requires a CI environment
  with the paired env vars set.
- The elicited `kv-metadata-field-pattern` fires unconditionally
  rather than gating on an `elicitedNonEmpty` predicate for
 `kv-binding-name`; the loader's `validateElicits` accepts only
 `requiresCapability` on the `when` block today. The guide teaches
  the pattern; a loader-capability uplift extending
 `validateElicits` to accept an `elicitedNonEmpty` predicate is
  captured as follow-up work item
  a follow-up capability change (0.26.x) is out of scope for this 0.25.x patch.

## Companion suggestions

- `logging` supplies the event-sink factory the facade uses to emit
 `facadeReady`, `kvHit`, `kvMiss`, `kvWrite`. Without a logging
  companion, the sink is a no-op and the lifecycle events do not
  render anywhere.
- `errorHandling` supplies the internal error record factory for a
  KV read or write failure boundary; a project without an
  error-handling companion sees a raw `Error` propagate to the
  Worker fetch handler.

## Standards trace

- ADR-3201 (scope-global on `keyValueStoreContract`) carries
 `standardsTraceClause: Cloudflare Workers KV documented
  consistency model` and cites
  <https://developers.cloudflare.com/kv/concepts/how-kv-works/>.
- ADR-3202 (default cache-aside TTL) carries
 `standardsTraceClause: generic enterprise practice` and cites the
  Cloudflare-documented 60-second cache TTL at
  <https://developers.cloudflare.com/kv/concepts/how-kv-works/>.
- ADR-3203 (key naming convention) carries
 `standardsTraceClause: generic enterprise practice`.

## Chain-slice pointers

The anatomy test at
`packages/rcf-lite/test/blueprint/platform-cloudflare-kv-anatomy.test.js`
binds every AC on the shipped kv user stories `US-31101..US-31108`
(`AC-31101-1`, `AC-31102-1`, `AC-31103-1`, `AC-31103-2`,
`AC-31104-1`, `AC-31105-1`, `AC-31106-1`, `AC-31107-1`,
`AC-31108-1`) to a test case in that file with a resolvable
`testPointer`, and to the union of the five contributed probe
result records. The five probes carry the following anchors: the
facade-round-trip probe holds `AC-31103-1` as primary and adds
`AC-31101-1` (facadeReady), `AC-31103-2` (delete then kvMiss),
`AC-31104-1` (list-with-prefix compact case) and `AC-31102-1`
(sole-reader env.CACHE grep) as additional results; the
list-with-prefix probe holds `AC-31104-1`; the
cache-aside-hit-then-miss probe holds `AC-31105-1` and
`AC-31106-1`; the event-secrecy probe holds `AC-31108-1` and
`AC-31107-1` (whitelist scan); the real-account-eventual-
consistency smoke re-covers `AC-31103-1` on a real Cloudflare KV
namespace. The blueprint contribution IDs are namespaced
`platform-cloudflare-kv-REQ-001..005` and
`platform-cloudflare-kv-US-31101..31108` per the shelf-wide
id-band registry. The prior chain-slice pointer
paragraph cited a defunct earlier id band that never became chain
rows on this repo; that citation was removed in the probe-integrity pass
(2026-09-08 relay 582c2bca): the earlier band was not resurrected
and every kv probe result now cites the shipped `AC-31xxx` band.
