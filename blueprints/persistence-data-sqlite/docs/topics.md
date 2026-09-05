# persistence-data-sqlite blueprint coordination vocabulary

This file is the persistence-data-sqlite half of the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | persistence-data-sqlite contribution | Origin | Composition note |
|---|---|---|---|
| `persistenceStore` | ADR-601-persistence-data-sqlite-store-model | Minted here; pre-cleared as unclaimed against application-spa (`clientRouting`, `theming`, `clientState`, `errorEnvelope`, `authModel`), application-api-rest (`errorEnvelope`, `authModel`, `apiVersioning`, `logging`), security-auth-magic-link (`authModel`), and the hello-panel walkthrough exemplar (`operatorPanel`) | The one primary durable store engine for the project. Any composing blueprint that holds an opinion on the store engine (a Postgres-first blueprint, a KV-store blueprint, an event-sourced blueprint) contributes its own scope:global ADR on this exact string and lets composition surface the pairing. Expected resolution: one project-level ADR that fixes the engine and states the tier reasoning |
| `migrationDiscipline` | ADR-602-persistence-data-sqlite-migration-discipline | Minted here; pre-cleared as unclaimed against application-spa, application-api-rest, security-auth-magic-link, and hello-panel | The one schema-evolution discipline for the project. A composing blueprint that holds an opinion on migration discipline (event-sourced projections, dual-write patterns, tenant-per-schema, bidirectional up/down migrations) conflicts here by design. Expected resolution: one project-level ADR fixing the discipline |

The persistence-data-sqlite blueprint claims two global topics. Every other contribution is scope-local (the three operational ADRs, ADR-603 through ADR-605, do not contribute global topics; a composing blueprint that holds an opinion on event-secrecy, the module-boundary posture, or the backup model authors its own project-level ADR if it wants to override).

Note on the delineation from the application-api-rest blueprint's `logging` topic: `logging` (owned by application-api-rest ADR-304) governs the wire-log shape of the HTTP tier. This blueprint's ADR-603 governs the STORE-EVENT log shape (opened, migrated, backupCheckpoint, closed). The two log surfaces may share a shipper but do not share a topic. A blueprint that contributes a unified log discipline across all tiers would author its own scope:global ADR on `logging` and expect to conflict with REST there, not here.

Rules for new topics (inherited from the application-spa and REST vocabularies, restated as law): lower camel case, one concept per topic, no version suffixes. A topic names the decision area, not the chosen answer. Do not mint variants of existing strings (`store`, `dataStore`, `db`, `dbEngine` are all wrong when `persistenceStore` already exists; `schemaMigrations`, `dbMigrations`, `migrations` are all wrong when `migrationDiscipline` already exists).

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
| application-charts | 18101-18899 | 19xx | shipped v1.0.0 | none |
| application-dashboard | 19101-19899 | 20xx | shipped v1.0.0 | none |
| application-notifications-in-app | 20101-20899 | 21xx | shipped v1.0.0 | none |
| application-admin-console | 21101-21899 | 22xx | shipped v1.0.0 | none |

US 5101-5111 sit at the LOW end of the 5101-5899 band on purpose. A project-side story that mechanically derives from `persistence-data-sqlite-REQ-011` into the number `5111` would collide against persistence-data-sqlite-US-5111 in this package; the band leaves headroom at the HIGH end (US 5181-5899) so a project's own stories anchored to persistence-data-sqlite REQs can allocate without conflict. The watchpost run4 lesson applies here too.

## Shared expectations for future composing blueprints

- Reuse `persistenceStore` exactly as spelled here when your blueprint holds an opinion on the project's primary durable store engine; contribute your own scope:global ADR on that string and let composition surface the pairing. A Postgres-first blueprint (see the persistence guide 'when it does not fit') will conflict here by design.
- Reuse `migrationDiscipline` exactly as spelled here when your blueprint holds an opinion on schema evolution; a blueprint that contributes an event-sourced projection story or a dual-write pattern conflicts here by design.
- This blueprint's decision states the SQLite single-file engine plus the forward-only numbered-catalog discipline. Compose compatible caching, outbox, or projection blueprints, or expect the operator to supersede with one project-level ADR per topic.
- Global topics that plausibly belong to a future blueprint and are NOT claimed by any shipped blueprint: `messageSerialisation` and `deliverySemantics` (a message-consumer blueprint's natural globals), `caching` (unclaimed by application-spa, application-api-rest, security-auth-magic-link, and this blueprint). Define any of these in your own package's topics doc, in this file's format, and consider whether the band-registry table above needs your slug added.
