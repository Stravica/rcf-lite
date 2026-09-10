# hetzner-throwaway-server fixture

Shared throwaway-Hetzner-server CI fixture for the round-7 tracks.
Minted by round-7 T-1 (`deploy-hetzner-server` v1.0.0); extended by T-2
(`platform-docker-compose-host`) and T-3 (`edge-cloudflare-tunnel`).
Ships one `cx23` shape in `fsn1` from `ubuntu-24.04` under
`hetzner/servers/ci-throwaway.json`, three real-account entry points
(`provision.mjs`, `destroy.mjs`, `sweep-orphans.mjs`), a mocked hcloud
shim (`src/hcloud-mock.mjs`), and six fixture-side reviewer-boot
scripts (`run-<probe>.mjs`) that delegate to the shipped blueprint
probes at
`blueprints/deploy-hetzner-server/contributions/probes/run-<probe>.mjs`.

## Two-line reviewer boot (mocked, no account)

Every local probe runs from THIS directory as written. `hcloud` must be
on `PATH` (see install notes below) for the dry-run mock; the mock
never calls the real API.

```
cd packages/rcf-lite/test/fixtures/hetzner-throwaway-server
node ./run-cloud-init-render-lint.mjs && node ./run-manifest-schema-validate.mjs && node ./run-hcloud-dry-run-mock.mjs
```

Each probe writes its report envelope to
`.rcf/reports/blueprints/deploy-hetzner-server/<probe-name>.json`
under the repo root (tracked in git per spec section 3.4).

## Two-line reviewer boot (real account, throwaway server)

Sets `CI_HAS_HETZNER_ACCOUNT=true` plus `HCLOUD_TOKEN`; provisions,
probes, tears down. Cost ceiling per run: one `cx23` at approximately
EUR 0.006/hour plus snapshot storage. `destroy.mjs` runs in `always()`
regardless of verdict; a leaked server is swept by the nightly
`sweep-orphans.mjs` (60-minute label-age cutoff).

```
cd packages/rcf-lite/test/fixtures/hetzner-throwaway-server
CI_HAS_HETZNER_ACCOUNT=true HCLOUD_TOKEN=$HETZNER_ACCOUNT_API_KEY node ./run-real-account-throwaway-server-provision.mjs && node ./run-real-account-cloud-init-hardened.mjs && node ./run-real-account-snapshot-on-demand.mjs
```

Without `CI_HAS_HETZNER_ACCOUNT` set to `true` every real-account
probe records `accountBoundSkipped: true` and the aggregate flips to
`pass` per hetzner-round-7-spec-2026-09-07.md section 3.5.

## hcloud install

The reviewer needs `hcloud` on `PATH` even for the mocked runs (the
shim intercepts spawn but the binary is expected to resolve). Two
install routes:

- Homebrew: `brew install hcloud` (macOS) or `brew install hcloudcli`
  on some taps; check `hcloud version`.
- Release binary: download the OS/arch tarball from
  https://github.com/hetznercloud/cli/releases/latest, verify against
  `checksums.txt`, drop the extracted `hcloud` binary on your `PATH`.
  This is the route the round-7 T-1 gate reviewer used on
  darwin-arm64 (1.67.0).

## Fixture layout

- `hetzner/servers/ci-throwaway.json`. The manifest the fixture drives:
  `cx23` in `fsn1`, `ubuntu-24.04`, one ssh-key ref, three firewall
  rules (22 from `203.0.113.0/24`, 80 and 443 open, deny all else),
  weekly snapshot cadence, `role=rcf-lite-ci-throwaway` and
  `blueprint=deploy-hetzner-server` labels.
- `src/provisioner-facade.mjs`. The proto facade the mocked probes
  drive. Sole reader of the injected token; emits
  `provisionerReady`, `hetznerServerProvisioned`, `hetznerSnapshotTaken`,
  `hetznerServerDestroyed` with metadata-only payloads per REQ-006.
