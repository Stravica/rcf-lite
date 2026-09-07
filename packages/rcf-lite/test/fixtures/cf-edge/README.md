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

## Rate-limits manifest (round 6 T-6 extension)

The T-6 blueprint `edge-cloudflare-rate-limiting` v1.0.0 extends
this fixture with a local rate-limit rules manifest and a drift-audit
runner realisation. The T-4 Access shape is unchanged; the T-6
additions are additive.

- `cloudflare/rate-limits/example.json` and
  `cloudflare/rate-limits/api-writes.json` are the two shipped
  manifest files, one JSON document per rule per ADR-3703. Each
  file carries the seven documented Cloudflare WAF rate-limiting
  rules fields (id, expression, threshold, period, characteristics,
  action, duration) per
  https://developers.cloudflare.com/waf/rate-limiting-rules/.
- `blueprints/edge-cloudflare-rate-limiting/contributions/schemas/rate-limit-rule.schema.json`
  is the shipped JSON Schema (draft-07). The
  `manifest-schema-validate` probe validates every file in
  `cloudflare/rate-limits/` against this schema.
- `src/drift-audit-runner.mjs` realises TAC-3703 in the fixture.
  It exports `createDriftAuditRunner({env, eventSink, fetch, clock,
  cadence, manifestLoader})` per the TAC's factory shape and is
  driven by the probes with a fake fetch (no live Cloudflare API
  call from the shelf).
- The zone id is read from `env.CF_ZONE_ID` (never inlined in a
  manifest file). A production project stores the zone id via the
  applied `security-secrets-management` companion; the fixture
  leaves it empty.

### Rate-limits environment

| Var | Purpose | Default |
| --- | --- | --- |
| `CF_ZONE_ID` | Cloudflare zone id the drift-audit runner fetches rules for. Never inlined in a manifest file. | unset |
| `CF_API_TOKEN` | Cloudflare API token the drift-audit runner sends as a bearer credential (real-account only). Never inlined in a manifest file. | unset |
| `CF_RATE_LIMIT_URL` | Scheduled HQ-owned URL the `real-account-burst-and-429` probe fires against under `CI_HAS_CLOUDFLARE_ACCOUNT=true`. | unset |
| `CI_HAS_CLOUDFLARE_ACCOUNT` | Gate for the `real-account-burst-and-429` probe per spec section 3.5 and ruling 6. Without it the probe records `accountBoundSkipped: true` and aggregates to `pass`. | unset |
| `SIMULATE_MANIFEST_MISSING` | Move one manifest file to a scratch location so `manifest-presence` surfaces the missing basename in the detail. | unset |
| `SIMULATE_SCHEMA_INVALID` | Write a manifest file with a missing `threshold` field so `manifest-schema-validate` surfaces the invalid file. | unset |
| `SIMULATE_EVENT_LEAK_IP` | Inject a full client IP into every drift record so `event-secrecy` surfaces the leaked key. | unset |

Every switch restores the fixture tree before the probe exits;
mutation checks in the anatomy test verify the negative path.

### Two-line gate-reviewer boot for the T-6 local probes

```
cd packages/rcf-lite/test/fixtures/cf-edge
node ../../../../../blueprints/edge-cloudflare-rate-limiting/contributions/probes/run-manifest-presence.mjs
```

Repeat with `run-manifest-schema-validate.mjs` and
`run-event-secrecy.mjs`. Each prints a report envelope and writes
its report to
`.rcf/reports/blueprints/edge-cloudflare-rate-limiting/<probe-name>.json`
under the repo root.

### Real-account burst probe

```
cd packages/rcf-lite/test/fixtures/cf-edge
CI_HAS_CLOUDFLARE_ACCOUNT=true \
CF_RATE_LIMIT_URL=https://rcf-lite-ci-rate-limit-smoke.example.test/api/ \
node ../../../../../blueprints/edge-cloudflare-rate-limiting/contributions/probes/run-real-account-burst-and-429.mjs
```

Without both env vars the probe records `accountBoundSkipped: true`
per ruling 6 and aggregates to `pass`; this is the accepted CI
verdict.
