## 1.1.8 - 2026-09-11

- Anatomy identifier rule tightened: an identifier is a value the engine or vendor minted (server id, snapshot id, firewall id, image id, engine request id, or the 64-hex Docker container id from `docker inspect`), or a supplied/echo pair with strict equality. A sha256 hash the probe itself computes over an artefact it read is NO LONGER accepted as an identifier - it is a derived-by-the-probe checksum, not an engine echo - and `contentSha256` is removed from the identifier set on both anatomy tests. Context/input fields (`expected`, `engineNote`, `event`, `service`, `path`, `source`, event names, manifest names, container names Compose chose) no longer satisfy the derived-observation half either.
- Offline probes (`manifest-schema-validate`, `cloud-init-render-lint`, `caddyfile-validate`, `compose-config-lint`, `secrets-as-files-scan`) carry no engine-minted identifier by nature: every result row is a `conformanceOnly` de-claim with `anchorAcId: null` and a `limitation` string beginning with a shipped AC id and naming the live probe (or the missing observation) the offline check does not observe. The hash of the artefact the row observed and the validator output stay on the row as derived context.
- Colour on E remains AMBER on `deploy-hetzner-server` (AC-37109-3 has no live once-per-lifecycle observation on this blueprint) and AMBER on every offline-only AC on `platform-docker-compose-host` where the live observation lives on `real-account-minimal-stack-up` or `real-account-reload-burst`.
- Anatomy test title `H-1 deploy-hetzner-server AC-14501-1 ...` is retained as the sole non-plain title so the `testPointer` in `packages/rcf-lite/rcf/test-suites/ts-175.json` stays resolvable; every other anatomy title is a plain descriptive string. A follow-up work item covers the ts-175 pointer rework.

## 1.1.7 - 2026-09-11

- Anatomy assertions on both blueprints moved from key-name allow-lists towards a semantic rule: every result row's evidence must carry an identifier (a vendor / resource id, engine request id, or a supplied/echo pair with strict equality) AND a derived observation (body excerpt, status code, observed mode, engine timestamp, non-zero count, or structured engine-returned object). Event names, file paths, service names, manifest names, resource names the probe chose, and probe inputs are derived context, not identity. Note: this pass still accepted a probe-computed `contentSha256` as identity on offline validators; 1.1.8 removes that acceptance.
- `hcloud-dry-run-mock` AC-37101-1 row now carries `suppliedTool`/`echoedTool` and `suppliedApiHost`/`echoedApiHost` supplied/echo pairs (the probe supplies the values to `createProvisionerFacade`; the facade echoes them on the `provisionerReady` event body). The AC-37109-1 lifecycle-scan row carries `serverId` and `snapshotId` (engine-minted ids from the events being scanned).
- `manifest-schema-validate` and `cloud-init-render-lint` were extended to carry a deterministic sha256 of the manifest or rendered cloud-init on every row as derived context. Note: 1.1.8 reclassifies these rows as `conformanceOnly` (see above); the hash remains on the row as context.
- `hcloud-dry-run-mock` mock-path rows for `AC-37103-1`, `AC-37108-1` and `AC-37109-3` are `conformanceOnly` with `anchorAcId: null` and a shipped-AC limitation. `AC-37103-1` and `AC-37108-1` are also observed live on `real-account-throwaway-server-provision` and `real-account-snapshot-on-demand` respectively. `AC-37109-3` has no live observing probe on this blueprint; its shipped colour is AMBER until a live once-per-lifecycle observation is added.

## 1.1.6 - 2026-09-11

