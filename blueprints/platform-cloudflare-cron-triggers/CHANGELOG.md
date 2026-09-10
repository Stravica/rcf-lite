# Changelog

All notable changes to `platform-cloudflare-cron-triggers` are recorded here. The shape follows Keep a Changelog and Semantic Versioning per the blueprint authoring standard.

## 1.1.3 - 2026-09-10

Positive-evidence rule alignment on the probe pack skip path (authoring standard section 7d).

- Probes: the account-bound skip returns on `contributions/probes/real-account-scheduled-smoke.mjs` now carry a `reason` field naming the exact env var(s) that were unset. The unset-second-tier case (`CF_ACCOUNT_ID` / `CF_WORKER_NAME` / `CF_API_TOKEN`) now records a declared skip on the missing keys rather than failing hard without real-engine evidence: this probe polls analytics for a pre-existing deployed Worker with a per-minute cron and does not deploy a Worker itself, so an unset-second-tier run on an empty account is a declared skip on the missing keys, not a fail. Skip-path probe report regenerated so the shipped shape carries the new field.


## 1.1.2 - 2026-09-10

Capability token named in the requirements layer; owner reference for the scheduled-side record shape.

- Extended REQ-001 description to name the declared `scheduledTrigger` capability token verbatim with a one-line runtime clause tying the token to the single scheduled() handler module that delivers it.
- Added AC-32101-6 on US-32101 as a fixed AC that binds the manifest-declared `scheduledTrigger` token to the handler-module presence assertion the fixture exercises.
- Rewrote REQ-004 description to reference the owning TAC field (`TAC-3303-platform-cloudflare-cron-triggers-event-sink.responsibilities[0]`) for the scheduled-side record shape, rather than restating the whitelist verbatim.

## 1.1.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).


## 1.1.0 (2026-09-09)

### Changed

