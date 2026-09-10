# platform-docker-compose-host CHANGELOG

## 1.1.2 - 2026-09-10

Register patch.

- Neutral register in README fixture-extension prose.

## 1.1.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.1.0 - 2026-09-09

### Added

- `platform-docker-compose-host-REQ-007` (`must`): the Docker Engine installation follows the elicited apt channel (`stable` or `test`) with the installed repository source as the observable oracle. Closes criterion a on the previously unbacked `docker-engine-channel` elicit (F-1).
- `platform-docker-compose-host-US-38110` traces REQ-007; two ACs (happy-path per-channel installation, refusal on unsupported channel value); each carries `disposition`, and the vendor-fact AC carries `vendorCitation` to the Docker Engine install-on-Ubuntu documentation verified 2026-09-09.

### Changed

- `REQ-001` extended to name the elicited `compose-file-location` alternative (`compose/compose.yaml`) alongside the shipped `repo-root` default; closes criterion a on the previously unbacked alternative branch (F-2).
- `REQ-003` extended to name every elicited healthcheck kind (`http`, `tcp`, `command`); previously only the `http` shape was named.
- `REQ-005` extended to name the `reverse-proxy=none` topology explicitly (the lint now refuses ANY proxy service block or reload verb when `none` is elicited); closes criterion a on the previously unbacked `none` branch (F-3).
- Every existing REQ carries a `deliveredBy` link into a TAC or ADR (six links). Every existing AC carries `disposition`. `rcf define blueprint lint-consistency` reports zero pass-1 and pass-2 findings.

### Added (criterion b completion, second pass 2026-09-09)

- Elicited `healthcheck-timeout-seconds` added to `blueprint.json` (default 30, floor 5, ceiling 300); REQ-003 description extended to name the elicited answer, closing criterion a on the previously-unbacked healthcheck-timeout branch (F-4).
- Every story on this blueprint now reaches the section 7a AC-set-sufficiency floor. 35 new hand-authored ACs cover the documented failure paths named in the guide and TAC records, per-story range 4-6 (from the 1-2 shipped in the first 1.1.0 pass): US-38101 gains five ACs (network drift closing F-9 first, volume drift closing F-9 second, image drift closing F-9 third, .env drift closing F-9 fourth, compose-file-location branch); US-38102 gains four ACs (SSM integration closing F-10 first, file-based fallback closing F-10 second, wrong-mode secret closing F-10 third, orphan top-level secret); US-38103 gains four ACs (wrong-mode probe closing F-10, orphan-secret probe closing F-10, plaintext in .env, clean-pass baseline); US-38104 gains four ACs (healthcheck-timeout elicit AC closing F-4, tcp kind closing F-6, command kind closing F-6, http kind closing F-6); US-38105 gains three ACs (real-account timeout, teardown discipline, dependency ordering); US-38106 gains three ACs (long-running policy classification closing F-7 first, job policy classification closing F-7 second, missing restart field); US-38107 gains three ACs (Traefik topology closing F-5 first, none topology closing F-5 second, read-only bind-mount); US-38108 gains three ACs (Traefik reload verb closing F-5, none topology no-op, reload window too short); US-38109 gains three ACs (journald marker probe closing F-8 first, loki marker probe closing F-8 second, missing logging block); US-38110 gains three ACs (sources file content, keyring presence, idempotent install). Every new AC carries `disposition`, most carry `ownerRef` into the owning TAC, and vendor-fact ACs carry `vendorCitation` (Docker Engine install, compose healthcheck reference, compose secrets reference, compose logging reference, Caddy docs, Traefik docs, journald docs, Loki docs) with today's verifiedOn date.
- `rcf define blueprint lint-consistency` still reports zero pass-1 and pass-2 findings. Blueprint stays at v1.1.0 on the same unreleased minor.

### Fixed (review fix pass, 2026-09-09)

- Register sweep: every `blueprint.json` elicit prompt, guide passage, README row, ADR title/context/decision and probe comment on the blueprint has "a platform reverse-proxy decision", "a development host", "an internal ops host", "round-7 tunnel" and "hetzner-round-7-spec-2026-09-07.md" neutralised to concept ("a platform decision", "a common Linux-host baseline that already runs Caddy", "a Cloudflare-tunnel sibling"). CHANGELOG entries keep internal provenance (review F-3).

## 1.0.0 - 2026-09-08

Initial release. Hetzner blueprint per spec at `projects/blueprint-library/specs/hetzner-round-7-spec-2026-09-07.md`.

- Mints capability `containerHost` and global topic `containerHostContract`.
- Six REQs, nine USs, four TACs, four ADRs; five Node-only probes.
- Extends the shared throwaway-Hetzner-server fixture with a minimal compose stack (`compose.yaml`, `caddy/Caddyfile`, `secrets/web-token` file mount, `src/serve.mjs` healthchecked stub) plus five `run-<probe>.mjs` delegate shims.
- Compose-config-lint carries four mutation switches (`SIMULATE_MISSING_HEALTHCHECK`, `SIMULATE_UNCLASSIFIED_RESTART`, `SIMULATE_UNCLASSIFIED_LOG_DRIVER`, `SIMULATE_EVENT_SECRECY_LEAK`); secrets-as-files-scan carries `SIMULATE_PLAINTEXT_SECRET`; caddyfile-validate carries `SIMULATE_INVALID_CADDYFILE` and runs `caddy validate` via the `caddy:2` container when a local `caddy` binary is not on PATH.
- Reverse-proxy choice elicited via `reverse-proxy` (caddy default per a platform reverse-proxy decision; traefik and none alternatives); Coolify rejected verbatim per a platform reverse-proxy decision; log driver elicited via `log-driver` (journald default; loki opt-in).
- Consumers: a follow-up work item migrates an internal ops host's remote-library compose stack onto this contract after 0.25.0 ships; blueprint acceptance never depends on that migration.
