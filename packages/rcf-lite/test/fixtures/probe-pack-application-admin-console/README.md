# probe-pack-application-admin-console fixture

Dependency-free sample app the `application-admin-console` probe pack drives on the shelf gate. Node HTTP server plus one shell HTML plus one inline client script that binds every surface the pack asserts on. Framework-free by design.

## Env-var manifest (criterion-e probes read these)

Every environment variable the fixture or a `contributions/probes/` probe reads is declared here. A probe that short-circuits on an undeclared variable would prove nothing (rule 7d).

| Var | Purpose |
|---|---|
| `PORT` | default 3000; probe picks 47600-47609 |
| `ADMIN_CONSOLE_CAPS` | comma list; default `principalDirectory,roleModel,auditLog` |
| `ADMIN_CONSOLE_BREAK` | optional default `?break=` switch |
| `ADMIN_CONSOLE_PRINCIPAL_EMAIL` | default `principal@example.com`, feeds the Access-gated sign-in [data-role=principal-read] |
| `PROBE_BREAK` | optional default `?break=` switch (a lower-priority alternate to `ADMIN_CONSOLE_BREAK`); per-request `?break=` still wins when set. Values: `matrix-grid`, `denied`, `audit-fields` |

Every response emits an `x-fixture-request-id` HTTP header (a per-request UUID). The criterion-e probes echo this id back into their `.rcf/reports/` run records as positive evidence per rule 7d (a real request identifier answered by the fixture engine).

## Criterion-e probe pack

`blueprints/application-admin-console/contributions/probes/` boots this fixture on a scratch port in its declared family range and drives varied inputs (different query strings and env overlays) to derive DOM observables. Each probe result carries an `evidence` object with the fixture's request id, the HTTP status and a response-body excerpt. No account credentials are involved: this blueprint's deliverable is application code and the fixture built from its own contributions IS the engine (the application-code engine rule).


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

## T-4 admin-console v1.1.0 extension (Cloudflare round 6, spec section 5.4.1)

Two new pieces ship with the extension:

- `?caps=zeroTrustGate` (composed with the existing caps): flips the
  `/admin/sign-in` route's surface. With `zeroTrustGate` in the caps
  list, the sign-in page renders `[data-surface=access-gated]` with
  no local form and a `[data-role=principal-read]` element carrying
  the principal email (read from `request.auth` in a real
  deployment; supplied via `?principalEmail=...` or the
  `ADMIN_CONSOLE_PRINCIPAL_EMAIL` env var in the fixture). Without
  `zeroTrustGate` the sign-in page renders `[data-surface=local-login]`
  with a local email/password form.
- `/admin/sign-in` route: added by the v1.1.0 minor. Serves the
  Access-gated or local-login surface based on the applied caps.
  Break switches: `?break=principal-read` drops the principal-read
  element on the gated branch; `?break=local-login-form` drops the
  form on the fallback branch. The shipped pack check `AC-21815-1`
  in `application-admin-console.pack.mjs` fires only when
  `zeroTrustGate` is applied and asserts the mutually exclusive
  surface presence.

### Two-line boot for the T-4 gate reviewer

```
PORT=4322 ADMIN_CONSOLE_CAPS=principalDirectory,roleModel,auditLog,zeroTrustGate node server.js
curl -s "http://127.0.0.1:4322/admin/sign-in" | head -20
```

Expected: the response body carries `data-surface="access-gated"`
and no `data-surface="local-login"`.
