# application-api-rest blueprint coordination vocabulary

This file is the application-api-rest half of the cross-blueprint contract; the application-spa blueprint's `blueprints/application-spa/docs/topics.md` defines the format and the founding vocabulary. The conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | application-api-rest contribution | Origin | Composition note |
|---|---|---|---|
| `errorEnvelope` | ADR-301-application-api-rest-error-envelope | Reused verbatim from the application-spa vocabulary | DELIBERATE pairing: application-spa contributes ADR-204-application-spa-error-envelope on this topic. Applying both blueprints to one project surfaces the conflict for operator resolution. Expected resolution: one project-level ADR adopting RFC 7807 end to end, superseding both halves |
| `authModel` | ADR-302-application-api-rest-auth-model | Reused verbatim from the application-spa vocabulary | DELIBERATE pairing with SPA's ADR-205-application-spa-auth-model (cookie-based sessions, client half). Expected resolution: one project-level ADR fixing the credential transport and mapping the client session model onto the four server classes |
| `apiVersioning` | ADR-303-application-api-rest-api-versioning | Minted here; pre-cleared as unclaimed in the application-spa vocabulary | The one versioning strategy for the project's wire contract. Any blueprint contributing a versioned API surface must join or supersede this decision |
| `logging` (retained historical) | ADR-304-application-api-rest-logging (no scope:global from v2.1.0) | Transferred to observability-logging-ADR-1601 as the shelf-canonical owner from v2.1.0 | The project's primary logging shape now sits on the shelf logging blueprint; the api-rest ADR-304 is retained as historical context and the api-rest blueprint no longer claims the global topic. Apply observability-logging 1.0.0 or later (or a registered library-side provider) to satisfy the `logging` role api-rest suggests |

Rules for new topics (inherited from the application-spa vocabulary, restated as law): lower camel case, one concept per topic, no version suffixes. A topic names the decision area, not the chosen answer. Do not mint variants of existing strings (`errorShape`, `auth`, `apiVersion`, `logShape` are all wrong).

## Id number bands

Band allocation is ratified policy (2026-08-19); the band IS the AC-collision enforcement mechanism, since AC ids are not namespaced by the 0.4.4 grammar. Composing blueprints take a fresh band rather than proposing namespaced AC ids.

This table is maintained shelf-wide across every blueprint's `docs/topics.md`. Rows are recorded at ship, never predicted.

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
| application-spa | 1101-1899 | 2xx | shipped v1.3.0 | `clientRouting`, `theming`, `clientState`, `errorEnvelope`, `authModel` |
| application-api-rest | 2101-2899 | 3xx | shipped v2.1.0 (suggestedCompanions added) | `errorEnvelope`, `authModel`, `apiVersioning` |
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

Suffix-family ids (ADR, TAC): SPA numbers in the 2xx range, this package takes 3xx (ADR-301 to ADR-308, TAC-301 to TAC-306); the next blueprint should take 4xx.

## Shared expectations for future composing blueprints

- Reuse `errorEnvelope`, `authModel`, `apiVersioning`, and `logging` exactly as spelled here when your blueprint holds an opinion on those decision areas; contribute your own scope:global ADR on the same string and let composition surface the pairing.
- This blueprint's decisions state the server-side halves: RFC 7807 produced at the pipeline's error boundary, four auth classes enforced in middleware, path-versioned contract, JSON-line logs. Compose compatible client or worker halves, or expect the operator to supersede with project-level decisions.
- Global topics that plausibly belong to a future blueprint and are NOT claimed here: `messageSerialisation` and `deliverySemantics` (a message-consumer blueprint's natural globals), `caching` (unclaimed by both application-spa and application-api-rest; claim it if your blueprint owns the caching story). Define any of these in your own package's topics doc, in this file's format.
