# platform-cloudflare-durable-objects

A rcf-lite blueprint that ships a small, opinionated wiring over
Cloudflare Durable Objects. Two shapes ride in one blueprint: the
SINGLE-CELL shape (a named object as an authoritative counter,
session store or lock) and the WEBSOCKET-HUB shape (a named object
hosting many websocket clients with per-message routing and
hibernate-and-wake support). A facade module owns the DO namespace
bindings; typed domain verbs wrap the storage API; the alarm
surface and the hibernatable-WebSocket contract land under two
scope-global ADRs on new topics.

- Version: `1.0.0`
- Category: `platform`
- Capabilities: `["strongConsistencyCell", "hibernatableWebSocket"]`
- Suggested companions: `logging`, `errorHandling`

## When to reach for it

- Authoritative state on Cloudflare Workers (counter, session
  store, lock, coordinator) that needs strong-consistency writes:
  the single-cell shape.
- Coordinated multiplayer websocket connections in one authoritative
  hub (rooms, live cursors, presence): the hub shape.

The sibling `platform-cloudflare-kv` (round 6 T-1) is the shipped
answer for eventually-consistent low-latency reads. The guide's
decision tree pairs them.

## The two shapes: decision tree at the top

- Do you need a strongly consistent authoritative cell? Reach for
  the SINGLE-CELL shape.
- Do you need coordinated multiplayer websocket connections?
  Reach for the WEBSOCKET-HUB shape.
- Do you need cache-shaped read-hot reads with no strong-consistency
  contract? Reach for `platform-cloudflare-kv` instead.
- Do you need durable multi-step workflows with retries and state
  across steps? Reach for the round-6 Workflows adapter on
  `jobs-background` v1.1.0 instead.

## The eight REQs

| REQ | What |
| --- | --- |
| `platform-cloudflare-durable-objects-REQ-001` | The DO facade is the sole reader of `env.CELL` and `env.HUB` and opens on boot with `namespaceReady`. |
| `platform-cloudflare-durable-objects-REQ-002` | The single-cell shape exposes typed domain verbs (`increment`, `read`, `reset`) and serialises concurrent invocations per instance. |
| `platform-cloudflare-durable-objects-REQ-003` | The storage API provides typed `put`, `get`, `delete` and `list` on the object with an elicited backend (SQL or KV). |
| `platform-cloudflare-durable-objects-REQ-004` | The alarm surface fires `alarm()` exactly once per scheduled time and `doAlarmFired` carries `objectName` and `scheduledTime`. |
| `platform-cloudflare-durable-objects-REQ-005` | The hibernatable WebSocket hub accepts clients via `state.acceptWebSocket` and the wake handler runs from cold reading the same storage. |
| `platform-cloudflare-durable-objects-REQ-006` | Lifecycle events fire at namespace and object level with metadata-only payloads. |
| `platform-cloudflare-durable-objects-REQ-007` | The sole-reader guarantee is enforced by an AST scan; no non-facade module dereferences `env.CELL` or `env.HUB`. |
| `platform-cloudflare-durable-objects-REQ-008` | Migration-safe class exports: stable class names committed to wrangler config with a paired `[[migrations]]` block. |

## The wired shape

The DO facade is the ONE place `env.CELL` and `env.HUB` are read.
Typed handles wrap named instances of the SingleCellObject and
HubObject classes. The public surface is:

```
createDoFacade({ env, eventSink, clock? })
  -> { ready, cellHandle(name), hubHandle(name) }
```

For in-process probing (no wrangler dev), the in-process variant:

```
createDoFacadeInProcess({ singleCell, hub, eventSink, clock? })
  -> { ready, cell(name), hub(name), registerCell(i), registerHub(i) }
```

The two DO classes:

```
new SingleCellObject({ storage, eventSink, name, clock? })
  -> instance.increment(delta?) / read() / reset() / setAlarm(offsetMs) / alarm()

new HubObject({ state, storage, eventSink, name, hibernateAfterIdleMs?, clock? })
  -> instance.accept(ws) / webSocketMessage(ws, msg) / webSocketClose(ws)
     / hibernate() / wake()
```

## Elicited parameters

- `do-cell-binding` (default `CELL`): the DO namespace binding name
  for the single-cell shape.
- `do-hub-binding` (default `HUB`): the DO namespace binding name
  for the hub shape.
- `do-cell-class-name` (default `SingleCellObject`): the stable class
  name string for the single-cell class.
- `do-hub-class-name` (default `HubObject`): the stable class name
  string for the hub class.
- `do-storage-backend` (default `sql`, per ADR-3403): SQL (typed
  columns, query) or KV (simple put/get/delete/list).
- `do-hub-broadcast-window-ms` (default `500`): the elicited window
  for broadcast fan-out.
- `do-hub-hibernate-after-idle-ms` (default `30000`, per ADR-3405):
  the hibernate-after-idle window on the hub shape. The wake
  handler is idempotent-by-contract per the same ADR.

## The eight probes

The eight probes live under `contributions/probes/`. Each has a
matching `run-<probe-name>.mjs` shim that writes a per-blueprint
report to `.rcf/reports/blueprints/platform-cloudflare-durable-objects/<probe-name>.json`
under the fixture root.

