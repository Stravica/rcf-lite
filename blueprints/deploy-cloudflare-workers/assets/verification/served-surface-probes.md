# Served-surface probe pattern

Reference shape for the Served-surface Verifier's probe declaration. Every value with `<...>` is a placeholder the project fills.

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
      // versionSha is filled at verify time from the promote record; the
      // verifier substitutes it before requesting. AC-12110-2 fails the probe
      // when the served versionSha does not match the promoted id.
      versionSha: '<PROMOTED_SHA>'
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
3. On a status in `successStatus`, parse the response body as JSON and check every key in `expectShape` matches the value in the response. `<PROMOTED_SHA>` in `expectShape` is substituted at verify time with the promote record's `promotedVersionId`'s build sha.
4. Pass on the first attempt whose status AND body-shape match.
5. Fail the verify when any probe exhausts `maxAttemptsPerProbe` or when the cumulative elapsed time exceeds `windowMs`, whichever comes first. Emit `{ probePath, status, elapsedMs, outcome: 'failed', versionShaSeen }` on the result sink.

## Reader notes

- A dev-mode local URL (`http://localhost:<port>`, `http://127.0.0.1:<port>`) is refused by the verifier with `DEPLOY_DEV_MODE_INADMISSIBLE`. AC-12111-1 makes this a hard refusal at the verifier layer; AC-12111-2 accepts the vendor's preview and production URL patterns.
- The health probe's response body carries `{ versionSha, builtAt, ciRunUrl }`. The Worker reads these at request time from the build-time constants injected by `build-and-upload`. AC-12112-2 requires the shape; AC-12112-3 makes the `versionSha` field the verifier's evidence that the promoted version is the version being served.
- A probe path that returns 200 with the WRONG `versionSha` fails the probe. A stale response served by a routing layer that has not converged yet fails the probe; the retry window buys the propagation-lag window; a full exhaustion fails the release.
- The project may add authenticated smoke probes; each carries an operator-chosen auth binding (a signed request header, a probe-only token) that lives in the secrets contract, not in this file. The verifier does not carry an `Authorization` header that would bypass a production auth layer; a probe surface that requires auth is exposed on a project-declared unauthenticated path (a signed-header contract for probes only, with a rotation cadence tied to the deploy-log).
