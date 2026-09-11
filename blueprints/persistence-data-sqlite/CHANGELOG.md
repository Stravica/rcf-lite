# Changelog

## 1.1.3 - 2026-09-11

Third fix pass (criterion e closure-3). wal-checkpoint TRUNCATE size row and walCheckpoint event row de-claimed with limitations naming REQ-005 (crash recovery, not checkpoint mechanics) and REQ-006 (walCheckpoint is not one of the four defined lifecycle events). facade-round-trip CRUD rows and event row de-claimed with limitations naming REQ-007 (sole-importer is a repo-scan property) and REQ-006 (fixture-added entry* events are not among the four defined). boot-open-migrate storeOpened-count row de-claimed with limitation naming AC-5101-1 (single named export invoked exactly once before handlers bind is not observable from a sink event); reopen row de-claimed with limitation naming AC-5101-3 (reopen idempotency is a related but distinct property). probe-utils normalised sentinel and thrown rows now carry an evidence object.


## 1.1.2 - 2026-09-11

Adds a contributions/probes/ pack (boot-open-migrate, facade-round-trip, wal-checkpoint) with a fixture-side node:sqlite store facade under packages/rcf-lite/test/fixtures/probe-pack-persistence-data-sqlite/. Probes run against the real node:sqlite engine on Node 24, record real integer row ids, the applied-migration list from schema_migrations, and the wal_checkpoint(TRUNCATE) counters, and the WAL sidecar shrink after truncate. No account gate.
Fix pass on this patch: facade-round-trip re-anchors CRUD rows to REQ-007 (facade boundary + narrow verbs) and events row to REQ-006 (event log with defined fields); wal-checkpoint re-anchors to REQ-005 (WAL crash safety, the durability posture no shipped AC states directly); probe-utils writes the normalised results into the persisted report; every detail line starts with the first eight words of the anchored AC or REQ text.



Fix pass (2026-09-11, criterion e closure): wal-checkpoint pass predicate now requires a non-null pre-checkpoint WAL size AND a reduction to zero; aggregate([]) fails; DECLARED_ENV derived and asserted.

## 1.1.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.1.0 - 2026-09-09
Adds deliveredBy on REQ-001. Adds ownerRef on AC-5106-1 and AC-5110-2 (onEvent). Closes chain-contradiction specimen F-1: US-5109 AC-5109-3 now recovers a defective committed migration via a new numbered forward-only file (never editing the committed file in place), aligning with TAC-603 and the migration catalog's forward-only rule. Adds disposition to every AC.



Review-fix (2026-09-09): Version bumped from 1.0.1 to 1.1.0 to reflect the net-added AC contributions on existing stories (permission-denied and concurrent-WAL failure paths added under US-5101; disk-full mid-migration added under US-5104). Prior 1.0.1 entry reclassified as prose-only; this bump covers the AC additions per section 8.

Adds deliveredBy on REQ-002 through REQ-011 (ten of eleven mandatory REQs).
