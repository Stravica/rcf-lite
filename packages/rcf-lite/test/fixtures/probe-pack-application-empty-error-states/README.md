# probe-pack-application-empty-error-states fixture

Dependency-free sample app the `application-empty-error-states` probe pack drives on the shelf gate. Node HTTP server plus one HTML shell per named state, no framework. Serves the eight named empty and error states honestly on the default branch and exposes break switches so the pack's negative runs can be driven from a single boot.

## Env-var manifest (criterion-e probes read these)

Every environment variable the fixture or a `contributions/probes/` probe reads is declared here. A probe that short-circuits on an undeclared variable would prove nothing (rule 7d).

| Var | Purpose |
|---|---|
| `PORT` | default 3000; probe picks 47630-47639; 4200 is refused |
| `EMPTY_ERROR_STATES_BREAK` | optional default `?break=` switch across every request |

Every response emits an `x-fixture-request-id` HTTP header (a per-request UUID). The criterion-e probes echo this id back into their `.rcf/reports/` run records as positive evidence per rule 7d (a real request identifier answered by the fixture engine).

## Criterion-e probe pack

`blueprints/application-empty-error-states/contributions/probes/` boots this fixture on a scratch port in its declared family range and drives varied inputs (different query strings and env overlays) to derive DOM observables. Each probe result carries an `evidence` object with the fixture's request id, the HTTP status and a response-body excerpt. No account credentials are involved: this blueprint's deliverable is application code and the fixture built from its own contributions IS the engine (addendum rule 2).


## Boot

```
cd packages/rcf-lite/test/fixtures/probe-pack-application-empty-error-states
node server.js
```

Prints `LISTENING <port>` once bound.

## Environment

| Var | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port the server binds to. `4200` is refused (reserved for the operator workspace). | `3000` |
| `EMPTY_ERROR_STATES_BREAK` | Force a default break across every request. Values: `stack-trace`, `leak-id`, `no-recovery`, `no-live-region`. Per-request `?break=` still wins when both are set. Useful for driving the pack's negative runs on plain `/probe/<state>` paths without appending a per-request query. | unset |

## Query switches

| Query | Purpose |
|---|---|
| `?state=<name>` | Selects one of the eight named states directly (`not-found`, `forbidden`, `server-error`, `offline`, `permission-denied`, `empty-list`, `no-search-results`, `error-boundary`). |
| `?caps=<list>` | n/a for this blueprint. application-empty-error-states declares no capabilities and no requiresAppliedCapabilities, so there is nothing to gate; the fixture ignores this switch. |
| `?theme=<name>` | n/a for this blueprint. This blueprint has no theme-gated surface or resize seam, so the fixture does not vary its render on theme; the switch is ignored. |
| `?break=stack-trace` | Re-adds a stack trace on the server-error route (pack check `AC-22103-1` refuses). |
| `?break=leak-id` | Re-adds a resource id on the forbidden and permission-denied routes (pack check `AC-22102-1` or `AC-22104-1` refuses). |
| `?break=no-recovery` | Drops the `[data-recovery="create"]` on the empty-list route (pack check `AC-22106-1` refuses). |
| `?break=no-live-region` | Drops the polite live-region wrapper on the offline reconnect leg (pack check `AC-22105-1` refuses). |
| `?reconnect=1` | On the offline route, renders the polite live-region wrapper carrying the reconnection announcement. |
| `?crash=1` | On the error-boundary route, renders the `role="alert"` region. |

## Routes

- `/probe` index of named-state routes.
- `/probe/not-found` renders the not-found state (HTTP 404).
- `/probe/forbidden` renders the forbidden state (HTTP 403).
- `/probe/server-error` renders the server-error state (HTTP 500).
- `/probe/offline` renders the offline state; `?reconnect=1` adds the polite reconnection announcement.
- `/probe/permission-denied` renders the permission-denied state (HTTP 403 with a class-level cause).
- `/probe/empty-list` renders the empty-list state.
- `/probe/search?q=<term>` renders the no-search-results state and echoes the query verbatim.
- `/probe/error-boundary?crash=1` renders the error-boundary state under `role="alert"`.
- `/probe/widgets` stub parent surface the not-found recovery link points at.
- `POST /api/request-access` accepts the request-access submission the forbidden and permission-denied surfaces fire.

## Manual boot for the gate reviewer

```
PORT=4321 node server.js
curl -s http://127.0.0.1:4321/probe/not-found | head -20
```

Two-line boot: start the server, hit `/probe/not-found` to confirm the surface renders.
