# Guide: platform-docker-compose-host v1.0.0

Applies on top of `deploy-hetzner-server` (or any future `cloudHost` provider) and mints `containerHost` for downstream consumers.

## What this blueprint gives you

A docker compose stack as your application runtime on a Linux VM. The compose file is the source of truth for the topology: services, networks, volumes, secrets, healthchecks, restart policy, log driver and the reverse-proxy bind-mount all live in one file at the repo root. Every claim the blueprint makes is provable at gate time by a Node-only probe against a real docker daemon and a real reverse-proxy config.

## Layout

```
<repo-root>/
  compose.yaml            # single-source topology per REQ-001
  .env                    # non-secret config per REQ-001
  caddy/
    Caddyfile             # reverse-proxy artefact per REQ-005 (when reverseProxy=caddy)
  secrets/
    <name>                # file-mount source per REQ-002 (0o400 inside the container)
  src/
    ...                   # your service code, bind-mounted into services
```

## When to reach for Caddy vs Traefik vs none

The `reverse-proxy` elicit is the one you will hit first. The defaults:

- **`caddy` (the shipped default).** Matches a common Linux-host baseline where the target hosts already run Caddy. Small config file, automatic HTTPS in production, `docker compose exec caddy caddy reload` picks up changes instantly. Reach for it whenever you do not have a strong project-side reason for something else. See the Caddy docs at https://caddyserver.com/docs/.
- **`traefik` (alternative).** Reach for it when your project wants docker-label auto-discovery (each service declares its hostname/route via labels in `compose.yaml` and Traefik configures itself). Trade-off: your routing is spread across many service blocks rather than one Caddyfile. See the Traefik docs at https://doc.traefik.io/traefik/.
- **`none` (alternative).** Reach for it when the project is fronted only by the `edge-cloudflare-tunnel` sibling (v1.0.0). The connector terminates at the CF edge and forwards to a service on the internal `web-net` network; no reverse proxy is needed inside compose. The lint refuses to add a `caddy/Caddyfile` when `reverse-proxy` is `none`.

The Coolify note (ADR-3903 body): "reject; it shadows what the blueprints contract and adds its own DB and UI as a second source of state". Recorded as a platform decision. A `platform-coolify-host` sibling may mint on operator demand later.

## Healthcheck contract

Every HTTP-terminating service declares a `healthcheck:` block. The compose-config-lint probe refuses at `docker compose config` on any missing block, naming the service. Defaults per service kind are elicited:

- `http` (default): a `wget --quiet --spider` against the service's `/health` (or `/live`) path.
- `tcp`: a socket connect against the declared port.
- `command`: a bespoke test string the operator supplies.

The stack is not considered up until every declared service reaches healthy inside the elicited timeout; the real-account minimal-stack-up probe proves this on the throwaway server.

## Secrets as files, never literals

Under REQ-002 every secret referenced by any compose service is declared under the top-level `secrets:` key with a `file:` source. Services reference the secret through their service-level `secrets:` array so docker mounts the value at 0o400 inside the container at `/run/secrets/<name>`. The compose file carries no plaintext secret literal (grep-refuse).

When `security-secrets-management` is applied, the source path resolves through that facade. When it is not, the file-based fallback path is: land the secret in `secrets/<name>` on the applying repo under a `.gitignore` line that lists the file, and rotate through the operator's out-of-band vault. Never commit the secret; never inline the value in `compose.yaml` or `.env`.

## When to reach for `journald` vs `loki`

The `log-driver` elicit (ADR-3904):

- **`journald` (default).** Matches the Debian 12 and Ubuntu 24.04 baseline the T-1 cloud-init sets up on the throwaway server. `journalctl -u docker.service` and `journalctl CONTAINER_NAME=<name>` reach the same stream you would see in `docker logs`.
- **`loki` (opt-in).** Reach for it when the applying project runs Grafana. The compose logging block wires each service through the Grafana Loki docker plugin; the observability-logging companion supplies the loki endpoint.

The compose-config-lint refuses on any driver value outside the two. The lint fires before `docker compose up` runs.

## Restart discipline

Under REQ-004: `restart: unless-stopped` on long-running services, `restart: on-failure` on jobs (short-lived services that exit after completion). Any service that declares neither, or declares a value outside those two, refuses at the lint. `SIMULATE_UNCLASSIFIED_RESTART=true` on the compose-config-lint probe exercises the refusal path.

## Zero-downtime reverse-proxy reload

Under REQ-005 the reverse-proxy config lives as a first-class checked-in artefact under `caddy/Caddyfile` (or `traefik/traefik.yaml`). The compose file bind-mounts it read-only into the proxy service. The reload verb is:

- `docker compose exec caddy caddy reload` for Caddy.
- `docker compose kill -s USR1 traefik` for Traefik (the documented equivalent).

During the elicited reload window (10 s default per `reload-window-seconds`) a client burst against the proxy sees no non-2xx and no dropped connection. The real-account reload-burst probe proves this on the throwaway server.

## Running the probes

From the shared throwaway-server fixture directory the three local probes run without a Hetzner account:

```
cd packages/rcf-lite/test/fixtures/hetzner-throwaway-server
node ./run-compose-config-lint.mjs
node ./run-secrets-as-files-scan.mjs
node ./run-caddyfile-validate.mjs
```

`caddyfile-validate` reaches for a local `caddy` binary when one is on PATH; otherwise it runs `caddy validate` inside the `caddy:2` container via `docker run --rm`. Verify the image once with `docker run --rm caddy:2 caddy version`.

Real-account probes require `CI_HAS_HETZNER_ACCOUNT=true` plus `HCLOUD_TOKEN`; without them each records `accountBoundSkipped: true` and the aggregate flips to `pass` per spec section 3.5.

## Applying to your project

Once T-1 (`deploy-hetzner-server`) has provisioned a `cloudHost`:

```
rcf apply platform-docker-compose-host
```

Answer the elicits (reverse-proxy, healthcheck-default-kind, log-driver, reload-window-seconds). The blueprint drops `compose.yaml`, `.env`, `caddy/Caddyfile` (when reverseProxy=caddy), the `secrets/` directory (empty, `.gitignored`) and the READMEs into your applying tree. Then `docker compose up -d --wait` on the applied host brings the stack up.
