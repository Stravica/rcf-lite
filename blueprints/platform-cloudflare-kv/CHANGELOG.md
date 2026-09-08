# Changelog

All notable changes to `platform-cloudflare-kv` are recorded here. The shape follows Keep a Changelog and Semantic Versioning per the blueprint authoring standard.

## 1.0.2 (2026-09-08)

H-2 follow-up (`w-2026-09-08-dave-017`, addendum item 6 fixture defect): the real-account KV probe now self-provisions its own throwaway namespace, closing the second-tier undeclared-env skip HQ hit at the real-account gate on 2026-09-08 (`REAL RUN: PARTIAL`, `MERGE DECISION: HOLD`). No shipped-code capability change.

### Changed

- `real-account-eventual-consistency-smoke.mjs` rewritten against a new self-provisioning fixture shim at `packages/rcf-lite/test/fixtures/cf-platform/h2-cf-kv-real-account-shim.mjs`. The shim mints a scratch KV namespace under the frozen throwaway prefix `h2-cf-probe-integrity-scratch-kv-`, writes a fixture key under `h2-storage-smoke-`, polls up to 60 seconds bounded for same-region visibility, deletes the key, and destroys the namespace on exit. Positive evidence captured on every real-account run: namespace id, exact scratch title, key, PUT / GET / DELETE status codes, elapsed ms.
- Removed the second-tier `CF_KV_NAMESPACE_ID` gate that produced the undeclared skip at the H-2 real-account gate. The declared env for a real-account run is now `CI_HAS_CLOUDFLARE_ACCOUNT` + `CF_ACCOUNT_ID` + `CF_API_TOKEN` (optional test override `CF_API_BASE_URL`), enumerated in the probe's `report.extra.envDeclared` and mirrored in the shim's `DECLARED_ENV` export.
- Teardown is fail-safe and idempotent: a mid-run crash surfaces the minted id through the shim's persisted scratch record; the shim's separate `sweepOrphans` entry point lists over the account and filters on the throwaway prefix. Sweep is structurally unable to select a non-prefixed name (three independent guards: prefix assert on mint, prefix assert on destroy against the record, prefix assert on the live-listing observation; sweep-only prefix filter mirrors the destroy assertions). A dedicated sweep-safety test at `packages/rcf-lite/test/fixtures/cf-platform/test/h2-cf-kv-real-account-shim.test.mjs` seeds the mock account with the ten live production script names on the operator account plus a sneaky mid-string-prefix name and asserts sweep selects zero of them.

### Added

- Self-contained mock CF REST API at `packages/rcf-lite/test/fixtures/cf-platform/test/mock-cf-api-server.mjs` (Node `node:http` only, zero-dep) implementing the KV namespaces + values endpoints the shim hits. Test at `test/h2-cf-kv-probe-e2e.test.mjs` boots the mock in-process, points the shim at it via `CF_API_BASE_URL`, and drives the probe end-to-end to prove the mint / evidence-capture / teardown / zero-orphans loop before the HQ real-account run ever executes.

## 1.0.1 (2026-09-08)

H-2 hardening train (`h2-cf-platform-probe-integrity`): probe-integrity patch across the four Cloudflare-platform blueprints. No capability change.

### Changed

