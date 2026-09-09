# platform-docker-compose-host CHANGELOG

## 1.1.0 - 2026-09-09

### Added

- `platform-docker-compose-host-REQ-007` (`must`): the Docker Engine installation follows the elicited apt channel (`stable` or `test`) with the installed repository source as the observable oracle. Closes criterion a on the previously unbacked `docker-engine-channel` elicit (F-1).
- `platform-docker-compose-host-US-38110` traces REQ-007; two ACs (happy-path per-channel installation, refusal on unsupported channel value); each carries `disposition`, and the vendor-fact AC carries `vendorCitation` to the Docker Engine install-on-Ubuntu documentation verified 2026-09-09.

### Changed

- `REQ-001` extended to name the elicited `compose-file-location` alternative (`compose/compose.yaml`) alongside the shipped `repo-root` default; closes criterion a on the previously unbacked alternative branch (F-2).
- `REQ-003` extended to name every elicited healthcheck kind (`http`, `tcp`, `command`); previously only the `http` shape was named.
- `REQ-005` extended to name the `reverse-proxy=none` topology explicitly (the lint now refuses ANY proxy service block or reload verb when `none` is elicited); closes criterion a on the previously unbacked `none` branch (F-3).
- Every existing REQ carries a `deliveredBy` link into a TAC or ADR (six links). Every existing AC carries `disposition`. `rcf define blueprint lint-consistency` reports zero pass-1 and pass-2 findings.

## 1.0.0 - 2026-09-08

Initial release. Round-7 T-2 of the Hetzner spec at `projects/blueprint-library/specs/hetzner-round-7-spec-2026-09-07.md`.

- Mints capability `containerHost` and global topic `containerHostContract`.
- Six REQs, nine USs, four TACs, four ADRs; five Node-only probes.
- Extends the shared throwaway-Hetzner-server fixture with a minimal compose stack (`compose.yaml`, `caddy/Caddyfile`, `secrets/web-token` file mount, `src/serve.mjs` healthchecked stub) plus five `run-<probe>.mjs` delegate shims.
- Compose-config-lint carries four mutation switches (`SIMULATE_MISSING_HEALTHCHECK`, `SIMULATE_UNCLASSIFIED_RESTART`, `SIMULATE_UNCLASSIFIED_LOG_DRIVER`, `SIMULATE_EVENT_SECRECY_LEAK`); secrets-as-files-scan carries `SIMULATE_PLAINTEXT_SECRET`; caddyfile-validate carries `SIMULATE_INVALID_CADDYFILE` and runs `caddy validate` via the `caddy:2` container when a local `caddy` binary is not on PATH.
- Reverse-proxy choice elicited via `reverse-proxy` (caddy default per Baz decision 19; traefik and none alternatives); Coolify rejected verbatim per Baz decision 20; log driver elicited via `log-driver` (journald default; loki opt-in).
- Consumers: `w-2026-09-07-dave-004` migrates the ops-01 remote-library compose stack onto this contract after 0.25.0 ships; blueprint acceptance never depends on that migration.
