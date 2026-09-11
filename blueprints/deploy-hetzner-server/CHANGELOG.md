## 1.1.4 (criterion-e closure fix pass, 2026-09-11)

- Every result row on every probe (mocked and real-account) now carries its own `evidence` object per Addendum rule 3 (server id created, pre- and post-run inventory ids, cloud-init exit and baseline blocks, snapshot id created and absent, mocked event bodies with shape checks). Report envelopes carry the extras that used to be hoisted to the top level.
- `probe-utils.aggregate([])` and nullish outcomes now FAIL with detail exactly `no checks ran`.
- Skip helpers split into `firstTierGateSkipResult` and `secondTierMissingSkipResult`; every skip row carries `reason` naming exactly one variable, distinguishing `unset` from `set-but-not-true (observed value ...)`. The three real-account probes now emit an honest second-tier skip row when `HCLOUD_TOKEN` is unset while `CI_HAS_HETZNER_ACCOUNT=true`.
- AC anchoring corrected: `hcloud-dry-run-mock` splits into per-AC rows (AC-37101-1 provisionerReady, AC-37103-1 hetznerServerProvisioned, AC-37108-1 hetznerSnapshotTaken, AC-37109-3 hetznerServerDestroyed, AC-37109-1 event-secrecy); the invented `AC-14501-1` rendered-file anchor is retired (Addendum rule 1: do not invent). `manifest-schema-validate` splits per-property (AC-37102-1 nine-required-fields, AC-37106-1 firewall shape, AC-37107-1 snapshotCadence enum).
- `real-account-throwaway-server-provision` runs `hcloud server list` before and after and asserts the created server id lands in the post-run inventory. `real-account-cloud-init-hardened` FAILS when `cloud-init status --wait` returns non-zero (the six baseline checks become diagnostic in that case). `real-account-snapshot-on-demand` observes the `hetznerSnapshotTaken` event shape (`{serverName, snapshotId, ts}`) and the pre-/post-create snapshot inventory.
- Teardown failures now FAIL the verdict on every real-account probe (Addendum rule 5). `destroy.mjs` propagates snapshot-delete failures instead of swallowing them; the probe finally block catches, appends a `TEARDOWN FAILED` note to the detail, records the orphan id on evidence and flips the verdict to `fail`.
- Anatomy test extended to pin the v1.1.4 anchoring and evidence shape on every result row (skipped or otherwise), the two skip tiers, and the `no checks ran` empty-result contract.

## 1.1.3 (criterion-e positive-evidence patch, 2026-09-11)

- Fixture manifest now carries a `Declared env vars (deploy-hetzner-server probes)` table naming every first- and second-tier variable the three T-1 real-account probes read, plus every fixture-mutation switch (positive-evidence gate row 7d). Skip reasons on the real-account probes name `CI_HAS_HETZNER_ACCOUNT` literally; the three real-account probes run under the criterion-e core-shelf hardening dispatch (server id created then absent from the post-run `hcloud server list` inventory, cloud-init render hash and six ssh baseline blocks observed, snapshot id created then deleted with the server). Blueprint content otherwise byte-identical to 1.1.2; anatomy test extended.

# Changelog

## 1.1.2 (register patch, 2026-09-10)

- Register: neutral wording on the ADR-3801 consequences field (closes F-1) and the shared throwaway-server fixture paragraph in README (closes F-2); no capability change.

## 1.1.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.1.0 - 2026-09-09

Adds deliveredBy on REQ-001, REQ-002 and REQ-004. Adds ownerRef on AC-37102-1 (manifest schema), AC-37105-1 (cloud-init template) and AC-37106-1 (firewall shape). Adds runtime-clause naming the cloudHost applied capability on REQ-001. Adds disposition to every AC. Adds provisioner-failure and idempotency ACs across the family: US-37101 (AC-37101-2 credential missing, AC-37101-3 dependency not ready, AC-37101-4 repeat-boot idempotency, per section 7a worked example), US-37102 (AC-37102-2 malformed manifest, AC-37102-3 firewall opens ssh to 0.0.0.0/0), US-37103 (AC-37103-2 provisioner failure surfaces, AC-37103-3 repeat-apply idempotency), US-37104 (AC-37104-2 malformed template refusal), US-37106 (AC-37106-2 firewall applied at provision time), US-37107 (AC-37107-2 scheduled snapshot per elicited cadence, with off suppression), US-37108 (AC-37108-2 snapshot-on-demand upstream failure), US-37109 (AC-37109-2 secret exclusion by source-tree grep, AC-37109-3 event fires once per lifecycle moment).

## 1.0.1

