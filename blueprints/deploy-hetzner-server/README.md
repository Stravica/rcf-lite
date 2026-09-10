# deploy-hetzner-server v1.0.0

Ship a Hetzner Cloud Linux VM as the project's `cloudHost`. A facade
over `hcloud` (or the raw Hetzner Cloud REST API) that provisions a
server from a git-managed manifest, lands a six-block hardening
baseline via cloud-init, applies a documented firewall shape, and
emits four metadata-only lifecycle events on the injected sink.

- Category: `deploy` (sibling of `deploy-cloudflare-workers`; the deploy
  family enforces one target per project at apply time).
- Capabilities provided: `cloudHost`.
- Suggested companions: `logging`, `errorHandling`.
- New global topics minted: `linuxCloudHostContract`,
  `snapshotAndBackupCadence`.

## What the blueprint contracts

Six REQs realise the shape:

| REQ | What it commits |
|---|---|
| REQ-001 | The provisioner facade is the sole reader of `HETZNER_ACCOUNT_API_KEY` and emits `provisionerReady` with `{tool, apiHost}` on boot. |
| REQ-002 | Server declarations live at `hetzner/servers/<name>.json` and validate against the shipped JSON Schema (nine required fields). |
| REQ-003 | The cloud-init template renders YAML that lands the six hardening baseline blocks on every provisioned server. |
| REQ-004 | Firewall rule shape: 22 from operator-nominated prefixes, 80 and 443 open, all other inbound denied. Applied at provision time. |
| REQ-005 | Snapshot cadence elicited (weekly default, daily and off alternatives). A snapshot-on-demand verb fires a tagged snapshot. |
| REQ-006 | Four lifecycle events fire with metadata-only payloads; no event body carries the token, an ssh private key, or the user-data body. |

Nine USs (37101 through 37109) split those REQs into one user story
per shape plus three cross-cutting cases: manifest-applies,
cloud-init-hardened, snapshot-on-demand.

Four TACs anchor the mechanism: `TAC-3801` provisioner, `TAC-3802`
manifest schema, `TAC-3803` cloud-init template, `TAC-3804` firewall
shape.

Four ADRs record the load-bearing decisions:

- `ADR-3801` cloud host contract (scope global, new topic
  `linuxCloudHostContract`).
- `ADR-3802` snapshot cadence (scope global, new topic
  `snapshotAndBackupCadence`); weekly default; Hetzner-managed backups
  are an elicited paid opt-in at approximately 20 percent of monthly
  server price per
  https://docs.hetzner.com/cloud/servers/backups-snapshots/overview.
- `ADR-3803` provisioning tool: `hcloud` default, `raw-api`
  alternative, Terraform rejected on second toolchain and state file
  grounds per maintainer ruling 2026-09-07.
- `ADR-3804` hardening baseline: the six blocks named below.

## Two provisioner paths: hcloud and raw-api

The `provisioningTool` elicit takes `hcloud` (default) or `raw-api`.
Both paths sit behind the same facade so consumer code never diverges.

- `hcloud` shells to the Hetzner Cloud CLI with `--output json` for
  every verb. Small, self-documenting, dependency-free (the operator
  installs the binary once). Vendor doc:
  https://github.com/hetznercloud/cli.
- `raw-api` fetches the Hetzner Cloud REST API directly. Useful when
  the target host or CI runner cannot install a binary. Vendor doc:
  https://docs.hetzner.cloud/.

## Hardening baseline (per ADR-3804)

Every rendered cloud-init lands these six blocks. The render-lint
probe asserts each block appears in the YAML; the
`SIMULATE_HARDENING_DRIFT` mutation removes a block and the probe
FAILS naming the missing line.

1. SSH key-only. `PasswordAuthentication no` via
   `/etc/ssh/sshd_config.d/hardening.conf`.
2. Root disabled. `PermitRootLogin no` in the same file.
3. UFW default-deny incoming with 22, 80, 443 permitted per the
   manifest firewall shape.
4. DOCKER-USER iptables chain wired to drop non-conforming egress
   (loaded on boot via `iptables-persistent`).
5. fail2ban SSH jail on port 22.
6. `unattended-upgrades` on for security updates per
   https://wiki.debian.org/UnattendedUpgrades.

## Elicited parameters

| Elicit | Choices | Default |
|---|---|---|
| `provisioning-tool` | `hcloud`, `raw-api` | `hcloud` (ADR-3803) |
| `server-type` | `cx23`, `cx33`, `cx43`, `cpx11`..`cpx41`, `cax11`..`cax31` | `cx23` |
| `location` | `fsn1`, `nbg1`, `hel1`, `ash`, `hil` | `fsn1` (maintainer ruling 2026-09-07 09:50Z) |
| `image` | any Hetzner image slug | `ubuntu-24.04` |
| `ssh-source-prefixes` | CSV of CIDR ranges | `203.0.113.0/24` (example only; supply the real prefix set) |
| `firewall-id` | existing firewall id or empty | empty (create from `firewallRules`) |
| `snapshot-cadence` | `weekly`, `daily`, `off` | `weekly` (ADR-3802) |
| `hetzner-managed-backups` | `true`, `false` | `false` (ADR-3802) |

ssh-key ids are delegated to `security-secrets-management`; the
manifest carries a nonempty array of key references (names) and the
facade never sees the private material.

## Companions

