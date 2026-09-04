# observability-probe-endpoints blueprint coordination vocabulary

This file is the observability-probe-endpoints half of the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.5.0 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | observability-probe-endpoints contribution | Origin | Composition note |
|---|---|---|---|
| `healthProbes` | ADR-1501-observability-probe-endpoints-health-probes | Reused from the observability-essentials vocabulary (observability-essentials contributes a self-supervised two-endpoint HTTP JSON contract on the request-traffic listener at the same topic string). This blueprint contributes an elicit-from-target-integration-profile model on the same topic string on purpose. | The one project-wide decision on the health probe interface. Composing this blueprint with observability-essentials fires a `globalAdrTopic` conflict by design because the two blueprints answer different questions: essentials commits to a self-supervised HTTP JSON floor; this blueprint commits to an elicit-and-adapt model whose shape follows the external supervisor. Expected resolution: one project-level ADR that either commits to the elicit-and-adapt model (external supervisor drives the shape) or the fused self-supervised model (project owns the shape) or an explicit hybrid with boundaries |
| `readinessSemantics` | ADR-1502-observability-probe-endpoints-readiness-semantics | Reused from the observability-essentials vocabulary (observability-essentials contributes strict-any-fail-over-declared-deps as the project-wide readiness rule at the same topic string). This blueprint contributes per-profile readiness semantics on the same topic string on purpose. | The one project-wide readiness semantics decision. Composing with observability-essentials fires a `globalAdrTopic` conflict by design. Expected resolution: one project-level ADR that commits to one of the two rules or an explicit hybrid |

The observability-probe-endpoints blueprint claims two global topics. Every other contribution is scope-local (ADR-1503 the Kubernetes default, ADR-1504 the separate-port option, and ADR-1505 the external-response secrecy rule do not contribute global topics; a composing blueprint that holds an opinion on the default profile, on probe-listener topology, or on response secrecy authors its own project-level ADR if it wants to override).

Note on the deliberate conflict with observability-essentials: this blueprint is designed for the EXTERNAL-SYSTEM INTEGRATION case (orchestrators, load balancers, uptime monitors probing the service, with their conventions driving the wire shape). observability-essentials is designed for the SELF-SUPERVISED all-in-one case (probes plus public status page plus notification outcome sink for a project that designs its own observability floor). Both are legitimate; each is the right default for its case. The conflict is the mechanism telling the operator to pick one intentionally. Precedent for the vendor-sibling pattern: security-auth-clerk conflicts with security-auth-magic-link on `authModel` on purpose; persistence-data-d1 conflicts with persistence-data-sqlite on both `persistenceStore` and `migrationDiscipline` on purpose. This blueprint follows the same pattern on `healthProbes` and `readinessSemantics`.

Note on the delineation from observability-essentials's `statusPageContract` topic: this blueprint does not contribute an opinion on the public status page. A project that wants the probe surface from this blueprint AND the public status page and notification outcome sink from observability-essentials resolves the two `healthProbes` and `readinessSemantics` conflicts with project-level ADRs and keeps `statusPageContract` on the essentials-supplied side; the blueprints then compose without further conflict.

Rules for new topics (inherited from the application-spa, application-api-rest, security-auth-magic-link, persistence-data-sqlite, delivery-ci-workflows, observability-essentials, security-secrets-management, security-auth-clerk, email-smtp-resend, and deploy-cloudflare-workers vocabularies, restated as law): lower camel case, one concept per topic, no version suffixes. A topic names the decision area, not the chosen answer. Do not mint variants of existing strings (`probeInterface`, `probeSurface`, `probes`, `livenessReadiness`, `probeTransport` are all wrong when `healthProbes` already exists; `readinessAggregation`, `readyPolicy`, `readinessRule` are all wrong when `readinessSemantics` already exists).

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
| observability-essentials | 7101-7899 | 8xx | shipped v1.0.0 | `healthProbes`, `readinessSemantics`, `statusPageContract` |
| security-secrets-management | 8101-8899 | 9xx | shipped v1.0.0 | `secretsSource` |
| security-auth-clerk | 9101-9899 | 10xx | shipped v1.0.0 | `authModel` |
| security-auth-oauth2 | 10101-10899 | 11xx | shipped v1.0.0 | `authModel` |
| security-auth-keycloak | 11101-11899 | 12xx | shipped v1.0.0 | `authModel` |
| deploy-cloudflare-workers | 12101-12899 | 13xx | shipped v1.0.0 | `deploymentTarget` |
| persistence-data-d1 | 13101-13899 | 14xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| observability-probe-endpoints | 14101-14899 | 15xx | shipped v1.1.0 | `healthProbes`, `readinessSemantics` |

US 14101-14108 sit at the LOW end of the 14101-14899 band on purpose. A project-side story that mechanically derives from an observability-probe-endpoints REQ id into the number `14108` would collide against observability-probe-endpoints-US-14108 in this package; the band leaves headroom at the HIGH end (US 14181-14899) so a project's own stories anchored to observability-probe-endpoints REQs can allocate without conflict. The watchpost run4 lesson applies here too. Band spacing between the previous HQ-lane row (persistence-data-d1, 13101-13899, 14xx) and this one (14101-14899, 15xx) reflects the four-digit widening pattern opened by security-auth-clerk at 10xx and continued through the round-2 HQ lane.

## Shared expectations for future composing blueprints

- Reuse `healthProbes` exactly as spelled here when your blueprint holds an opinion on the health probe interface; contribute your own scope:global ADR on that string and let composition surface the pairing. A future blueprint that ships a metrics-probe hybrid or a health-check protocol variant (an OpenTelemetry-agent-scrape probe, a JMX health surface) will conflict here by design and expect a project-level ADR resolution.
- Reuse `readinessSemantics` exactly as spelled here when your blueprint holds an opinion on readiness aggregation or its evaluator cadence.
- The Kubernetes default (ADR-1503), the separate-port option (ADR-1504), and the external-response secrecy rule (ADR-1505) are scope-local. A composing blueprint that holds a different opinion on the default profile, the listener topology, or the response surface authors its own project-level ADR; none of them are minted as globals because the space of legitimate variations is smaller than the space of legitimate `healthProbes` variations.
- Global topics that plausibly belong to a future blueprint and are NOT claimed by any shipped blueprint: `messageSerialisation` and `deliverySemantics` (a message-consumer blueprint's natural globals), `caching` (unclaimed by every shipped blueprint), `metricsExport` and `tracingProtocol` (natural globals for a metrics or tracing blueprint that would compose alongside this one), `deploymentPackaging` (unclaimed; a natural global for a container-image or artefact-bundling blueprint that composes above the deploy target). Define any of these in your own package's topics doc, in this file's format, and consider whether the band-registry table above needs your slug added.
