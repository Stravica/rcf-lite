# Served-surface probe pattern

Reference shape for the Served-surface Verifier's probe declaration. Every value with `<...>` is a placeholder the project fills.

## Two identifiers, one probe body

The verifier reconciles a promoted version against what production is serving. The reconciliation compares two named identifiers the vendor and the project both know:

| Identifier | What it is | Where it lives | Written by |
|---|---|---|---|
| `promotedVersionId` | The vendor-assigned version UUID (`06839e70-1f7c-414f-99a9-babf3969efca`), the string `wrangler versions deploy` takes as its positional argument | The promote record's `promotedVersionId` field, emitted by the Promote Gate on every promote | The vendor CLI's response to `wrangler versions deploy`, captured by the Deploy Adapter's `promoteVersion` return value |
| `versionSha` | The git commit sha of the source tree the version was built from (the 40-character hex the `github.sha` context carries), baked into the built bundle by `build-and-upload` | The bundle as a build-time constant AND the Worker's health-probe response body | The `build-and-upload` workflow, which sets `BUILD_VERSION_SHA=${{ github.sha }}` before the build step |

The two identifiers name two different things on two different systems. They are NEVER equal by construction: `promotedVersionId` is a UUID assigned by the vendor at upload time; `versionSha` is a git sha assigned by the source-control system at commit time. Any teaching that "substitutes the promoted id into the probe body" and expects a match is wrong on the wire.

The verifier's reconciliation is: the Promote Gate captures BOTH identifiers on every promote (the vendor returns `promotedVersionId`; the project pairs it with the `versionSha` of the source-tree the version was built from, carried on the promote record's `versionSha` field). At verify time, the verifier substitutes the promote record's `versionSha` into the probe's `expectShape.versionSha` slot and refuses the probe when the served body's `versionSha` does not match.

## The probe declaration

```javascript
// src/deploy/verify-config.mjs
// Consumed by the Served-surface Verifier (TAC-1305). The health probe is
// mandatory; add project smoke probes for surfaces where a served-surface
// check adds signal a health probe does not.

export const probes = [
  {
    path: '/healthz',
    method: 'GET',
    successStatus: [200],
    expectShape: {
      // <PROMOTED_VERSION_SHA> is substituted at verify time from the
      // promote record's `versionSha` field (the git sha), NOT from the
      // promote record's `promotedVersionId` (the vendor UUID). The two
      // are different identifiers on two different systems.
      versionSha: '<PROMOTED_VERSION_SHA>'
    }
  },
  {
    // A project smoke probe: a read that exercises one binding and one
    // Worker code path a health probe does not. Keep it stateless, idempotent,
    // and observable in one round trip.
    path: '/api/status',
    method: 'GET',
    successStatus: [200],
    expectShape: {
      ok: true
    }
  }
];

export const retryBounds = {
  // At most six attempts per probe over at most sixty seconds; per-request
  // timeout at most five seconds. AC-12110-1 refuses a bound looser than these.
  maxAttemptsPerProbe: 6,
  windowMs: 60_000,
  perRequestTimeoutMs: 5_000
};
```

## The verifier's runtime shape

The Served-surface Verifier consumes the config through the `probeConfig` interface (TAC-1305). Per probe:

1. Compose the request against the target URL (from `probeUrl('production', null)` for a promote verify, from `probeUrl('alias', <alias>)` for a preview-only verify).
2. Send the request; on transport error or on a status outside `successStatus`, sleep with an exponential-shaped backoff bounded by `windowMs / maxAttemptsPerProbe`.
3. On a status in `successStatus`, parse the response body as JSON and check every key in `expectShape` matches the value in the response. `<PROMOTED_VERSION_SHA>` in `expectShape` is substituted at verify time with the promote record's `versionSha` field (the git commit sha the promoted version was built from).
4. Pass on the first attempt whose status AND body-shape match.
5. Fail the verify when any probe exhausts `maxAttemptsPerProbe` or when the cumulative elapsed time exceeds `windowMs`, whichever comes first. Emit `{ probePath, status, elapsedMs, outcome: 'failed', versionShaSeen }` on the result sink.

## Compose boundary with observability-probe-endpoints

The `/healthz` probe declared above is a DEPLOY-blueprint surface. Its body carries build provenance (`versionSha`, `builtAt`, `ciRunUrl`) because the verifier's reconciliation requires it (AC-12112-3). That body shape is NOT a supervisor-integration probe response; it is the deploy blueprint's own provenance readback.

The `observability-probe-endpoints` blueprint contributes an operator-supervised probe interface derived from a target integration profile (`kubernetes`, `loadBalancer`, `uptimeMonitor`, `systemd`, `dockerHealthcheck`, `reverseProxy`). Every profile mandates a minimal response contract: `loadBalancer` requires an empty body; `kubernetes` requires exactly `{"status": "pass"|"fail"}`; the profile validator refuses any override that would add a field beyond the enumerated set. That contract's audience is the external supervisor whose conventions drive the wire shape; adding build-provenance fields to it would leak reconnaissance value to unintended readers and would fail the profile validator.

When both blueprints compose, the project runs TWO probe surfaces with distinct paths and distinct contracts:

- One `/health` (or the profile-declared path) owned by `observability-probe-endpoints`, whose body is minimal per its profile.
- One `/healthz` (or the deploy-blueprint's chosen path, distinct from the profile's) owned by `deploy-cloudflare-workers`, whose body carries `{ versionSha, builtAt, ciRunUrl }` for the verifier.

The two surfaces coexist on purpose; the deploy verifier never hits the profile-owned path and the external supervisor never hits the deploy-owned path. A project unsure which path is which picks distinct strings at apply time (`/health` for the profile, `/healthz` for the deploy verifier; or `/health` for the profile and `/build-info` for the deploy verifier) and documents both on the project's ADR set. Collapsing the two onto one path is not supported; the deploy verifier's provenance body would fail the profile validator, and stripping provenance from the body would break the verifier's reconciliation.

## Reader notes

- A dev-mode local URL (`http://localhost:<port>`, `http://127.0.0.1:<port>`) is refused by the verifier with `DEPLOY_DEV_MODE_INADMISSIBLE`. AC-12111-1 makes this a hard refusal at the verifier layer; AC-12111-2 accepts the vendor's preview and production URL patterns.
- The health probe's response body carries `{ versionSha, builtAt, ciRunUrl }`. The Worker reads these at request time from the build-time constants injected by `build-and-upload`. AC-12112-2 requires the shape; AC-12112-3 makes the `versionSha` field the verifier's evidence that the promoted version is the version being served.
- A probe path that returns 200 with the WRONG `versionSha` fails the probe. A stale response served by a routing layer that has not converged yet fails the probe; the retry window buys the propagation-lag window; a full exhaustion fails the release.
- The project may add authenticated smoke probes; each carries an operator-chosen auth binding (a signed request header, a probe-only token) that lives in the secrets contract, not in this file. The verifier does not carry an `Authorization` header that would bypass a production auth layer; a probe surface that requires auth is exposed on a project-declared unauthenticated path (a signed-header contract for probes only, with a rotation cadence tied to the deploy-log).
- The `/healthz` path (or whichever path the project picks) MUST be listed in `[assets] run_worker_first` when the Worker declares an `[assets]` binding whose directory contains any file that could shadow the path. Without the listing, the assets pipeline may serve a stale (or absent) response before the fetch handler runs, and the verifier reads a shape that is not the Worker's answer; see `wrangler-toml-shape.md` for the discipline.
