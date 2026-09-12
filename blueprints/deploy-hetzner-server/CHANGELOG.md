## 1.1.17 - 2026-09-12

- Event-correlation fixtures now cover BOTH shipped producers (v1.1.17). The existing positive and negative controls in `deploy-hetzner-server-anatomy.test.js` remain built from the field set the first producer emits (`fixtures/hetzner-throwaway-server/provision.mjs` :77-85, the `{event, id, name, primaryIpv4, location, serverType, ts}` field set). A new positive and negative control pair, alongside the existing pair in the same test, is built from the field set the second producer emits (`fixtures/hetzner-throwaway-server/src/provisioner-facade.mjs` :50, :93-100, the `{event, id, primaryIpv4, location, serverType, labels}` field set, with `labels`, without `name` and `ts`); the negative shares the facade shape with a different top-level `id`. Every control calls `walkRecordRow` end to end and the helper correlates on the event body's own `id` field for both shapes.
- `blueprint.json` bumps to 1.1.17 with the anatomy pin in lockstep; `updatedAt` refreshed. Family records regenerated through the shipped run path with no account variables set so each carries `version: "1.1.17"` and the repository walk validates all six.
- Colour on E is unchanged: AMBER on **AC-37101-1**, **AC-37102-1**, **AC-37104-1**, **AC-37106-1**, **AC-37107-1**, **AC-37109-1** and **AC-37109-3**; GREEN on every other shipped AC that a real-account probe observes with an identifier of the required shape present in the record's own engine evidence.

## 1.1.16 - 2026-09-12

- Event-correlation fixtures are exact instances of the shipped `hetznerServerProvisioned` event (v1.1.16). The positive and negative controls in `deploy-hetzner-server-anatomy.test.js` are built from the field set one of the shipped producers emits (`fixtures/hetzner-throwaway-server/provision.mjs` :77-85): every field that producer emits, no invented `detail`, nothing omitted. The negative shares the same shape as the positive with a different top-level `id`, and carries the digits of the row's `evidence.serverId` inside the shipped `name` string field the producer really emits. Every control calls `walkRecordRow` end to end. The second shipped producer (`src/provisioner-facade.mjs` :50, :93-100) emits a different field set (with `labels`, without `name` and `ts`); it is not covered at 1.1.16.
- `blueprint.json` bumps to 1.1.16 with the anatomy pin in lockstep; `updatedAt` refreshed. Family records regenerated through the shipped run path with no account variables set so each carries `version: "1.1.16"` and the repository walk validates all six.
- Colour on E is unchanged: AMBER on **AC-37101-1**, **AC-37102-1**, **AC-37104-1**, **AC-37106-1**, **AC-37107-1**, **AC-37109-1** and **AC-37109-3**; GREEN on every other shipped AC that a real-account probe observes with an identifier of the required shape present in the record's own engine evidence.

## 1.1.15 - 2026-09-12

- Split record walker: `walkRepositoryRecords(dir, expectedVersion)` and `walkHandOffRecords(dir)` (v1.1.15). Two functions, two tests, no shared bypass. The repository walk (what CI runs) has NO conditional branch tied to any override: every present record under `.rcf/reports/blueprints/deploy-hetzner-server/` MUST carry `version === blueprint.version` and a missing or different version FAILS with the file named. The hand-off walk runs only when `RCF_LITE_RECORDS_DIR` is set, applies every row validator to the operator-side records, and asserts in its own message that those records predate the version writer (they carry no `version` field, and hand-editing a version into a hand-off record is out). There is no `RCF_LITE_EXPECTED_VERSION` variable anywhere.
- Event correlation uses the field the shipped producer actually emits (v1.1.15). `hetznerServerProvisioned` (and `hetznerServerDestroyed`) events carry the vendor id on the event body's own top-level `id` field (`packages/rcf-lite/test/fixtures/hetzner-throwaway-server/provision.mjs` and `src/provisioner-facade.mjs`); the walker correlates by exact equality against that field on `event === 'hetznerServerProvisioned' | 'hetznerServerDestroyed'` entries only. A substring over the event `name` or `detail` does NOT correlate, and no invented `serverId` field on an event body is consulted (the producer never emits one).
- Every negative case invokes the operative walker or helper (v1.1.15). Versionless, wrong-version, non-directory, malformed-JSON, empty / non-array / missing results and stub-row cases each build a scratch directory and call `walkRepositoryRecords`; the event-correlation negative builds a synthetic record with a misleading event trail and calls `walkRecordRow` end to end. No duplicated lambdas, no direct `assert.equal` stand-ins.
- `blueprint.json` bumps to 1.1.15 with the anatomy pin in lockstep; `updatedAt` refreshed. Family records regenerated through the shipped run path with no account variables set so each carries `version: "1.1.15"` and the repository walk validates all six.
- Colour on E is unchanged: AMBER on **AC-37101-1**, **AC-37102-1**, **AC-37104-1**, **AC-37106-1**, **AC-37107-1**, **AC-37109-1** and **AC-37109-3**; GREEN on every other shipped AC that a real-account probe observes with an identifier of the required shape present in the record's own engine evidence.

