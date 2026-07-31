# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0, breaking changes are signalled by a minor version bump.

## [Unreleased - 0.7.0 train]

Verify-side of the 0.7.0 train (review d-2026-07-31-009 N-1 stub; content authored in the release pass). The chain reader gains AC-level derivation per the twin ruling (serviceAttestations, fbsUiBearing, fbsIds); reports gain present-only perAcVerdicts with the four 0.7.0 verdict classes (MOCK-ONLY-DECLARED, BLOCKED-BY-DECLARATION, UI-BASELINE-UNMET, BROWSER-VERIFICATION-MISSING); provisioning shares the core service seed set. Version stays 0.1.x-unreleased on main; the 0.7.0-line bump happens at the release pass across the whole train.

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