- Bring criterion b (AC set to the 7a standard with 7b marking) and criterion c (chain consistency, lint clean) up to the September 2026 hardening target on top of shipped v1.0.0. Every acceptance criterion now carries `disposition` (`fixed` or `template`); `AC-32101-1` carries `ownerRef` into TAC-3301 and `vendorCitation` for the Cloudflare Workers scheduled handler contract; `AC-32102-1` carries `ownerRef` into TAC-3302. Every REQ carries `deliveredBy` (four TAC-scoped links). `rcf define blueprint lint-consistency` reports zero pass-1 and pass-2 findings.
- Close chain-contradiction specimen F-1: `AC-32101-1` and the fixture `src/scheduled.mjs` now emit `cronReady` with the cron-vocabulary metadata payload `{event, expression, scheduledTime, outcome, duration}` per TAC-3303's allow-list. The previous KV-shaped payload `{event, key, size, ttl, timestamp}` on the boot ready-check is retired; `TS-090` on the anatomy test asserts the new shape.
- `AC-32102-1` reworded to describe the injected `sink` parameter (no longer restates the literal owned by TAC-3303's interface); no behavioural change in the shipped code path.

### Added (criterion b completion, second pass 2026-09-09)

- Every story on this blueprint now reaches the section 7a AC-set-sufficiency floor. 26 new hand-authored ACs cover the documented failure paths named in the guide and TAC records, per-story range 4-6 (from the 1-2 shipped in the first 1.1.0 pass): US-32101 gains four failure-path ACs (empty routes, invalid sink, repeat-boot idempotency, sole-reader source-tree scan closing F-5); US-32102 gains four ACs (single-handler mode closing F-2, malformed event, duplicate expressions, empty routes at construction); US-32103 gains three ACs (exact-boundary at skewToleranceMs, one millisecond past, early-fire negative delta); US-32104 gains four ACs (handler-throw pre-budget closing F-3 first half, handler-throw post-budget closing F-3 second half, exact-boundary at softBudgetMs, single-cronStalled idempotency); US-32105 gains four ACs (CI gate on bind/fire failures closing F-4, bounded-wait timeout, mid-run crash, teardown discipline); US-32106 gains four ACs (allow-list forbidden-key mutation, empty-payload boundary, expression-literal-is-not-PII exclusion, closure-over-fixture); US-32107 gains three ACs (bounded-wait timeout, partial env-var configuration, non-2xx API response). Every new AC carries `disposition`, most carry `ownerRef` into the owning TAC, and vendor-fact ACs carry `vendorCitation` (scheduled handler, cron triggers, wrangler CLI, workers platform limits) with today's verifiedOn date.
- `rcf define blueprint lint-consistency` still reports zero pass-1 and pass-2 findings. Blueprint stays at v1.1.0 on the same unreleased minor.

### Fixed (review fix pass, 2026-09-09)

- `AC-32105-1` reworded so the warn branch stays a describable probe outcome but no longer states the CI gate behaviour; `AC-32105-2` alone owns the harness gate on non-pass verdicts, resolving the two-AC single-definition-ownership contradiction on US-32105 (review F-1 blocker).
- Enum-branch dispositions on the `cron-dispatcher-mode` elicit set correctly: `AC-32102-1` and `AC-32102-2` (expression-routed branch) and `AC-32102-3` (single-handler branch) flip from `fixed` to `template`; the applying project chooses the mode. Factory-invariant refusal ACs (`AC-32102-4/5/6`) stay `fixed` (review F-4).

## 1.0.0 (2026-09-07)

### Added

- v1.0.0 mint of the `platform-cloudflare-cron-triggers` blueprint, category `platform`, capabilities `["scheduledTrigger"]`. Ships a scheduled() handler over the Cloudflare Workers Cron Trigger event, an expression-routed dispatcher over multiple cron expressions, a skew-tolerance classifier, a soft-budget observer, and five metadata-only lifecycle events (`cronReady`, `cronFired`, `cronSkewed`, `cronStalled`, `cronUnmatched`).
- 4 REQs (`platform-cloudflare-cron-triggers-REQ-001..004`), 7 USs (`platform-cloudflare-cron-triggers-US-32101..32107`), 3 TACs (`TAC-3301` scheduled handler, `TAC-3302` expression-router dispatcher, `TAC-3303` lifecycle-event sink), 3 ADRs (`ADR-3301` scope-global on new topic `scheduledTriggerContract` with `standardsTraceClause: Cloudflare Workers Cron Triggers documented shape`; `ADR-3302` dispatcher mode `elicited: true` `recommendedDefault: expression-routed` when more than one cron expression is elicited; `ADR-3303` default skew tolerance 30 seconds floor 5 ceiling 300 `elicited: true`).
- 5 Node-only probes under `contributions/probes/`: `wrangler-test-scheduled` (drives `wrangler dev --test-scheduled` on the shared cf-platform fixture, `warn` on CLI regression per spec section 3.1), `dispatcher-routing`, `skew-tolerance` (also folds AC-32104 soft-budget as additional results), `event-secrecy` (SIMULATE_PII_LEAK=true mutation surfaces the leaked fields), and `real-account-scheduled-smoke` (`accountBound: true`; skipped in CI without `CI_HAS_CLOUDFLARE_ACCOUNT`).
- Elicited parameters on `blueprint.json`: `cron-expressions` (default `* * * * *`), `cron-dispatcher-mode` (default `expression-routed`), `cron-skew-tolerance-seconds` (default `30`, floor `5`, ceiling `300`), `cron-soft-budget-seconds` (default `30`).
- `suggestedCompanions`: `logging` (for the event-sink boundary) and `errorHandling` (for the handler-failure boundary).
- Extends the shared `cf-platform` sample-app fixture with the `[triggers] crons` block on `wrangler.toml`, the sole-reader scheduled handler (`src/scheduled.mjs`), and the expression-routed dispatcher (`src/dispatcher.mjs`). The `[assets]` block and the `[[kv_namespaces]]` block are preserved verbatim; the scheduled handler does NOT dereference `env.CACHE` (KV stays owned by the facade).
- Anatomy test at `packages/rcf-lite/test/blueprint/platform-cloudflare-cron-triggers-anatomy.test.js` covers `TS-090..096` on the chain slice (blueprint shape, contributions cross-check, probe module contracts, fixture files, ADR bodies and clauses, guide sections and URLs, three-state probed verdicts).

### Known limitations

- The `real-account-scheduled-smoke` probe records `accountBoundSkipped: true` and aggregates to `pass` when `CI_HAS_CLOUDFLARE_ACCOUNT` is unset (spec section 3.5 pass-with-skip). Full mechanism reach requires a CI environment with the paired `CF_ACCOUNT_ID`, `CF_WORKER_NAME` and `CF_API_TOKEN` env vars plus a deployed Worker running a per-minute cron.
- The `wrangler-test-scheduled` probe returns `warn` (never `fail`) on a CLI regression that prevents `wrangler dev --test-scheduled` from binding within 30 seconds; the in-process `dispatcher-routing` and `skew-tolerance` probes carry the runtime evidence for the shipped handler regardless.
- The dispatcher does NOT terminate a handler on soft-budget breach; termination is Cloudflare's platform-level concern. A project that needs hard termination on a stalled fire builds it inside the handler code path against `AbortController`.
- The loader's supported `when` block on `elicits[]` only accepts `requiresCapability` arrays, so `cron-dispatcher-mode` cannot yet gate its `expression-routed` default on `elicitedNonEmpty` over `cron-expressions`. A future loader minor extending `validateElicits` would close that gap; the elicit fires unconditionally today and the guide teaches the pattern.
