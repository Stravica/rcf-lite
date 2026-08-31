# Wiring the workflow set on alternate CI providers

The blueprint ships one illustrative provider example (GitHub Actions, four workflow files under `github-actions/`). Every mainstream provider hosts the same workflow set by translating four points per workflow and keeping the Node entry-point invocations unchanged. These notes are read alongside `guide/delivery-ci-workflows.md`, not instead of it.

## The workflow set the matrix materialises

Which workflow files exist depends on `workflowShape`:

- Always: `default-branch-checks` (pushes to the default or trunk branch).
- Feature-branch, or trunk-based with `trunkPullRequests: sometimes`: `pull-request-checks` (pull requests targeting the branch).
- `releaseMode` not `none` and not absent: `release` (release-trigger events; four shapes per mode).
- `scheduledAudit: true`: `scheduled-audit` (cron cadence).

## The four mapping points (applied per workflow)

1. Job trigger. Fire the workflow's job on the trigger set defined for that workflow (see the corresponding GHA file's `on:` block for the reference shape).
2. Node setup. Install Node 24 or later on the runner.
3. Package-manager setup and install. Install the project's dependencies with the frozen-lockfile discipline of whichever manager the project uses. The manager is a project decision recorded on `workflowShape.packageManager` (default `pnpm`; recognised set `pnpm`, `npm`, `yarn`, `bun`); the per-manager setup and install blocks are named in the guide's "Within-provider package-manager substitution" table. Alternate providers translate the block to the provider's own action/command; the manager choice stays project-controlled.
4. Node entry-point invocation and artefact upload. Run `node <path>` (or a package-manager script that resolves to the same) for the workflow's entry point (gate-runner for `pull-request-checks` and `default-branch-checks`, release orchestrator for `release`, scheduled-audit runner for `scheduled-audit`); upload the aggregate report directory as a run artefact for downstream readers.

The blueprint does not ship provider-specific configuration files for the providers below at v2.0.0. A project hand-authors the first three points in the provider's own runner language and keeps the fourth unchanged per the workflow's entry point.

## GitLab CI (`.gitlab-ci.yml`)

- Triggers: for `pull-request-checks` use `rules: { if: $CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_TARGET_BRANCH_NAME == "main" }`; for `default-branch-checks` use `rules: { if: $CI_COMMIT_BRANCH == "main" }`; for `release` use `rules: { if: $CI_COMMIT_TAG }` plus a `workflow_dispatch`-equivalent through GitLab's manual jobs; for `scheduled-audit` use a scheduled pipeline.
- Node setup: use a `node:24` image or install through the runner's setup hook.
- Install: the install line from the guide's substitution table for the project's `workflowShape.packageManager` (default `pnpm install --frozen-lockfile`).
- Invoke: `node scripts/rcf-ci.js` for check-set workflows; `node scripts/rcf-release.js` for release; `node scripts/rcf-scheduled-audit.js --report-path .rcf/reports/ci/scheduled-audit.json` for scheduled-audit.
- Artefact upload: `artifacts: { when: always, paths: [.rcf/reports/ci/] }`.

## CircleCI (`.circleci/config.yml`)

- Triggers: `workflows:` with branch and PR filters for the two check-set workflows; scheduled workflows for `scheduled-audit`; the release workflow fires from tag-triggered pipelines.
- Node setup: `cimg/node:24.19` or the `node/install` orb command.
- Install: the install line from the guide's substitution table for the project's `workflowShape.packageManager`.
- Invoke: as above.
- Artefact upload: `store_artifacts: { path: .rcf/reports/ci }`.

## Buildkite (`.buildkite/pipeline.yml`)

- Triggers: pipeline-level branch conditions or per-step `branches: main` for check-set workflows; separate pipelines for release (tag-triggered) and scheduled-audit (Buildkite scheduled builds).
- Node setup: install Node 24 in the queue's setup hook or use a Docker plugin (`docker#v5.0.0`).
- Install: the install line from the guide's substitution table for the project's `workflowShape.packageManager`.
- Invoke: as above.
- Artefact upload: `artifact_paths: [".rcf/reports/ci/**"]`.

## Jenkins (declarative pipeline)

- Triggers: `triggers { githubPush() }` plus a multibranch pipeline configured to build pull requests against the default branch; a separate tag-triggered pipeline for release; `triggers { cron('H 6 * * *') }` for scheduled-audit.
- Node setup: install Node 24 via `tools { nodejs '24' }` or provision the agent with Node preinstalled.
- Install: `sh` invocation of the install line from the guide's substitution table for the project's `workflowShape.packageManager`.
- Invoke: `sh 'node scripts/rcf-ci.js'` (or the appropriate script per workflow).
- Artefact upload: `archiveArtifacts artifacts: '.rcf/reports/ci/**', allowEmptyArchive: true`.

## Cross-provider notes

- The Node entry-point paths are the same on every provider. A project that changes providers rewrites its trigger, setup, install, and artefact-upload steps; the entry-point step is unchanged.
- The report directory (default `.rcf/reports/ci/`) is the same on every provider. Downstream readers do not need per-provider knowledge to pick up the aggregate reports.
- The tool-version pin (which `rcf` version to run) is the project's decision. The runner records the installed version on every per-gate report's `toolVersion` field; a mismatch across two runs is visible in the reports without re-running the gate.
- The release workflow's `deployHandoff:<slug>` mode dispatches the named deploy blueprint's `promote` workflow. On GHA that means a `workflow_dispatch` call to the deploy blueprint's workflow file; on other providers, translate to the equivalent workflow-dispatch primitive (GitLab's pipeline API trigger, CircleCI's trigger-pipeline API, Buildkite's Trigger step, Jenkins parameterised build). The `versionId` input contract is unchanged across providers.
- Sibling asset packs (a v2.1 candidate) that ship per-provider full asset sets from the same `workflowShape` are the natural way to skip this hand-translation work for projects that live on one provider.
