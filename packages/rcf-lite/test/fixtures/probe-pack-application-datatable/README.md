# probe-pack-application-datatable sample-app fixture

Dependency-free Node HTTP server exercising the surface the `application-datatable` probe pack asserts on: an ARIA APG table with sort controls, search input, four rendered states, and a paginated `/api/rows` endpoint.

## Boot

```
cd packages/rcf-lite/test/fixtures/probe-pack-application-datatable
PORT=47305 node server.js
```

The server prints one line to stdout once bound:

```
LISTENING 47305
```

`PORT` defaults to `3000` for manual runs; the shelf-gate probe pack uses `PROBE_PORT` in the reserved 47300-47399 range (default 47305). Stop with Ctrl+C or `kill <pid>`.

## Routes

- `GET /`, `GET /datatable-shell`: HTML shell honouring the ARIA APG table pattern. Query params: `state=populated|empty|loading|error`, `q=<text>`, `sort=<column>`, `page=<n>`, `pageSize=<n>`.
- `GET /api/rows?q=&sort=&page=&pageSize=`: JSON `{ rows, total, page, pageSize, sort, q }` for adapter drills.

## Declared env vars

| Name         | Read by      | Purpose                                                       |
|--------------|--------------|---------------------------------------------------------------|
| `PORT`       | `server.js`  | Bind port for manual runs (default `3000`).                   |
| `PROBE_PORT` | `probe-utils.mjs` in `blueprints/application-datatable/contributions/probes/` | Bind port used by the probe pack (default `47305`, reserved range 47300-47399). |

No account-bound branch: the engine is a local fixture, so no `CI_HAS_*` gate applies.

## Related

- Probes: `blueprints/application-datatable/contributions/probes/`
- Anatomy test: `packages/rcf-lite/test/blueprint/application-datatable-anatomy.test.js`
