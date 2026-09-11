# Changelog

## 1.1.3 - 2026-09-11

Adds a contributions/probes/ pack (boot-open-migrate, facade-round-trip, wal-checkpoint) with a fixture-side node:sqlite store facade under packages/rcf-lite/test/fixtures/probe-pack-persistence-data-sqlite/. Probes run against the real node:sqlite engine on Node 24; record real integer row ids, applied-migration lists, and wal_checkpoint(TRUNCATE) counters with the WAL sidecar shrink after truncate. No account gate.

Anchoring: boot-open-migrate anchors AC-5101-3 (open returns only after migrations run); the AC-5101-1 export-order row and the AC-5101-2 path-from-config row are de-claimed (conformanceOnly, anchorAcId=null) with limitations naming their respective ACs; the reopen row de-claims from AC-5101-3. wal-checkpoint anchors AC-5105-3 (durability posture set at open); the size-transition row and the walCheckpoint event row de-claim from AC-5105-1 and AC-5106-1 respectively. facade-round-trip anchors AC-5107-2 as its module anchor with the runtime CRUD rows de-claiming from AC-5107-2 (facade surface not exhaustively scanned) and the event row de-claiming from AC-5106-1. probe-utils normalisation and thrown-error rows carry an evidence object; the fallback anchorAcId is null (harnessError marks the row) rather than any placeholder id.

## 1.1.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.1.0 - 2026-09-09
Adds deliveredBy on REQ-001. Adds ownerRef on AC-5106-1 and AC-5110-2 (onEvent). Closes chain-contradiction specimen F-1: US-5109 AC-5109-3 now recovers a defective committed migration via a new numbered forward-only file (never editing the committed file in place), aligning with TAC-603 and the migration catalog's forward-only rule. Adds disposition to every AC.



Review-fix (2026-09-09): Version bumped from 1.0.1 to 1.1.0 to reflect the net-added AC contributions on existing stories (permission-denied and concurrent-WAL failure paths added under US-5101; disk-full mid-migration added under US-5104). Prior 1.0.1 entry reclassified as prose-only; this bump covers the AC additions per section 8.

Adds deliveredBy on REQ-002 through REQ-011 (ten of eleven mandatory REQs).
