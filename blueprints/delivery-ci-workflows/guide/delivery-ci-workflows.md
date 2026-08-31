# delivery-ci-workflows blueprint guide

## What it is

The default CI floor for rcf-lite projects, expressed as a workflow SET the operator declares once and the workflow-materialiser produces from that declaration. The blueprint contributes the WHAT of the workflow set: which workflows exist per branch model, which required check set every check-set workflow runs, what the release workflow does per release mode, what the scheduled-audit workflow does when enabled, and what report files land on disk after every run. Each workflow is a single Node entry point the CI job invokes with one line; the elicitation surface is the four required plus two optional fields of `workflowShape` in `.rcf/config/delivery-ci-workflows.json` on the project tree.

Concretely, the blueprint ships 23 requirements, 23 user stories (roughly 50 acceptance criteria), 6 architecture components, and 10 architecture decision records. Three ADRs are `scope: global` on the topics `ciGates` (the required check set every commit-triggered workflow runs), `strictCoverageGate` (the per-AC strict coverage posture), and `releaseArtefacts` (the four-mode release workflow shape); the other seven ADRs are scope-local.

## What it is not

Not a matrix of provider-specific configuration files. v2.0.0 ships one illustrative GitHub Actions workflow file per workflow the matrix materialises under `assets/ci-provider-examples/github-actions/` (`pull-request-checks.yml`, `default-branch-checks.yml`, `release.yml`, `scheduled-audit.yml`) as copy-paste starting points. Alternate providers (GitLab CI, CircleCI, Buildkite, Jenkins) wire the same Node entry points per the four-point mapping named below applied to each workflow; the blueprint does not carry per-provider configuration files for those runners at v2.0.0.

Not a source-code contribution. The blueprint contributes the workflow-materialiser contract, the gate-runner contract, the release-workflow contract, the scheduled-audit contract, the per-gate report writer contract, the aggregate report writer contract, and the discipline that binds them. The project realises the Node entry points against those contracts in its own build cycle; the blueprint does not ship the entry-point source.

Not a choice of linter, formatter, typechecker, test runner, or security scanner. The elicited check catalogue names the check kinds; the project picks the tools that satisfy the runner-contract interfaces. A code-formatting style guide, a security-scan severity threshold, and the linter rule set are all project decisions the blueprint does not opine on.

Not a release-mechanism. The release workflow reacts to a tag or a `workflow_dispatch`; the project creates the tag through its own release mechanism (a `standard-version` invocation, a manual git tag, a release-please bot). The blueprint does not ship a tag-creation workflow, a changelog generator, or a version-bump tool.

Not a merge-queue integration or a coverage-trend dashboard. A project that wants either reads the aggregate reports from the queue tool or the dashboard of its choice; the blueprint owns the aggregate report shapes and stability, not the reader wiring.

Not a branch-protection or merge-policy configuration. AC-6101-2, AC-6114-3, AC-6115-1, and AC-6115-2 state the property the project owes on the platform's own configuration surface per branch model; the blueprint does not ship the configuration file.

## When to reach for it

Reach for the `delivery-ci-workflows` blueprint when:

- The project is an rcf-lite deployment with an RCF chain and a default or trunk branch.
- The project's CI provider can run Node 24 or later on its runner (every mainstream provider can).
- The project wants the required check set (RCF chain plus enabled elicited checks) to be a merge-blocking property, not an author-time habit.
- The project wants a stable per-run report artefact any downstream reader (dashboard, audit tool, merge queue) can pick up without scraping the CI provider's log surface.
- The project wants a release workflow that scales with what the project has already declared (from `none` for internal packages up to `deployHandoff:<slug>` for paired services).

## When it does not fit

Do not reach for the `delivery-ci-workflows` blueprint when:

- The project does not use RCF (no `rcf/` tree, no `rcf define validate` invocation makes sense).
- The project runs on a CI provider whose runners cannot execute Node 24 or later.
- The project wants a coverage-mode grace window on newly introduced ACs (supersede ADR-702 with a project-level ADR stating the grace window).
- The project wants required checks that are not in the catalogue and not naturally cross-blueprint (a mutation-testing gate, an accessibility scan). Supersede ADR-701 with a project-level ADR listing the extended catalogue and register the check under `custom:<name>`.

## What a good outcome looks like

A project applies the `delivery-ci-workflows` blueprint on a fresh tree, populates `.rcf/config/delivery-ci-workflows.json` with its `workflowShape` (four required fields plus any optional ones), realises the six TACs in project-authored FBSes, and lands on a deployed workflow set where:

- Every commit-triggered event fires the appropriate workflow (per branch model). The workflow's aggregate report at `.rcf/reports/ci/pipeline.json` records the trigger, the timing, and the ordered gate outcomes including the `checkKind` per gate.
- A pull request whose head commit fails any required check sees the failed check in the aggregate, sees the specific issue in the per-gate report, and cannot be merged through the platform's standard merge path.
- A pull request whose head commit passes every required check sees `verdict: passed` in the aggregate, sees green on the platform's required-check surface, and can be merged.
- A release trigger fires the release workflow per `releaseMode`: `none` means no workflow at all; `tagOnly` creates a release entity; `tagPlusArtefact` also publishes an artefact; `deployHandoff:<slug>` also invokes the named deploy blueprint's promote workflow with the `versionId` input.
- When `scheduledAudit: true`, the scheduled-audit workflow fires on a cron cadence and writes to `.rcf/reports/ci/scheduled-audit.json`, distinct from commit-triggered `pipeline.json`.
- A developer reproducing a CI failure on their machine runs the same one-line invocation the CI job's step recorded and sees the same per-gate outcomes at the same report paths.

