# deploy-hetzner-server changelog

## 1.0.0

Initial shelf release. Ships an hcloud-shaped provisioner facade
(with a raw-api elicited alternative) as the sole reader of the
Hetzner API token; a manifest schema at `hetzner/servers/*.json`; a
cloud-init template landing the six-block hardening baseline (SSH
key-only, root disabled, UFW default-deny incoming, DOCKER-USER
iptables chain, fail2ban SSH jail, unattended-upgrades); a firewall
rule shape (22 from operator-nominated prefixes, 80/443 open, deny
all else); a snapshot cadence elicit (weekly default, daily and off
alternatives) plus a snapshot-on-demand verb; four metadata-only
lifecycle events (`provisionerReady`, `hetznerServerProvisioned`,
`hetznerSnapshotTaken`, `hetznerServerDestroyed`). Provides the
`cloudHost` capability. Mints two new global topics:
`linuxCloudHostContract` and `snapshotAndBackupCadence`. Suggests
companions `logging` and `errorHandling`.

Ships six Node-only probes: `cloud-init-render-lint`,
`manifest-schema-validate`, `hcloud-dry-run-mock` (three mocked; each
paired with a mutation switch that flips the probe to FAIL), plus
`real-account-throwaway-server-provision`,
`real-account-cloud-init-hardened`,
`real-account-snapshot-on-demand` (three account-bound; skipped
without `CI_HAS_HETZNER_ACCOUNT`).

Mints the shared `hetzner-throwaway-server` fixture under
`packages/rcf-lite/test/fixtures/` (round-7 T-2 and T-3 EXTEND it,
they do not ship a second copy).

Trace: hetzner-round-7-spec-2026-09-07.md section 5.1;
Baz ruling 2026-09-07 09:50Z (decisions 18 through 24 approved as
recommended, "round 7 - agreee to all").
