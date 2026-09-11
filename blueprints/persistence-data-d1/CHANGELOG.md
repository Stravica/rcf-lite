# Changelog

## 1.1.3 - 2026-09-11

Adds a contributions/probes/ pack (facade-round-trip, migrations-forward-only, real-account-d1-round-trip) with a fixture-side sqlite-backed D1 binding mock and persistence facade under packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/. The real-account probe is gated on CI_HAS_CLOUDFLARE_ACCOUNT and creates a scratch D1 database (name prefix qa-e-d1-), applies a migration and a query, deletes the database and confirms the uuid is absent from the account's D1 inventory (created-then-deleted-resource-id shape). Vendor citation https://developers.cloudflare.com/api/operations/cloudflare-d1-list-databases (verified 2026-09-11).
Fix pass on this patch: facade-round-trip re-anchors named-verb rows to AC-13101-2 and missing-binding to AC-13101-4 (facadeReady one-fires under REQ-001); migrations-forward-only rows anchor AC-13102-2 and AC-13102-3; real-account rows anchor REQ-001 (facade-binding substrate reachability) with the AMBIENT vendor CRUD honesty; a credential-present 4xx/auth failure is a FAIL per fixture README; every detail line starts with the first eight words of the anchored AC or REQ text.




Fix pass (2026-09-11, criterion e closure): real-account probe treats auth failures with credentials PRESENT as FAIL (not accountBoundSkipped); teardown row requires inventoryStatus === 200 and asserts the created uuid is absent from a real post-delete listing. Shared aggregate([]) fails with 'no checks ran'; DECLARED_ENV covers every process.env read across probes and fixture. Fixture README uses generic vault placeholders in reviewer boot.

## 1.1.2 - 2026-09-10

Second closure fix on the dimension-d ownership sweep for REQ-004: removed the `prepare().bind()` and `db.exec(<consumer string>)` literals from `ADR-1404.context` (the argument now names the prepared-statement discipline owned on `TAC-1401-persistence-data-d1-facade.responsibilities[2]`); added the one-line owner pointer to the facade-shape asset and the batch-usage asset naming the TAC responsibility indices they demonstrate. ADR-1404 bumped to 1.0.1. Chain-consistency lint zero on pass 1 and pass 2.

## 1.1.1 - 2026-09-10

Dimension-d single-definition-ownership cleanup on REQ-004: REQ description now references the prepared-statement discipline owned on TAC-1401 (facade responsibilities) rather than restating the vendor prepare/bind/exec literals. `deliveredBy` re-pointed at `TAC-1401-persistence-data-d1-facade.responsibilities.prepare` so the pass-2 delivery-carried check resolves against surface text present on the TAC. Chain-consistency lint zero on pass 1 and pass 2.

## 1.1.0 - 2026-09-09
Adds deliveredBy on REQ-001. Adds ownerRef and disposition to every AC. Closes chain-contradiction specimen F-3 by settling the allowed query surface on ADR-1404 (db.exec refused on the facade's public verbs and on consumer code; permitted only inside the migration runner, out of consumer reach). No new contributions.



Review-fix (2026-09-09): Version bumped from 1.0.1 to 1.1.0 to reflect the net-added AC contributions on existing stories (migration-D1-binding failure paths added under US-13101; deploy-gate quota-exhausted added under user story 13102). Prior 1.0.1 entry reclassified as prose-only; this bump covers the AC additions per section 8.

Adds deliveredBy on REQ-002 through REQ-007 (six of seven mandatory REQs). Sweeps vendorCitation onto fixed ACs resting on vendor facts (AC-13103-1, AC-13104-3, AC-13105-2).
