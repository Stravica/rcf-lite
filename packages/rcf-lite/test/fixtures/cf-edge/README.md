# cf-edge sample-app fixture

Fixture for the round 6 T-4 Cloudflare blueprint `edge-cloudflare-access`.
Ships a minimal Workers project applying `deploy-cloudflare-workers` v1.2.0
plus `edge-cloudflare-access` v1.0.0. The Worker entry passes every
request through the Access JWT validator middleware; the middleware
is the sole reader of the `Cf-Access-Jwt-Assertion` header in the
applied source tree.

Access is enforced at the Cloudflare edge in production; the fixture
does not open a live Access binding. The five local probes drive the
shipped code path in-process against a fixture-JWT signer plus a
local JWKS server, so the shelf gains no runtime dependency on
Cloudflare Access.

## Layout

- `wrangler.toml` declares the Worker entry, the T-0 `[assets]`
  block (Workers-with-static-assets shape), and the elicited env
  vars `ACCESS_JWKS_URL` and `ACCESS_AUDIENCE`.
- `dist/index.html` is the single static asset the Cloudflare
  runtime serves at the edge (the T-0 assets-manifest scan is
  satisfied by this file's presence).
- `src/index.mjs` is the Worker fetch handler. Every request goes
  through `createAccessValidator(...).middleware(request)` at the
  top of the handler. The `/health` path is exempt from the
  validator so a load balancer can reach it.
- `src/jwt-validator.mjs` is the JWT validator. Sole reader of the
  `Cf-Access-Jwt-Assertion` header per REQ-080. Fetches the JWKS
  from `env.ACCESS_JWKS_URL`, caches keys per-kid, verifies the JWT
  against the cached key matching the header's `kid`, and reduces
  the principal into `request.auth` as `{email, sub, groups}`. On
  any validate-failure it emits an audit event with metadata-only
  fields on the injected sink and returns 401.
- `test/jwt-signer.mjs` is the fixture-JWT signer. Generates an RSA
  keypair per-process (a fresh one on every boot), exposes
  `signJwt` and `fixtureAccessJwt` for probes, and `jwksExport` for
  the fixture JWKS server.
- `test/jwks-server.mjs` is a small dependency-free Node HTTP
  server that publishes `/.well-known/jwks.json` on a local port.
  The probes start this server on port 0 (kernel-chosen), point the
  validator at the resulting URL, run their assertions, and stop
  the server on exit.
- `package.json` declares `wrangler` as a devDependency; every
  probe is exposed as a script (`access-probe-*`).

## Manual boot

```
cd packages/rcf-lite/test/fixtures/cf-edge
pnpm install --ignore-workspace
pnpm start
```

`wrangler dev` picks its own port and prints the local URL. The
fixture never binds `4200` (Dave's workspace server owns that
port).

## Fixture-JWT signer boot line

The probes start the fixture-JWT signer in-process; a manual boot
for the gate reviewer looks like:

```
cd packages/rcf-lite/test/fixtures/cf-edge
node -e "import('./test/jwt-signer.mjs').then(m => { const k=m.createFixtureKey(); console.log(JSON.stringify(m.jwksExport(k), null, 2)); })"
```

Prints the JWKS document the validator would fetch from
`env.ACCESS_JWKS_URL`.

## JWKS endpoint

The fixture JWKS server binds `127.0.0.1:0` by default (kernel-chosen
port). A manual pin uses:

```
cd packages/rcf-lite/test/fixtures/cf-edge
node -e "import('./test/jwt-signer.mjs').then(async m=>{const k=m.createFixtureKey();const s=await (await import('./test/jwks-server.mjs')).startJwksServer({port: 8788, keys:[k]});console.log('jwks at', s.url);})"
```

Prints `jwks at http://127.0.0.1:8788/.well-known/jwks.json`; leave
the process running while a `wrangler dev` process points at it.

## Environment

| Var | Purpose | Default |
| --- | --- | --- |
| `ACCESS_JWKS_URL` | JWKS endpoint the validator fetches. | `http://127.0.0.1:8788/.well-known/jwks.json` |
| `ACCESS_AUDIENCE` | Audience tag the validator checks against `payload.aud`. | `cf-edge-fixture-audience` |
| `SIMULATE_MISSING_JWT` | Strip the header before dispatch so the reject probe surfaces the 401 with `outcome: missing`. | unset |
| `SIMULATE_EXPIRED_JWT` | Treat the effective expiry as an hour in the past so the reject probe surfaces the 401 with `outcome: expired`. | unset |
| `SIMULATE_BYPASS_SERVICE_AUTH` | Force the break-glass code path (a valid pair is still required). | unset |

`?state=` and `?theme=` query switches are ignored by the Worker
(the applied project layers them into its own downstream handlers);
the fixture route table is intentionally minimal (`/` returns the
principal reflected as JSON, `/health` is exempt from the validator).

## Two-line gate-reviewer boot for the local probes

```
cd packages/rcf-lite/test/fixtures/cf-edge
node ../../../../../blueprints/edge-cloudflare-access/contributions/probes/run-jwt-validator-fixture.mjs
```

Repeat with `run-jwt-validator-reject.mjs`, `run-admin-console-gate-surface.mjs`,
`run-audit-event-secrecy.mjs`, `run-real-account-gated-url.mjs` and
`run-wrangler-seam.mjs`. Each prints a report envelope and writes
its report to `.rcf/reports/blueprints/edge-cloudflare-access/<probe-name>.json`
under the repo root.

## Two-line wrangler-seam boot

The wrangler-seam probe expects the wrangler devDependency to be
present under `packages/rcf-lite/test/fixtures/cf-edge/node_modules/.bin/wrangler`.

```
cd packages/rcf-lite/test/fixtures/cf-edge
pnpm install --ignore-workspace
node ../../../../../blueprints/edge-cloudflare-access/contributions/probes/run-wrangler-seam.mjs
```

Warn semantics per spec section 3.1 pass-with-skip: the probe
returns `aggregateVerdict: warn` (never `fail`) if the wrangler
devDependency is missing or the CLI does not bind within the cap.
A handler thrown at the workerd boundary is a genuine `fail`.
