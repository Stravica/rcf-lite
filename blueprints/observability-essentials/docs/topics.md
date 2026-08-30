# observability-essentials blueprint coordination vocabulary

This file is the observability-essentials half of the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | observability-essentials contribution | Origin | Composition note |
|---|---|---|---|
| `healthProbes` | ADR-801-observability-essentials-health-probes | Minted here; pre-cleared as unclaimed against application-spa (`clientRouting`, `theming`, `clientState`, `errorEnvelope`, `authModel`), application-api-rest (`errorEnvelope`, `authModel`, `apiVersioning`, `logging`), security-auth-magic-link (`authModel`), persistence-data-sqlite (`persistenceStore`, `migrationDiscipline`), ci-pipeline (`ciGates`, `strictCoverageGate`), and the hello-panel walkthrough exemplar (`operatorPanel`) | The one HTTP health probe contract for the project: two endpoints (liveness /healthz, readiness /readyz), shared JSON body shape, served on the request-traffic listener. A composing blueprint that holds a different endpoint contract (a single /health endpoint, gRPC health protocol, probes on a separate admin port) contributes its own scope:global ADR on this exact string and lets composition surface the pairing. Expected resolution: one project-level ADR that fixes the endpoint contract |
| `readinessSemantics` | ADR-802-observability-essentials-readiness-semantics | Minted here; pre-cleared as unclaimed against application-spa, application-api-rest, security-auth-magic-link, persistence-data-sqlite, ci-pipeline, and hello-panel | The one readiness aggregation and declaration scope for the project: strict-any-fail over an explicit boot-time-declared dependency set, evaluated against per-dep cached state. A composing blueprint that holds a different opinion (quorum aggregation, write-path-only readiness, graceful-degradation model) conflicts here by design. Expected resolution: one project-level ADR fixing the semantics |
| `statusPageContract` | ADR-803-observability-essentials-status-page-contract | Minted here; pre-cleared as unclaimed against application-spa, application-api-rest, security-auth-magic-link, persistence-data-sqlite, ci-pipeline, and hello-panel | The one public status page contract for the project: declared component list plus fixed state enum plus stable-fielded incident notices. A composing blueprint that wants a different public contract (JSON endpoint at /status.json, historical uptime cells as v1 requirement, webhook-posted notices) conflicts here by design. Expected resolution: one project-level ADR fixing the public contract |

The observability-essentials blueprint claims three global topics. Every other contribution is scope-local (ADR-804 probe secrecy and ADR-805 notification outcome model do not contribute global topics; a composing blueprint that holds an opinion on probe auth policy or notification outcome shape authors its own project-level ADR if it wants to override).

Note on the delineation from the hello-panel walkthrough's `operatorPanel` topic: `operatorPanel` (owned by the hello-panel walkthrough exemplar) governs the project's PRIMARY operator drift-detection surface, an AUTHENTICATED surface for the operator. This blueprint's status page (ADR-803) governs the PUBLIC status surface for external readers. The two surfaces are deliberately distinct in audience and vocabulary; this blueprint MUST NOT touch `operatorPanel` and does not contribute an ADR on it.

Note on the delineation from the application-api-rest blueprint's `logging` topic: `logging` (owned by application-api-rest ADR-304) governs the wire-log shape of the HTTP tier. This blueprint's notification outcome sink (ADR-805) is a durable record surface for notification attempts, not a log; the two do not overlap.

Note on the delineation from the persistence-data-sqlite blueprint's `persistenceStore` topic: this blueprint's notification outcome sink is substrate-agnostic. When composing with the persistence-data-sqlite blueprint, the outcome sink's substrate is a facade verb on that store; the observability-essentials blueprint does not itself hold an opinion on the store engine and does not conflict on `persistenceStore`.

