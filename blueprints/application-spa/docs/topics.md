# application-spa blueprint coordination vocabulary

This file is the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics (exact strings)

| Topic string | application-spa contribution | Meaning | Composition note |
|---|---|---|---|
| `clientRouting` | ADR-201-application-spa-routing | How URLs map to client surfaces | Owned by the client tier; a second client-tier blueprint on one project conflicts here by design |
| `theming` | ADR-202-application-spa-theming | The one theming mechanism for the project | Any blueprint contributing themable UI must join or supersede this decision. v1.1 strengthens the ADR in place with a runtime-observable probe (TAC-207); topic ownership is unchanged. |
| `clientState` | ADR-203-application-spa-client-state | Client cache and state regime | Client-tier owned |
| `errorEnvelope` | ADR-204-application-spa-error-envelope | The wire error shape | The application-api-rest blueprint contributes its own scope:global ADR on this exact topic; `rcf define blueprint add application-api-rest` after application-spa (or vice versa) surfaces a DELIBERATE conflict for operator resolution. Expected resolution: one project-level ADR adopting RFC 7807 end to end, superseding both |
| `authModel` | ADR-205-application-spa-auth-model | The project authentication model | Same deliberate pairing with the application-api-rest blueprint's auth-classes decision; security-auth-magic-link blueprint adds a third contributor. Resolve with one project-level ADR and `--resolve authModel=project:<id>` on subsequent adds |

Rules for new topics: lower camel case, one concept per topic, no version suffixes. A topic names the decision area, not the chosen answer.

v1.1 mints ZERO new global topics. The mechanism-reach cure lives entirely in additive non-global contributions (TAC-207, TAC-208, application-spa-US-1129, application-spa-US-1130) plus in-place amendments to ADR-206 and ADR-202 that strengthen the consequences narrative without moving the decision. `iconography` is NOT a global topic and remains non-global in v1.1.

## Id number bands

AC ids (and therefore US numeric ids, which anchor them) are NOT namespaced by the 0.4.4 schema grammar; only the band allocation prevents cross-blueprint AC collisions. The band IS the AC-collision enforcement mechanism: composing blueprints take a fresh band rather than proposing namespaced AC ids.

## Full-ecosystem registry table (post-v1.1.0 SPA bump)

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
| observability-logging | 15101-15899 | 16xx | shipped v1.0.0 | `logging` |
| application-error-handling | 16101-16899 | 17xx | shipped v1.0.0 | `errorHandling` |
| application-datatable | 17101-17899 | 18xx | shipped v1.0.0 | none |
| application-charts | 18101-18899 | 19xx | shipped v1.0.0 | none |
| application-dashboard | 19101-19899 | 20xx | shipped v1.0.0 | none |
| application-notifications-in-app | 20101-20899 | 21xx | shipped v1.0.0 | none |
| application-admin-console | 21101-21899 | 22xx | shipped v1.0.0 | none |

SPA v1.1.0 stays on the LOW end of its band: v1.0.0 occupied US-1101 through US-1128; v1.1.0 adds US-1129 and US-1130, leaving headroom above 1130 for future minor bumps and for project-side stories that mechanically derive to the 11xx numeric range.

Suffix-family ids (ADR, TAC) are string-distinct once slug-suffixed. SPA numbers its ADRs and TACs in the 2xx block for legibility: v1.0.0 ADR-201 through ADR-209 and TAC-201 through TAC-206; v1.1.0 adds TAC-207-application-spa-token-adherence-probe and TAC-208-application-spa-icon-adherence-probe.

## Shared expectations for composing blueprints

- Reuse `errorEnvelope`, `authModel`, and `theming` exactly as spelled above; do not mint `errorShape`, `auth`, or theme variants. New blueprints authoring in the `theming` space either supersede ADR-202 with a project-level ruling or supersede-and-adopt.
- The SPA data layer consumes RFC 7807 problem details (ADR-204) and cookie-based sessions (ADR-205); a client-tier blueprint's decisions should state their client-facing halves in terms compatible with these or expect the operator to supersede both.
- The v1.1 token-adherence probe and icon-adherence probe are BLUEPRINT ACs bound to BLUEPRINT TACs. A composing project realises the TACs against its own build layout; the ACs are runtime-observable and TC-bindable in the project's build cycle.

## v1.0.0 US-1101 collision note (preserved)

In run4 of the watchpost case study, a project-side `US-1101` derived mechanically from `REQ-011` (leading `11` + sequence `01`) collided with the application-spa blueprint's `application-spa-us-1101` at the AC-id-scoping bucket. The seat allocated the project story as `US-1181` and moved on. Lesson: keep contributions on the LOW end of the band and leave headroom at the HIGH end for project-side stories that mechanically derive to your numbers. v1.1 preserves this lesson: US-1129 and US-1130 remain at the low end.
