# delivery-ci-workflows blueprint coordination vocabulary

This file is the delivery-ci-workflows half of the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | delivery-ci-workflows contribution | Origin | Composition note |
|---|---|---|---|
| `ciGates` | ADR-701-delivery-ci-workflows-ci-gates | Minted at v1 by the ci-pipeline predecessor; broadened at v2.0.0 to name the required check set (mandatory tier plus elicited subset from `workflowShape.checkSet`) | The required check set every commit-triggered workflow runs. Any composing blueprint that ships its own required-check opinion (an adherence-pack blueprint, a browser-verify blueprint, an observability probe blueprint) contributes its own scope:global ADR on this exact string and lets composition surface the pairing. Expected resolution: one project-level ADR that fixes the extended catalogue and states the reasoning |
| `strictCoverageGate` | ADR-702-delivery-ci-workflows-strict-coverage-gate | Preserved verbatim from v1 | The coverage-mode posture for the required gate (per-AC strict, not shallow-any). A composing blueprint that holds an opinion on coverage-mode policy (a shallow-any-for-early-projects blueprint, a coverage-with-grace-window blueprint) conflicts here by design. Expected resolution: one project-level ADR fixing the coverage posture |
| `releaseArtefacts` | ADR-709-delivery-ci-workflows-release-artefacts | **Minted at v2.0.0** | The decision area of what the release workflow produces on a release trigger. The delivery-side answer is the four-mode `releaseMode` enumeration (`none`, `tagOnly`, `tagPlusArtefact`, `deployHandoff:<slug>`). A future `security-release-provenance` blueprint (minting a signature-attestation opinion) or a `delivery-release-notes` blueprint (minting a changelog opinion) contributes its own scope:global ADR on this exact string and lets composition surface the pairing. Expected resolution: one project-level ADR that fixes the extended answer |

The delivery-ci-workflows blueprint claims three global topics at v2.0.0 (`ciGates` broadened, `strictCoverageGate` preserved, `releaseArtefacts` new). Every other contribution is scope-local; a composing blueprint that holds an opinion on runner language, report shape, elicitation surface, branch model, release workflow shape, provider hint, or scheduled audit authors its own project-level ADR if it wants to override.

### Deliberate conflicts declared

Where this blueprint's set overlaps other blueprints' topics, the resolution paths are documented at authoring rather than left to composition-time surprise:

- **`ciGates` vs any future adherence-pack or browser-verify blueprint**: expected conflict on the `ciGates` string. Resolution: the project-level ADR names the extended catalogue including the composing blueprint's checks.
- **`releaseArtefacts` vs any future `security-release-provenance` blueprint**: expected conflict on the `releaseArtefacts` string. Resolution: the project-level ADR fixes the artefact production shape including signatures and provenance blocks.
- **`releaseArtefacts` vs any future `delivery-release-notes` blueprint**: expected conflict on the `releaseArtefacts` string (release notes are one kind of artefact the release workflow produces). Resolution: the project-level ADR names the release-notes production alongside the artefact publish step.

`branchModel` is deliberately NOT minted as a global topic. No shipped or plausible sibling blueprint has a legitimate opinion on branch model choice; minting the string would create a resolution surface for a conflict that would not materialise. If evidence emerges to the contrary, `branchModel` can be minted in a v2.x minor bump.

Note on the delineation from the application-api-rest blueprint's `logging` topic and the persistence-data-sqlite blueprint's store event log: `logging` (owned by application-api-rest ADR-304) governs the wire-log shape of the HTTP tier; persistence ADR-603 governs the store-event log shape. This blueprint's report shape (ADR-704) governs the pipeline-run report shape, which is a build-time artefact, not a runtime log. The three surfaces may share a shipper but do not share a topic. A blueprint that contributes a unified telemetry discipline across build-time and runtime surfaces would author its own scope:global ADR and expect to conflict with all three, not just here.

