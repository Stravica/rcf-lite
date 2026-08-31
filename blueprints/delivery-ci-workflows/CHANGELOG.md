# Changelog: delivery-ci-workflows blueprint

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the blueprint version is semver per the authoring standard section 8.

## [2.0.0] - 2026-08-31

Rename from `ci-pipeline` and redesign into a workflow SET the operator declares via a `workflowShape` block; introduces the elicited-check tier (linter, formatter, typecheck, unitTest, securityScan) alongside the preserved v1 RCF-gate mandatory tier; introduces the release workflow scaled across four modes; introduces the optional scheduled-audit workflow; mints one new global topic (`releaseArtefacts`). Ratified 2026-08-31 (Q1 one-blueprint-the-set; Q6-B releaseMode-optional; all other section-12 questions accepted as recommended).

### Changed (BREAKING)

- **Slug rename**: `ci-pipeline` -> `delivery-ci-workflows`. Directory `blueprints/ci-pipeline/` -> `blueprints/delivery-ci-workflows/`. Every contribution id rewrites: prefix-family `ci-pipeline-REQ-NNN` -> `delivery-ci-workflows-REQ-NNN` (numbers preserved), suffix-family `TAC-70N-ci-pipeline-<tail>` -> `TAC-70N-delivery-ci-workflows-<tail>` (numbers and tails preserved).
- **`ciGates` topic answer surface broadened**: the topic string is unchanged; the delivery-side answer is now the mandatory tier (v1 fixed two-gate set, preserved verbatim) plus the elicited tier the project turns on and off through `workflowShape.checkSet` (default: every catalogued elicited check on). Downstream readers of the aggregate report see a longer `gates[]` array; the report shape itself is unchanged.
- **New global topic**: `releaseArtefacts` is minted for the decision area of what the release workflow produces on a release trigger. ADR-709 is the delivery-side answer (the four-mode `releaseMode` enumeration).
- **`workflowShape` elicitation surface required**: the project ships `.rcf/config/delivery-ci-workflows.json` with three required fields (`branchModel`, `checkSet`, `providerHint`) plus one optional field (`releaseMode`, absent = no release workflow, per Q6-B ratification) and two optional dimensions (`scheduledAudit`, `trunkPullRequests`). The workflow-materialiser boot-check refuses on missing required fields or unrecognised values.

### Added

- Six new REQs covering the elicitation surface (REQ-011, REQ-012, REQ-013), branch model (REQ-014, REQ-015), the elicited check catalogue (REQ-016..020), the release workflow (REQ-021), the deploy handoff (REQ-022), and the scheduled-audit dimension (REQ-023). Total REQ count: 23 (up from 10 at v1).
- Corresponding new user stories US-6111..US-6123 (23 total) with additive ACs; the aggregate AC count sits inside the ratified 6101-6899 band.
- Three new TACs: TAC-704 (workflow-materialiser), TAC-705 (release-workflow orchestrator), TAC-706 (scheduled-audit runner). The v1 three TACs (gate-runner, per-gate report, aggregate report) are preserved verbatim except for the report-writer picking up the v2 `checkKind` field.
- Six new ADRs: ADR-705 (elicitation-surface location), ADR-706 (branch-model defaults), ADR-707 (release-workflow shape), ADR-708 (provider-hint shape), ADR-709 (`releaseArtefacts` global), ADR-710 (scheduled-audit dimension). The v1 four ADRs are preserved with content updated for v2 broadened scope.
- Per-gate report shape gains a `checkKind` field naming the elicited-check kind (`validate`, `coverage-strict`, `linter`, `formatter`, `typecheck`, `unitTest`, `securityScan`, `custom:<name>`). The v1 fixed key set is preserved as a strict subset.
- Distinct aggregate report paths per workflow: commit-triggered stays at `.rcf/reports/ci/pipeline.json`; release writes to `.rcf/reports/ci/release.json`; scheduled-audit writes to `.rcf/reports/ci/scheduled-audit.json`.
- GHA illustrative asset set now covers one file per workflow in the matrix under `assets/ci-provider-examples/github-actions/`. The alternate-provider notes doc extends the four-point mapping to cover every workflow.

### Migration

For a project that applied `ci-pipeline` v1:

1. `rcf define blueprint remove ci-pipeline`.
2. `rcf define blueprint add <path>/blueprints/delivery-ci-workflows`.
3. Populate `.rcf/config/delivery-ci-workflows.json` with the `workflowShape` block (see the guide for the four dimensions plus the two optional).
4. Run the project-realised workflow-materialiser (TAC-704 realisation) to produce the workflow set.
5. Any project-authored ADR that superseded v1's `ciGates` topic is re-authored to supersede v2's `ciGates` (topic string unchanged; the mechanism records the pair).
6. Downstream readers that read per-gate reports pick up the new `checkKind` field; readers written against the v1 fixed key set continue to work (the v1 keys are a strict subset).

## [1.0.0] - 2026-08-24

Initial release under the `ci-pipeline` slug. Ships the two-gate mandatory suite (`validate` then `coverage-strict`), the Node-only runner contract, the per-gate and aggregate JSON report shapes, and one illustrative GHA workflow. Two global topics: `ciGates`, `strictCoverageGate`. Superseded by v2.0.0 under the `delivery-ci-workflows` slug.