## 1.1.13 - 2026-09-12

- Anatomy per-field validators tightened (v1.1.13). The `exitStatus` and `cloudInit.code` fields on `real-account-cloud-init-hardened / AC-37105-1` must each equal exactly 0; `baselineChecks` accepts only `true`, `"pass"` or `"ok"` per entry (boolean `false`, the string `"fail"`, an empty status, a missing id and every other shape FAIL); `postCreateSnapshotIds` and `postTeardownSnapshotIds` reject `NaN`, `Infinity`, `-Infinity`, zero and negative integers alongside every non-vendor-id shape. Identifier presence is checked by shape (`serverId` and `snapshotId` are positive integers or non-empty numeric strings; a Docker `containerId` is 64-hex) and by presence in the record's own engine evidence, not by string echo.
- Cloud-init both-zero cross-field added (v1.1.13). When both `exitStatus` and `cloudInit` are present in the row's evidence tree, BOTH must be exactly 0. A row that carries `{exitStatus: 0, cloudInit: {code: 137}}` (or the mirror) FAILS - the anyOf letters through on `exitStatus` alone, but the contradictory `cloudInit.code` exposes an unclean run. Rows that carry only one of the two continue to pass on the anyOf as before, so the shipped happy-path record shape is unaffected. A synthetic negative case in `packages/rcf-lite/test/blueprint/deploy-hetzner-server-anatomy.test.js` proves both directions and the accepted `exitStatus === 0 AND cloudInit.code === 0` case.
- Snapshot inventory cross-field from v1.1.12 stays in force: a passing `real-account-snapshot-on-demand / AC-37108-1` row MUST carry `snapshotId` inside `postCreateSnapshotIds` AND MUST NOT carry it inside `postTeardownSnapshotIds`.
- Anatomy record walk rejects empty result sets (v1.1.13). A present record whose `results` is absent, not an array, or an empty array FAILS - a record that carries a probeName but no rows attests to nothing. The v1.1.12 malformed-row rejection (evidence / limitation / reason / `notObservableHere.ac` markers) stays in force. `no local records` remains the only permitted early-return, and only when the directory itself has no record files.
- Anatomy walkers accept an optional records-directory override (v1.1.13): with `RCF_LITE_RECORDS_DIR` set the walker reads `<dir>/deploy-hetzner-server/*.json` instead of the tree default. CI never sets this variable; the operator-side evidence walk uses it.
- Family records regenerated (v1.1.13). Every shipped probe on this blueprint (`cloud-init-render-lint`, `hcloud-dry-run-mock`, `manifest-schema-validate`, `real-account-cloud-init-hardened`, `real-account-snapshot-on-demand`, `real-account-throwaway-server-provision`) was run through its run-shim with NO account variables set: offline / mock probes wrote `conformanceOnly` rows anchored to their shipped ACs, and each real-account probe wrote its single-variable `accountBoundSkipped` row naming `CI_HAS_HETZNER_ACCOUNT`. Six record files live under `.rcf/reports/blueprints/deploy-hetzner-server/`; every row is one the current probe wrote at the current version and the strict walker validates all of them.
- Colour on E is unchanged: AMBER on **AC-37101-1**, **AC-37102-1**, **AC-37104-1**, **AC-37106-1**, **AC-37107-1**, **AC-37109-1** and **AC-37109-3**; GREEN on every other shipped AC that a real-account probe observes with an identifier of the required shape present in the record's own engine evidence.

## 1.1.12 - 2026-09-12

