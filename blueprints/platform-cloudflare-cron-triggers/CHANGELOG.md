# Changelog

All notable changes to `platform-cloudflare-cron-triggers` are recorded here. The shape follows Keep a Changelog and Semantic Versioning per the blueprint authoring standard.

## 1.1.0 (2026-09-09)

### Changed

- Bring criterion b (AC set to the 7a standard with 7b marking) and criterion c (chain consistency, lint clean) up to the September 2026 hardening target on top of shipped v1.0.0. Every acceptance criterion now carries `disposition` (`fixed` or `template`); `AC-32101-1` carries `ownerRef` into TAC-3301 and `vendorCitation` for the Cloudflare Workers scheduled handler contract; `AC-32102-1` carries `ownerRef` into TAC-3302. Every REQ carries `deliveredBy` (four TAC-scoped links). `rcf define blueprint lint-consistency` reports zero pass-1 and pass-2 findings.
- Close chain-contradiction specimen F-1: `AC-32101-1` and the fixture `src/scheduled.mjs` now emit `cronReady` with the cron-vocabulary metadata payload `{event, expression, scheduledTime, outcome, duration}` per TAC-3303's allow-list. The previous KV-shaped payload `{event, key, size, ttl, timestamp}` on the boot ready-check is retired; `TS-090` on the anatomy test asserts the new shape.
- `AC-32102-1` reworded to describe the injected `sink` parameter (no longer restates the literal owned by TAC-3303's interface); no behavioural change in the shipped code path.

## 1.0.0 (2026-09-07)

### Added

- v1.0.0 mint of the `platform-cloudflare-cron-triggers` blueprint, category `platform`, capabilities `["scheduledTrigger"]`. Ships a scheduled() handler over the Cloudflare Workers Cron Trigger event, an expression-routed dispatcher over multiple cron expressions, a skew-tolerance classifier, a soft-budget observer, and five metadata-only lifecycle events (`cronReady`, `cronFired`, `cronSkewed`, `cronStalled`, `cronUnmatched`).
- 4 REQs (`platform-cloudflare-cron-triggers-REQ-001..004`), 7 USs (`platform-cloudflare-cron-triggers-US-32101..32107`), 3 TACs (`TAC-3301` scheduled handler, `TAC-3302` expression-router dispatcher, `TAC-3303` lifecycle-event sink), 3 ADRs (`ADR-3301` scope-global on new topic `scheduledTriggerContract` with `standardsTraceClause: Cloudflare Workers Cron Triggers documented shape`; `ADR-3302` dispatcher mode `elicited: true` `recommendedDefault: expression-routed` when more than one cron expression is elicited; `ADR-3303` default skew tolerance 30 seconds floor 5 ceiling 300 `elicited: true`).
- 5 Node-only probes under `contributions/probes/`: `wrangler-test-scheduled` (drives `wrangler dev --test-scheduled` on the shared cf-platform fixture, `warn` on CLI regression per spec section 3.1), `dispatcher-routing`, `skew-tolerance` (also folds AC-32104 soft-budget as additional results), `event-secrecy` (SIMULATE_PII_LEAK=true mutation surfaces the leaked fields), and `real-account-scheduled-smoke` (`accountBound: true`; skipped in CI without `CI_HAS_CLOUDFLARE_ACCOUNT`).
- Elicited parameters on `blueprint.json`: `cron-expressions` (default `* * * * *`), `cron-dispatcher-mode` (default `expression-routed`), `cron-skew-tolerance-seconds` (default `30`, floor `5`, ceiling `300`), `cron-soft-budget-seconds` (default `30`).
- `suggestedCompanions`: `logging` (for the event-sink boundary) and `errorHandling` (for the handler-failure boundary).
- Extends the shared `cf-platform` sample-app fixture with the `[triggers] crons` block on `wrangler.toml`, the sole-reader scheduled handler (`src/scheduled.mjs`), and the expression-routed dispatcher (`src/dispatcher.mjs`). The T-0 `[assets]` block and the T-1 `[[kv_namespaces]]` block are preserved verbatim; the scheduled handler does NOT dereference `env.CACHE` (KV stays owned by the T-1 facade).
- Anatomy test at `packages/rcf-lite/test/blueprint/platform-cloudflare-cron-triggers-anatomy.test.js` covers `TS-090..096` on the T-2 chain slice (blueprint shape, contributions cross-check, probe module contracts, fixture files, ADR bodies and clauses, guide sections and URLs, three-state probed verdicts).

### Known limitations

- The `real-account-scheduled-smoke` probe records `accountBoundSkipped: true` and aggregates to `pass` when `CI_HAS_CLOUDFLARE_ACCOUNT` is unset (spec section 3.5 pass-with-skip). Full mechanism reach requires a CI environment with the paired `CF_ACCOUNT_ID`, `CF_WORKER_NAME` and `CF_API_TOKEN` env vars plus a deployed Worker running a per-minute cron.
- The `wrangler-test-scheduled` probe returns `warn` (never `fail`) on a CLI regression that prevents `wrangler dev --test-scheduled` from binding within 30 seconds; the in-process `dispatcher-routing` and `skew-tolerance` probes carry the runtime evidence for the shipped handler regardless.
- The dispatcher does NOT terminate a handler on soft-budget breach; termination is Cloudflare's platform-level concern. A project that needs hard termination on a stalled fire builds it inside the handler code path against `AbortController`.
- The loader's supported `when` block on `elicits[]` only accepts `requiresCapability` arrays, so `cron-dispatcher-mode` cannot yet gate its `expression-routed` default on `elicitedNonEmpty` over `cron-expressions`. A future loader minor extending `validateElicits` would close that gap; the elicit fires unconditionally today and the guide teaches the pattern.
