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
- `src/ssh-baseline-check.mjs`. Runs the six baseline checks over
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