Rules for new topics (inherited from the application-spa, application-api-rest, security-auth-magic-link, and persistence vocabularies, restated as law): lower camel case, one concept per topic, no version suffixes. A topic names the decision area, not the chosen answer. Do not mint variants of existing strings (`ciChecks`, `pipelineGates`, `strictCoverage`, `coverageStrict` are all wrong when `ciGates` and `strictCoverageGate` already exist).

## Id number bands (registry bootstrap)

AC ids (and therefore US numeric ids, which anchor them) are NOT namespaced by the 0.4.4 schema grammar; the band allocation IS the AC-collision enforcement mechanism. Composing blueprints take a fresh band rather than proposing namespaced AC ids. Band allocation is ratified policy (2026-08-19); this table is the shared registry-bootstrap replicated across every shipped and forthcoming blueprint's `docs/topics.md` until a mechanism-side central registry lands (v1.1 candidate).

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
| observability-essentials | 7101-7899 | 8xx | shipped v1.0.0 | `healthProbes`, `readinessSemantics`, `statusPageContract` |
| security-secrets-management | 8101-8899 | 9xx | shipped v1.0.0 | `secretsSource` |
| security-auth-clerk | 9101-9899 | 10xx | shipped v1.0.0 | `authModel` |
| security-auth-oauth2 | 10101-10899 | 11xx | shipped v1.0.0 | `authModel` |
| security-auth-keycloak | 11101-11899 | 12xx | shipped v1.0.0 | `authModel` |
| deploy-cloudflare-workers | 12101-12899 | 13xx | shipped v1.0.0 | `deploymentTarget` |
| persistence-data-d1 | 13101-13899 | 14xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| observability-probe-endpoints | 14101-14899 | 15xx | shipped v1.1.0 | `healthProbes`, `readinessSemantics` |

US 6101-6110 sit at the LOW end of the 6101-6899 band on purpose. A project-side story that mechanically derives from `delivery-ci-workflows-REQ-011` into the number `6111` would collide against delivery-ci-workflows-US-6111 in this package; the band leaves headroom at the HIGH end (US 6181-6899) so a project's own stories anchored to delivery-ci-workflows REQs can allocate without conflict. The watchpost run4 lesson applies here too.

## Shared expectations for future composing blueprints

- Reuse `ciGates` exactly as spelled here when your blueprint holds an opinion on the required check set every commit-triggered workflow runs; contribute your own scope:global ADR on that string and let composition surface the pairing. An observability-essentials blueprint that ships health-probe or status-page gates as required will conflict here by design.
- Reuse `strictCoverageGate` exactly as spelled here when your blueprint holds an opinion on the coverage-mode policy (strict per-AC versus shallow-any versus grace-window); a blueprint that ships a different posture conflicts here.
- Reuse `releaseArtefacts` exactly as spelled here when your blueprint holds an opinion on what the release workflow produces on a release trigger (an artefact-signing opinion, a provenance-block opinion, a release-notes opinion); contribute your own scope:global ADR on that string and expect a project-level ADR to fix the extended answer.
- This blueprint's decision at v2.0.0 states the mandatory tier (`validate` and `coverage-strict` in that order) plus the elicited tier (linter, formatter, typecheck, unitTest, securityScan) driven by `workflowShape.checkSet`, the four-mode `releaseMode` enumeration on `releaseArtefacts`, the Node-only entry-point shape (ADR-703), and the report shape (ADR-704 with the v2 `checkKind` addition). Compose compatible adherence packs, browser-verify shipping, or observability probes, or expect the operator to supersede with one project-level ADR per topic.
- Global topics that plausibly belong to a future blueprint and are NOT claimed by any shipped blueprint: `adherencePack` (an adherence-shipping blueprint's natural global), `mutationSampling` (a mutation-testing blueprint's natural global). Define any of these in your own package's topics doc, in this file's format, and consider whether the band-registry table above needs your slug added.
