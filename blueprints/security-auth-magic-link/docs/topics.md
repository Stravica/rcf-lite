# security-auth-magic-link blueprint coordination vocabulary

This file is the security-auth-magic-link half of the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | security-auth-magic-link contribution | Origin | Composition note |
|---|---|---|---|
| `authModel` | ADR-501-security-auth-magic-link-model | Reused verbatim from the application-spa vocabulary and the application-api-rest vocabulary | DELIBERATE pairing: application-spa contributes ADR-205-application-spa-auth-model (client half: cookie-based session, 401-redirect posture), application-api-rest contributes ADR-302-application-api-rest-auth-model (server half: four declared auth classes). Applying any two of the three on one project surfaces the pairing for operator resolution. Expected resolution: one project-level ADR that fixes the credential shape (this blueprint's opaque cookie session), maps it onto the server's auth classes if REST is applied, and specifies the client half's session-expiry posture if SPA is applied |

The security-auth-magic-link blueprint claims only one global topic. Every other contribution is scope-local (the four operational ADRs, ADR-502 through ADR-505, do not contribute global topics; a composing blueprint that holds an opinion on token secrecy, anti-enumeration budgets, session lifecycle, or rate limits authors its own project-level ADR if it wants to override).

Rules for new topics (inherited from the application-spa and REST vocabularies, restated as law): lower camel case, one concept per topic, no version suffixes. A topic names the decision area, not the chosen answer. Do not mint variants of existing strings (`sessionAuth`, `magicLink`, `sessionModel` are all wrong when `authModel` already exists; `operatorPanel` is claimed by the hello-panel walkthrough exemplar and is not free).

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

US 3101-3111 sit at the LOW end of the 3101-3899 band on purpose. A project-side story that mechanically derives from `security-auth-magic-link-REQ-011` into the number `3111` would collide against security-auth-magic-link-US-3111 in this package; the band leaves headroom at the HIGH end (US 3181-3899) so a project's own stories anchored to security-auth-magic-link REQs can allocate without conflict.

## Shared expectations for future composing blueprints

- Reuse `authModel` exactly as spelled here when your blueprint holds an opinion on the project's authentication model; contribute your own scope:global ADR on that string and let composition surface the pairing. An OIDC-flavoured security-auth-magic-link blueprint (see the security-auth-magic-link blueprint's guide, section 'when it does not fit') will conflict here by design.
- This blueprint's decision states the passwordless-magic-link half plus the opaque cookie-session transport. Compose compatible client and server halves, or expect the operator to supersede with one project-level auth-model ADR.
- Global topics that plausibly belong to a future blueprint and are NOT claimed by any shipped blueprint: `messageSerialisation` and `deliverySemantics` (a message-consumer blueprint's natural globals), `caching` (unclaimed by application-spa, application-api-rest, and security-auth-magic-link). Define any of these in your own package's topics doc, in this file's format, and consider whether the band-registry table above needs your slug added.
