# observability-probe-endpoints blueprint coordination vocabulary

This file is the observability-probe-endpoints half of the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.5.0 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | observability-probe-endpoints contribution | Origin | Composition note |
|---|---|---|---|
| `healthProbes` | ADR-1501-observability-probe-endpoints-health-probes | From essentials v2.0.0 this blueprint is the SOLE shelf-wide claimant of `healthProbes`. Round 2 canon: probes elicited from a target-integration profile; Kubernetes default `/live` + `/ready` on the request-traffic listener. Essentials v2.0.0 (see `projects/rcf-lite-wsd/specs/rcf-lite-probe-path-alignment-spec-2026-09-04.md` section 4) dropped its own scope:global claim on this topic. | Composing this blueprint with observability-essentials v2.0.0 or later fires NO `globalAdrTopic` conflict on `healthProbes`; the resolved profile path binds automatically for essentials on the same project. A composing blueprint that holds a different endpoint contract (a single `/health` endpoint, a gRPC health protocol, probes on a separate admin port) contributes its own scope:global ADR on this string and lets composition surface the pairing. Expected resolution: one project-level ADR that either adopts the composing blueprint or supersedes both |
| `readinessSemantics` | ADR-1502-observability-probe-endpoints-readiness-semantics | From essentials v2.0.0 this blueprint is the SOLE shelf-wide claimant of `readinessSemantics`. Round 2 canon: per-profile readiness semantics (Kubernetes profile default is strict-any-fail-over-declared-deps). Essentials v2.0.0 dropped its own scope:global claim on this topic (spec section 4). | Composing with observability-essentials v2.0.0 or later fires NO `globalAdrTopic` conflict on `readinessSemantics`. A composing blueprint that holds a different opinion (quorum aggregation, write-path-only readiness, graceful-degradation model) contributes its own scope:global ADR on this string and lets composition surface the pairing |

The observability-probe-endpoints blueprint claims two global topics. Every other contribution is scope-local (ADR-1503 the Kubernetes default, ADR-1504 the separate-port option, and ADR-1505 the external-response secrecy rule do not contribute global topics; a composing blueprint that holds an opinion on the default profile, on probe-listener topology, or on response secrecy authors its own project-level ADR if it wants to override).

Note on the delineation with observability-essentials from essentials v2.0.0: essentials contributes the body shape, dep registry, probe-secrecy rule, status page and notification sink; this blueprint contributes the path binding and profile elicitation. The two compose without a conflict on `healthProbes` or `readinessSemantics` from essentials v2.0.0 forward (this blueprint is the sole claimant on both). Precedent for the deliberate-conflict pattern still stands on other topic pairs: security-auth-clerk conflicts with security-auth-magic-link on `authModel` on purpose; persistence-data-d1 conflicts with persistence-data-sqlite on both `persistenceStore` and `migrationDiscipline` on purpose.

Note on the delineation from observability-essentials's `statusPageContract` topic: this blueprint does not contribute an opinion on the public status page. A project that wants the probe surface from this blueprint AND the public status page and notification outcome sink from observability-essentials composes the two cleanly from essentials v2.0.0 forward; `statusPageContract` stays on the essentials-supplied side and no probe-path or readiness-semantics conflict fires.

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
| observability-essentials | 7101-7899 | 8xx | shipped v2.0.0 | `statusPageContract` |
| security-secrets-management | 8101-8899 | 9xx | shipped v1.0.0 | `secretsSource` |
| security-auth-clerk | 9101-9899 | 10xx | shipped v1.0.0 | `authModel` |
| security-auth-oauth2 | 10101-10899 | 11xx | shipped v1.0.0 | `authModel` |
| security-auth-keycloak | 11101-11899 | 12xx | shipped v1.0.0 | `authModel` |
| deploy-cloudflare-workers | 12101-12899 | 13xx | shipped v1.0.0 | `deploymentTarget` |
| persistence-data-d1 | 13101-13899 | 14xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| observability-probe-endpoints | 14101-14899 | 15xx | shipped v1.1.0 | `healthProbes`, `readinessSemantics` |
| application-datatable | 17101-17899 | 18xx | shipped v1.0.0 | none |
| application-charts | 18101-18899 | 19xx | shipped v1.0.0 | none |
| application-dashboard | 19101-19899 | 20xx | shipped v1.0.0 | none |

US 14101-14108 sit at the LOW end of the 14101-14899 band on purpose. A project-side story that mechanically derives from an observability-probe-endpoints REQ id into the number `14108` would collide against observability-probe-endpoints-US-14108 in this package; the band leaves headroom at the HIGH end (US 14181-14899) so a project's own stories anchored to observability-probe-endpoints REQs can allocate without conflict. The watchpost run4 lesson applies here too. Band spacing between the previous HQ-lane row (persistence-data-d1, 13101-13899, 14xx) and this one (14101-14899, 15xx) reflects the four-digit widening pattern opened by security-auth-clerk at 10xx and continued through the round-2 HQ lane.

## Shared expectations for future composing blueprints

- Reuse `healthProbes` exactly as spelled here when your blueprint holds an opinion on the health probe interface; contribute your own scope:global ADR on that string and let composition surface the pairing. A future blueprint that ships a metrics-probe hybrid or a health-check protocol variant (an OpenTelemetry-agent-scrape probe, a JMX health surface) will conflict here by design and expect a project-level ADR resolution.
- Reuse `readinessSemantics` exactly as spelled here when your blueprint holds an opinion on readiness aggregation or its evaluator cadence.
- The Kubernetes default (ADR-1503), the separate-port option (ADR-1504), and the external-response secrecy rule (ADR-1505) are scope-local. A composing blueprint that holds a different opinion on the default profile, the listener topology, or the response surface authors its own project-level ADR; none of them are minted as globals because the space of legitimate variations is smaller than the space of legitimate `healthProbes` variations.
- Global topics that plausibly belong to a future blueprint and are NOT claimed by any shipped blueprint: `messageSerialisation` and `deliverySemantics` (a message-consumer blueprint's natural globals), `caching` (unclaimed by every shipped blueprint), `metricsExport` and `tracingProtocol` (natural globals for a metrics or tracing blueprint that would compose alongside this one), `deploymentPackaging` (unclaimed; a natural global for a container-image or artefact-bundling blueprint that composes above the deploy target). Define any of these in your own package's topics doc, in this file's format, and consider whether the band-registry table above needs your slug added.
