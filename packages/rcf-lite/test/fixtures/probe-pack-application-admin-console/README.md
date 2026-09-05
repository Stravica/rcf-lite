# probe-pack-application-admin-console fixture

Dependency-free sample app the `application-admin-console` probe pack drives on the shelf gate. Node HTTP server plus one shell HTML plus one inline client script that binds every surface the pack asserts on. Framework-free by design.

## Boot

```
cd packages/rcf-lite/test/fixtures/probe-pack-application-admin-console
node server.js
```

Prints `LISTENING <port>` once bound.

## Environment

| Var | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port the server binds to | `3000` |
| `ADMIN_CONSOLE_CAPS` | Comma-separated capability list mirroring `manifest.blueprints[application-admin-console].appliedCapabilities`. Determines which surfaces render. | `principalDirectory,roleModel,auditLog` |

The `?caps=` query parameter on any route overrides `ADMIN_CONSOLE_CAPS` for that request only. Useful for cross-fixture probing without restarting.

## Query switches

| Query | Purpose |
|---|---|
| `?caps=<comma-list>` | Override the applied capability set for one page load. |
| `?asAdmin=false` | Simulate a non-admin principal reaching an admin route: renders the access-denied region. |
| `?break=matrix-grid` | Drops `role="grid"` and inner role attributes on the permission matrix (pack check `AC-21103-1` refuses). |
| `?break=denied` | Drops the `[data-action="request-access"]` control on the access-denied region (pack check `AC-21102-1` refuses on its denied branch). |
| `?break=audit-fields` | Drops the `correlationId` column on every audit row (pack check `AC-21105-1` refuses). |

## Routes

- `/admin` shell (nav landmark + surface index).
- `/admin/users` users directory (fires when `principalDirectory` is in CAPS).
- `/admin/roles` permission matrix (fires when `roleModel` is in CAPS).
- `/admin/orgs` org switcher (fires when `tenancy` is in CAPS).
- `/admin/audit` audit-log surface (fires when `auditLog` is in CAPS).
- `POST /api/request-access` records a request-access submission on `/__requests`.
- `GET /__requests` returns the request log (client-side fetches mirror to `window.__adminFetches`).

## Manual boot for the gate reviewer

```
PORT=4321 ADMIN_CONSOLE_CAPS=principalDirectory,roleModel,auditLog node server.js
curl -s http://127.0.0.1:4321/admin/users | head -20
```

Two-line boot: start the server, hit `/admin/users` to confirm the surface renders.