- `logging` supplies the sink factory for the four lifecycle events.
- `errorHandling` supplies the internal-error record factory and the
  facade boundary that turns hcloud non-zero exits, rate-limited API
  calls, firewall-apply failures and cloud-init timeouts into typed
  records.

## The six probes and how to run them

Every probe lives at `contributions/probes/<name>.mjs` with a
`run-<name>.mjs` shim, and is exercised through a fixture-side
`run-<name>.mjs` under
`packages/rcf-lite/test/fixtures/hetzner-throwaway-server/`.

- Three mocked probes run in-process without an API call:
  - `cloud-init-render-lint` (AC-37104-1): renders the template
    against the fixture manifest and asserts the six baseline blocks
    appear. Mutation switch: `SIMULATE_HARDENING_DRIFT=true`.
  - `manifest-schema-validate` (AC-37102-1, also AC-37106-1 and
    AC-37107-1): validates every fixture manifest. Mutation switch:
    `SIMULATE_MANIFEST_INVALID=true`.
  - `hcloud-dry-run-mock` (AC-37101-1 and AC-37109-1): drives the
    facade lifecycle against a mocked hcloud shim and asserts every
    lifecycle event fires with a metadata-only payload; runs an
    event-secrecy scan across every event body. Mutation switches:
    `SIMULATE_JSON_PARSE_STRIP=true` (parser failure) and
    `SIMULATE_EVENT_SECRECY_LEAK=true` (defensive-fake token leak).
- Three account-bound probes gate on `CI_HAS_HETZNER_ACCOUNT`:
  - `real-account-throwaway-server-provision` (AC-37103-1): applies
    the ci-throwaway manifest, asserts the server appears in
    `hcloud server list`, tears down in `always()`.
  - `real-account-cloud-init-hardened` (AC-37105-1): waits for
    `cloud-init status --wait`, runs six ssh baseline checks.
  - `real-account-snapshot-on-demand` (AC-37108-1): fires the snapshot
    verb, asserts a tagged snapshot appears in `hcloud image list`.

Without `CI_HAS_HETZNER_ACCOUNT=true` the three account-bound probes
record `accountBoundSkipped: true` and the aggregate flips to pass per
hetzner-round-7-spec-2026-09-07.md section 3.5.

Reviewer boot from the fixture directory (mocked path, no account):

```
cd packages/rcf-lite/test/fixtures/hetzner-throwaway-server
node ./run-cloud-init-render-lint.mjs && node ./run-manifest-schema-validate.mjs && node ./run-hcloud-dry-run-mock.mjs
```

Every probe writes its report envelope to
`.rcf/reports/blueprints/deploy-hetzner-server/<probe-name>.json`.

## Shared throwaway-server fixture

The one new pattern this round. Lives at
`packages/rcf-lite/test/fixtures/hetzner-throwaway-server/`; ships
`provision.mjs`, `destroy.mjs`, `sweep-orphans.mjs`, the mocked hcloud
shim and the manifest at `hetzner/servers/ci-throwaway.json`. Sibling
`platform-docker-compose-host` and `edge-cloudflare-tunnel` blueprints
EXTEND the fixture rather than shipping a second copy. Cost ceiling:
one `cx23` at approximately EUR 0.006/hour per run; destroy runs in
`always()`; the nightly `sweep-orphans` cron collects any leak with a
60-minute label-age cutoff and emits a `throwawayServerSweptCount`
metric.

## When to reach for this blueprint

Reach for `deploy-hetzner-server` when the project needs a persistent
Linux runtime: something a Cloudflare Worker cannot host (a
long-running process, a container runtime, an outbound network
adapter that needs a stable egress). Sibling `deploy-cloudflare-workers`
still ships every V8-isolate workload the Workers runtime accepts;
this blueprint is the Hetzner-line answer for the workloads Workers
cannot host.

## Consumers

- ops-host is the first infrastructure consumer (migration path).
- Round-7 `platform-docker-compose-host` composes on
  `capabilities: [cloudHost]`.
- Round-7 `edge-cloudflare-tunnel` composes on `cloudHost` (via
  the systemd unit shape) or on `containerHost` (via `platform-docker-compose-host`).

Blueprint acceptance never depends on the ops-host migration.

## Standards trace

- Hetzner Cloud API: https://docs.hetzner.cloud/
- Hetzner Cloud CLI: https://github.com/hetznercloud/cli
- Hetzner Cloud servers overview: https://docs.hetzner.com/cloud/servers/overview
- Hetzner Cloud firewalls overview: https://docs.hetzner.com/cloud/firewalls/overview/
- Hetzner Cloud backups-and-snapshots overview:
  https://docs.hetzner.com/cloud/servers/backups-snapshots/overview
- Hetzner Cloud networks overview: https://docs.hetzner.com/cloud/networks/overview/
- Hetzner community basic cloud-config tutorial:
  https://community.hetzner.com/tutorials/basic-cloud-config
- cloud-init documentation: https://cloudinit.readthedocs.io/en/latest/
- Debian unattended-upgrades wiki: https://wiki.debian.org/UnattendedUpgrades

## Rejected alternatives

- Terraform. Adds a second toolchain and a state file that nobody in
  the estate needs. maintainer ruling 2026-09-07 09:50Z.
- A Load Balancer blueprint. Out of scope for round-7; may ship as
  a follow-up if a second Hetzner consumer needs it.
