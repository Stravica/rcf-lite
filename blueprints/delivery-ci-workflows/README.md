# Delivery-ci-workflows blueprint (v2.0.0)

The `delivery-ci-workflows` blueprint (renamed from `ci-pipeline` at v2.0.0) contributes the full workflow set an rcf-lite project runs on its CI provider: two commit-triggered workflows (pull-request-checks and default-branch-checks), an optional release workflow scaled across four modes, and an optional scheduled-audit workflow. The workflow set is a function of an operator-declared `workflowShape` covering four elicited dimensions plus one optional fifth: branch model (feature or trunk), check set (mandatory tier plus five elicited checks), release mode (none, tagOnly, tagPlusArtefact, or deployHandoff), provider hint (which CI provider's illustrative assets to seed from), and an optional scheduledAudit flag. The v1 RCF-gate suite is preserved verbatim as the mandatory tier inside a broader two-tier check catalogue.

## Apply

```
rcf define blueprint add <path-to>/blueprints/delivery-ci-workflows
```

Phase 1 resolves local path sources only; registry and git-ref resolution is a mechanism follow-up. Apply is idempotent; `rcf define blueprint list` shows the applied entry; `rcf define blueprint remove delivery-ci-workflows` cleanly removes an unreferenced application.

Projects on the v1 `ci-pipeline` slug follow the migration path in the CHANGELOG: remove `ci-pipeline`, add `delivery-ci-workflows`, populate `.rcf/config/delivery-ci-workflows.json`, re-run the workflow-materialiser.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version, and the 62 contributions with scope/topic on the three global ADRs |
| Doc set | `contributions/` | 23 REQs, 23 USs, 6 TACs, 10 ADRs, all schema-valid and namespaced (`delivery-ci-workflows-REQ-NNN` prefix family; `ADR-70N-delivery-ci-workflows-<tail>` suffix family) |
| GitHub Actions assets | `assets/ci-provider-examples/github-actions/` | One illustrative workflow file per workflow the matrix materialises (`pull-request-checks.yml`, `default-branch-checks.yml`, `release.yml`, `scheduled-audit.yml`) |
| Alternate-provider notes | `assets/ci-provider-examples/notes.md` | The four-point mapping (job trigger, Node setup, single-line entry-point invocation, artefact upload) applied per workflow for GitLab CI, CircleCI, Buildkite, and Jenkins |
| Report-shape samples | `assets/report-samples/per-gate.json`, `assets/report-samples/pipeline.json` | Worked examples of a per-gate report (with the v2 `checkKind` field) and an aggregate report at the ratified schemas |
| Guide | `guide/delivery-ci-workflows.md` | Operator-facing: workflow-shape declaration, elicited-check catalogue, the four release modes, the deploy handoff contract, the scheduled-audit cadence |
| Coordination vocabulary | `docs/topics.md` | The three global-topic strings this blueprint contributes and the shared id band registry |

The doc set is contributions (copied into the project tree by `rcf define blueprint add`); the guide, assets, and docs are package-resident references. Guide rendering into `rcf/knowledge/docs/blueprint-guides/` and asset ingestion are mechanism follow-ups; until they land, the working agent reads them from the applied blueprint's source path recorded in `manifest.blueprints[].source`.

## What it contributes, and what it deliberately does not

Contributed kinds: REQ, US (with inline ACs), TAC, ADR. Adherence is expressed as ACs; the blueprint ships no test files (ratified decision preserved from v1) and no code.

No FBS contributions, as a matter of principle (ratified policy 2026-08-19): FBSs are the work of the implementing agent, not the blueprint. The blueprint contributes the WHAT (the workflow-materialiser contract, the gate-runner contract, the release-workflow contract, the scheduled-audit contract, the check-catalogue AC contracts, the report shapes); the implementing agent derives the HOW-tasks in the host project against those contracts.

Deliberately not contributed: a matrix of provider-specific configuration files (v2.0.0 ships GHA only; alternate providers wire the same entry points per the guide's four-point mapping applied per workflow); provider-specific pipeline plugins or actions; the linter, formatter, typechecker, unit-test runner, or security scanner (the elicited checks name the kind; the project picks the tool); a code-formatting style guide or a security-scan severity threshold (project decisions); a release-mechanism (no `standard-version` invocation, no `release-please` config, no `changesets` schema; the workflow reacts to a tag or dispatch, does not create it); a merge-queue integration; a coverage-trend dashboard.

## The three global decisions

ADR-701-delivery-ci-workflows-ci-gates ships `scope: global` on topic `ciGates`. This is the project's required check set: the two mandatory tier gates (`validate` then `coverage-strict`) plus the elicited subset from `workflowShape.checkSet` (default: every catalogued elicited check on). A composing blueprint that ships its own required-check opinion (adherence packs, browser-verify smokes, observability probes) conflicts here by design and expects a project-level ADR that names the extended set.

ADR-702-delivery-ci-workflows-strict-coverage-gate ships `scope: global` on topic `strictCoverageGate`. This is the project's coverage-mode posture: per-AC strict, not shallow-any. Preserved verbatim from v1. A composing blueprint that holds a different coverage posture conflicts here by design.

ADR-709-delivery-ci-workflows-release-artefacts ships `scope: global` on topic `releaseArtefacts` (new at v2). This names the decision area of what the release workflow produces on a release trigger; the delivery-side answer is the four `releaseMode` values. A future `security-release-provenance` or `delivery-release-notes` blueprint that opines on the same decision area conflicts here and expects a project-level ADR that fixes the extended answer.

See `docs/topics.md` for the exact strings, the expected resolutions, the delineation from the application-api-rest blueprint's `logging` topic, and the AC id band allocation (delivery-ci-workflows owns 6101-6899).

## Quality bar

The workflow-materialiser reads `.rcf/config/delivery-ci-workflows.json` and refuses to run when the three required fields are missing or when any field carries an unrecognised value; the required check set runs on every commit-triggered workflow the branch model defines; the mandatory tier runs first in order (`validate` then `coverage-strict`); the elicited tier runs after the mandatory tier in stable but non-load-bearing order; per-gate JSON reports at stable paths carry the v1 fixed key set plus the v2 `checkKind` field; distinct workflows write to distinct aggregate paths (`.rcf/reports/ci/pipeline.json` for commit-triggered, `.rcf/reports/ci/release.json` for release, `.rcf/reports/ci/scheduled-audit.json` for scheduled); a missing required gate report is recorded as `outcome: missing` and flips the aggregate to `failed`; the release workflow shape scales across four discrete modes with the `none` semantic reached either by explicit value or by absent field; the `deployHandoff:<slug>` mode invokes the named deploy blueprint's `promote` workflow with the `versionId` input and refuses at boot when the deploy blueprint is absent; the applied blueprint's source path carries one illustrative GHA workflow file per workflow in the matrix and a notes file mapping four points to alternate providers. Every bar is carried by ACs in the doc set, not by this README.

## Known mechanism-reach gaps

None at v2.0.0. Every AC on every story is bound to at least one TAC that the host project must realise, and every AC's `then` clause is runtime-observable in the materialised workflow files, the aggregate report files at their stable paths, and the platform's own branch-protection or push-protection surface. The mechanism-reach principle from the authoring standard section 7 is satisfied at ship. The operational responsibility a project must own is the branch-protection or equivalent merge-policy configuration on the default or trunk branch that binds the aggregate exit to the merge criterion (AC-6101-2, AC-6114-3, AC-6115-1, AC-6115-2); that responsibility is stated as an AC observable on the platform's own configuration surface, not a smuggled runtime probe.
