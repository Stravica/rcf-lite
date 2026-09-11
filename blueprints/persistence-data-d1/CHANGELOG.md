# Changelog

## 1.1.4 - 2026-09-11

Adds a contributions/probes/ pack (facade-round-trip, migrations-forward-only, real-account-d1-round-trip) with a fixture-side sqlite-backed D1 binding and a facade module under packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/. Probes run against the fixture on Node 24 and against real Cloudflare D1 on the account-bound branch (CI_HAS_CLOUDFLARE_ACCOUNT gate + CF_ACCOUNT_ID + CF_API_TOKEN, one variable per skip row).

Anchoring: facade-round-trip anchors AC-13101-4 (missing-binding refusal) as its module anchor; the facadeReady, insert, find and delete rows de-claim (conformanceOnly, anchorAcId=null) with limitations naming AC-13101-1 or AC-13101-2 (source-tree sole-reader and facade-surface scan are not observable at runtime). migrations-forward-only anchors AC-13102-2 as its module anchor; each row de-claims with a limitation naming AC-13102-2 or AC-13102-3 (wrangler CLI not spawned; internal table name is not the configured d1_migrations). real-account-d1-round-trip anchors AC-13101-1 as its module anchor; every live row de-claims with the limitation naming AC-13101-1 (raw REST is not the source-tree sole-reader property). Live create rows record only what the create call proves; presentAfterDelete is set only on the teardown row after delete + inventory. An auth failure with credentials PRESENT is a FAIL, not an accountBoundSkipped row. Live scratch resources are named qa-e-d1-<short> and deleted with a post-run inventory check.

