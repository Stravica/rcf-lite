# Changelog

## 1.1.0 - 2026-09-09

Adds deliveredBy on REQ-001, REQ-002 and REQ-004. Adds ownerRef on AC-37102-1 (manifest schema), AC-37105-1 (cloud-init template) and AC-37106-1 (firewall shape). Adds runtime-clause naming the cloudHost applied capability on REQ-001. Adds disposition to every AC. Adds provisioner-failure and idempotency ACs across the family: US-37101 (AC-37101-2 credential missing, AC-37101-3 dependency not ready, AC-37101-4 repeat-boot idempotency, per section 7a worked example), US-37102 (AC-37102-2 malformed manifest, AC-37102-3 firewall opens ssh to 0.0.0.0/0), US-37103 (AC-37103-2 provisioner failure surfaces, AC-37103-3 repeat-apply idempotency), US-37104 (AC-37104-2 malformed template refusal), US-37106 (AC-37106-2 firewall applied at provision time), US-37107 (AC-37107-2 scheduled snapshot per elicited cadence, with off suppression), US-37108 (AC-37108-2 snapshot-on-demand upstream failure), US-37109 (AC-37109-2 secret exclusion by source-tree grep, AC-37109-3 event fires once per lifecycle moment).

## 1.0.1

H-1 hardening patch train (round-7 real-account gate  defect list). Fixes nine real-path defects in the shared throwaway-Hetzner-server fixture at packages/rcf-lite/test/fixtures/hetzner-throwaway-server/ so the three T-1 real-account probes return aggregateVerdict pass on a live Hetzner Cloud project unpatched, and destroy plus sweep-orphans never leak a server. Every existing v1.0.0 contribution id byte-identical apart from the cloud-init template bodies (baseline unchanged; adds a NOPASSWD sudoers.d fragment for the deploy user) and the three T-1 mocked probe bodies (mutation-purity clean plus a new rendered-file assertion).

Defect list fixed:

- (1) provision.mjs reads snake_case fields off the hcloud server create response (public_net.ipv4.ip, datacenter.location.name, server_type.name). v1.0.0 read camelCase and threw on every real-account provision, so destroy.mjs could not find the server to tear down.
- (2) provision.mjs renders the cloud-init user-data via src/cloud-init-renderer.mjs before hcloud server create fires and writes it to hetzner/servers/rendered/<name>.cloud-init.yaml. v1.0.0 expected a file that no shipped code wrote; every provision failed on missing user-data.
- (3) src/cloud-init-renderer.mjs resolves each ssh key name to its .publicKey via hcloud ssh-key describe --output json and inlines the material into ssh_authorized_keys under the deploy user. v1.0.0 inlined the key NAME and the deploy user had no working authorized_keys entry.
- (4) destroy.mjs and sweep-orphans.mjs never pass --output json to a hcloud <resource> delete verb (the delete verbs reject the flag with unknown flag: --output). The tolerant JSON parser accepts arrays, objects and the delete verbs short informational text output.
- (5) src/snapshot-verb.mjs shells hcloud server create-image --type snapshot --description <label> <server-id> and recovers the created snapshot id via hcloud image list --type=snapshot --output json by matching the serverName label. v1.0.0 called a non-existent hcloud image create-image verb.
- (6) src/ssh-baseline-check.mjs polls port 22 open and a trivial ssh true exec (bounded up to 6 minutes) before firing the six baseline checks. v1.0.0 spawned ssh immediately after provision and every check timed out on connection refused because cloud-init had not finished.
- (7) contributions/templates/cloud-init.yaml.tmpl adds a write_files sudoers.d fragment at /etc/sudoers.d/90-deploy-nopasswd (mode 0440) that grants NOPASSWD to the deploy user, so the sudoed baseline checks (cloud-init status --wait, ufw status, iptables -L, systemctl is-active fail2ban) never block on a tty prompt.
- (9) provision.mjs reads an env override RCF_LITE_CI_SSH_KEY_NAME (per-key comma-separated) for the manifest sshKeyIds, with the manifest value staying the default when the override is unset. Documented in the fixture README.

Also: the three T-1 mocked probe modules (cloud-init-render-lint, manifest-schema-validate, hcloud-dry-run-mock) no longer read any process.env.SIMULATE_ switch inside the probe body per the H-1 mutation-purity gate row. The switches live entirely inside fixture-side files (src/cloud-init-renderer.mjs, src/hcloud-mock.mjs, src/provisioner-facade.mjs and the fixture-side run-manifest-schema-validate.mjs shim) and alter INPUT only. The hcloud-dry-run-mock probe now consumes the SAME rendered cloud-init file the real path consumes (renderer writes it, both the mock and real path read it) and asserts an ssh public-key line under the deploy user plus a NOPASSWD directive naming that user (H-1 REQ-145 / AC-14501-1). Report envelopes under .rcf/reports/blueprints/deploy-hetzner-server/ regenerated from the real run.

Chain: the operator estate hardening block H-1 REQ-145..149 / TS-175..179 / FBS-165..169 / CN-510..519 per the operator estate chain-block ruling 2026-09-08. Real run under the project maintainer one-off approval 2026-09-08: yes, one-off for round 7 gates; Ensure that after any testing etc the Hertner account leaves NO orphaned resources behind. Leave it in the state it started in.

Defect (8) T-2 and T-3 stub drivers are OUT of scope for H-1 (the review train owns them).

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
maintainer ruling 2026-09-07 09:50Z (decisions 18 through 24 approved as
recommended, "round 7 - agreee to all").

Review-fix (2026-09-09): Adds three option-binding ACs to close section 7c on the elicits catalogue - provisioning-tool raw-api (AC-37101-5), server-type SKU enum (AC-37103-4 naming every shipped SKU), location enum (AC-37103-5 naming every shipped datacentre). Adds deliveredBy on REQ-003, REQ-005, REQ-006. Sweeps vendorCitation onto fixed ACs resting on vendor facts (AC-37101-2, AC-37105-1, AC-37108-1, AC-37108-2, AC-37108-3).
