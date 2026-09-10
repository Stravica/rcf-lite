# Changelog


## 1.1.1 - 2026-09-10

Dimension-d single-definition-ownership cleanup on REQ-004: REQ description now references the prepared-statement discipline owned on TAC-1401 (facade responsibilities) rather than restating the vendor prepare/bind/exec literals. `deliveredBy` re-pointed at `TAC-1401-persistence-data-d1-facade.responsibilities.prepare` so the pass-2 delivery-carried check resolves against surface text present on the TAC. Chain-consistency lint zero on pass 1 and pass 2.

## 1.1.0 - 2026-09-09
Adds deliveredBy on REQ-001. Adds ownerRef and disposition to every AC. Closes chain-contradiction specimen F-3 by settling the allowed query surface on ADR-1404 (db.exec refused on the facade's public verbs and on consumer code; permitted only inside the migration runner, out of consumer reach). No new contributions.



Review-fix (2026-09-09): Version bumped from 1.0.1 to 1.1.0 to reflect the net-added AC contributions on existing stories (migration-D1-binding failure paths added under US-13101; deploy-gate quota-exhausted added under US-13102). Prior 1.0.1 entry reclassified as prose-only; this bump covers the AC additions per section 8.

Adds deliveredBy on REQ-002 through REQ-007 (six of seven mandatory REQs). Sweeps vendorCitation onto fixed ACs resting on vendor facts (AC-13103-1, AC-13104-3, AC-13105-2).
