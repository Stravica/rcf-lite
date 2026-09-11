## 1.1.4 (criterion-e closure fix pass, 2026-09-11)

- Every result row on every probe (mocked and real-account) now carries its own `evidence` object per Addendum rule 3 (compose service list, on-server response body excerpt, warm baseline, burst counters with elicited window, event bodies with shape checks). Extras that used to be hoisted onto report fields sit under `evidence` on the row that observes them.
- `probe-utils.aggregate([])` and nullish outcomes now FAIL with detail exactly `no checks ran`.
- Skip helpers split into `firstTierGateSkipResult` and `secondTierMissingSkipResult`; every skip row carries `reason` naming exactly one variable, distinguishing `unset` from `set-but-not-true (observed value ...)`. The two real-account probes emit an honest second-tier skip row when `HCLOUD_TOKEN` is unset while `CI_HAS_HETZNER_ACCOUNT=true`.
- AC anchoring corrected: `compose-config-lint` splits into per-AC rows (healthcheck-lint per HTTP service, restart-classification per service, log-driver-classification per service plus a single-choice check that every service matches the elicited log-driver); the previous synthetic `composeStackReady` event-secrecy row is retired (Addendum rule 1: no invented anchor). `caddyfile-validate` gains a bind-mount observation anchored to AC-38107-4 (compose mount carries `:ro`) and a vendor URL plus ISO `verifiedOn` on the Caddy/Docker engine assertion. `secrets-as-files-scan` extends its plaintext scan to `.env` and every file under `caddy/`.
- `real-account-reload-burst` enforces the elicited reload-window-seconds (default 10, source `RELOAD_WINDOW_SECONDS`) and FAILS when the observed `reloadDurationMs` exceeds it. `real-account-minimal-stack-up` records the on-server response body excerpt (`ok`) and the root JSON response so the compose secret mount evidence is on the row.
- Teardown failures now FAIL the verdict on both real-account probes (Addendum rule 5). The compose-down step still records diagnostics, but a non-zero `docker compose down` exit is now propagated onto the result row detail alongside the throwaway-server destroy record.
- Fixture README T-2 declared-env table now names `REVERSE_PROXY`, `LOG_DRIVER`, `RELOAD_WINDOW_SECONDS`, `WEB_APP_NAME`, `WEB_LISTEN_PORT` and `WEB_HEALTH_PATH`, matching every variable the probes and the fixture web service read.
- Anatomy test extended to pin the v1.1.4 anchoring and evidence shape on every result row (skipped or otherwise), the two skip tiers, the `no checks ran` empty-result contract, and the bind-mount observation.

## 1.1.3 (criterion-e positive-evidence patch, 2026-09-11)

- Fixture `compose.yaml`: caddy now exposes host port `80` (was `ports: []`) so the reverse-proxy is externally observable when the operator opens `DOCKER-USER`. The shipped T-1 cloud-init hardening's `DOCKER-USER` DROP still refuses off-host traffic to the docker-mapped port; the T-2 real-account probes therefore probe caddy from the throwaway server itself via ssh + curl to `http://127.0.0.1:80` and record the outside-in fetch as expected-fail diagnostic.
- Compose-stack driver gains `httpProbeOnServer(server, path)` (records status, body excerpt, elapsed seconds; ssh into the throwaway server + curl on the loopback) alongside the existing `httpProbe(url)`. `reloadBurst(server, path, { onServer: true })` runs a `concurrency`-way parallel curl script on the throwaway server itself so per-request ssh overhead does not eat the reload window.

- Real-account probes wired: `real-account-minimal-stack-up` and `real-account-reload-burst` now provision a throwaway cx23, install docker over ssh, ship the fixture compose bundle to `/home/deploy/stack`, run `docker compose up -d --wait`, and HTTP-probe the caddy `:80` endpoint from the runner so the runs carry the "deployed stack URL that answers" 7d evidence shape. Reload-burst fires a 40 request 8 concurrent burst against caddy while `caddy reload` runs and asserts zero drops. Server is destroyed in `always()` and the absence is verified in the post-run `hcloud server list` inventory.
- Fixture manifest gains a `Declared env vars (platform-docker-compose-host probes)` table naming every first- and second-tier variable the T-2 probes read on the account-bound path plus every fixture-mutation switch (positive-evidence gate row 7d). Skip reasons name `CI_HAS_HETZNER_ACCOUNT` literally.
- Fixture ships a new `src/compose-stack-driver.mjs` (bringUpStack, httpProbe, reloadBurst, tearDownStack) that reuses the T-1 fixture's `waitForSshReady`, `waitForCloudInit` and `sshExec` primitives (now exported from `src/ssh-baseline-check.mjs`). Anatomy test extended to pin the driver's contract exports.

# platform-docker-compose-host CHANGELOG

## 1.1.2 - 2026-09-10

Register patch.

- Neutral register in README fixture-extension prose (F-2).

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

Initial release. Hetzner blueprint per the Hetzner host specification.

- Mints capability `containerHost` and global topic `containerHostContract`.
- Six REQs, nine USs, four TACs, four ADRs; five Node-only probes.
- Extends the shared throwaway-Hetzner-server fixture with a minimal compose stack (`compose.yaml`, `caddy/Caddyfile`, `secrets/web-token` file mount, `src/serve.mjs` healthchecked stub) plus five `run-<probe>.mjs` delegate shims.
- Compose-config-lint carries four mutation switches (`SIMULATE_MISSING_HEALTHCHECK`, `SIMULATE_UNCLASSIFIED_RESTART`, `SIMULATE_UNCLASSIFIED_LOG_DRIVER`, `SIMULATE_EVENT_SECRECY_LEAK`); secrets-as-files-scan carries `SIMULATE_PLAINTEXT_SECRET`; caddyfile-validate carries `SIMULATE_INVALID_CADDYFILE` and runs `caddy validate` via the `caddy:2` container when a local `caddy` binary is not on PATH.
- Reverse-proxy choice elicited via `reverse-proxy` (caddy default per a platform reverse-proxy decision; traefik and none alternatives); Coolify rejected verbatim per a platform reverse-proxy decision; log driver elicited via `log-driver` (journald default; loki opt-in).
- Consumers: a follow-up work item migrates an internal ops host's remote-library compose stack onto this contract after 0.25.0 ships; blueprint acceptance never depends on that migration.
