# probe-pack-observability-essentials fixture

Small self-contained fixture used by the `observability-essentials`
blueprint's contribution probes. Provides a real http probe server
(`src/probe-server.mjs`) that binds on 127.0.0.1, exposes /live,
/ready, and /metrics, and echoes a real request-id header on every
response.

## Declared env vars

- `RCF_FIXTURE_OBS_ESS_PORT` (optional): overrides the port the
  fixture server binds; default 47501. The probes fall back to
  0 (kernel-assigned) if this env var equals `0`.

No account gate.

## Reviewer boot

```
export PATH=$HOME/.n/n/versions/node/24.14.0/bin:$PATH
node ./blueprints/observability-essentials/contributions/probes/run-liveness-probe.mjs
node ./blueprints/observability-essentials/contributions/probes/run-readiness-probe.mjs
node ./blueprints/observability-essentials/contributions/probes/run-metrics-endpoint.mjs
```

The probes each open the fixture server on 127.0.0.1 (kernel-assigned
port unless the env var is set), issue real requests, and record the
response bodies and request-id headers as positive evidence.