- `src/hcloud-mock.mjs`. Pure-Node mock returning fixture JSON for
  `server create`, `server list`, `server delete`, `image create-image`,
  `image list`, `firewall create` and `firewall apply-to-resource`.
- `src/cloud-init-renderer.mjs`. Renders
  `blueprints/deploy-hetzner-server/contributions/templates/cloud-init.yaml.tmpl`
  against a manifest; the render-lint probe consumes the output and
  asserts the six baseline blocks.
- `src/ssh-baseline-check.mjs`. Runs the six ssh baseline checks over
  ssh; called only from the real-account cloud-init-hardened probe.
- `src/snapshot-verb.mjs`. Real-account snapshot verb; shells to
  `hcloud image create-image` and verifies via `hcloud image list`.
- `provision.mjs`, `destroy.mjs`, `sweep-orphans.mjs`. Real-account
  entry points.
- `run-<probe>.mjs`. Six fixture-side reviewer-boot shims that
  delegate to the shipped blueprint probe run-* scripts.
- `.gitignore` hides `scratch/` (holds `last-throwaway.json` between
  `provision.mjs` and `destroy.mjs`).

## Induced-failure switches (mutation checks)

Every negative-fires probe carries a mutation switch per spec
section 3.4 lesson 4. Set the env var; the probe FAILS naming the
missing observable.

- `SIMULATE_HARDENING_DRIFT=true` on `run-cloud-init-render-lint.mjs`:
  removes the unattended-upgrades write-file block from the rendered
  YAML; render-lint FAILS naming the missing line.
- `SIMULATE_MANIFEST_INVALID=true` on `run-manifest-schema-validate.mjs`:
  replaces `location` with `mars1`; schema validate FAILS naming the
  offending field.
- `SIMULATE_JSON_PARSE_STRIP=true` on `run-hcloud-dry-run-mock.mjs`:
  the mocked `hcloud server create --output json` returns non-JSON
  stdout; the facade's JSON parser throws and the probe FAILS with a
  defensive-fake finding.
- `SIMULATE_EVENT_SECRECY_LEAK=true` on `run-hcloud-dry-run-mock.mjs`:
  the facade injects the token into the `hetznerServerProvisioned`
  payload; the event-secrecy scan across every event body FAILS with
  a defensive-fake finding naming the leaked field.

## Gate env vars

- `CI_HAS_HETZNER_ACCOUNT` (`true` to exercise the three real-account
  probes; anything else records `accountBoundSkipped`).
- `HCLOUD_TOKEN` (the Hetzner API token; the fixture reads it via
  `security-secrets-management` in a real applying project).
- `RCF_LITE_CI_SSH_KEY` (optional; ssh key path for the runtime
  hardened check; falls back to the default ssh-agent key).
- `RCF_LITE_CI_SSH_KEY_NAME` (optional; comma-separated list of
  Hetzner Cloud ssh-key NAMES to use in place of the manifest
  `sshKeyIds` at provision time; the manifest value stays the default
  when the override is unset. Added in v1.0.1 so a project can point
  the throwaway-server fixture at any real key on its own Hetzner
  project without editing the manifest.).

## Cost ceiling per run

One `cx23` at approximately EUR 0.006/hour plus a snapshot at
approximately EUR 0.05/GB month. Every real-account probe tears down
its server in `always()`; every snapshot is deleted by `destroy.mjs`
in the same call. The nightly `sweep-orphans.mjs` runs a bounded
60-minute label-age cutoff cleanup and emits a
`throwawayServerSweptCount` metric so a run of leaks surfaces on the
observability sink.

## Extending in T-2 and T-3

`platform-docker-compose-host` (T-2) and `edge-cloudflare-tunnel`
(T-3) reuse THIS fixture rather than shipping a second copy.
T-2 mounts its `docker` and `compose` verbs on the same throwaway
server after `run-cloud-init-render-lint.mjs` seals the cloud-init
baseline. T-3 mounts its `cloudflared` connector on the compose
runtime T-2 stands up. Neither track modifies the ci-throwaway
manifest; both add their own `run-<probe>.mjs` shims here that call
their own blueprint probes with the same delegate pattern.

