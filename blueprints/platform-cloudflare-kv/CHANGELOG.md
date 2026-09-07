# Changelog

All notable changes to `platform-cloudflare-kv` are recorded here. The shape follows Keep a Changelog and Semantic Versioning per the blueprint authoring standard.

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
- The loader's supported `when` block on `elicits[]` only accepts `requiresCapability` arrays, so the elicited `kv-metadata-field-pattern` cannot yet gate on an `elicitedNonEmpty` predicate for `kv-binding-name`. A future loader minor extending `validateElicits` would close that gap; the elicit fires unconditionally today and the guide teaches the pattern.