## The workflowShape declaration (four dimensions plus two optional)

The project ships `.rcf/config/delivery-ci-workflows.json` at the project root. The declaration has three required fields, one optional field with defined default semantics, and two optional dimensions.

```json
{
  "workflowShape": {
    "branchModel": "feature",
    "checkSet": {
      "linter": true,
      "formatter": true,
      "typecheck": true,
      "unitTest": true,
      "securityScan": true
    },
    "releaseMode": "tagPlusArtefact",
    "providerHint": "githubActions",
    "scheduledAudit": false
  }
}
```

- `branchModel` (required): `feature` or `trunk`.
- `checkSet` (required): object of booleans keyed by elicited-check name.
- `providerHint` (required): `githubActions`, `gitlabCi`, `circleCi`, `buildkite`, or `jenkins`.
- `releaseMode` (OPTIONAL, Q6-B ratification): `none`, `tagOnly`, `tagPlusArtefact`, or `deployHandoff:<slug>`. An absent field is treated the same as `none` (no release workflow ships). Not having a release path yet is a common scenario when starting a project; the ratification chose ergonomics over an explicit `none`.
- `scheduledAudit` (optional): boolean; default `false`.
- `trunkPullRequests` (optional; qualifies `branchModel: trunk`): `never` or `sometimes`; default `never`.

### Profile aliases

Named profile aliases (`smallLibrary`, `smallService`, `internalPackage`, `trunkLibrary`) compose the four-field form. The materialiser expands the alias to the four-field form at boot; every AC binds to the four-field form. Adding an alias is a minor bump; renaming or removing an alias is a minor bump.

## The check catalogue

Two tiers:

- **Mandatory tier** (preserved from v1): `validate` (running `rcf define validate`) then `coverage-strict` (running `rcf audit coverage --strict`), in that order.
- **Elicited tier** (v2 additions): `linter`, `formatter`, `typecheck`, `unitTest`, `securityScan`. Default: every catalogued check on. Per-check auto-detection may adjust the default (typecheck defaults on when the project tree contains a `tsconfig.json` or equivalent tool marker).

Each elicited check ships an AC contract stating what its runner must produce: a non-zero exit code on any blocking finding, a per-gate report at the check's stable path, and a `checkKind` field naming the check kind. The blueprint does NOT ship the linter, formatter, typechecker, test runner, or scanner; the project picks the tools.

Custom checks (`custom:<name>`) supersede this ADR at the project level and register alongside the catalogued checks in the aggregate.

## The four release modes

`releaseMode` scales what the release workflow does:

- `none` (or absent, per Q6-B ratification): no release workflow ships.
- `tagOnly`: on a release trigger, creates a release entity on the provider's release surface (a GitHub Release, a GitLab release).
- `tagPlusArtefact`: on a release trigger, creates the release entity and runs the project-realised artefact-publish step, uploading the artefact to the release entity.
- `deployHandoff:<slug>`: on a release trigger, runs the tagPlusArtefact flow and then dispatches the named deploy blueprint's `promote` workflow via `workflow_dispatch` with the just-published version identifier as the `versionId` input.

The release workflow does NOT invoke the required check set: that already ran on the `default-branch-checks` workflow at the commit the release points at.

The `deployHandoff:<slug>` mode has a manifest boot-check: the materialiser refuses when the named deploy blueprint is absent from `manifest.blueprints[]`.

## Wiring alternate CI providers (four-point mapping applied per workflow)

Every mainstream CI provider ships the same four ingredients under a different runner language. The blueprint's Node entry points are the fourth ingredient (one per workflow); the other three are provider-specific. The illustrative GitHub Actions workflow files show all four applied per workflow; alternate providers translate the first three and keep the fourth unchanged per workflow:

1. Job trigger. The trigger set per workflow (pull_request into the target branch for `pull-request-checks`; push to the target branch for `default-branch-checks`; release event or workflow_dispatch for `release`; cron schedule for `scheduled-audit`).
2. Node setup.
3. Package-manager setup and install.
4. Node entry-point invocation and artefact upload per workflow.

See `assets/ci-provider-examples/notes.md` for the per-provider translation.

## Operator decisions that remain open after apply

- The workflow shape declaration (`.rcf/config/delivery-ci-workflows.json` populated).
- Report directory path (default `.rcf/reports/ci/`).
- Tool choices for elicited checks (linter, formatter, typechecker, unit-test runner, security scanner).
- Security-scan severity threshold.
- Coverage-mode posture (supersede ADR-702 with a project-level ADR if a different posture is wanted).
- CI provider choice and the trigger/setup/install steps per workflow.
- Branch-protection or push-protection configuration on the default or trunk branch per branch model.
- Artefact-upload retention and destination.
- Merge-queue integration and coverage-trend dashboard wiring.
- Release-mechanism (how tags get created).

## Cost-honesty paragraph

Shipping this doc set costs the project the following. Every commit-triggered event runs the required check set every time; the elicited tier lengthens wall time in proportion to the number of enabled checks. The strict-coverage posture makes every new AC a two-file edit (author the AC and author the TC that resolves it). Adding a check kind outside the catalogue is a project-level ADR plus a runner realisation, not a knob-flip. The illustrative GHA assets are a starting point; a project on another provider owes the translation of the first three of the four mapping points per workflow (extending v1's per-workflow cost to a per-workflow-set cost). Branch-protection configuration is not shipped by the blueprint; a project that forgets to configure it satisfies every AC on the doc set and still ships a workflow set that does not block merges. The report directory grows one per-gate file per gate per run plus one aggregate per workflow per run; a project that runs many workflows against short-lived branches accumulates reports until the CI provider's artefact retention rolls them off.