## T-2 (platform-docker-compose-host v1.0.0) extension

Round-7 T-2 extends this fixture with a minimal compose stack that proves
the platform-docker-compose-host v1.0.0 blueprint contract:

- `compose.yaml`: two services (`web`, `caddy`), one named network
  (`web-net`), three named volumes (`web-data`, `caddy-data`,
  `caddy-config`), one compose secret (`web-token`, mounted at
  `/run/secrets/web-token` at 0o400 inside the web container).
- `caddy/Caddyfile`: reverse-proxies the web service under `/` with a
  `/live` handler, admin at `:2019` for the container healthcheck.
- `secrets/web-token`: fixture-only secret material, mode 0o600 on the
  host, mounted read-only by docker as 0o400 inside the container.
- `src/serve.mjs`: Node stub the web service runs; listens on port 8080
  (via `WEB_LISTEN_PORT` from `.env`), returns 200 on `/live`.

## T-2 reviewer boot (mocked, no account)

Every T-2 local probe runs from THIS directory as written. Docker must
be reachable for `compose-config-lint` and `caddyfile-validate` (which
uses the `caddy:2` container when a local `caddy` binary is not on
PATH); the two real-account probes skip without `CI_HAS_HETZNER_ACCOUNT`.

```
cd packages/rcf-lite/test/fixtures/hetzner-throwaway-server
node ./run-compose-config-lint.mjs && node ./run-secrets-as-files-scan.mjs && node ./run-caddyfile-validate.mjs
```

## T-2 reviewer boot (real account, throwaway server)

```
cd packages/rcf-lite/test/fixtures/hetzner-throwaway-server
CI_HAS_HETZNER_ACCOUNT=true HCLOUD_TOKEN=$HETZNER_ACCOUNT_API_KEY node ./run-real-account-minimal-stack-up.mjs && node ./run-real-account-reload-burst.mjs
```

## T-2 induced-failure switches (mutation checks)

- `SIMULATE_MISSING_HEALTHCHECK=true` on `run-compose-config-lint.mjs`:
  strips the healthcheck: block from the web service; the lint FAILS
  naming the service.
- `SIMULATE_UNCLASSIFIED_RESTART=true` on `run-compose-config-lint.mjs`:
  rewrites the web restart policy to `always`; the lint FAILS naming
  the disallowed value.
- `SIMULATE_UNCLASSIFIED_LOG_DRIVER=true` on `run-compose-config-lint.mjs`:
  rewrites the web logging driver to `syslog`; the lint FAILS naming
  the disallowed value.
- `SIMULATE_EVENT_SECRECY_LEAK=true` on `run-compose-config-lint.mjs`:
  injects the fixture web-token literal into the composeStackReady
  event body; the event-secrecy scan FAILS naming the leaked field.
- `SIMULATE_PLAINTEXT_SECRET=true` on `run-secrets-as-files-scan.mjs`:
  writes a plaintext WEB_TOKEN literal into a scratch copy of
  compose.yaml; the probe FAILS naming the file and the literal.
- `SIMULATE_INVALID_CADDYFILE=true` on `run-caddyfile-validate.mjs`:
  appends an unclosed-block syntax error to a scratch copy of the
  Caddyfile; `caddy validate` exits non-zero and the probe FAILS.

## T-3 (edge-cloudflare-tunnel v1.0.0) extension

Round-7 T-3 extends this fixture with a cloudflared connector in both
runtime shapes (compose-service alongside the T-2 web and caddy services
when `containerHost` is applied; systemd-unit for a bare `cloudHost`) and
both hostname modes (access-gated when `zeroTrustGate` is applied;
public-hostname when absent):

- `cloudflared/compose-service/compose-fragment.yaml`: the cloudflared
  compose service (no host ports; restart unless-stopped; journald
  logging).
