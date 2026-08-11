# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0, breaking changes are signalled by a minor version bump.

## [0.2.0] - 2026-07-31

Verify-side of the 0.7.0 release train. Ships alongside `@stravica-ai/rcf-build-lite@0.7.0` and `@stravica-ai/rcf-lite-core@0.3.0`; `@stravica-ai/rcf-schemas@0.4.2` already carries the additive 0.7.0 surface. The chain reader gains AC-level derivation per the twin ruling (`serviceAttestations`, `fbsUiBearing`, `fbsIds`); reports gain present-only `perAcVerdicts[]` carrying the four 0.7.0 verdict classes (`MOCK-ONLY-DECLARED`, `BLOCKED-BY-DECLARATION`, `UI-BASELINE-UNMET`, `BROWSER-VERIFICATION-MISSING`); provisioning shares the core service seed set. The run-level `verdict` enum is unchanged so pre-0.7.0 consumers still validate; the report shape stays backward-compatible (no `perAcVerdicts` block on chains without 0.7.0 fields).

Versioning note: the packages carry independent version lines (core 0.3.x, schemas 0.4.x, build 0.6.x -> 0.7.0, verify 0.1.x -> 0.2.0). The "0.7.0 train" names the release programme after the build package's bump; verify sits at its own additive-minor position rather than being lifted to a literal 0.7.0.

### Added

- **Chain-reader AC-level derivation** (`packages/verify/src/chain/index.js`). Flattens `serviceAttestations`, `fbsUiBearing`, and `fbsIds` onto every AC read off the chain, and surfaces `tree.manifest` (`uiBaseline`, `browserVerification[]`) on the read result. Derivation lives HERE per the 2026-07-31 orchestrator ruling; the core package carries a walker-guard test asserting no leakage of these fields into core.
- **Per-AC verdict taxonomy** (`packages/verify/src/verdict/index.js`). Four new verdict classes ride on `report.perAcVerdicts[]`: `MOCK-ONLY-DECLARED`, `BLOCKED-BY-DECLARATION`, `UI-BASELINE-UNMET`, `BROWSER-VERIFICATION-MISSING`. `derivePerAcVerdicts()` returns the `{ acId, verdict, reason }` shape the merged finalise-gate consumer (`packages/build/src/finalise/ingest.js`) expects. The run-level `verdict` enum is deliberately unchanged; per-AC verdicts are a present-only extension.
- **Brief composer suffixes** (`packages/verify/src/engine/brief.js`). Appends a per-service delivery-observable suffix on attested ACs (e.g. "verify a delivery observable exists on the running URL") and a shared-nav / theme-toggle / signed-in-as suffix on UI-bearing ACs. Prompt-only; independence guarantee 4 preserved (no source-tree references, no build-transcript framing).
- **Report `perAcVerdicts[]` present-only block** (`packages/verify/src/report/index.js` + `renderer.js`). Written present-only (omitted when empty), validated against the report schema, round-tripped through report I/O, rendered as its own section.
- **Shared service seed set in provisioning** (`packages/verify/src/provision/index.js`). The provisioning heuristic swaps its local `SERVICE_PATTERNS` regex for `matchServiceSignals()` from `@stravica-ai/rcf-lite-core/patterns/services` (Track A verification-integrity spec §5.3). Single source of truth across build's pre-flight scanner and verify's provisioning; the d-2026-07-30-142 "email channel" miss cannot recur.
- **Engine wiring** (`packages/verify/src/engine/index.js`). Derives per-AC verdicts once from the chain and threads them into every report branch (`NOT-DEPLOYED`, `LAUNCH-FAILURE`, normal), so the finalise gate always sees chain-derived evidence regardless of run outcome.

### Fixed

- **Pre-existing em-dashes in operator-facing renderer + brief output swept.** `packages/verify/src/report/renderer.js` (`VERDICT_LINE` map and the render body) and `packages/verify/src/engine/brief.js` (`instructions` string) replaced their em-dashes with commas / colons / ASCII hyphens. Estate baseline: no em-dashes in third-party-facing prose.

### Contract stability

- **Finalise-gate consumer unchanged.** The merged build-side finalise gate (PR #74, `packages/build/src/finalise/ingest.js:findMockOnlyDeclaredAcs`) and its integration tests (`packages/build/test/cli/finalise-mock-only.test.js`, `packages/build/test/finalise/mock-only-disclosure.test.js`) pass unchanged against the report shape verify now writes; build's 1120-test suite stays green.
- **Backward compatibility.** A pre-0.7.0 chain (no FBS 0.7.0 fields, no manifest 0.7.0 fields) omits `perAcVerdicts` from the report. Older consumers ignore it; older reports without the block flow through the finalise gate with pre-0.7.0 semantics.

## [0.1.1] - 2026-07-22

Documentation-only release. No code, CLI, contract or dependency changes.

### Documentation

- **README consumability pass + reference doc** ([#52](https://github.com/Stravica/rcf-lite/pull/52)): the verify README was rewritten for a consumer landing on the npm package page cold — what the verifier is, how it is invoked (both the `rcf finalise` finalise-gate path and the operator CLI), and the runtime-profile / ship-authority model. Adds `docs/reference.md` as the full flag-and-exit-code reference.

## [0.1.0] - 2026-07-22

First publish. `rcf-verify-lite` v1 — a fresh-context adversarial verifier for the RCF Lite suite.

### Added

- **`rcf-verify` CLI and the v1 verifier engine** ([#48](https://github.com/Stravica/rcf-lite/pull/48)): given an RCF chain (the acceptance contract) and a running instance under a declared runtime profile, it launches an isolated verifier agent that walks real user journeys adversarially — trying to *disprove* the app against its acceptance criteria — and emits a structured verdict stamped with the runtime it ran against. The verifier never reads the source tree, the test suite, or the builder's self-report; its only inputs are the chain and the live URL, which is what makes the verdict independent. Both surfaces of the §6 contract are served by one engine: the build-side finalise gate (invoked as a fresh subprocess by `rcf finalise`) and the operator-invoked CLI.
- **Runtime-profile model**: verdicts carry the runtime they ran against (`deployed` / `ci` / `local-dev`); a SHIP verdict is only issued from a `deployed` or declared-parity environment.
- **Shared isolation env**: spawned under `@stravica-ai/rcf-lite-core`'s §7.3 isolation recipe so the verifier agent starts cold with zero build context.

### Fixed

- **Default-launcher ship-blockers** ([#49](https://github.com/Stravica/rcf-lite/pull/49)): network permissions for the launched verifier, more robust report ingestion, and a structured `LAUNCH-FAILURE` report when the instance under test cannot be reached — the launch path no longer fails silently or ambiguously.
