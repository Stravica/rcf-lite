# platform-cloudflare-durable-objects guide

## When to reach for this blueprint

You reach for `platform-cloudflare-durable-objects` when your
Worker needs strongly consistent authoritative state, coordinated
multiplayer websocket connections, or both on the same DO namespace
mechanic. Two shapes ship in one blueprint: the single-cell shape
(counter, session store, lock, coordinator) and the WEBSOCKET-HUB
shape (rooms, presence, live cursors).

If you need eventually-consistent low-latency reads on a read-hot
path (feature flags, session cache, config cache), reach for
`platform-cloudflare-kv` instead. If you need
durable multi-step workflows with retries and state across steps,
reach for the follow-up Workflows adapter on `jobs-background`
v1.1.0.

## Decision tree

- Strongly consistent authoritative cell (counter, session store,
  lock, coordinator) -> single-cell shape (this blueprint,
  `platform-cloudflare-durable-objects` v1.0.0).
- Coordinated multiplayer websocket connections in one authoritative
  hub (rooms, live cursors, presence) -> WEBSOCKET-HUB shape (this
  blueprint, same v1.0.0).
- Cache-shaped eventually-consistent reads -> `platform-cloudflare-kv`
  v1.0.0.
- Durable multi-step workflow -> follow-up Workflows adapter on
  `jobs-background` v1.1.0.
- Not on Cloudflare Workers -> reach for a platform-native
  strongly-consistent adapter when one ships; the shelf has no
  non-Cloudflare strong-consistency cell blueprint today.

## The apply-time answers

Answer seven elicits at `rcf define blueprint add` time:

- `do-cell-binding` (default `CELL`): the DO namespace binding name
  under `[[durable_objects.bindings]]` in wrangler.toml for the
  single-cell shape.
- `do-hub-binding` (default `HUB`): the DO namespace binding name
  for the hub shape.
- `do-cell-class-name` (default `SingleCellObject`): the stable class
  name string committed under the mint `[[migrations]]` tag. A
  future rename lands as a subsequent migrations tag, not a silent
  edit.
- `do-hub-class-name` (default `HubObject`): the stable class name
  string for the hub class.
- `do-storage-backend` (default `sql` per ADR-3403): SQL (typed
  columns, query) or KV (simple `put`/`get`/`delete`/`list`).
- `do-hub-broadcast-window-ms` (default `500`): the elicited window
  for broadcast fan-out from A to all connected sockets.
- `do-hub-hibernate-after-idle-ms` (default `30000` per ADR-3405):
  the hibernate-after-idle window on the hub shape. The wake
  handler is idempotent-by-contract per the same ADR.

## The two shapes: single-cell first

The single-cell shape is one named object exposing typed domain
verbs. Cloudflare's DO runtime serialises invocations against the
same instance; the shipped SingleCellObject class realises that
contract via a per-instance FIFO promise queue so two concurrent
callers cannot silently overwrite each other. Each increment
resolves with a `{counter, witness}` pair: the FIFO-first caller
sees `witness=0`, the second sees `witness=1`, and a subsequent
read returns the sum.

Storage is elicited (`sql` or `kv` per ADR-3403). The shipped
driver factory is backend-agnostic and threads through the elicited
answer as `driver.backend`. SQL supports typed columns and query;
KV is simpler and single-key. Pick SQL when your object has a
non-trivial data shape; pick KV when a single key is all you need.

Alarm is a first-class surface. `setAlarm(offsetMs)` persists a
schedule; the `alarm()` handler runs at that time, drains the
persisted alarm from storage, and emits `doAlarmFired` on the
injected sink with `{objectName, scheduledTime}`. Cloudflare's
runtime guarantees exactly-once delivery per scheduled time; a
second call to `alarm()` on the drained storage records
`scheduledTime: null` rather than re-firing for the same schedule.

## The two shapes: websocket hub

The hub shape is one named object accepting websocket clients via
`state.acceptWebSocket`. Messages route by JSON `type` field:
`broadcast` fans out to all connected sockets (echo included, per
the hub shape trade-off), `set-state` and `get-state` wrap the
underlying storage.

Every broadcast persists `lastBroadcast` to storage so a re-emerging
client can catch up on the missed message. When the object goes
idle past the elicited `hibernate-after-idle` window, Cloudflare's
runtime hibernates the object; on the next message the wake handler
runs from a cold start and reads the same storage. The shipped
HubObject class emits `doWakeUp` exactly once on the first wake
(idempotent-by-contract per ADR-3405) and returns the persisted
`lastBroadcast` from storage so a downstream client can rebuild
state.

The elicited `do-hub-broadcast-window-ms` (default `500`) is the
window in which A's broadcast reaches every connected socket on
the shipped path. A tighter window is fine on a small hub; a
looser window trades latency for fan-out cost on a busy hub.

## The migration-safe class-export contract

The DO class names are stable strings committed to `wrangler.toml`.
Both binding blocks name the class explicitly; the `[[migrations]]`
block records the mint under `tag = "v1"` with `new_sqlite_classes` naming
both classes. A copy-paste block for a fresh Worker project:

```
[[durable_objects.bindings]]
name = "CELL"
class_name = "SingleCellObject"

[[durable_objects.bindings]]
name = "HUB"
class_name = "HubObject"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["SingleCellObject", "HubObject"]
```

A rename in a later release ships as a NEW `[[migrations]]` tag on
the same list (`tag = "v2"`, `renamed_classes = [...]`), never a
silent edit of the class name. A rename without a migration is a
runtime error the shipped anatomy assertion catches at self-review.

## The sole-reader guarantee

The DO facade module (`src/do-facade.mjs`) is the ONLY module in
the applied source tree that dereferences `env.CELL` and `env.HUB`.
Every consumer of DO calls the facade's typed handles; a call site
outside the facade is a leak the sole-reader-scan probe surfaces
at self-review.

The probe walks every `.mjs`, `.js` and `.ts` file under the
applied source root, strips block and line comments (so a
documentation mention of `env.CELL` does not flag), and matches
literal accesses against the file path. A clean scan surfaces zero
non-facade leaks; a leak returns `aggregateVerdict: fail` and the
review does not ship until the leak is closed.

## Metadata-only lifecycle events

Every lifecycle event on the sink is a metadata-only record. The
allowed key set is `{event, key, size, ttl, timestamp, objectName,
scheduledTime}`; no message payloads, request bodies, headers,
cookies or PII cross the sink boundary. A logging companion
renders records directly without a per-blueprint scrub pass.

The event-secrecy assertion rides on the websocket-hub-broadcast
probe (the shipped path emits `doAccept`, `doHibernate`, `doWakeUp`
and the `namespaceReady` on the paired facade). Under
`SIMULATE_PII_LEAK=true` a wrapped sink forwards synthetic
body-bearing records; the probe surfaces the forbidden keys and
returns fail on the AC-33106-1 result.

## Composition

- Consumes `deploy-cloudflare-workers` v1.2.0. The DO bindings
  and migrations tag land in the same `wrangler.toml`.
- Companions `logging` and `errorHandling` supply the sink factory
  and the internal-error record factory.
- Complements `platform-cloudflare-kv`: DO owns the
  strong-consistency slot; KV owns the cache-shaped eventually-
  consistent slot. Both compose on the same Worker.
- A future non-Cloudflare adapter on `strongConsistencyCellContract`
  or `websocketHubContract` mints on demand; each contributes the
  same topic string with a different answer, forcing a DELIBERATE
  conflict the operator resolves via a project-level ADR.

## Real-account smoke

The `real-account-storage-smoke` probe opens the DO facade against
a real Cloudflare account with a real DO namespace when
`CI_HAS_CLOUDFLARE_ACCOUNT=true` (paired with `CF_ACCOUNT_ID`,
`CF_DO_NAMESPACE_ID` and `CF_API_TOKEN`); without the env var it
records `accountBoundSkipped: true`, aggregates to `pass`, and
exits 0 per spec section 3.5 (Clerk pattern).

## Wrangler-seam probe

The eighth probe, `wrangler-seam.mjs`, spawns `wrangler dev
--local` on the cf-platform fixture and drives the shipped DO
facade + SingleCellObject + HubObject code path against a real
workerd runtime:

- Two concurrent `POST /cell/<id>/increment` requests route
  through `src/index.mjs` -> `createDoFacade({env,
  eventSink}).cellFetch(<id>, request)` -> the shipped
  SingleCellObject class. The probe asserts per-instance
  serialisation (sorted counters equal `[1, 2]`, sorted
  witnesses equal `[0, 1]`; each request observed the other's
  write).
- One WebSocket upgrade against `/hub/<id>/connect` routes
  through the same facade to `env.HUB` and receives one
  broadcast frame from the HubObject fetch handler on connect
  (payload `hello-from-hub`).
- An additional `AC-33108-1` result on the same run greps the
  fixture `wrangler.toml` for both `[[durable_objects.bindings]]`
  binding pairs and the `[[migrations]]` `tag = "v1"` with
  `new_sqlite_classes`; the grep is deterministic and does not require
  wrangler.

Warn semantics per section 3.1 pass-with-skip: if the wrangler
devDependency is missing under the fixture's `node_modules`, or
if the CLI does not bind within the cap, the probe returns
`aggregateVerdict: warn` (never fail). A handler thrown at the
workerd boundary is a genuine `fail`.

The routing layer in `src/index.mjs` never dereferences
`env.CELL` or `env.HUB` directly; every DO call routes through
`createDoFacade({env, eventSink}).cellFetch` /
`.hubFetch` so the sole-reader guarantee still holds. The
sole-reader-scan probe covers the boundary.

## The v1.0.0 boundary: what defers to v1.1.0

Per spec section 5.3, the following items are OUT of v1.0.0 and
land as an additive v1.1.0 minor when at least one project needs
them:

- RPC-style class methods (per the DO RPC surface).
- Storage backups.
- Multi-object transactions across namespaces.

Do not extend the shipped code path to open any of these seams in
v1.0.0. A minor bump post-round lands the deferred items as an
additive contribution set without a fresh blueprint.

## References

- Cloudflare Durable Objects overview: https://developers.cloudflare.com/durable-objects/