- Anatomy per-field validators tightened (v1.1.12) with explicit `NaN`, `Infinity`, `-Infinity` and negative-value negative cases for every numeric field. `exitStatus` must equal exactly 0 (a non-zero exit or a non-integer value FAILS); `cloudInit.code` must equal exactly 0; `baselineChecks` rejects a boolean `false` verdict and the string `"fail"` (only `true`, `"pass"` and `"ok"` are accepted); and `postCreateSnapshotIds` / `postTeardownSnapshotIds` reject `NaN`, `Infinity`, `-Infinity` and negative integers alongside the earlier non-conformant shapes.
- Snapshot inventory cross-field rule added (v1.1.12): a passing `real-account-snapshot-on-demand / AC-37108-1` row MUST carry `snapshotId` inside `postCreateSnapshotIds` AND MUST NOT carry it inside `postTeardownSnapshotIds`. A synthetic negative case in `packages/rcf-lite/test/blueprint/deploy-hetzner-server-anatomy.test.js` proves both halves fail with the appropriate error.
- Anatomy record walk no longer skips malformed rows as `stubs` (v1.1.12). Every row of every present local record is validated: a row lacking evidence, a `limitation`, a skip `reason` and a `notObservableHere.ac` marker FAILS. A paired synthetic negative case proves the walker rejects a stub row without touching `.rcf/reports/`. `no local records` remains the only permitted early-return, and only when the directory itself has no record files.
- Colour on E is unchanged: AMBER on **AC-37101-1**, **AC-37102-1**, **AC-37104-1**, **AC-37106-1**, **AC-37107-1**, **AC-37109-1** and **AC-37109-3**; GREEN on every other shipped AC that a real-account probe observes with an identifier of the required shape present in the record's own engine evidence.

## 1.1.11 - 2026-09-11

- Anatomy applies row-specific value validators (v1.1.11) instead of null/undefined presence checks alone. `real-account-throwaway-server-provision` requires a documentation-range-shaped `primaryIpv4` and a vendor-listed `location`; `real-account-cloud-init-hardened` requires a non-empty `baselineChecks` array whose entries each carry a non-empty `id` and a `verdict`/`status`, and at least one of an integer `exitStatus` or a `cloudInit` object with a numeric `code`; `real-account-snapshot-on-demand` requires a non-empty vendor-id array for `postCreateSnapshotIds` and a vendor-id array (possibly empty, once the snapshot is destroyed) for `postTeardownSnapshotIds`. Empty strings, empty arrays, `false`, `NaN` and malformed values now FAIL; one negative-proof test per validator is added to `packages/rcf-lite/test/blueprint/deploy-hetzner-server-anatomy.test.js`.
- Unmapped offline / mock probes (`hcloud-dry-run-mock`, `manifest-schema-validate`, `cloud-init-render-lint`) MUST NOT emit `accountBoundSkipped` rows: they have no declared gate variable to skip on, so only `conformanceOnly` rows are permitted. `assertRowsCarry7dShape` now refuses a skip row from any unmapped probe; the change is proved by a paired negative / positive test.
- Anatomy synthetic fixtures carry unmistakably synthetic vendor-id integers (`424242`, `424243`, `4242424`) and a documentation-range `primaryIpv4` (`198.51.100.10`, RFC 5737 TEST-NET-3). No live-account identifiers appear in branch source.
- Anatomy walks any records under `.rcf/reports/blueprints/deploy-hetzner-server/`. Every walkable counting row is validated against the per-probe map, and its mapped identifier must appear in the record's own inventory or event trail (`serverId` in `eventTrail` / `postRunInventory` / `postTeardownServerIds` / `teardown`; `snapshotId` in `postCreateSnapshotIds`); when the directory is empty or absent the walk reports `no local records` and passes.
- Colour on E is unchanged: AMBER on **AC-37101-1**, **AC-37102-1**, **AC-37104-1**, **AC-37106-1**, **AC-37107-1**, **AC-37109-1** and **AC-37109-3**; GREEN on every other shipped AC that a real-account probe observes with a vendor-minted identifier.

## 1.1.10 - 2026-09-11

