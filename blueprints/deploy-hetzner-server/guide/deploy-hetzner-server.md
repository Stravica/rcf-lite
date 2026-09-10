# deploy-hetzner-server guide

Practical guide for the operator applying `deploy-hetzner-server`
v1.0.0. Covers manifest authoring, the two provisioner paths, the
hardening baseline, snapshot posture, elicitation shortcuts, and
the runtime probe rig.

## Prerequisites

- A Hetzner Cloud project and API token. The token binds to one
  project; a fresh throwaway project keeps the blast radius small
  during onboarding.
- `hcloud` on `PATH` when `provisioning-tool` is `hcloud`. Install:
  Homebrew `brew install hcloud` on macOS, or download the OS/arch
  tarball from https://github.com/hetznercloud/cli/releases/latest,
  verify against `checksums.txt`, drop the binary on `PATH`. Skip
  the install when `provisioning-tool` is `raw-api`; the provisioner
  reaches the REST API directly.
- `security-secrets-management` applied so the facade reads
 `HETZNER_ACCOUNT_API_KEY` from the operator's vault of choice.

## Authoring `hetzner/servers/<name>.json`

Every server declaration lives at
`hetzner/servers/<server-name>.json` and validates against the
shipped `hetzner-server.schema.json`. The fixture manifest at
`packages/rcf-lite/test/fixtures/hetzner-throwaway-server/hetzner/servers/ci-throwaway.json`
is the canonical example. Copy it and edit:

```jsonc
{
  "name": "ops-host",
  "serverType": "cx33",
  "location": "fsn1",
  "image": "ubuntu-24.04",
  "sshKeyIds": ["dave-ed25519", "baz-yubikey"],
  "networkId": null,
  "firewallId": null,
  "cloudInitPath": "hetzner/servers/rendered/ops-host.cloud-init.yaml",
  "labels": {
    "role": "ops-host",
    "blueprint": "deploy-hetzner-server"
  },
  "firewallRules": [
    { "name": "ssh", "protocol": "tcp", "port": 22, "direction": "in", "sourceIps": ["203.0.113.0/24"] },
    { "name": "http", "protocol": "tcp", "port": 80, "direction": "in", "sourceIps": ["0.0.0.0/0", "::/0"] },
    { "name": "https", "protocol": "tcp", "port": 443, "direction": "in", "sourceIps": ["0.0.0.0/0", "::/0"] }
  ],
  "snapshotCadence": "weekly",
  "hetznerManagedBackups": false
}
```

The manifest-schema-validate probe refuses on missing required
fields and on a rule set that opens 22 to `0.0.0.0/0`.

## Rendering cloud-init

Point `cloudInitPath` at a rendered file the provisioner uploads
with `--user-data-from-file`. The fixture renderer at
`packages/rcf-lite/test/fixtures/hetzner-throwaway-server/src/cloud-init-renderer.mjs`
consumes the shipped template with two placeholders:

- `{{name}}` (the manifest name)
- `{{sshAuthorizedKeysBlock}}` (the ssh-authorized_keys entries per
 `sshKeyIds`)

An applying project runs the renderer at manifest edit time (a git
pre-commit hook, or a `pnpm build:cloud-init` script) and commits
the rendered YAML alongside the manifest.

## Six hardening baseline blocks (ADR-3804)

The rendered YAML lands the six blocks per the estate baseline at
`operator/knowledge/systems/environments/hetzner-cloud/overview.md`
Security posture baseline and the Debian unattended-upgrades wiki
at https://wiki.debian.org/UnattendedUpgrades.

1. SSH key-only. `PasswordAuthentication no`.
2. Root disabled. `PermitRootLogin no`.
3. UFW default-deny incoming. `ufw allow 22/tcp 80/tcp 443/tcp`.
4. DOCKER-USER iptables chain. Drops non-conforming egress from
   containers before Docker rules apply.
5. fail2ban SSH jail on port 22. `maxretry 5`, `bantime 3600`.
6. `unattended-upgrades` on for security-only updates
   (`Unattended-Upgrade::Automatic-Reboot "false"`).

Deviation costs an ADR at the applying project level; the shipped
lint refuses on drift.

## When to reach for hcloud vs raw-api