Rules for new topics (inherited from the application-spa, application-api-rest, security-auth-magic-link, and persistence vocabularies, restated as law): lower camel case, one concept per topic, no version suffixes. A topic names the decision area, not the chosen answer. Do not mint variants of existing strings (`healthEndpoints`, `probes`, `livenessReadiness` are all wrong when `healthProbes` already exists; `readinessAggregation`, `readyPolicy` are all wrong when `readinessSemantics` already exists; `statusPage`, `publicStatus`, `uptimePage` are all wrong when `statusPageContract` already exists).

## Id number bands (registry bootstrap)

AC ids (and therefore US numeric ids, which anchor them) are NOT namespaced by the 0.4.4 schema grammar; the band allocation IS the AC-collision enforcement mechanism. Composing blueprints take a fresh band rather than proposing namespaced AC ids. Band allocation is ratified policy (2026-08-19); this table is the shared registry-bootstrap replicated across every shipped and forthcoming blueprint's `docs/topics.md` until a mechanism-side central registry lands (v1.1 candidate).

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
| application-spa | 1101-1899 | 2xx | shipped v1.0.0 | `clientRouting`, `theming`, `clientState`, `errorEnvelope`, `authModel` |
| application-api-rest | 2101-2899 | 3xx | shipped v1.0.0 | `errorEnvelope`, `authModel`, `apiVersioning`, `logging` |
| security-auth-magic-link | 3101-3899 | 5xx | shipped v1.0.0 | `authModel` |
| hello-panel (walkthrough exemplar) | 4101-4899 | 4xx | doc-reserved; teaching exemplar in `packages/rcf-lite/docs/blueprint-authoring-walkthrough.md`, not shipped as a blueprint directory | `operatorPanel` |
| persistence-data-sqlite | 5101-5899 | 6xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| ci-pipeline | 6101-6899 | 7xx | shipped v1.0.0 (main @ 595cab9c) | `ciGates`, `strictCoverageGate` |
| observability-essentials (this package) | 7101-7899 | 8xx | queued final seat | `healthProbes`, `readinessSemantics`, `statusPageContract` (this package) |

US 7101-7110 sit at the LOW end of the 7101-7899 band on purpose. A project-side story that mechanically derives from an observability-essentials REQs id into the number `7110` would collide against observability-essentials-US-7110 in this package; the band leaves headroom at the HIGH end (US 7181-7899) so a project's own stories anchored to observability-essentials REQs can allocate without conflict. The watchpost run4 lesson applies here too.

Row-status caveat: the ci-pipeline seat shipped first (PR #95 merged at 595cab9c on main). This branch was rebased onto that main; the ci-pipeline row reflects the shipped state, and the observability row flips to `shipped v1.0.0` at this branch's merge (Dave coordinates that final flip in the merge commit or an immediate follow-up).

## Shared expectations for future composing blueprints

- Reuse `healthProbes` exactly as spelled here when your blueprint holds an opinion on the health endpoint contract; contribute your own scope:global ADR on that string and let composition surface the pairing. A gRPC-health blueprint or a single-endpoint blueprint will conflict here by design.
- Reuse `readinessSemantics` exactly as spelled here when your blueprint holds an opinion on readiness aggregation or the declaration scope; a quorum-aggregation blueprint conflicts here by design.
- Reuse `statusPageContract` exactly as spelled here when your blueprint holds an opinion on the public status surface; a machine-readable JSON-endpoint blueprint or a historical-uptime blueprint conflicts here by design.
- This blueprint's decision states the two-endpoint HTTP JSON contract, the strict-any-fail explicit-declaration readiness semantics, and the declared-component fixed-enum status page. Compose compatible metrics-export, tracing, or authenticated-operator-dashboard blueprints, or expect the operator to supersede with one project-level ADR per topic.
- Global topics that plausibly belong to a future blueprint and are NOT claimed by any shipped blueprint: `messageSerialisation` and `deliverySemantics` (a message-consumer blueprint's natural globals), `caching` (unclaimed by every shipped blueprint), `metricsExport` and `tracingProtocol` (natural globals for a metrics or tracing blueprint that would compose alongside this one). Define any of these in your own package's topics doc, in this file's format, and consider whether the band-registry table above needs your slug added.