| Probe | anchorAcId | accountBound | What it covers |
| --- | --- | --- | --- |
| `namespace-facade-ready.mjs` | `AC-33101-1` | false | Facade opens; `namespaceReady` fires with allowed keys; `cell(name)` and `hub(name)` return the registered instances. |
| `single-cell-concurrent-increment.mjs` | `AC-33102-1` | false | Two concurrent increments serialise FIFO; counters `[1,2]`, witnesses `[0,1]`, final read `2`. Also covers `AC-33109-1` (witness field). |
| `storage-round-trip.mjs` | `AC-33103-1` | false | `put`, `get`, `delete`, `list` on both `sql` and `kv` backends; `driver.backend` reports the elicited answer. Also covers `AC-33111-1`. |
| `alarm-fires-once.mjs` | `AC-33104-1` | false | `alarm()` fires once; `doAlarmFired` carries `objectName` and `scheduledTime`; drained storage does not re-fire. |
| `websocket-hub-broadcast.mjs` | `AC-33105-1` | false | Broadcast from A reaches A and B within 500 ms; storage persists `lastBroadcast`. Also covers `AC-33110-1` (hibernate-and-wake) and `AC-33106-1` (event-secrecy on the shipped path). |
| `sole-reader-scan.mjs` | `AC-33107-1` | false | Every `.mjs`/`.js`/`.ts` file under the fixture applied source root is scanned; only `src/do-facade.mjs` may dereference `env.CELL` or `env.HUB` in live source. |
| `real-account-storage-smoke.mjs` | `AC-33112-1` | true | Facade round-trip against a real Cloudflare DO namespace when `CI_HAS_CLOUDFLARE_ACCOUNT=true`; otherwise records `accountBoundSkipped` and passes per spec section 3.5. |
| `wrangler-seam.mjs` | `AC-33113-1` | false | Spawns `wrangler dev --local` on the fixture and drives two concurrent `POST /cell/<id>/increment` requests through the DO facade against `env.CELL`, asserting per-instance serialisation (counters `[1, 2]`, witnesses `[0, 1]`); opens one WebSocket upgrade against `/hub/<id>/connect` through the facade against `env.HUB`, asserting one broadcast frame arrives on connect. Also carries an additional `AC-33108-1` result that greps `wrangler.toml` for both binding pairs and the migrations tag/new_sqlite_classes. Warn semantics per section 3.1 pass-with-skip if wrangler is not installed or fails to bind. |

## Two-line gate-reviewer boot

```
cd packages/rcf-lite/test/fixtures/cf-platform
pnpm install --ignore-workspace
node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-namespace-facade-ready.mjs
node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-single-cell-concurrent-increment.mjs
node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-storage-round-trip.mjs
node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-alarm-fires-once.mjs
node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-websocket-hub-broadcast.mjs
node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-sole-reader-scan.mjs
node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-real-account-storage-smoke.mjs
node ../../../../../blueprints/platform-cloudflare-durable-objects/contributions/probes/run-wrangler-seam.mjs
```

Each returns exit 0 with `aggregateVerdict: pass`. The seventh
records `accountBoundSkipped: true` without the CI env var per
spec section 3.5.

The wrangler-dev boot (documented in the fixture README
under the T-3 sections) is required for the eighth probe
(`wrangler-seam.mjs`), which spawns `wrangler dev --local` on
the fixture to drive the shipped DO facade + SingleCellObject +
HubObject code path against a real workerd runtime. The six
local probes drive the shipped code path in-process against the
in-memory DO storage driver and a fake WebSocket state; a
real-account round-trip lives on the `real-account-storage-smoke`
probe and is skipped by default per the Clerk pattern. Prepare
the fixture once with `pnpm install --ignore-workspace`; the
wrangler-seam probe returns warn per spec section 3.1 pass-with-skip
if the CLI is missing or fails to bind within the cap.

## The v1.0.0 boundary

The v1.0.0 mint keeps a single build worker inside its context
budget for an L blueprint. The following items DEFER to the v1.1.0
minor bump per spec section 5.3 and land as an additive minor once
at least one project needs them:

- RPC-style class methods (per the DO RPC surface).
- Storage backups.
- Multi-object transactions across namespaces.

The v1.0.0 shipped code path does not open any of these seams; a
future v1.1.0 grows the mechanism inside the same blueprint.

## Companion pairing

- `logging`: every lifecycle event on the sink writes through the
  applied logger; a logging companion supplies the sink factory.
- `errorHandling`: a namespace binding miss, an alarm handler
  throwing, a hub broadcast failure constructs an internal error
  record; an error-handling companion supplies the record factory
  and the boundary.

## Cross-reference to `platform-cloudflare-kv`

If your project needs eventually-consistent low-latency reads on
a read-hot path (feature flags, session cache, config cache),
reach for `platform-cloudflare-kv` (round 6 T-1) instead. Durable
Objects owns the strong-consistency slot on the shelf; KV owns
the cache-shaped eventually-consistent slot. Both compose on the
same Worker.

## The two mint topics

- `strongConsistencyCellContract` (ADR-3401): the shipped shape is
  a Cloudflare Durable Object named instance. A future non-Cloudflare
  sibling (Postgres advisory-lock singleton, Redis single-master)
  conflicts on this topic.
- `websocketHubContract` (ADR-3402): the shipped shape is a
  Cloudflare Durable Object hub instance with hibernatable
  WebSockets. A future non-Cloudflare hub sibling conflicts on
  this topic.

Both topics are `scope: global` on the ADR contribution entries in
`blueprint.json`; the round-2 conflict pattern applies.

## References

- Cloudflare Durable Objects overview: https://developers.cloudflare.com/durable-objects/
