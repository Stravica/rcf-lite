# Ci-pipeline blueprint (v1.0.0)

The fifth content blueprint on the rcf-build-lite blueprint mechanism (design brief v2, ratified). Scope: a CI-provider-neutral gate suite that runs `rcf define validate` and `rcf audit coverage --strict` as required gates on every push to the default branch and every pull request into it, writes machine-readable JSON reports at stable paths, and refuses to declare a pipeline pass on any missing or failed required gate. The suite is a single Node entry-point script the CI job invokes with one line; one illustrative GitHub Actions workflow ships as a starting point and alternate providers wire the same script.

## Apply

```
rcf define blueprint add <path-to>/blueprints/ci-pipeline
```

Phase 1 resolves local path sources only; registry and git-ref resolution is a mechanism follow-up. Apply is idempotent; `rcf define blueprint list` shows the applied entry; `rcf define blueprint remove ci-pipeline` cleanly removes an unreferenced application.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version, and the 27 contributions with scope/topic on the two global ADRs |
| Doc set | `contributions/` | 10 REQs, 10 USs (20 ACs), 3 TACs, 4 ADRs, all schema-valid against rcf-schemas 0.4.5 and namespaced (`ci-pipeline-REQ-001` prefix family; `ADR-701-ci-pipeline-ci-gates` suffix family) |
| GitHub Actions example | `assets/ci-provider-examples/github-actions.yml` | One illustrative workflow: push and pull_request triggers on the default branch, Node and pnpm setup, single-line entry-point invocation, artefact upload of the report directory |
| Alternate-provider notes | `assets/ci-provider-examples/notes.md` | The four-point mapping (job trigger event, Node setup, single-line entry-point invocation, artefact upload) for GitLab CI, CircleCI, Buildkite, and Jenkins |
| Report-shape samples | `assets/report-samples/per-gate.json`, `assets/report-samples/pipeline.json` | Worked examples of a per-gate report and an aggregate report at the ratified schemas |
| Guide | `guide/ci-pipeline.md` | Operator-facing: when to use it, when not, what stays your call, and how to extend the required gate set |
| Coordination vocabulary | `docs/topics.md` | The two global-topic strings this blueprint contributes, the shared id band registry (spa, rest, auth, hello-panel, persistence, ci-pipeline, observability) |

The doc set is contributions (copied into the project tree by `rcf define blueprint add`); the guide, assets, and docs are package-resident references. Guide rendering into `rcf/knowledge/docs/blueprint-guides/` and asset ingestion are mechanism follow-ups; until they land, the working agent reads them from the applied blueprint's source path recorded in `manifest.blueprints[].source`.

## What it contributes, and what it deliberately does not

Contributed kinds: REQ, US (with inline ACs), TAC, ADR. Adherence is expressed as ACs; the blueprint ships no test files (ratified decision 5) and no code.

No FBS contributions, as a matter of principle (ratified policy 2026-08-19): FBSs are the work of the implementing agent, not the blueprint. The blueprint contributes the WHAT (the gate-runner contract, the per-gate report writer contract, the aggregate report writer contract, the fixed-gate-set discipline); the implementing agent derives the HOW-tasks in the host project, where the ACs contributed here get picked up by the project's own build sequencing.

Deliberately not contributed: a matrix of provider-specific configuration files (only one illustrative GitHub Actions workflow ships; alternate providers wire the same Node entry point per the guide's four-point mapping); provider-specific pipeline plugins or actions (each provider's action or plugin catalogue is a per-provider decision the project owns); a Node entry-point source file or scaffolding code (adherence is expressed as ACs, not code; the project realises the entry point in its own build cycle against the TAC contracts); a linter, formatter, or unit-test gate (out of scope at v1.0.0; a project that wants those adds them via a project-level ADR superseding ADR-701 and lists the extended gate set); a merge-queue integration (a project that wants one wires the aggregate report into the merge-queue tool the project picked); a coverage-trend dashboard (a project that wants one reads the aggregate reports over time and layers the dashboard on top).

## The two global decisions

ADR-701-ci-pipeline-ci-gates ships `scope: global` on topic `ciGates`. This is the project's required-gate set: two gates in fixed order at v1.0.0 (`validate` then `coverage-strict`). A composing blueprint that ships its own required-gate opinion (adherence packs, browser-verify smokes, observability probes) conflicts here by design and expects a project-level ADR that names the extended set.

ADR-702-ci-pipeline-strict-coverage-gate ships `scope: global` on topic `strictCoverageGate`. This is the project's coverage-mode posture: per-AC strict, not shallow-any. A composing blueprint that holds a different coverage posture (a shallow-any-for-early-projects blueprint, a coverage-with-grace-window blueprint) conflicts here by design.

See `docs/topics.md` for the exact strings, the expected resolutions, the delineation from the REST blueprint's `logging` topic (wire-log shape, not build-time report shape), and the AC id band allocation (ci-pipeline owns 6101-6899).

## Quality bar

Every push to the default branch and every pull request into it runs the RCF gate suite as a required check; `rcf define validate` runs first and its non-zero exit terminates the aggregate as failed; `rcf audit coverage --strict` runs second and its non-zero exit terminates the aggregate as failed; per-gate JSON reports at stable paths carry a fixed key set (gate, command, toolVersion, startedAt, endedAt, durationMs, exitCode, outcome, stdout, stderr); an aggregate report at `<reportDir>/pipeline.json` carries verdict, trigger, timing, runner metadata, and the ordered gates array; a missing required gate report is recorded as `outcome: missing` with a reason and flips the aggregate to `failed`; the suite continues past a failing gate to record every failure on one run; operator-visible failure summaries name the gate and the report path in the runner-log tail; the Node entry point invocation is identical locally and in CI; no CI-provider environment variable gates the entry point's control flow; the applied blueprint's source path carries one illustrative GitHub Actions workflow and a notes file mapping four points to alternate providers. Every bar is carried by ACs in the doc set, not by this README.

## Known mechanism-reach gaps

None at v1.0.0. Every AC on every story is bound to at least one TAC that the host project must realise, and every AC's `then` clause is runtime-observable in the deployed pipeline surface (per-gate JSON report inspection, aggregate JSON report inspection, source-tree grep for CI-provider environment reads, workflow-file inspection under the applied blueprint's source path). The mechanism-reach principle from the authoring standard section 7 is satisfied at ship: a project that applies this blueprint and does not realise a TAC leaves an unresolved `tacIds` reference on the story that `rcf define validate` and `rcf audit coverage` refuse. The one operational responsibility a project must own is the branch-protection or equivalent merge-policy configuration on the default branch that binds the pipeline job's aggregate exit to the merge criterion (AC-6101-2); that responsibility is stated as an AC observable on the platform's own configuration surface, not a smuggled runtime probe.
