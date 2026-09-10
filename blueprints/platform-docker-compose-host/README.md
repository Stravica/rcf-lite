# platform-docker-compose-host v1.0.0

A container-orchestration facade over docker compose running on a Linux `cloudHost`. Provides `containerHost` for consumer blueprints that ship as containers.

## What it commits

Six REQs, nine USs, four TACs, four ADRs and five Node-only probes. Ships the containerHostContract topic on top of a cloudHost provider.

| REQ | Contract |
|---|---|
| REQ-001 | `compose.yaml` at repo root is the single-source runtime topology (service-per-container, named networks and volumes, `.env` for non-secret config) |
| REQ-002 | Every secret injected via a docker compose secrets file mount; no plaintext literal in `compose.yaml` (grep-refuse); references `security-secrets-management` when applied |
| REQ-003 | Healthcheck contract on every HTTP-terminating service; `docker compose config` refuses on missing |
| REQ-004 | Restart discipline enforced at lint: `unless-stopped` on long-running, `on-failure` on jobs; unclassified value refuses |
| REQ-005 | Zero-downtime reverse-proxy reload via bind-mounted config; verb per proxy; no non-2xx or dropped connection inside the elicited window (10 s default) |
| REQ-006 | Log shipping to the elicited `observability-logging` sink: `journald` default matching Debian 12 / Ubuntu 24.04 baseline; `loki` opt-in when the project runs Grafana |

## Capability

- `containerHost` (extends `blueprint-authoring.md` section 6a).

## Suggested companions

- `logging`: every `composeStackReady`, `containerHealthy`, `containerCrashed` and `reverseProxyReloaded` event writes through the applied logger; a logging companion supplies the factory and the log-driver binding.
- `errorHandling`: a healthcheck timeout, a compose lint refusal, a secret-file-mode mismatch, a reload window overshoot constructs an internal error record; an error-handling companion supplies the record factory and the boundary.

## Elicits (via `elicits[]`)

- `reverse-proxy`: `caddy` (the shipped default, matching a common Linux-host baseline that already runs Caddy) | `traefik` (alternative for docker-label auto-discovery) | `none` (alternative for projects fronted only by a Cloudflare-tunnel sibling).
- `docker-engine-channel`: `stable` (default) | `test`.
- `compose-file-location`: `repo-root` (default) | `compose/compose.yaml`.
- `healthcheck-default-kind`: `http` (default) | `tcp` | `command`.
- `log-driver`: `journald` (default per ADR-3904) | `loki` (opt-in).
- `reload-window-seconds`: default `10`.

## ADR shape

- ADR-3901 container host contract: scope `global` on new topic `containerHostContract`; standards trace clause `Docker Compose file reference AND Docker Engine install-on-Ubuntu docs`.
- ADR-3902 reverse proxy: elicited, `caddy` default; standards trace clause `Caddy docs AND Traefik docs`.
- ADR-3903 reject Coolify: rejected by platform decision ("it shadows what the blueprints contract and adds its own DB and UI as a second source of state"); standards trace clause `generic enterprise practice`.
- ADR-3904 log driver: elicited, `journald` default; standards trace clause `generic enterprise practice`.

## Probes

Five modules under `contributions/probes/`, each writes an envelope to `.rcf/reports/blueprints/platform-docker-compose-host/<probe>.json`:

- `compose-config-lint` (accountBound: false; anchors AC-composeHost-healthcheckLint, AC-composeHost-restartClassification, AC-composeHost-logDriverClassification). Mutations: `SIMULATE_MISSING_HEALTHCHECK`, `SIMULATE_UNCLASSIFIED_RESTART`, `SIMULATE_UNCLASSIFIED_LOG_DRIVER`, `SIMULATE_EVENT_SECRECY_LEAK`.
- `secrets-as-files-scan` (accountBound: false; anchors AC-composeHost-secretsAreFiles, AC-composeHost-secretShape). Mutation: `SIMULATE_PLAINTEXT_SECRET`.
- `caddyfile-validate` (accountBound: false; anchors AC-composeHost-reverseProxyArtefactValid). Runs a local `caddy` binary when present, otherwise the `caddy:2` container via `docker run --rm`. Mutation: `SIMULATE_INVALID_CADDYFILE`. Skipped when `REVERSE_PROXY` is not `caddy`.
- `real-account-minimal-stack-up` (accountBound: true; anchors AC-composeHost-upClean). Provisions the throwaway server, `scp`s the compose stack, runs `docker compose up -d --wait`, asserts every declared service reaches healthy inside the elicited timeout, tears down in `always()`. Records `accountBoundSkipped: true` without `CI_HAS_HETZNER_ACCOUNT`.
- `real-account-reload-burst` (accountBound: true; anchors AC-composeHost-zeroDowntimeReload). Fires an `undici` burst against the caddy service while `docker compose exec caddy caddy reload` runs, asserts every request returns 2xx inside the elicited window with no dropped connection, tears down in `always()`. Records `accountBoundSkipped: true` without `CI_HAS_HETZNER_ACCOUNT`.

## Running the probes

From the shared throwaway-server fixture directory:

```
cd packages/rcf-lite/test/fixtures/hetzner-throwaway-server
node ./run-compose-config-lint.mjs && node ./run-secrets-as-files-scan.mjs && node ./run-caddyfile-validate.mjs
```

Real-account probes gate on `CI_HAS_HETZNER_ACCOUNT`:

```
cd packages/rcf-lite/test/fixtures/hetzner-throwaway-server
CI_HAS_HETZNER_ACCOUNT=true HCLOUD_TOKEN=$HETZNER_ACCOUNT_API_KEY node ./run-real-account-minimal-stack-up.mjs && node ./run-real-account-reload-burst.mjs
```

## Fixture extension path

round-7 (`deploy-hetzner-server`) minted the shared fixture at `packages/rcf-lite/test/fixtures/hetzner-throwaway-server/`. the container-host slice EXTENDS that fixture, never duplicates it: `compose.yaml`, `caddy/Caddyfile`, `secrets/web-token`, `src/serve.mjs` and five `run-<probe>.mjs` delegate shims land alongside the earlier release `provision.mjs`/`destroy.mjs`/`sweep-orphans.mjs`.  (`edge-cloudflare-tunnel`) extends the same fixture further; consumers of that fixture see one folder, one manifest, three tracks worth of runtime.

## When to reach for this blueprint

- Any project running a containerised stack on a `cloudHost` (`deploy-hetzner-server` provides the shipped v1.0.0 provider).
- Any project that wants secrets as file mounts (not environment literals), healthchecks that gate boot, a checked-in reverse-proxy artefact, and a log driver on the elicited sink.
