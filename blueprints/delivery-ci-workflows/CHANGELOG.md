# Changelog: delivery-ci-workflows blueprint

## 2.3.3 - 2026-09-11

Adds a contributions/probes/ pack (workflow-template-shape, node-gate-entrypoint, real-account-github-actions-run-record) with a fixture-side workflow-lint helper under packages/rcf-lite/test/fixtures/probe-pack-delivery-ci-workflows/. Probes run against the shipped workflow templates on Node 24 and against real GitHub Actions on the account-bound branch (CI_HAS_GITHUB_ACTIONS gate + RCF_FIXTURE_CIW_REPO, one variable per skip row).

Anchoring: every row is de-claimed (conformanceOnly, anchorAcId=null) with a limitation naming a shipped AC id:
- workflow-template-shape: template shape row -> AC-6101-1 (materialiser wiring not observed); actionlint row -> AC-6101-3 (materialiser refusal not observed; honest accountBoundSkipped naming RCF_FIXTURE_CIW_ACTIONLINT_PATH when the binary is not runnable); branch-protection row -> AC-6101-2 (repository merge-policy not observable at shelf without a probe-controlled repository).
- node-gate-entrypoint: single-line invocation row -> AC-6102-2 (absence of gate-specific logic elsewhere in the job not observed); entry-point unique row -> AC-6102-1 (runtime aggregate report and project tree unavailable).
- real-account-github-actions-run-record: every row -> AC-6101-1 (a gh run list record is not evidence of the configured trigger set nor of the aggregate pipeline report's `trigger` field); accountBoundSkipped rows name exactly one declared variable; a gh auth failure with the gate set is a FAIL.
probe-utils aggregate follows the standard fail>warn>pass rule with no warn-to-pass promotion; every warn-shaped row was converted to a conformanceOnly or accountBoundSkipped row so aggregate=pass carries only pass rows. probe-utils fallback anchor is null.

## 2.3.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the blueprint version is semver per the authoring standard section 8.


## 2.3.0 (hardening pass, 2026-09-09)

- Adds `elicits[]` with seven apply-time answers: `branch-model` (enum feature/trunk, default feature; ADR-706), `check-set` (string JSON of booleans; REQs 016-020), `release-mode` (enum none/tagOnly/tagPlusArtefact/deployHandoff, default none; ADR-707), `scheduled-audit` (enum off/on, default off; ADR-710), `provider-hint` (enum githubActions, default githubActions; ADR-708), `report-dir` (string, default .rcf/reports; ADR-704), `deploy-handoff-target` (string, blank when not deployHandoff; REQ-022).
- Adds `deliveredBy` to all 23 REQs pointing at TAC-701/702/703/704/705/706 responsibility-carrying interfaces. Closes 14 pass-2 lint findings.
- Closes the pass-1 lint finding on AC-6109-2: adds ownerRef pointing at TAC-701-delivery-ci-workflows-gate-runner.interfaces[2].name (the entry-point CLI it restates).
- Closes F-1 (interrupted report writes could leave stale success): adds AC-6105-3 and AC-6108-3 asserting an interrupted per-gate and aggregate rewrite never leaves a stale-success from a previous run; the pipeline refuses pass on absent aggregate per REQ-008.
- Closes F-2 (release entity creation and artefact publication had only success cases): adds AC-6121-4 (RELEASE_CREATE_FAILED naming step + provider status; no downstream publication or promote) and AC-6122-4 (RELEASE_PUBLISH_FAILED naming artefact + provider response; no promote step).
- Closes F-3 (missing/malformed workflow config): adds AC-6112-3 (absent .rcf/config/delivery-ci-workflows.json -> WORKFLOW_CONFIG_MISSING; no workflow file written) and AC-6112-4 (unparseable JSON -> WORKFLOW_CONFIG_UNPARSEABLE naming file + parser error).
- Re-sweeps every existing AC's `disposition` per section 7b: ACs referencing workflowShape values, provider hint, elicited check catalogue, report directory, and deployHandoff target flipped to `template` with `templateFillIns`; the remaining ACs stay `fixed`.
- Review fix pass (F-1): flips AC-6104-3, AC-6106-3, AC-6119-2 to `disposition: fixed` (three ACs describe blueprint-invariant semantics with no elicited substitution in the assertion); adds the section 7b fill-in sentence naming the elicited values the applying agent sets to the remaining eight template ACs (AC-6111-3, AC-6113-3, AC-6115-3, AC-6116-2, AC-6118-3, AC-6120-2, AC-6123-3, AC-6124-2).
- Review fix pass (F-6): extends REQ-011 description with a runtime clause naming the literal `providerHint: githubActions` value (the one shipped-asset provider hint in v2 per ADR-708); AC-6113-1 already binds the four-field expansion including `providerHint: githubActions`.
- Review fix pass (F-8): adds section 7a coverage-note descriptions to US-6109, US-6116, US-6117, US-6119, US-6120, US-6124 recording the guide-and-TAC trace outcome per story (none had mechanism-specific failure paths named in the guide or TAC beyond the ACs each story already binds; runner-missing and gate-aggregation gaps route generically through AC-6102-3 and AC-6108-1).

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