- Anatomy assertions are now driven by a per-probe requirement map (`PROBE_REQUIREMENTS` in `packages/rcf-lite/test/blueprint/deploy-hetzner-server-anatomy.test.js`). For each counting probe on this blueprint, the map declares the row's required vendor-minted identifier (with a shape check: `serverId` and `snapshotId` are vendor integers or non-empty numeric strings; a Docker `containerId` is a 64-character hex string) plus every required row-specific observation. `real-account-throwaway-server-provision` requires `primaryIpv4` and `location`; `real-account-cloud-init-hardened` requires `baselineChecks` and one of `exitStatus` or `cloudInit` (the live record carries the exit status under `cloudInit.code`); `real-account-snapshot-on-demand` requires `postCreateSnapshotIds` and `postTeardownSnapshotIds`.
- Observation lookup traverses the whole evidence tree, so a required field nested under (for example) `evidence.cloudInit` or an array entry still counts. Any counting row that misses one of the required fields FAILS; a counting row from an offline or mock probe not declared in the map (`hcloud-dry-run-mock`, `manifest-schema-validate`, `cloud-init-render-lint`) FAILS on the spot - those probes may emit only skip / conformanceOnly / notObservableHere rows. Eight negative-proof tests in the same file demonstrate the failure modes (missing observation, cross-probe combination, non-vendor identifier value, unmapped probe with a counting row, and nested-field deep search).
- Colour on E is unchanged: AMBER on **AC-37101-1**, **AC-37102-1**, **AC-37104-1**, **AC-37106-1**, **AC-37107-1**, **AC-37109-1** and **AC-37109-3**; GREEN on every other shipped AC that a real-account probe observes with a vendor-minted identifier.

## 1.1.9 - 2026-09-11

- Ruling for this family, final: a counting row is a LIVE row whose identifier is a value the vendor API minted for the row (server id, snapshot id, firewall id, image id, vendor request id, or the 64-hex Docker container id from `docker inspect`) AND whose derived observation is row-specific (per the per-probe observation fields named on the anatomy test). Mock and offline rows carry no vendor-minted identifier by nature and are always `conformanceOnly` de-claims. There is no supplied/echo path for this family: a value the probe supplied is not evidence the engine echoed it back with vendor-minted state.
- `hcloud-dry-run-mock` rows for AC-37101-1 (sole-reader source scan and provisionerReady shape) and AC-37109-1 (event-secrecy substring scan and payload-key allow-list) are now `conformanceOnly` with `anchorAcId: null` and a `limitation` string beginning with the shipped AC id. Both checks stay on the row as derived context, and the verdict still gates on their outcome. Neither AC has a live observing probe on this blueprint, so both are AMBER on E.
- Anatomy identifier set (both blueprints) is narrowed to `serverId`, `snapshotId`, `firewallId`, `imageId`, `containerId`, `vendorRequestId`, `requestId`. Generic `id` and `resourceId`, and any `supplied<Name>` / `echoed<Name>` pair, are dropped from the identifier set. The derived-observation set is narrowed to the row-specific fields each counting probe carries (provision: `primaryIpv4`, `location`; cloud-init hardened: `exitStatus` and `baselineChecks`; snapshot on demand: `postCreateSnapshotIds` and `postTeardownSnapshotIds`; minimal-stack-up: `observedNames` / `healthcheckKeys` and `observedSecretModes` / `mode`; reload-burst: `total`, `twoXx`, `drops`, `overlapCount`, `clockDomain`). Generic `observed`, `port`, `protocol`, `direction` fields are dropped.
- Colour on E: AMBER on **AC-37101-1**, **AC-37102-1**, **AC-37104-1**, **AC-37106-1**, **AC-37107-1**, **AC-37109-1** and **AC-37109-3** (the offline mock and validator rows on this branch are `conformanceOnly` de-claims; no live probe on this blueprint carries a positive observation of these ACs). GREEN on every other shipped AC that a real-account probe observes with a vendor-minted identifier.
- The mock-purity test title retained for its chain pointer in `packages/rcf-lite/rcf/test-suites/ts-175.json` is left in place; every other anatomy title is a plain descriptive string. Future work covers the ts-175 pointer rework.

## 1.1.8 - 2026-09-11

