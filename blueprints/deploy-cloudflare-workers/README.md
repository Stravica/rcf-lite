# Deploy Cloudflare Workers blueprint (v1.0.0)

The ninth content blueprint on the rcf-build-lite blueprint mechanism, and the first in the `deploy` category. Scope: an artefact-upload + explicit-promote deployment model with three distinct addressable URLs (per-version-id, stable preview alias, production), a single Deploy Adapter as the sole vendor caller, a repo-root wrangler manifest as the sole declaration of deploy shape, a rollback-is-promote posture, a served-surface verifier on every promote, a dev-mode-inadmissible-for-deployed-coverage posture, and build-provenance baked into every uploaded version. Targeted at small greenfield rcf-lite projects; larger deployments supersede the default vendor (ADR-1302) with a project-level ADR and swap the adapter's vendor binding.

## Apply

```
rcf define blueprint add <path-to>/blueprints/deploy-cloudflare-workers
```

Phase 1 resolves local path sources only; registry and git-ref resolution is a mechanism follow-up. Apply is idempotent; `rcf define blueprint list` shows the applied entry grouped under the `deploy` category; `rcf define blueprint remove deploy-cloudflare-workers` cleanly removes an unreferenced application.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version, category `deploy`, and the 35 contributions with scope/topic on the one global ADR |
| Doc set | `contributions/` | 12 REQs, 12 USs (36 ACs), 6 TACs, 5 ADRs, all schema-valid and namespaced (`deploy-cloudflare-workers-REQ-001` prefix family; `ADR-1301-deploy-cloudflare-workers-deployment-target` suffix family) |
| Wrangler manifest sample | `assets/wrangler-samples/wrangler-toml-shape.md` | The exact shape of a `wrangler.toml` for a Worker with static assets, KV, D1, and secret bindings, worked as one committable example |
| Preview alias example | `assets/wrangler-samples/preview-alias-shape.md` | The URL patterns for the three URL kinds (per-version-id, stable alias, production) with placeholder account/worker names |
| Build-and-upload workflow | `assets/ci-workflows/build-and-upload.yml.md` | The GitHub Actions form of the build-and-upload workflow with token binding, alias input, and structured output |
| Promote workflow | `assets/ci-workflows/promote.yml.md` | The GitHub Actions form of the promote workflow with `workflow_dispatch`, optional `versionId` input, and post-promote verifier invocation |
| Served-surface probe pattern | `assets/verification/served-surface-probes.md` | The probe-config shape, retry bounds, and expect-shape pattern for the health probe and one project smoke probe |
| Guide | `guide/deploy-cloudflare-workers.md` | Operator-facing: when to use it, when not, what stays your call, and the promotion signals for future deploy blueprints |
| Coordination vocabulary | `docs/topics.md` | The one global-topic string this blueprint contributes and the shared id band registry (nine shipped blueprints including this one) |

The doc set is contributions (copied into the project tree by `rcf define blueprint add`); the guide, assets, and docs are package-resident references. Guide rendering into `rcf/knowledge/docs/blueprint-guides/` and asset ingestion are mechanism follow-ups; until they land, the working agent reads them from the applied blueprint's source path recorded in `manifest.blueprints[].source`.

## What it contributes, and what it deliberately does not

Contributed kinds: REQ, US (with inline ACs), TAC, ADR. Adherence is expressed as ACs; the blueprint ships no test files (ratified decision 5) and no code.

No FBS contributions, as a matter of principle (ratified policy 2026-08-19): FBSs are the work of the implementing agent, not the blueprint; project constraints have to be applied at the time of creation. The blueprint contributes the WHAT (the deploy shape, the adapter contract, the manifest shape, the three URL kinds, the promote-is-explicit posture, the rollback-is-promote posture, the served-surface verify shape, the dev-mode drift posture, the build-provenance surface); the implementing agent derives the HOW-tasks (FBS) in the host project, where the ACs contributed here get picked up by the project's own build sequencing.

