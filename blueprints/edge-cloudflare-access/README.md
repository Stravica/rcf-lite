# edge-cloudflare-access

A rcf-lite blueprint that ships an opinionated wiring for Cloudflare
Access as the edge authentication gate on a Workers project. One
JWT validator middleware sits at the top of every fetch handler,
verifies the JWT Cloudflare Access mints against the JWKS the
service publishes, and reduces the principal onto `request.auth` as
`{email, sub, groups}`. Every audit event carries only
`{email, outcome, timestamp, path}`; no token slice, no header
value beyond `path` ever leaves the validator boundary.

- Version: `1.0.0`
- Category: `edge`
- Capabilities: `["zeroTrustGate"]`
- Suggested companions: `logging`, `errorHandling`, `secretsManagement`

## When to reach for it

- Any Cloudflare Workers project that needs an authenticated edge
  (only authenticated principals reach the origin Worker).
- Any project that has adopted the Zero Trust posture and wants a
  vendor-neutral seam (`request.auth`) between the edge and the
  downstream handler.
- Compose with `application-admin-console` v1.1.0 for the Access-gated
  sign-in surface (round-4 T-4 capability-minor pattern).

## The six REQs

| REQ | What |
| --- | --- |
| `edge-cloudflare-access-REQ-001` | The JWT validator is the sole reader of the `Cf-Access-Jwt-Assertion` header and reduces the principal onto `request.auth`. |
| `edge-cloudflare-access-REQ-002` | An Access application is declared with an elicited hostname or self-hosted-app id and an elicited policy shape from the enum. |
| `edge-cloudflare-access-REQ-003` | The operator issues a Zero Trust policy via the guide's dashboard walk-through or the alternative API path. |
| `edge-cloudflare-access-REQ-004` | The audit event carries only `{email, outcome, timestamp, path}` with no token value or headers. |
| `edge-cloudflare-access-REQ-005` | Break-glass posture: an elicited bypass-service-auth pair authenticates CI automation. |
| `edge-cloudflare-access-REQ-006` | Composition with `application-admin-console` v1.1.0: the sign-in surface flips per applied capability set. |

## The wired shape

The validator is the one place the `Cf-Access-Jwt-Assertion` header
is read. Consumers reach the reduced principal via `request.auth`.
The public surface is:

```
createAccessValidator({ env, eventSink, fetch?, clock?, bypassServiceAuth? })
  -> { validate, middleware }
```

Where `env` carries the elicited `ACCESS_JWKS_URL` and `ACCESS_AUDIENCE`.
The `middleware(request, envSwitches?)` returns either
`{rejected: true, response, outcome}` for a 401 rejection or
`{rejected: false, outcome}` after attaching `request.auth` in place.

## Elicited parameters

- `access-application-host` OR `access-selfhosted-app-id`: pick
  exactly one at apply. The dashboard walk-through follows the
  hostname path when the first is set and the self-hosted-app id
  path when the second is set.
- `access-audience`: the JWT audience tag the Access policy issues
  the validator refuses tokens whose `aud` claim does not match.
- `access-jwks-url`: the JWKS endpoint URL the validator fetches.
  Cloudflare Access publishes this at
  `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`.
- `access-policy-shape` (default `email-domain`): one of
  `email-domain`, `service-token-only`,
  `service-token-plus-email-domain`, `group-membership`. Drives
  the guide walk-through and the API alternative.
- `access-bypass-service-auth-id`: leave blank to disable
  break-glass. When set, the paired secret is delegated to the
  applied `secretsManagement` companion via
  `security-secrets-management`.

## The six probes

The probes live under `contributions/probes/`. Each has a matching
`run-<probe-name>.mjs` shim that writes a per-blueprint report to
`.rcf/reports/blueprints/edge-cloudflare-access/<probe-name>.json`
under the fixture root.