- `cloudflared/compose-service/cloudflare/tunnels/{public-hostname,access-gated}.yaml`:
  tunnel manifests, differing only in whether the ingress rule attaches
  `originRequest.access.aud`.
- `cloudflared/compose-service/credentials/probe.json.example`:
  placeholder documenting the 0o400 host-mode plus secretRef discipline.
- `cloudflared/systemd-unit/cloudflared.service`: vendor as-a-service
  systemd unit; reads `/etc/cloudflared/probe.yaml`.
- `cloudflared/systemd-unit/cloudflare/tunnels/{public-hostname,access-gated}.yaml`:
  loopback service URLs for the bare cloudHost path.
- `cloudflared/systemd-unit/credentials/probe.json.example`.
- `cloudflared/sidecars/{access-gated,public-hostname}.applied.json`:
  the two applied-blueprint sidecars aud-presence-check reads to prove
  the shape flips.

## T-3 reviewer boot (mocked, no account)

Three local probes; the tunnel schema validator is named
`run-tunnel-manifest-schema-validate.mjs` to avoid colliding with T-1's
`run-manifest-schema-validate.mjs` (T-1's shim still delegates to the
deploy-hetzner-server probe as it did before).

```
cd packages/rcf-lite/test/fixtures/hetzner-throwaway-server
node ./run-tunnel-manifest-schema-validate.mjs && node ./run-cloudflared-config-lint.mjs && node ./run-aud-presence-check.mjs
```

`cloudflared-config-lint` shells to a local `cloudflared` binary when
one is on PATH; when it is not, it runs `cloudflared tunnel --config
/etc/cloudflared/<mode>.yaml ingress validate` via the vendor container
image `cloudflare/cloudflared:2026.8.3` (docker must be reachable).

## T-3 reviewer boot (real account, throwaway server)

```
cd packages/rcf-lite/test/fixtures/hetzner-throwaway-server
CI_HAS_HETZNER_ACCOUNT=true CI_HAS_CLOUDFLARE_ACCOUNT=true \
  node ./run-real-account-connector-healthy.mjs
CI_HAS_HETZNER_ACCOUNT=true CI_HAS_CLOUDFLARE_ACCOUNT=true CI_HAS_CLOUDFLARE_ACCESS=true \
  node ./run-real-account-tunnel-hostname-routes.mjs
```

The access-gated sub-case additionally reads `CI_HAS_CLOUDFLARE_ACCESS`
per the round-7 Q4 ratification; sub-cases skip independently.

## T-3 induced-failure switches (mutation checks)

Every switch lives in the fixture-side delegate shim (the probe modules
never read a `SIMULATE_` env var, per the T-2 gate ruling).

- `SIMULATE_MANIFEST_INVALID_TUNNEL_ID=true` on `run-tunnel-manifest-schema-validate.mjs`:
  rewrites the tunnel-id to a non-uuid literal; schema validate FAILS.
- `SIMULATE_MANIFEST_CREDENTIALS_INLINE=true` on `run-tunnel-manifest-schema-validate.mjs`:
  writes credentials inline (bypassing secretRef); the probe FAILS.
- `SIMULATE_MANIFEST_MISSING_CATCHALL=true` on `run-tunnel-manifest-schema-validate.mjs`:
  strips the catch-all http_status rule; the probe FAILS.
- `SIMULATE_ORIGIN_PORT_OPEN=true` on `run-tunnel-manifest-schema-validate.mjs`:
  rewrites an ingress service URL to `http://0.0.0.0:80`; the probe
  FAILS naming the host public interface bind.
- `SIMULATE_EVENT_SECRECY_LEAK=true` on `run-tunnel-manifest-schema-validate.mjs`:
  seeds a `_leakedEvent` object on the credentials placeholder; the
  event-secrecy scan FAILS naming the leaked field.
- `SIMULATE_INGRESS_INVALID=true` on `run-cloudflared-config-lint.mjs`:
  rewrites the ingress service URL to an invalid address; cloudflared
  tunnel ingress validate exits non-zero and the probe FAILS.
