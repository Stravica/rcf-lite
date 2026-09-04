# observability-essentials blueprint coordination vocabulary

This file is the observability-essentials half of the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | observability-essentials contribution | Origin | Composition note |
|---|---|---|---|
| `statusPageContract` | ADR-803-observability-essentials-status-page-contract | Minted here; pre-cleared as unclaimed against application-spa, application-api-rest, security-auth-magic-link, persistence-data-sqlite, delivery-ci-workflows, and hello-panel | The one public status page contract for the project: declared component list plus fixed state enum plus stable-fielded incident notices. A composing blueprint that wants a different public contract (JSON endpoint at /status.json, historical uptime cells as v1 requirement, webhook-posted notices) conflicts here by design. Expected resolution: one project-level ADR fixing the public contract |

From v2.0.0 the observability-essentials blueprint claims ONE global topic (`statusPageContract`). Every other contribution is scope-local (ADR-801 health probes and ADR-802 readiness semantics are historical scope-local ADRs recording the self-supervised design intent; ADR-804 probe secrecy and ADR-805 notification outcome model do not contribute global topics; a composing blueprint that holds an opinion on probe auth policy or notification outcome shape authors its own project-level ADR if it wants to override).

### Historical global topics (dropped in v2.0.0)

The alignment ratified in `projects/rcf-lite-wsd/specs/rcf-lite-probe-path-alignment-spec-2026-09-04.md` moved probe-path ownership to `observability-probe-endpoints` as the sole shelf-wide claimant. The two rows below record what this blueprint used to claim; the ADRs stay on disk as scope-local historical context and their titles carry a "Historical: ... superseded by observability-probe-endpoints" prefix.

| Historical topic string | Was claimed by | Replaced by | Migration reference |
|---|---|---|---|
| `healthProbes` | ADR-801-observability-essentials-health-probes (v1.x, now historical) | `observability-probe-endpoints` ADR-1501 (sole shelf owner from probe-endpoints v1.0.0; sole shelf claimant from essentials v2.0.0) | spec section 4; TAC-801 v2.0.0 drops the `/healthz` default; REQ-001 restated path-neutral |
| `readinessSemantics` | ADR-802-observability-essentials-readiness-semantics (v1.x, now historical) | `observability-probe-endpoints` ADR-1502 (sole shelf owner from probe-endpoints v1.0.0; sole shelf claimant from essentials v2.0.0) | spec section 4; TAC-802 v2.0.0 drops the `/readyz` default; REQ-002 restated path-neutral |

Note on the delineation from the hello-panel walkthrough's `operatorPanel` topic: `operatorPanel` (owned by the hello-panel walkthrough exemplar) governs the project's PRIMARY operator drift-detection surface, an AUTHENTICATED surface for the operator. This blueprint's status page (ADR-803) governs the PUBLIC status surface for external readers. The two surfaces are deliberately distinct in audience and vocabulary; this blueprint MUST NOT touch `operatorPanel` and does not contribute an ADR on it.

Note on the delineation from the application-api-rest blueprint's `logging` topic: `logging` (owned by application-api-rest ADR-304) governs the wire-log shape of the HTTP tier. This blueprint's notification outcome sink (ADR-805) is a durable record surface for notification attempts, not a log; the two do not overlap.

Note on the delineation from the persistence-data-sqlite blueprint's `persistenceStore` topic: this blueprint's notification outcome sink is substrate-agnostic. When composing with the persistence-data-sqlite blueprint, the outcome sink's substrate is a facade verb on that store; the observability-essentials blueprint does not itself hold an opinion on the store engine and does not conflict on `persistenceStore`.

Rules for new topics (inherited from the application-spa, application-api-rest, security-auth-magic-link, and persistence vocabularies, restated as law): lower camel case, one concept per topic, no version suffixes. A topic names the decision area, not the chosen answer. Do not mint variants of existing strings (`healthEndpoints`, `probes`, `livenessReadiness` are all wrong when `healthProbes` already exists; `readinessAggregation`, `readyPolicy` are all wrong when `readinessSemantics` already exists; `statusPage`, `publicStatus`, `uptimePage` are all wrong when `statusPageContract` already exists).

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
| observability-essentials | 7101-7899 | 8xx | shipped v2.0.0 | `statusPageContract` |
| security-secrets-management | 8101-8899 | 9xx | shipped v1.0.0 | `secretsSource` |
| security-auth-clerk | 9101-9899 | 10xx | shipped v1.0.0 | `authModel` |
| security-auth-oauth2 | 10101-10899 | 11xx | shipped v1.0.0 | `authModel` |
| security-auth-keycloak | 11101-11899 | 12xx | shipped v1.0.0 | `authModel` |
| deploy-cloudflare-workers | 12101-12899 | 13xx | shipped v1.0.0 | `deploymentTarget` |
| persistence-data-d1 | 13101-13899 | 14xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| observability-probe-endpoints | 14101-14899 | 15xx | shipped v1.1.0 | `healthProbes`, `readinessSemantics` |
| application-datatable | 17101-17899 | 18xx | shipped v1.0.0 | none |

US 7101-7110 sit at the LOW end of the 7101-7899 band on purpose. A project-side story that mechanically derives from an observability-essentials REQs id into the number `7110` would collide against observability-essentials-US-7110 in this package; the band leaves headroom at the HIGH end (US 7181-7899) so a project's own stories anchored to observability-essentials REQs can allocate without conflict. The watchpost run4 lesson applies here too.

Row-status caveat: the delivery-ci-workflows seat shipped first (PR #95 merged at 595cab9c on main). This branch was rebased onto that main; the delivery-ci-workflows row reflects the shipped state, and the observability row flips to `shipped v1.0.0` at this branch's merge (Dave coordinates that final flip in the merge commit or an immediate follow-up).

## Shared expectations for future composing blueprints

- Reuse `healthProbes` exactly as spelled here when your blueprint holds an opinion on the health endpoint contract; contribute your own scope:global ADR on that string and let composition surface the pairing on the sole owner (`observability-probe-endpoints` from v1.0.0). This blueprint no longer claims the topic from v2.0.0.
- Reuse `readinessSemantics` exactly as spelled here when your blueprint holds an opinion on readiness aggregation or the declaration scope on the sole owner (`observability-probe-endpoints` from v1.0.0). This blueprint no longer claims the topic from v2.0.0.
- Reuse `statusPageContract` exactly as spelled here when your blueprint holds an opinion on the public status surface; a machine-readable JSON-endpoint blueprint or a historical-uptime blueprint conflicts here by design.
- From v2.0.0 this blueprint's decision states the body shape and dep-registry semantics for the two probe surfaces (as scope-local historical intent), the readiness dep registry and strict-any-fail readiness predicate for the essentials-alone case, and the declared-component fixed-enum status page as its ONLY global commitment. Compose compatible metrics-export, tracing, or authenticated-operator-dashboard blueprints, or expect the operator to supersede with one project-level ADR per topic.
- Global topics that plausibly belong to a future blueprint and are NOT claimed by any shipped blueprint: `messageSerialisation` and `deliverySemantics` (a message-consumer blueprint's natural globals), `caching` (unclaimed by every shipped blueprint), `metricsExport` and `tracingProtocol` (natural globals for a metrics or tracing blueprint that would compose alongside this one). Define any of these in your own package's topics doc, in this file's format, and consider whether the band-registry table above needs your slug added.