| Probe | anchorAcId | accountBound | What it covers |
| --- | --- | --- | --- |
| `jwt-validator-fixture.mjs` | `AC-34101-1` | false | Fixture-signed JWT validates; principal reduces to `{email, sub, groups}` on request.auth; one audit event with `outcome: validated` and allowed keys only. |
| `jwt-validator-reject.mjs` | `AC-34102-1` | false | Three subcases: missing header, expired exp, mis-signed each return HTTP 401 with exactly one audit event whose keys are drawn from the allowed set; outcomes: `missing`, `expired`, `invalid`. |
| `admin-console-gate-surface.mjs` | `AC-34108-1` | false | The extended admin-console fixture flips the sign-in surface: with `?caps=zeroTrustGate` it renders `[data-surface=access-gated]`; without it renders `[data-surface=local-login]`. Mutually exclusive on both branches. |
| `audit-event-secrecy.mjs` | `AC-34106-1` | false | After 5 pass + 5 reject runs, the audit sink holds 10 metadata-only records; the serialised sink contains no substring of any JWT (or its segments) and no header names beyond `path`. |
| `real-account-gated-url.mjs` | `AC-34109-1` | true | Fetch against a scheduled Access-configured hostname (`CF_ACCESS_HOST`) with `CI_HAS_CLOUDFLARE_ACCOUNT=true` follows the redirect chain to a `<team>.cloudflareaccess.com` URL. Records `accountBoundSkipped: true` without both env vars (pass-with-skip). |
| `wrangler-seam.mjs` | `AC-34101-1` | false | Spawns `wrangler dev --local` on the cf-edge fixture. `/protected` returns HTTP 401 on the shipped validator's missing-header reject path (workerd boundary); `/health` returns HTTP 200 exempt. Warn semantics per section 3.1 pass-with-skip if wrangler is missing or fails to bind; a handler thrown at the workerd boundary is a fail. |

## Mechanism-reach note

- `AC-34101-1` (fixture JWT validate) and `AC-34102-1` (reject) are
  covered by the in-process probes plus the wrangler-seam probe
  under workerd.
- `AC-34103-1` (sole-reader guarantee) is covered by the anatomy
  test that greps `src/**/*.mjs` for the header string.
- `AC-34104-1` (Access application declaration) is covered by the
  anatomy test that reads `blueprint.json` for the elicits[] shape.
- `AC-34105-1` (guide dashboard walk-through and API alternative)
  is covered by the anatomy test that greps the shipped guide file
  for the two section headings and the vendor URL.
- `AC-34106-1` (audit metadata secrecy) is covered by the
  `audit-event-secrecy` probe.
- `AC-34107-1` (break-glass posture) is covered by the anatomy
  test that drives the validator with an elicited pair.
- `AC-34108-1` (admin-console composition) is covered by the
  `admin-console-gate-surface` probe (both branches) and by the
  shipped `application-admin-console.pack.mjs` pack check
  `AC-21815-1` (Playwright-driven on the extended fixture).
- `AC-34109-1` (real-account gated URL) is covered by the
  `real-account-gated-url` probe (skipped in CI without both env
  vars per section 3.5).

## Two-line gate-reviewer boot

```
cd packages/rcf-lite/test/fixtures/cf-edge
pnpm install --ignore-workspace
```

Then run every probe:

```
node ../../../../../blueprints/edge-cloudflare-access/contributions/probes/run-jwt-validator-fixture.mjs
node ../../../../../blueprints/edge-cloudflare-access/contributions/probes/run-jwt-validator-reject.mjs
node ../../../../../blueprints/edge-cloudflare-access/contributions/probes/run-audit-event-secrecy.mjs
node ../../../../../blueprints/edge-cloudflare-access/contributions/probes/run-admin-console-gate-surface.mjs
node ../../../../../blueprints/edge-cloudflare-access/contributions/probes/run-real-account-gated-url.mjs
node ../../../../../blueprints/edge-cloudflare-access/contributions/probes/run-wrangler-seam.mjs
```

Each probe prints a report envelope and writes it to
`.rcf/reports/blueprints/edge-cloudflare-access/<probe-name>.json`.

## Composition companion

- `application-admin-console` v1.1.0 consumes `zeroTrustGate`
  optionally: the admin-console's sign-in surface renders
  Access-gated when `zeroTrustGate` is in the applied set (and
  falls back to `security-auth-*` local login otherwise). The
  v1.1.0 minor rides this PR (round-4 T-4 capability-minor pattern).
