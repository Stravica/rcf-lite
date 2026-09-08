# platform-docker-compose-host CHANGELOG

## 1.0.0 - 2026-09-08

Initial release. Round-7 T-2 of the Hetzner spec at `projects/blueprint-library/specs/hetzner-round-7-spec-2026-09-07.md`.

- Mints capability `containerHost` and global topic `containerHostContract`.
- Six REQs, nine USs, four TACs, four ADRs; five Node-only probes.
- Extends the shared throwaway-Hetzner-server fixture with a minimal compose stack (`compose.yaml`, `caddy/Caddyfile`, `secrets/web-token` file mount, `src/serve.mjs` healthchecked stub) plus five `run-<probe>.mjs` delegate shims.
- Compose-config-lint carries four mutation switches (`SIMULATE_MISSING_HEALTHCHECK`, `SIMULATE_UNCLASSIFIED_RESTART`, `SIMULATE_UNCLASSIFIED_LOG_DRIVER`, `SIMULATE_EVENT_SECRECY_LEAK`); secrets-as-files-scan carries `SIMULATE_PLAINTEXT_SECRET`; caddyfile-validate carries `SIMULATE_INVALID_CADDYFILE` and runs `caddy validate` via the `caddy:2` container when a local `caddy` binary is not on PATH.
- Reverse-proxy choice elicited via `reverse-proxy` (caddy default per Baz decision 19; traefik and none alternatives); Coolify rejected verbatim per Baz decision 20; log driver elicited via `log-driver` (journald default; loki opt-in).
- Consumers: `w-2026-09-07-dave-004` migrates the ops-01 remote-library compose stack onto this contract after 0.25.0 ships; blueprint acceptance never depends on that migration.