- `SIMULATE_AUD_DROP=true` on `run-aud-presence-check.mjs`:
  removes the `originRequest.access` block from the access-gated
  manifest; the probe FAILS with a defensive-against-silent-degradation
  finding.

## Declared env vars (edge-cloudflare-tunnel probes)

Every environment variable the `edge-cloudflare-tunnel` probes hosted
against this fixture read is declared here. Includes the first-tier
`CI_HAS_*` gate variables and every second-tier variable the
account-bound branch reads once past the gate. An undeclared env var
that a probe or the fixture reads is refused by the positive-evidence
gate row (authoring standard section 7d and the checklist rows in
section 6). The Hetzner-blueprint gate env vars for the wider fixture
are listed under "Gate env vars" above; this section is scoped to the
tunnel-probe surface.

| Env var | Tier | Purpose | Consumed by |
|---|---|---|---|
| `CI_HAS_CLOUDFLARE_ACCOUNT` | first | Gate for the Cloudflare-account branch on both `edge-cloudflare-tunnel` real-account probes. Without it, each probe records `accountBoundSkipped: true` with `reason` naming this variable and aggregates to `pass`. | `edge-cloudflare-tunnel/real-account-connector-healthy`, `edge-cloudflare-tunnel/real-account-tunnel-hostname-routes` |
| `CI_HAS_HETZNER_ACCOUNT` | first | Gate for the Hetzner-account branch on both `edge-cloudflare-tunnel` real-account probes. Unset means the tunnel probe records `accountBoundSkipped: true` with `reason` naming this variable. | `edge-cloudflare-tunnel/real-account-connector-healthy`, `edge-cloudflare-tunnel/real-account-tunnel-hostname-routes` |
| `CI_HAS_CLOUDFLARE_ACCESS` | first | Extra gate for the access-gated sub-case on the hostname-routes probe. A pass on the access-gated sub-case is unreachable without this variable, even with the other two set. | `edge-cloudflare-tunnel/real-account-tunnel-hostname-routes` (access-gated sub-case) |
| `CF_TUNNEL_NAME` | second | Optional; tunnel name the connector-healthy probe queries via the cf-edge shim on the account-bound path. Defaults to a scratch name when unset. | `edge-cloudflare-tunnel/real-account-connector-healthy` |
| `CF_TUNNEL_PUBLIC_URL` | second | Optional; scratch subdomain URL the public-hostname sub-case fetches on the account-bound path. Defaults to a documented scratch value when unset. | `edge-cloudflare-tunnel/real-account-tunnel-hostname-routes` (public-hostname sub-case) |
| `CF_TUNNEL_ACCESS_URL` | second | Optional; scratch subdomain URL the access-gated sub-case fetches on the account-bound path. Defaults to a documented scratch value when unset. | `edge-cloudflare-tunnel/real-account-tunnel-hostname-routes` (access-gated sub-case) |
| `CF_ACCESS_AUDIENCE` | second | Audience tag the two-identity JWT check asserts against on the account-bound access-gated sub-case. Unset on the skip path. | `edge-cloudflare-tunnel/real-account-tunnel-hostname-routes` (access-gated sub-case) |
| `CF_ACCESS_TEAM_SECRET` | second | Team secret used to mint the scratch identity on the account-bound access-gated sub-case. Unset on the skip path. | `edge-cloudflare-tunnel/real-account-tunnel-hostname-routes` (access-gated sub-case) |
| `HCLOUD_TOKEN` | second | Hetzner API token the shared fixture reads on the account-bound path to provision the throwaway server the tunnel probe drives against. Unset on the skip path. | shared `hetzner-throwaway-server` provision seam consumed by `edge-cloudflare-tunnel/real-account-connector-healthy` |
| `CLOUDFLARE_API_TOKEN` | second | Cloudflare API token the cf-edge shim reads on the account-bound path to drive the tunnel control surface. Unset on the skip path. | cf-edge shim consumed by `edge-cloudflare-tunnel/real-account-connector-healthy` |
