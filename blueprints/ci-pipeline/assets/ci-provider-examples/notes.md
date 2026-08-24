# Wiring the gate runner on alternate CI providers

The blueprint ships one illustrative provider example (GitHub Actions, `github-actions.yml`). Every mainstream provider hosts the same pipeline by translating four points and keeping the Node entry-point invocation unchanged. These notes are read alongside `guide/ci-pipeline.md`, not instead of it.

## The four mapping points

1. Job trigger. Fire the job on a push to the default branch AND on every pull request opened, synchronised, or reopened against the default branch.
2. Node setup. Install Node 24 or later on the runner.
3. Package-manager setup and install. Install the project's dependencies with the frozen-lockfile discipline of whichever manager the project uses.
4. Node entry-point invocation and artefact upload. Run `node <path>` (or a package-manager script that resolves to the same); upload the configured report directory as a run artefact for downstream readers.

The blueprint does not ship provider-specific configuration files for the providers below at v1.0.0. A project hand-authors the first three points in the provider's own runner language and keeps the fourth unchanged.

## GitLab CI (`.gitlab-ci.yml`)

- Trigger: `rules:` with `if: $CI_COMMIT_BRANCH == "main"` for the push half, `if: $CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_TARGET_BRANCH_NAME == "main"` for the merge-request half.
- Node setup: use a `node:24` image or install through the runner's setup hook.
- Install: `pnpm install --frozen-lockfile` (or equivalent).
- Invoke: `node scripts/rcf-ci.js`.
- Artefact upload: `artifacts: { when: always, paths: [.rcf/reports/ci/] }`.

## CircleCI (`.circleci/config.yml`)

- Trigger: `workflows:` with `filters: { branches: { only: [main] } }` for the push half; pull-request contexts are handled through CircleCI's GitHub integration or via the `pull_request_number` pipeline parameter.
- Node setup: `cimg/node:24.19` or the `node/install` orb command.
- Install: `pnpm install --frozen-lockfile`.
- Invoke: `node scripts/rcf-ci.js`.
- Artefact upload: `store_artifacts: { path: .rcf/reports/ci }`.

## Buildkite (`.buildkite/pipeline.yml`)

- Trigger: pipeline-level branch conditions or per-step `branches: main` with additional pull-request-only steps triggered through Buildkite's GitHub integration.
- Node setup: install Node 24 in the queue's setup hook or use a Docker plugin (`docker#v5.0.0`).
- Install: `pnpm install --frozen-lockfile`.
- Invoke: `node scripts/rcf-ci.js`.
- Artefact upload: `artifact_paths: [".rcf/reports/ci/**"]`.

## Jenkins (declarative pipeline)

- Trigger: `triggers { githubPush() }` plus a multibranch pipeline configured to build pull requests against the default branch.
- Node setup: install Node 24 via `tools { nodejs '24' }` or provision the agent with Node preinstalled.
- Install: `sh 'pnpm install --frozen-lockfile'`.
- Invoke: `sh 'node scripts/rcf-ci.js'`.
- Artefact upload: `archiveArtifacts artifacts: '.rcf/reports/ci/**', allowEmptyArchive: true`.

## Cross-provider notes

- The Node entry-point path is the same on every provider. A project that changes providers rewrites its trigger, setup, install, and artefact-upload steps; the entry-point step is unchanged.
- The report directory (default `.rcf/reports/ci/`) is the same on every provider. Downstream readers do not need per-provider knowledge to pick up the aggregate report.
- The tool-version pin (which `rcf` version to run) is the project's decision. The runner records the installed version on every per-gate report's `toolVersion` field; a mismatch across two runs is visible in the reports without re-running the gate.
