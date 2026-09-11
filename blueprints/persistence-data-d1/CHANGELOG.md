# Changelog

## 1.1.6 - 2026-09-11

facade-round-trip AC-13101-4 (missing-binding refusal) row is de-claimed to conformanceOnly (anchorAcId=null on the row; the module anchor is unchanged). The refusal is thrown by the local fixture's openFacade before any call reaches the D1 engine, so no engine-returned request id or resource identifier is available; the credential-leak-absent predicate is retained on the row. The earlier CHANGELOG description of a locally minted callTrackingId as a resource identifier is corrected: the field is dropped from the probe's evidence and the language does not appear here.

## 1.1.5 - 2026-09-11

AC-13101-4 anchor now positively asserts no-credential-leak: a sentinel account id and API token are stashed on the env passed to openFacade alongside the missing DB binding, and the row verdict requires neither sentinel appears in the refusal error message, kind, bindingName, stack or JSON serialisation (credentialLeakAbsent=true); the row records a locally minted row correlation string on the row (no engine identifier is available on the refusal path). CHANGELOG history restored (the 1.1.0/1.1.1/1.1.2 entries were unintentionally overwritten in the previous pass) and the 1.1.5 mixed-pass-5 entry is prepended.

## 1.1.4 - 2026-09-11

Adds a contributions/probes/ pack (facade-round-trip, migrations-forward-only, real-account-d1-round-trip) with a fixture-side sqlite-backed D1 binding and a facade module under packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/. Probes run against the fixture on Node 24 and against real Cloudflare D1 on the account-bound branch (CI_HAS_CLOUDFLARE_ACCOUNT gate + CF_ACCOUNT_ID + CF_API_TOKEN, one variable per skip row).

Anchoring: facade-round-trip anchors AC-13101-4 (missing-binding refusal) as its module anchor; the facadeReady, insert, find and delete rows de-claim (conformanceOnly, anchorAcId=null) with limitations naming AC-13101-1 or AC-13101-2 (source-tree sole-reader and facade-surface scan are not observable at runtime). migrations-forward-only anchors AC-13102-2 as its module anchor; each row de-claims with a limitation naming AC-13102-2 or AC-13102-3 (wrangler CLI not spawned; internal table name is not the configured d1_migrations). real-account-d1-round-trip anchors AC-13101-1 as its module anchor; every live row de-claims with the limitation naming AC-13101-1 (raw REST is not the source-tree sole-reader property). Live create rows record only what the create call proves; presentAfterDelete is set only on the teardown row after delete + inventory. An auth failure with credentials PRESENT is a FAIL, not an accountBoundSkipped row. Live scratch resources are named qa-e-d1-<short> and deleted with a post-run inventory check.

## 1.1.2 - 2026-09-10

Second closure fix on the dimension-d ownership sweep for REQ-004: removed the `prepare().bind()` and `db.exec(<consumer string>)` literals from `ADR-1404.context` (the argument now names the prepared-statement discipline owned on `TAC-1401-persistence-data-d1-facade.responsibilities[2]`); added the one-line owner pointer to the facade-shape asset and the batch-usage asset naming the TAC responsibility indices they demonstrate. ADR-1404 bumped to 1.0.1. Chain-consistency lint zero on pass 1 and pass 2.

## 1.1.1 - 2026-09-10

Dimension-d single-definition-ownership cleanup on REQ-004: REQ description now references the prepared-statement discipline owned on TAC-1401 (facade responsibilities) rather than restating the vendor prepare/bind/exec literals. `deliveredBy` re-pointed at `TAC-1401-persistence-data-d1-facade.responsibilities.prepare` so the pass-2 delivery-carried check resolves against surface text present on the TAC. Chain-consistency lint zero on pass 1 and pass 2.

## 1.1.0 - 2026-09-09
Adds deliveredBy on REQ-001. Adds ownerRef and disposition to every AC. Closes chain-contradiction specimen F-3 by settling the allowed query surface on ADR-1404 (db.exec refused on the facade's public verbs and on consumer code; permitted only inside the migration runner, out of consumer reach). No new contributions.



Review-fix (2026-09-09): Version bumped from 1.0.1 to 1.1.0 to reflect the net-added AC contributions on existing stories (migration-D1-binding failure paths added under US-13101; deploy-gate quota-exhausted added under US-13102). Prior 1.0.1 entry reclassified as prose-only; this bump covers the AC additions per section 8.

Adds deliveredBy on REQ-002 through REQ-007 (six of seven mandatory REQs). Sweeps vendorCitation onto fixed ACs resting on vendor facts (AC-13103-1, AC-13104-3, AC-13105-2).