- `createProvisionerFacade` in `src/provisioner-facade.mjs` now defaults the `token` parameter to `process.env.HETZNER_ACCOUNT_API_KEY`, making the facade module the sole non-comment reader of that operator variable across the fixture `.mjs`/`.js` source. Callers that inject an explicit token override the default; the mock probe still passes a synthetic literal.
- `hcloud-dry-run-mock` observes BOTH clauses of AC-37101-1 in a SINGLE result row: the source-tree grep confirms exactly one non-comment reader inside `src/provisioner-facade.mjs` (the row FAILS on zero readers, and FAILS on any reader outside that file), and the `provisionerReady` event fires with the metadata-only `{tool, apiHost}` payload; extra keys on the event body also FAIL the row.
- Mock-path rows that observe the shape of `hetznerServerProvisioned` and `hetznerSnapshotTaken` are `anchorAcId: null`, `conformanceOnly: true`, with a `limitation` string starting with the shipped AC id and naming the live probe that observes the AC. The `hetznerServerDestroyed` mock-path row is `conformanceOnly` on `AC-37109-3` (once-per-lifecycle); no live observing probe is credited on this row, so `deploy-hetzner-server` is AMBER on `AC-37109-3` until a live observation is added. `notObservableHere` is not used on these rows: the ACs are process/live-observable, not shelf-only, so the browser-only marker does not apply.
- The `hetznerServerDestroyed` mock-path row carries `wallClockTime` and `payloadKeys` in evidence alongside the destroyed id.
- AC-37109-1 event-secrecy scan carries a payload-key allow-list per event (subset of the REQ-006 named metadata set). A lifecycle event whose payload carries a key outside the allow-list FAILS the row alongside the token / ssh-key / user-data substring scan.
- `real-account-cloud-init-hardened` FAILS the row when the post-teardown `hcloud server list` call throws.
- Real-account provision and snapshot probes observe lifecycle events (`hetznerServerProvisioned`, `hetznerSnapshotTaken`) via an injected `eventSink`; `snapshot-verb.mjs` emits `hetznerSnapshotTaken` only after the vendor list call confirms the id landed.
- `real-account-throwaway-server-provision` FAILS the row when `hcloud server list` after provision or after teardown throws.
- Firewall validation binds each rule name to its required protocol/direction/port and refuses duplicate names.
- `destroy.mjs` propagates a snapshot-list failure before deletion rather than swallowing it as an empty list.
- Every result row on every probe carries an `evidence` object with BOTH a non-empty identifier (vendor id, event name, artefact path, or resource name) AND a non-empty observation (excerpt, statusCode, mode, wallClockTime, vendor-return value, non-zero count, or derived structured observation).
- Skip helpers `firstTierGateSkipResult` and `secondTierMissingSkipResult` name exactly one variable in `reason` and distinguish `unset` from `set-but-not-true (observed value ...)`; anatomy asserts the reason is one of the declared gate variables in the fixture README env-vars section.
- `probe-utils.mjs` accepts `RCF_REPORT_DIR_OVERRIDE` so local runs write to a scratch directory and the tracked `.rcf/reports/` stays byte-identical to `origin/main`.
- Anatomy test titles are plain descriptive strings (blueprint slug + AC id + one-line summary), with one exception carried on the `H-1 deploy-hetzner-server AC-14501-1 ...` title retained so the `testPointer` in `packages/rcf-lite/rcf/test-suites/ts-175.json` stays resolvable; paired `testPointer` fields in `packages/rcf-lite/rcf/test-suites/ts-140.json` are updated in the same commit.
- Blueprint content otherwise unchanged from 1.1.2 (no ACs, REQs, TACs, ADRs or elicits added or removed).

# Changelog

## 1.1.2 (register patch, 2026-09-10)

- Register: neutral wording on the ADR-3801 consequences field (closes F-1) and the shared throwaway-server fixture paragraph in README (closes F-2); no capability change.

## 1.1.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.1.0 - 2026-09-09

Adds deliveredBy on REQ-001, REQ-002 and REQ-004. Adds ownerRef on AC-37102-1 (manifest schema), AC-37105-1 (cloud-init template) and AC-37106-1 (firewall shape). Adds runtime-clause naming the cloudHost applied capability on REQ-001. Adds disposition to every AC. Adds provisioner-failure and idempotency ACs across the family: US-37101 (AC-37101-2 credential missing, AC-37101-3 dependency not ready, AC-37101-4 repeat-boot idempotency, per section 7a worked example), US-37102 (AC-37102-2 malformed manifest, AC-37102-3 firewall opens ssh to 0.0.0.0/0), US-37103 (AC-37103-2 provisioner failure surfaces, AC-37103-3 repeat-apply idempotency), US-37104 (AC-37104-2 malformed template refusal), US-37106 (AC-37106-2 firewall applied at provision time), US-37107 (AC-37107-2 scheduled snapshot per elicited cadence, with off suppression), US-37108 (AC-37108-2 snapshot-on-demand upstream failure), US-37109 (AC-37109-2 secret exclusion by source-tree grep, AC-37109-3 event fires once per lifecycle moment).

## 1.0.1

