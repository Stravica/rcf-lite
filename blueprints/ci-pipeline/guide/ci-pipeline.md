# Ci-pipeline blueprint guide

## What it is

A default CI floor for rcf-lite projects. The blueprint contributes the WHAT of a pipeline pattern: which gates run, in which order, what constitutes a passed run, what report files land on disk after every run, and how a failing run surfaces the failing gate in the operator's own log tail. The pipeline is a single Node entry-point script the CI job invokes with one line, and the gate set at v1.0.0 is exactly two required gates: `rcf define validate` followed by `rcf audit coverage --strict`.

Concretely, the blueprint ships ten requirements, ten user stories (twenty acceptance criteria), three architecture components, and four architecture decision records. Two ADRs are `scope: global` on the topics `ciGates` (the fixed required-gate set) and `strictCoverageGate` (the per-AC strict coverage posture); the other two are scope-local (the Node-only runner shape and the JSON report shape) that a composing blueprint does not conflict with by default.

## What it is not

Not a matrix of provider-specific configuration files. One illustrative GitHub Actions workflow ships under `assets/ci-provider-examples/github-actions.yml` as a copy-paste starting point. Alternate providers (GitLab CI, CircleCI, Buildkite, Jenkins) wire the same Node entry point per the four-point mapping named below; the blueprint does not carry a per-provider configuration file for those runners at v1.0.0.

Not a source-code contribution. The blueprint contributes the gate-runner contract, the per-gate report writer contract, the aggregate report writer contract, and the discipline that binds them. The project realises the Node entry point against those contracts in its own build cycle; the blueprint does not ship the entry-point source.

Not a linter, formatter, or unit-test gate. The v1.0.0 required-gate set is two gates that speak to the RCF chain and its coverage. A project that wants to add a linter or a unit-test gate authors a project-level ADR superseding ADR-701 and lists the extended gate set; the runner set is a decision area, not a runtime knob.

Not a merge-queue integration. A project that wants a merge queue reads the aggregate report from the queue tool of its choice; the blueprint owns the aggregate report shape and stability, not the queue tool wiring.

Not a coverage-trend dashboard. A project that wants one reads the aggregate reports over time and layers the dashboard on top; the blueprint owns the per-run reports, not the trend view.

Not a branch-protection or merge-policy configuration. AC-6101-2 states the property the project owes on the platform's own configuration surface (branch protection, required checks, or the equivalent), but the blueprint does not ship that configuration file.

## When to reach for it

Reach for the ci-pipeline blueprint when:

- The project is an rcf-lite deployment with an RCF chain and a default branch merged into through pull requests.
- The project's CI provider can run Node 24 or later on its runner (every mainstream provider can: GitHub Actions, GitLab CI, CircleCI, Buildkite, Jenkins).
- The project wants the RCF chain and its per-AC strict coverage to be a merge-blocking property, not an author-time habit.
- The project wants a stable per-run report artefact any downstream reader (dashboard, audit tool, merge queue) can pick up without scraping the CI provider's log surface.
- The project wants the same command line to reproduce a CI failure on a developer's machine.

## When it does not fit

Do not reach for the ci-pipeline blueprint when:

- The project does not use RCF (no `rcf/` tree, no `rcf define validate` invocation makes sense). A project without an RCF chain does not need this blueprint; its pipeline is a different shape entirely.
- The project runs on a CI provider whose runners cannot execute Node 24 or later (a legacy internal Jenkins pool locked to Node 12, an embedded hardware CI). Upgrade the runner or supersede ADR-703 with a project-level ADR selecting a different runner shape.
- The project's default branch model is trunk-based with no pull requests. The `push to default branch` half of the trigger still applies, but the pull-request half of AC-6101-1 does not; a project on trunk-based development authors a project-level ADR narrowing the trigger set.
- The project wants a coverage-mode grace window on newly introduced ACs. Supersede ADR-702 with a project-level ADR stating the grace window and the reasoning.
- The project wants the pipeline to include gates that are not shipped by any rcf-lite blueprint (a linter, a mutation-testing gate, a stack-specific unit-test runner). Supersede ADR-701 with a project-level ADR listing the extended set; the runner then invokes the added gates alongside the two required ones.

## What a good outcome looks like

A project applies the ci-pipeline blueprint on a fresh tree, realises the three TACs in project-authored FBSes, wires a CI job per the illustrative GitHub Actions workflow (or per the four-point mapping for its own provider), configures its branch protection to require the pipeline job as a merge-blocking check, and lands on a deployed pipeline where:

