# probe-pack-observability-probe-endpoints fixture

Self-contained fixture used by the `observability-probe-endpoints`
blueprint's contribution probes. Provides an in-process profile
registry and a real http materialiser (`src/profile-registry.mjs`)
that binds on 127.0.0.1 and refuses a partial profile at boot.

## Declared env vars

- `RCF_FIXTURE_OBS_PROBE_PORT` (optional): overrides the port the
  request-traffic listener binds; default 0 (kernel-assigned).
- `RCF_FIXTURE_OBS_PROBE_SEPARATE_PORT` (optional): when set to a
  port number, the separate-listener probe binds a second listener
  on that port to prove the separate-port option; default 0.

No account gate.