Round-7 real-account gate hardening patch train. Fixes nine real-path defects in the shared throwaway-Hetzner-server fixture at packages/rcf-lite/test/fixtures/hetzner-throwaway-server/ so the three real-account probes return aggregateVerdict pass on a live Hetzner Cloud project unpatched, and destroy plus sweep-orphans never leak a server. Every existing v1.0.0 contribution id byte-identical apart from the cloud-init template bodies (baseline unchanged; adds a NOPASSWD sudoers.d fragment for the deploy user) and the three mocked probe bodies (mutation-purity clean plus a new rendered-file assertion).

Defect list fixed:

- (1) provision.mjs reads snake_case fields off the hcloud server create response (public_net.ipv4.ip, datacenter.location.name, server_type.name). v1.0.0 read camelCase and threw on every real-account provision, so destroy.mjs could not find the server to tear down.
- (2) provision.mjs renders the cloud-init user-data via src/cloud-init-renderer.mjs before hcloud server create fires and writes it to hetzner/servers/rendered/<name>.cloud-init.yaml. v1.0.0 expected a file that no shipped code wrote; every provision failed on missing user-data.
- (3) src/cloud-init-renderer.mjs resolves each ssh key name to its .publicKey via hcloud ssh-key describe --output json and inlines the material into ssh_authorized_keys under the deploy user. v1.0.0 inlined the key NAME and the deploy user had no working authorized_keys entry.
- (4) destroy.mjs and sweep-orphans.mjs never pass --output json to a hcloud <resource> delete verb (the delete verbs reject the flag with unknown flag: --output). The tolerant JSON parser accepts arrays, objects and the delete verbs short informational text output.
- (5) src/snapshot-verb.mjs shells hcloud server create-image --type snapshot --description <label> <server-id> and recovers the created snapshot id via hcloud image list --type=snapshot --output json by matching the serverName label. v1.0.0 called a non-existent hcloud image create-image verb.
- (6) src/ssh-baseline-check.mjs polls port 22 open and a trivial ssh true exec (bounded up to 6 minutes) before firing the six baseline checks. v1.0.0 spawned ssh immediately after provision and every check timed out on connection refused because cloud-init had not finished.
- (7) contributions/templates/cloud-init.yaml.tmpl adds a write_files sudoers.d fragment at /etc/sudoers.d/90-deploy-nopasswd (mode 0440) that grants NOPASSWD to the deploy user, so the sudoed baseline checks (cloud-init status --wait, ufw status, iptables -L, systemctl is-active fail2ban) never block on a tty prompt.
- (9) provision.mjs reads an env override RCF_LITE_CI_SSH_KEY_NAME (per-key comma-separated) for the manifest sshKeyIds, with the manifest value staying the default when the override is unset. Documented in the fixture README.

Also: the three mocked probe modules (cloud-init-render-lint, manifest-schema-validate, hcloud-dry-run-mock) no longer read any process.env.SIMULATE_ switch inside the probe body per the mutation-purity gate row. The switches live entirely inside fixture-side files (src/cloud-init-renderer.mjs, src/hcloud-mock.mjs, src/provisioner-facade.mjs and the fixture-side run-manifest-schema-validate.mjs shim) and alter INPUT only. The hcloud-dry-run-mock probe now consumes the SAME rendered cloud-init file the real path consumes (renderer writes it, both the mock and real path read it) and asserts an ssh public-key line under the deploy user plus a NOPASSWD directive naming that user (REQ-145 / AC-14501-1). Report envelopes under .rcf/reports/blueprints/deploy-hetzner-server/ regenerated from the real run.

Chain: the operator estate hardening block covering REQ-145..149 / TS-175..179 / FBS-165..169 / CN-510..519 per the operator estate chain-block ruling 2026-09-08. Real run under the project maintainer one-off approval 2026-09-08: yes, one-off for round 7 gates; Ensure that after any testing etc the Hertner account leaves NO orphaned resources behind. Leave it in the state it started in.

Defect (8) container-host and edge-tunnel stub drivers are OUT of scope for the round-7 real-account gate pass (the review train owns them).

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
`packages/rcf-lite/test/fixtures/` (`platform-docker-compose-host` and `edge-cloudflare-tunnel` EXTEND it,
they do not ship a second copy).

Trace: hetzner-round-7-spec-2026-09-07.md section 5.1;
maintainer ruling 2026-09-07 09:50Z (decisions 18 through 24 approved as
recommended, "round 7 - agreee to all").

Review-fix (2026-09-09): Adds three option-binding ACs to close section 7c on the elicits catalogue - provisioning-tool raw-api (AC-37101-5), server-type SKU enum (AC-37103-4 naming every shipped SKU), location enum (AC-37103-5 naming every shipped datacentre). Adds deliveredBy on REQ-003, REQ-005, REQ-006. Sweeps vendorCitation onto fixed ACs resting on vendor facts (AC-37101-2, AC-37105-1, AC-37108-1, AC-37108-2, AC-37108-3).