- `hcloud` (default). Choose it when the operator laptop and CI
  runner can install the binary. Small, self-documenting, JSON
  output on `--output json`; the vendor updates it in step with the
  API. Docs: https://github.com/hetznercloud/cli.
- `raw-api`. Choose it when a container base image cannot install
 `hcloud` (Alpine minimal builds, a locked-down runtime). The
  provisioner reaches the REST endpoints directly per
  https://docs.hetzner.cloud/. Vendor SLAs cover the API; the local
  CLI is a convenience layer.

The facade shape is identical on both paths so switching is a one
elicit change.

## When to reach for `cx23` vs `cx33`

- `cx23` (default). Two vCPU, 4 GB RAM, 40 GB SSD. Approximately
  EUR 4.15/month. Fine for the docker-compose stack that ops-host
  runs (fewer than ten containers, each below 300 MB RSS).
- `cx33`. Two vCPU, 8 GB RAM, 80 GB SSD. Approximately EUR
  7.99/month. Reach when the compose stack holds a Postgres, a
  Grafana, or any container that regularly touches 1 GB RSS.
- `cx43`. Four vCPU, 16 GB RAM. Reach for a home for the
 `platform-cloudflare-durable-objects` self-hosted mode or a
  Postgres + Grafana + Loki triad.
- `cpx*`. AMD EPYC. Faster per vCPU; slightly more expensive.
- `cax*`. ARM64. Choose when every runtime component has an ARM
  build (Node, Postgres, cloudflared, most caddy modules do).

Vendor pricing:
https://docs.hetzner.com/cloud/servers/overview.

## Snapshot cadence choices (ADR-3802)

- `weekly` (default). One snapshot every Sunday at 02:00 local. On
  a `cx23`, adds approximately EUR 0.005/month in snapshot storage.
- `daily`. Higher recovery-point objective. On a `cx23`, adds
  approximately EUR 0.035/month.
- `off`. No automatic snapshot. Choose only when Hetzner-managed
  backups are opted-in AND the application layer takes its own
  logical backups on cadence.

Hetzner-managed backups are a separately elicited paid opt-in at
approximately 20 percent of monthly server price (on a `cx23`,
approximately EUR 0.80/month). They compose with the scheduled
snapshot runner; both fire independently.
Vendor pricing:
https://docs.hetzner.com/cloud/servers/backups-snapshots/overview.

## Snapshot-on-demand

Fire a snapshot manually from the applying project's CLI:

```
node ./scripts/snapshot.mjs --server ops-host
```

The script imports the provisioner facade, calls `takeSnapshot`,
and emits `hetznerSnapshotTaken` on the injected sink. The account-
bound probe `real-account-snapshot-on-demand` covers the same shape.

## The shared throwaway-server fixture

Every real-account probe runs against a throwaway `cx23` in `fsn1`
provisioned from the fixture manifest. Fixture location:
`packages/rcf-lite/test/fixtures/hetzner-throwaway-server/`. Cost
ceiling: EUR 0.006/hour per run; destroy runs in `always()`; nightly
`sweep-orphans` cron collects any leak on a 60-minute label-age
cutoff.

round-7 (`platform-docker-compose-host`) and 
(`edge-cloudflare-tunnel`) EXTEND this fixture rather than shipping
a second copy.  mounts the docker + compose verbs on the same
throwaway server after cloud-init seals the baseline;  mounts
`cloudflared` on the runtime the container-host stack stands up.

## Standards trace

Every URL fetched 200 in the ratifying pass before the PR.

- Hetzner Cloud API https://docs.hetzner.cloud/
- Hetzner Cloud CLI https://github.com/hetznercloud/cli
- Hetzner Cloud servers overview https://docs.hetzner.com/cloud/servers/overview
- Hetzner Cloud firewalls overview https://docs.hetzner.com/cloud/firewalls/overview/
- Hetzner Cloud backups-and-snapshots overview https://docs.hetzner.com/cloud/servers/backups-snapshots/overview
- Hetzner Cloud networks overview https://docs.hetzner.com/cloud/networks/overview/
- Hetzner community basic-cloud-config tutorial https://community.hetzner.com/tutorials/basic-cloud-config
- cloud-init https://cloudinit.readthedocs.io/en/latest/
- Debian unattended-upgrades wiki https://wiki.debian.org/UnattendedUpgrades