- Re-anchored all five KV probes and the README from the defunct `AC-5xxx` id space to the shipped `AC-31xxx` band (nine shipped ACs: `AC-31101-1`, `AC-31102-1`, `AC-31103-1`, `AC-31103-2`, `AC-31104-1`, `AC-31105-1`, `AC-31106-1`, `AC-31107-1`, `AC-31108-1`). Every one of the nine now has a runtime observable through a re-anchored probe. Anatomy-test assertions in `packages/rcf-lite/test/blueprint/platform-cloudflare-kv-anatomy.test.js` moved with the re-anchor. Dispatch addendum ruling 1.
- Moved the `SIMULATE_CACHE_MISS` mutation switch out of `cache-aside-hit-then-miss.mjs` into fixture shim `packages/rcf-lite/test/fixtures/cf-platform/h2-cf-kv-cache-aside-shim.mjs`; the probe body holds zero `SIMULATE_` token references (`AC-15401-1` mutation-purity rule).
- Moved the `SIMULATE_PII_LEAK` mutation switch out of `event-secrecy.mjs` into fixture shim `packages/rcf-lite/test/fixtures/cf-platform/h2-cf-kv-event-secrecy-shim.mjs`; the probe body holds zero `SIMULATE_` token references.
- Reworded the "fake clock" comment on `cache-aside-hit-then-miss.mjs` header to name the local test double honestly ("elicited deterministic clock the fixture advances").
- Reworded the `Known limitations` (CHANGELOG) and `Known mechanism-reach gaps` (README) entries on the loader `elicits[]` `when` block predicate to name the loader-capability uplift as follow-up work item `w-2026-09-08-h3-loader-elicit-when-predicates` (0.26.x capability change, out of H-2's 0.25.x patch scope per Dave ruling 1). The entry describes the current shipped shape and points forward to the follow-up.

### Fixed

- Removed the committed fail envelope at `.rcf/reports/blueprints/platform-cloudflare-kv/event-secrecy.json`; committed a shipped-code pass envelope in its place. Regenerated the other KV envelopes so committed envelopes reflect the re-anchored shipped-code runs.

### Chain slice

- Train chain slice minted inside the reserved H-2 block: `REQ-150..154`, `US-15001..15401`, twelve `AC-15xxx` ACs, `TS-180..184` with eleven TCs, `FBS-170..174`, `CN-520..529` (seven used, three reserved). Full mint transcript in the H-2 PR provenance.

## 1.0.0 (2026-09-07)

### Added

- v1.0.0 mint of the `platform-cloudflare-kv` blueprint, category `platform`, capabilities `["keyValueStore"]`. Ships a facade over Cloudflare Workers KV with typed put/get/delete/list verbs, a cache-aside helper, four metadata-only lifecycle events (`facadeReady`, `kvHit`, `kvMiss`, `kvWrite`), and an eventual-consistency note in the guide that sets the elicited cache-aside TTL as the staleness ceiling readers observe.
- 5 REQs (`platform-cloudflare-kv-REQ-001..005`), 8 USs (`platform-cloudflare-kv-US-31101..31108`), 3 TACs (`TAC-3201` facade, `TAC-3202` cache-aside, `TAC-3203` event sink), 3 ADRs (`ADR-3201` scope-global on new topic `keyValueStoreContract` with `standardsTraceClause: Cloudflare Workers KV documented consistency model`; `ADR-3202` default cache-aside TTL 60 seconds floor 1 second `elicited: true`; `ADR-3203` key naming convention `recommendedDefault: prefixed` `elicited: true`).
- 5 Node-only probes under `contributions/probes/`: `facade-round-trip`, `cache-aside-hit-then-miss`, `event-secrecy`, `list-with-prefix` (four local probes driving the in-memory KV driver on the `cf-platform` fixture) and `real-account-eventual-consistency-smoke` (`accountBound: true`; skipped in CI without `CI_HAS_CLOUDFLARE_ACCOUNT`).
- Elicited parameters on `blueprint.json`: `kv-binding-name` (default `CACHE`), `kv-default-cache-ttl-seconds` (default `60`, floor `1`), `kv-metadata-field-pattern` (default `{v:1}`), `kv-key-naming-convention` (default `prefixed`).
- `suggestedCompanions`: `logging` (for the event-sink boundary) and `errorHandling` (for the error record shape).
- Extends the shared `cf-platform` sample-app fixture with the `[[kv_namespaces]]` binding block (name `CACHE`), the sole-reader KV facade module (`src/kv-facade.mjs`), the cache-aside helper (`src/cache-aside.mjs`), and the in-memory KV driver (`src/kv-driver.mjs`) that realises the Workers KV binding shape so the local probes drive without a live-KV dependency.
- Anatomy test at `packages/rcf-lite/test/blueprint/platform-cloudflare-kv-anatomy.test.js` covers `TS-080..087` on the T-1 chain slice (blueprint shape, contributions cross-check, probe module contracts, fixture files, ADR bodies and clauses, guide sections and URLs, three-state probed verdicts).

### Known limitations

- The `real-account-eventual-consistency-smoke` probe records `accountBoundSkipped: true` and aggregates to `pass` when `CI_HAS_CLOUDFLARE_ACCOUNT` is unset (spec section 3.5 pass-with-skip). Full mechanism reach requires a CI environment with the paired `CF_ACCOUNT_ID`, `CF_KV_NAMESPACE_ID` and `CF_API_TOKEN` env vars.
- The four local probes drive an in-memory KV driver whose shape matches the Workers KV binding at the facade boundary. Vendor surface changes beyond that boundary (a new list cursor format, a header-only limit) are not caught by the local probes; the real-account smoke is the mechanism-reach closure for that gap.
- The loader's supported `when` block on `elicits[]` currently accepts only `requiresCapability` arrays, so the elicited `kv-metadata-field-pattern` fires unconditionally rather than gating on an `elicitedNonEmpty` predicate for `kv-binding-name`. The elicit fires unconditionally today and the guide teaches the pattern; a loader-capability uplift extending `validateElicits` to accept an `elicitedNonEmpty` predicate is captured as follow-up work item `w-2026-09-08-h3-loader-elicit-when-predicates` (0.26.x capability change, out of H-2's 0.25.x patch scope per Dave ruling 1).
