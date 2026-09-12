# probe-pack-application-error-handling sample-app fixture

Dependency-free Node HTTP server exercising the smallest surface the `application-error-handling` probe pack asserts on: ADR-1701 error record construction, the framework and process boundaries, and the paired emission sink.

## Boot

```
cd packages/rcf-lite/test/fixtures/probe-pack-application-error-handling
PORT=47303 node server.js
```

The server prints one line to stdout once bound:

```
LISTENING 47303
```

`PORT` defaults to `3000` for manual runs; the shelf-gate probe pack uses `PROBE_PORT` in the reserved 47300-47399 range (default 47303). Stop with Ctrl+C or `kill <pid>`.

## Routes

- `GET /construct/<category>`: JSON constructed record in the ADR-1701 shape (`code`, `category`, `message`, `occurredAt`, `traceId`, `cause`, `context`, `remediation`). Recognised categories: `validation`, `authorization`, `notFound`, `conflict`, `downstream`, `internal`. An unrecognised category returns 400 with the allowed list.
- `GET /boundary/framework`: 500 JSON payload representing the record the framework-level handler produced; the record is appended to `/emitted` marked `boundary: framework`.
- `GET /boundary/process`: same for the process-level handler, marked `boundary: process`.
- `GET /emitted`: JSON `{ emitted: [record...] }` used by the probe to pair boundary calls with recorded emits.
- `GET /healthz`: `200 ok`.

## Declared env vars

| Name         | Read by      | Purpose                                                       |
|--------------|--------------|---------------------------------------------------------------|
| `PORT`       | `server.js`  | Bind port for manual runs (default `3000`).                   |
| `PROBE_PORT` | `probe-utils.mjs` in `blueprints/application-error-handling/contributions/probes/` | Bind port used by the probe pack (default `47303`, reserved range 47300-47399). |

No account-bound branch: the engine is a local fixture, so no `CI_HAS_*` gate applies.

## Related

- Probes: `blueprints/application-error-handling/contributions/probes/`
- Anatomy test: `packages/rcf-lite/test/blueprint/application-error-handling-anatomy.test.js`
