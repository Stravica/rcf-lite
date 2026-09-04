# deploy-cloudflare-workers blueprint coordination vocabulary

This file is the deploy-cloudflare-workers half of the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | deploy-cloudflare-workers contribution | Origin | Composition note |
|---|---|---|---|
| `deploymentTarget` | ADR-1301-deploy-cloudflare-workers-deployment-target | Minted here; pre-cleared as unclaimed against application-spa (`clientRouting`, `theming`, `clientState`, `errorEnvelope`, `authModel`), application-api-rest (`errorEnvelope`, `authModel`, `apiVersioning`, `logging`), security-auth-magic-link (`authModel`), persistence-data-sqlite (`persistenceStore`, `migrationDiscipline`), delivery-ci-workflows (`ciGates`, `strictCoverageGate`), observability-essentials (`healthProbes`, `readinessSemantics`, `statusPageContract`), security-secrets-management (`secretsSource`), and the hello-panel walkthrough exemplar (`operatorPanel`) | The one project-wide model for how bits reach a running target: an artefact-upload + explicit-promote model, versions addressable at stable preview URLs, one adapter as the sole vendor caller, one served-surface verifier on every promote. A composing blueprint that holds a different opinion on the deployment shape (a container-image-per-commit + rolling-deploy blueprint, a coupled-merge-to-production blueprint, a serverless-function-per-endpoint blueprint) contributes its own scope:global ADR on this exact string and lets composition surface the pairing. Expected resolution: one project-level ADR that fixes the deployment shape and the vendor selection |

The deploy-cloudflare-workers blueprint claims one global topic. Every other contribution is scope-local (ADR-1302 through ADR-1305 name the default vendor, the preview-vs-production URL model, the rollback-is-promote posture, and the dev-mode drift posture without contributing global topics; a composing blueprint that holds a different opinion on any of them authors its own project-level ADR if it wants to override).

Rules for new topics (inherited from the application-spa, application-api-rest, security-auth-magic-link, persistence-data-sqlite, delivery-ci-workflows, observability-essentials, and security-secrets-management vocabularies, restated as law): lower camel case, one concept per topic, no version suffixes. A topic names the decision area, not the chosen answer. Do not mint variants of existing strings (`deploy`, `deployVendor`, `deployPipeline`, `shipTarget` are all wrong when `deploymentTarget` already exists).

## Id number bands (registry bootstrap)

AC ids (and therefore US numeric ids, which anchor them) are NOT namespaced by the 0.5.0 schema grammar; the band allocation IS the AC-collision enforcement mechanism. Composing blueprints take a fresh band rather than proposing namespaced AC ids. Band allocation is ratified policy (2026-08-19); this table is the shared registry-bootstrap replicated across every shipped and forthcoming blueprint's `docs/topics.md` until a mechanism-side central registry lands (v1.1 candidate).

This table is maintained shelf-wide across every blueprint's `docs/topics.md`. Rows are recorded at ship, never predicted.

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
| application-spa | 1101-1899 | 2xx | shipped v1.3.0 | `clientRouting`, `theming`, `clientState`, `errorEnvelope`, `authModel` |
| application-api-rest | 2101-2899 | 3xx | shipped v1.0.0 | `errorEnvelope`, `authModel`, `apiVersioning`, `logging` |
| security-auth-magic-link | 3101-3899 | 5xx | shipped v1.0.0 | `authModel` |
| email-smtp-resend | 4101-4899 | 4xx | shipped v1.0.0 | none |
| hello-panel (walkthrough exemplar) | 4101-4899 | 4xx | doc-reserved; teaching exemplar in `packages/rcf-lite/docs/blueprint-authoring-walkthrough.md`, not shipped as a blueprint directory | `operatorPanel` |
| persistence-data-sqlite | 5101-5899 | 6xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| delivery-ci-workflows | 6101-6899 | 7xx | shipped v2.0.0 (renamed from ci-pipeline) | `ciGates`, `strictCoverageGate`, `releaseArtefacts` |
| observability-essentials | 7101-7899 | 8xx | shipped v2.0.0 | `statusPageContract` |
| security-secrets-management | 8101-8899 | 9xx | shipped v1.0.0 | `secretsSource` |
| security-auth-clerk | 9101-9899 | 10xx | shipped v1.0.0 | `authModel` |
| security-auth-oauth2 | 10101-10899 | 11xx | shipped v1.0.0 | `authModel` |
| security-auth-keycloak | 11101-11899 | 12xx | shipped v1.0.0 | `authModel` |
| deploy-cloudflare-workers | 12101-12899 | 13xx | shipped v1.0.0 | `deploymentTarget` |
| persistence-data-d1 | 13101-13899 | 14xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| observability-probe-endpoints | 14101-14899 | 15xx | shipped v1.1.0 | `healthProbes`, `readinessSemantics` |

US 12101-12112 sit at the LOW end of the 12101-12899 band on purpose. A project-side story that mechanically derives from a deploy-cloudflare-workers REQ id into the number `12112` would collide against deploy-cloudflare-workers-US-12112 in this package; the band leaves headroom at the HIGH end (US 12181-12899) so a project's own stories anchored to deploy-cloudflare-workers REQs can allocate without conflict. The watchpost run4 lesson applies here too. Band spacing between the last shipped block (security-secrets-management, 8101-8899, 9xx) and this one (12101-12899, 13xx) leaves the 9xxx-11xxx US bands and the 10xx-12xx suffix blocks open for concurrent-lane authoring so a peer authoring another blueprint in the same PR window does not collide with this one.

## Shared expectations for future composing blueprints

- Reuse `deploymentTarget` exactly as spelled here when your blueprint holds an opinion on the project's deployment shape; contribute your own scope:global ADR on that string and let composition surface the pairing. A container-image-per-commit blueprint, a merge-to-production blueprint, or a serverless-function-per-endpoint blueprint will conflict here by design and expect a project-level ADR resolution.
- Vendor choice sits at ADR-1302 (scope-local) by design: the contract is at ADR-1301, the default is at ADR-1302. A composing blueprint that wants a different DEFAULT vendor without changing the contract does not conflict on `deploymentTarget`; the operator supersedes ADR-1302 with a project-level ADR and swaps the vendor binding.
- Preview-vs-production URL model (ADR-1303), rollback-is-promote posture (ADR-1304), and dev-mode drift posture (ADR-1305) are scope-local. A composing blueprint that holds an opinion on any of them authors its own project-level ADR; none of them are minted as globals because the space of legitimate variations is smaller than the space of legitimate `deploymentTarget` variations.
- Global topics that plausibly belong to a future blueprint and are NOT claimed by any shipped blueprint: `messageSerialisation` and `deliverySemantics` (a message-consumer blueprint's natural globals), `caching` (unclaimed by every shipped blueprint), `metricsExport` and `tracingProtocol` (natural globals for a metrics or tracing blueprint), `deploymentPackaging` (unclaimed; a natural global for a container-image or artefact-bundling blueprint that composes above the deploy target). Define any of these in your own package's topics doc, in this file's format, and consider whether the band-registry table above needs your slug added.