- Every push to the default branch and every pull request into it fires the CI job automatically; the job's aggregate report at `.rcf/reports/ci/pipeline.json` records the trigger event, the timing, and the ordered gate outcomes.
- A pull request whose head commit fails `rcf define validate` sees `validate` outcome as `failed` in the aggregate, sees the specific schema or reference issue in the per-gate report, and cannot be merged through the platform's standard merge path.
- A pull request whose head commit passes `rcf define validate` but leaves an AC without a resolving TC sees `coverage-strict` outcome as `failed`, sees the specific `covered-unresolved` AC in the per-gate report, and cannot be merged.
- A pull request whose head commit passes both gates sees `verdict: passed` in the aggregate, sees green on the platform's required-check surface, and can be merged.
- A runner crash mid-suite (a killed Node child, a report write failure) produces an aggregate with `outcome: missing` for the affected gate and `verdict: failed`; the crash is not silently indistinguishable from a pass.
- A developer reproducing a CI failure on their machine runs the same one-line invocation the CI job's step recorded and sees the same per-gate outcomes at the same report paths.
- A downstream reader (a coverage-trend dashboard the project may add later) picks up successive aggregate reports over time without any scraping or provider-API integration.

## Wiring alternate CI providers (four-point mapping)

Every mainstream CI provider ships the same four ingredients under a different runner language. The blueprint's Node entry point is the fourth ingredient; the other three are provider-specific. The illustrative GitHub Actions workflow shows all four; alternate providers translate the first three and keep the fourth unchanged:

1. Job trigger. GitHub Actions uses `on: push` and `on: pull_request` YAML; GitLab CI uses `rules:` with `if:` predicates on `$CI_COMMIT_BRANCH` and `$CI_MERGE_REQUEST_TARGET_BRANCH_NAME`; CircleCI uses `workflows:` with `filters:` on branches; Buildkite uses pipeline conditions on the branch name; Jenkins declarative pipelines use `when { branch }` blocks.
2. Node setup. GitHub Actions uses `actions/setup-node@vX`; GitLab CI images typically pre-install Node or use a Docker image; CircleCI uses `cimg/node` orbs; Buildkite installs Node in the queue's setup hook; Jenkins agents install Node through a tool config.
3. Package-manager setup and install. Whichever manager the project uses (pnpm, npm, yarn, bun); the same `install --frozen-lockfile` (or equivalent) pattern applies everywhere.
4. Node entry-point invocation and artefact upload. `node <path>` (or a package-manager script that resolves to the same); every provider ships an artefact-upload primitive that reads the configured report directory.

The blueprint does not ship provider-specific configuration files for GitLab CI, CircleCI, Buildkite, or Jenkins at v1.0.0. A project on one of those providers hand-authors the trigger, setup, install, and artefact-upload steps in that provider's runner language and invokes the Node entry point unchanged.

## Operator decisions that remain open after apply

- Report directory path (default `.rcf/reports/ci/`; a project that wants a different location changes the configuration input to the runner). Blueprint owns the schema and the file names; project owns the path.
- Gate set beyond the two required ones. Blueprint owns the required set (`validate` then `coverage-strict`); project supersedes ADR-701 with a project-level ADR to add gates.
- Coverage-mode posture. Blueprint owns strict per-AC as the required posture; project supersedes ADR-702 with a project-level ADR if a different posture (shallow-any, grace-window) is thoughtfully accepted.
- CI provider choice. Blueprint owns the Node entry-point shape and one illustrative provider example; project picks the provider and wires the trigger, setup, install, and artefact-upload steps.
- Branch protection and merge-policy configuration on the default branch. Blueprint states the property (AC-6101-2); project configures the platform surface.
- Artefact upload retention and destination. Blueprint owns the report directory and its stable paths; project owns how long the CI provider keeps the artefact and where a downstream reader picks it up.
- Merge-queue integration, if any. Blueprint owns the aggregate report as the single-record verdict; project wires the merge-queue tool to read it.
- Coverage-trend dashboard or audit-log integration, if any. Blueprint owns the aggregate schema stability; project owns the reader.

## Cost-honesty paragraph

Shipping this doc set costs the project the following. Every push and every pull request into the default branch runs both gates every time; on a small tree that is seconds, on a large tree with a deep chain it can be tens of seconds of pipeline wall time per run. The strict-coverage posture makes every new AC a two-file edit (author the AC and author the TC that resolves it); a project that skips the TC hits the strict-coverage gate on the pull request rather than at merge time. Adding a gate is a project-level ADR and a code change to the entry-point runner, not a knob-flip in a config file, which is the intended shape but does cost the ADR. The illustrative GitHub Actions workflow is a starting point; a project on another provider owes the translation of the first three of the four mapping points. Branch-protection configuration is not shipped by the blueprint; a project that forgets to configure it satisfies every AC on the doc set and still ships a pipeline that does not block merges. The report directory grows one per-gate file per gate per run; a project that runs the pipeline against a very short-lived branch may accumulate reports until the CI provider's artefact retention rolls them off. The atomic-write posture for report files costs one extra file-system syscall per report; the 256KB truncation cap on stdout and stderr costs the tail of a very verbose gate on runaway output.