Baseline real-account gate hardening. Fixes nine real-path defects in the shared throwaway-Hetzner-server fixture at packages/rcf-lite/test/fixtures/hetzner-throwaway-server/ so the three real-account probes return aggregateVerdict pass on a live Hetzner Cloud project unpatched, and destroy plus sweep-orphans never leak a server. Every existing v1.0.0 contribution id byte-identical apart from the cloud-init template bodies (baseline unchanged; adds a NOPASSWD sudoers.d fragment for the deploy user) and the three mocked probe bodies (mutation-purity clean plus a new rendered-file assertion).

Defect list fixed:

- (1) provision.mjs reads snake_case fields off the hcloud server create response (public_net.ipv4.ip, datacenter.location.name, server_type.name). v1.0.0 read camelCase and threw on every real-account provision, so destroy.mjs could not find the server to tear down.
- (2) provision.mjs renders the cloud-init user-data via src/cloud-init-renderer.mjs before hcloud server create fires and writes it to hetzner/servers/rendered/<name>.cloud-init.yaml. v1.0.0 expected a file that no shipped code wrote; every provision failed on missing user-data.
- (3) src/cloud-init-renderer.mjs resolves each ssh key name to its .publicKey via hcloud ssh-key describe --output json and inlines the material into ssh_authorized_keys under the deploy user. v1.0.0 inlined the key NAME and the deploy user had no working authorized_keys entry.
- (4) destroy.mjs and sweep-orphans.mjs never pass --output json to a hcloud <resource> delete verb (the delete verbs reject the flag with unknown flag: --output). The tolerant JSON parser accepts arrays, objects and the delete verbs short informational text output.
- (5) src/snapshot-verb.mjs shells hcloud server create-image --type snapshot --description <label> <server-id> and recovers the created snapshot id via hcloud image list --type=snapshot --output json by matching the serverName label. v1.0.0 called a non-existent hcloud image create-image verb.
- (6) src/ssh-baseline-check.mjs polls port 22 open and a trivial ssh true exec (bounded up to 6 minutes) before firing the six baseline checks. v1.0.0 spawned ssh immediately after provision and every check timed out on connection refused because cloud-init had not finished.
- (7) contributions/templates/cloud-init.yaml.tmpl adds a write_files sudoers.d fragment at /etc/sudoers.d/90-deploy-nopasswd (mode 0440) that grants NOPASSWD to the deploy user, so the sudoed baseline checks (cloud-init status --wait, ufw status, iptables -L, systemctl is-active fail2ban) never block on a tty prompt.
- (9) provision.mjs reads an env override RCF_LITE_CI_SSH_KEY_NAME (per-key comma-separated) for the manifest sshKeyIds, with the manifest value staying the default when the override is unset. Documented in the fixture README.

Also: the three mocked probe modules (cloud-init-render-lint, manifest-schema-validate, hcloud-dry-run-mock) no longer read any process.env.SIMULATE_ switch inside the probe body per the mutation-purity gate row. The switches live entirely inside fixture-side files (src/cloud-init-renderer.mjs, src/hcloud-mock.mjs, src/provisioner-facade.mjs and the fixture-side run-manifest-schema-validate.mjs shim) and alter INPUT only. The hcloud-dry-run-mock probe now consumes the SAME rendered cloud-init file the real path consumes (renderer writes it, both the mock and real path read it) and asserts an ssh public-key line under the deploy user plus a NOPASSWD directive naming that user (the H hardening requirement / AC-14501-1). Report envelopes under .rcf/reports/blueprints/deploy-hetzner-server/ regenerated from the real run.

Live-account gate carries a maintainer resource-hygiene rule: the throwaway server is destroyed at teardown and the account inventory is confirmed clean before the record is written, so a real run leaves the Hetzner account in the state it started in with zero orphaned servers, snapshots or firewalls.

Defect (8) container-host and edge-tunnel stub drivers are OUT of scope for the shipped real-account gate; a later blueprint release covers them.

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

Trace: hetzner-shipped-spec-2026-09-07.md section 5.1;
maintainer ruling 2026-09-07 09:50Z (decisions 18 through 24 approved as
recommended, "shipped - agreee to all").

Review-fix (2026-09-09): Adds three option-binding ACs to close section 7c on the elicits catalogue - provisioning-tool raw-api (AC-37101-5), server-type SKU enum (AC-37103-4 naming every shipped SKU), location enum (AC-37103-5 naming every shipped datacentre). Adds deliveredBy on REQ-003, REQ-005, REQ-006. Sweeps vendorCitation onto fixed ACs resting on vendor facts (AC-37101-2, AC-37105-1, AC-37108-1, AC-37108-2, AC-37108-3).
