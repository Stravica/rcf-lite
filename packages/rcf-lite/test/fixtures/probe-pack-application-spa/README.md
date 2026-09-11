# probe-pack-application-spa sample-app fixture

Dependency-free Node HTTP server exercising the smallest surface the `application-spa` probe pack asserts on: a published route inventory, a shell with top-level navigation, and a designed empty-state route.

## Boot

```
cd packages/rcf-lite/test/fixtures/probe-pack-application-spa
PORT=47301 node server.js
```

The server prints one line to stdout once bound:

```
LISTENING 47301
```

`PORT` defaults to `3000` for manual runs; the shelf-gate probe pack uses `PROBE_PORT` in the reserved 47300-47399 range (default 47301). Stop with Ctrl+C or `kill <pid>`.

## Routes

- `GET /`, `GET /dashboard`, `GET /settings`: HTML responses with the shell shape (primary nav, main region, semantic-token wrapper class).
- `GET /reports`: the designed empty-state variant (`data-empty-state="reports"`).
- `GET /__routes`: JSON `{ routes: [{ path, name, state }] }` reflecting the published inventory the shell's `<meta name="route-inventory">` also names.
- `GET /healthz`: `200 ok`.

## Declared env vars

| Name         | Read by      | Purpose                                                       |
|--------------|--------------|---------------------------------------------------------------|
| `PORT`       | `server.js`  | Bind port for manual runs (default `3000`).                   |
| `PROBE_PORT` | `probe-utils.mjs` in `blueprints/application-spa/contributions/probes/` | Bind port used by the probe pack (default `47301`, reserved range 47300-47399). |

No account-bound branch: the engine is a local fixture, so no `CI_HAS_*` gate applies.

## Related

- Probes: `blueprints/application-spa/contributions/probes/`
- Anatomy test: `packages/rcf-lite/test/blueprint/application-spa-anatomy.test.js`
