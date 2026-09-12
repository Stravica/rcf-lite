# probe-pack-application-api-rest sample-app fixture

Dependency-free Node HTTP server exercising the smallest surface the `application-api-rest` probe pack asserts on: cursor-paginated collection, three health probes, RFC 7807 problem-details, and request-id echo.

## Boot

```
cd packages/rcf-lite/test/fixtures/probe-pack-application-api-rest
PORT=47302 node server.js
```

The server prints one line to stdout once bound:

```
LISTENING 47302
```

`PORT` defaults to `3000` for manual runs; the shelf-gate probe pack uses `PROBE_PORT` in the reserved 47300-47399 range (default 47302). Stop with Ctrl+C or `kill <pid>`.

## Routes

- `GET /v1/widgets?cursor=<n>&limit=<n>`: cursor-paginated JSON `{ items[], nextCursor, total, requestId }`.
- `GET /v1/widgets/<id>`: JSON widget or a 404 problem-details.
- `GET /livez`, `GET /readyz`, `GET /startupz`: distinct JSON `{ status, probe, requestId }` bodies.
- Anything else: 404 problem-details with `content-type: application/problem+json`.

## Request-id

Every response carries an `x-request-id` header. The value is echoed from the inbound `x-request-id` header when the client supplied one, or synthesised as a UUID when it did not.

## Declared env vars

| Name         | Read by      | Purpose                                                       |
|--------------|--------------|---------------------------------------------------------------|
| `PORT`       | `server.js`  | Bind port for manual runs (default `3000`).                   |
| `PROBE_PORT` | `probe-utils.mjs` in `blueprints/application-api-rest/contributions/probes/` | Bind port used by the probe pack (default `47302`, reserved range 47300-47399). |

No account-bound branch: the engine is a local fixture, so no `CI_HAS_*` gate applies.

## Related

- Probes: `blueprints/application-api-rest/contributions/probes/`
- Anatomy test: `packages/rcf-lite/test/blueprint/application-api-rest-anatomy.test.js`