Deliberately not contributed: a vendor CLI implementation (the default vendor is named in ADR-1302 as Cloudflare's `wrangler`, the shape of the vendor binding is fixed by TAC-1301, the actual binding code is a project-authored implementation shelling to the CLI); a project's authorisation model for who is allowed to promote (promote authorisation sits at the CI platform's own permission model on the `workflow_dispatch` primitive); a promote-approval workflow (a project that wants an approver review on every promote layers a manual-approval step above the `workflow_dispatch` trigger); a canary or gradual-rollout controller (the vendor's own primitives support gradual promote where the operator wants it; the blueprint mandates the served-surface verifier on the eventual full promote); an image or artefact registry (the vendor's own upload-and-version primitive is the artefact store); a project's audit-log storage engine (the blueprint fixes the deploy-log record shape, not where the records land); a status page (the observability-essentials blueprint owns `statusPageContract`; the deploy log feeds into it); the secrets pipeline itself (the security-secrets-management blueprint owns `secretsSource`; this blueprint consumes it for the vendor API token and any application secret bindings the Worker reads).

## The one global decision

ADR-1301-deploy-cloudflare-workers-deployment-target ships `scope: global` on topic `deploymentTarget`. This is the project's single source of truth for how bits reach a running target: an artefact-upload + explicit-promote model with three distinct addressable URLs. A composing blueprint that wants a different deployment shape (a container-image-per-commit + rolling-deploy blueprint, a merge-to-production-coupled blueprint, a serverless-function-per-endpoint blueprint) conflicts here by design and expects a project-level ADR resolution. Vendor DEFAULT (ADR-1302) is deliberately scope-local: the contract is global; the default that ships behind it is not.

See `docs/topics.md` for the exact strings, the expected resolutions, the delineation from vendor-choice (which is not global), and the AC id band allocation (deploy-cloudflare-workers owns 12101-12899, ADR/TAC suffix block 13xx).

## Quality bar

Repo-root wrangler manifest as the sole declaration of Worker name, entry, compatibility settings, and every binding; one Deploy Adapter as the sole caller of the vendor CLI on the boundary; every merge to main uploads a Worker version reachable at both a permanent per-version-id URL and a stable preview alias URL; the uploaded version never serves production traffic; production only changes when the `promote` workflow runs on an explicit operator trigger; the promote workflow accepts one input `versionId` (empty defaults to newest-of-main); rollback IS a promote of a prior version id, on the same workflow, with the same audit shape; every promote runs the Served-surface Verifier against the production URL with bounded retries; a promote whose verifier fails is not marked successful; every uploaded version carries build provenance (commit sha, build timestamp, CI run URL) readable at a fixed health-probe path; the health probe's `versionSha` field is the served-surface verifier's confirmation that the promoted version is the version being served; no secret value ever lives in the wrangler manifest, in a committed environment file, in a CI variable readable outside the promote job, or in any CI log line; a probe against a dev-mode local URL is refused as coverage for a `deployed`-scope AC; the manifest loader refuses a wrangler config whose production route resolves to the same host as the preview alias URL. Every bar is carried by ACs in the doc set, not by this README.

## Known mechanism-reach gaps

None at v1.0.0. Every AC on every story is bound to at least one TAC that the host project must realise, and every AC's `then` clause is runtime-observable in the deployed application (source-tree import-graph scans for the adapter boundary, structured-record accumulation for the deploy-log shape, HTTP probes against the three URL kinds for the served-surface properties, byte-equality checks against resolved secret values for the leakage properties, workflow-file parsing for the trigger-set invariants, coverage-gate walk for the dev-mode-inadmissible invariant). The mechanism-reach principle from the authoring standard section 7 is satisfied at ship: a project that applies this blueprint and does not realise a TAC leaves an unresolved `tacIds` reference on the story that `rcf define validate` and `rcf audit coverage` refuse. The one operational surface a project must own on its own is the vendor binding implementation (the default `wrangler`-shelling binding, or a superseding vendor's binding); that responsibility is stated as a TAC interface, not as a smuggled runtime probe. The one AC whose runtime observability depends on operator choice is AC-12112-2 (the `/healthz` path is a common default but the project picks the actual path); the runtime observability there is the project-declared probe path resolving with the expected shape, which the served-surface verifier's own success signal confirms.