- Anatomy identifier rule tightened: an identifier is a value the engine or vendor minted (server id, snapshot id, firewall id, image id, engine request id, or the 64-hex Docker container id from `docker inspect`). A sha256 hash the probe itself computes over an artefact it read is NO LONGER accepted as an identifier - it is a derived-by-the-probe checksum, not an engine echo - and `contentSha256` is removed from the identifier set on both anatomy tests. Context/input fields (`expected`, `engineNote`, `event`, `service`, `path`, `source`, event names, manifest names, container names Compose chose) no longer satisfy the derived-observation half either.
- Offline probes (`manifest-schema-validate`, `cloud-init-render-lint`, `caddyfile-validate`, `compose-config-lint`, `secrets-as-files-scan`) carry no engine-minted identifier by nature: every result row is a `conformanceOnly` de-claim with `anchorAcId: null` and a `limitation` string beginning with a shipped AC id and naming the live probe (or the missing observation) the offline check does not observe. The hash of the artefact the row observed and the validator output stay on the row as derived context.
- Colour on E remains AMBER on `deploy-hetzner-server` (AC-37109-3 has no live once-per-lifecycle observation on this blueprint) and AMBER on every offline-only AC on `platform-docker-compose-host` where the live observation lives on `real-account-minimal-stack-up` or `real-account-reload-burst`.
- The mock-purity test title retained for its chain pointer in `packages/rcf-lite/rcf/test-suites/ts-175.json` is left in place; every other anatomy title is a plain descriptive string. Future work covers the ts-175 pointer rework.

## 1.1.7 - 2026-09-11

- Anatomy assertions on both blueprints moved from key-name allow-lists towards a semantic rule: every result row's evidence must carry an engine-minted identifier (a vendor / resource id, engine request id, or a 64-hex Docker container id from `docker inspect`) AND a derived observation (body excerpt, status code, observed mode, engine timestamp, non-zero count, or structured engine-returned object). Event names, file paths, service names, manifest names, resource names the probe chose, and probe inputs are derived context, not identity. Note: at 1.1.7 the anatomy still accepted a probe-computed `contentSha256` as identity on offline validators; 1.1.8 removes that acceptance and 1.1.9 further removes the supplied/echo pair path.
- `hcloud-dry-run-mock` AC-37101-1 row (offline mock-path) carried `tool` and `apiHost` echoed by the facade on the `provisionerReady` event body as derived context, and the AC-37109-1 lifecycle-scan row carried `serverId` and `snapshotId` from the events being scanned. 1.1.9 reclassifies both AC-37101-1 and AC-37109-1 rows as `conformanceOnly` de-claims (offline mock ids are not vendor-minted).
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
- Anatomy test titles are plain descriptive strings (blueprint slug + AC id + one-line summary), with one exception: the mock-purity test title retained for its chain pointer so the `testPointer` in `packages/rcf-lite/rcf/test-suites/ts-175.json` stays resolvable; paired `testPointer` fields in `packages/rcf-lite/rcf/test-suites/ts-140.json` are updated in the same commit.
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

Also: the three mocked probe modules (cloud-init-render-lint, manifest-schema-validate, hcloud-dry-run-mock) no longer read any process.env.SIMULATE_ switch inside the probe body per the mutation-purity gate row. The switches live entirely inside fixture-side files (src/cloud-init-renderer.mjs, src/hcloud-mock.mjs, src/provisioner-facade.mjs and the fixture-side run-manifest-schema-validate.mjs shim) and alter INPUT only. The hcloud-dry-run-mock probe now consumes the SAME rendered cloud-init file the real path consumes (renderer writes it, both the mock and real path read it) and asserts an ssh public-key line under the deploy user plus a NOPASSWD directive naming that user (REQ-145 / AC-14501-1). Report envelopes under .rcf/reports/blueprints/deploy-hetzner-server/ regenerated from the real run.

Live-account gate carries a resource-hygiene rule: the throwaway server is destroyed at teardown and the account inventory is confirmed clean before the record is written, so a real run leaves the Hetzner account in the state it started in with zero orphaned servers, snapshots or firewalls.

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
Approved decisions
recommended, "shipped - agreee to all").

Follow-on ratification (2026-09-09): Adds three option-binding ACs to close section 7c on the elicits catalogue - provisioning-tool raw-api (AC-37101-5), server-type SKU enum (AC-37103-4 naming every shipped SKU), location enum (AC-37103-5 naming every shipped datacentre). Adds deliveredBy on REQ-003, REQ-005, REQ-006. Sweeps vendorCitation onto fixed ACs resting on vendor facts (AC-37101-2, AC-37105-1, AC-37108-1, AC-37108-2, AC-37108-3).
