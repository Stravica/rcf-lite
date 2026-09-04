# persistence-data-d1 blueprint coordination vocabulary

This file is the persistence-data-d1 half of the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | persistence-data-d1 contribution | Origin | Composition note |
|---|---|---|---|
| `persistenceStore` | ADR-1401-persistence-data-d1-store-model | Reused from the persistence-data-sqlite vocabulary (persistence-data-sqlite contributes a single-file SQLite store on the same topic string). This blueprint contributes a Cloudflare D1 store on the same topic string on purpose. | The one project-wide decision on the primary durable store engine. Composing this blueprint with persistence-data-sqlite (or a future persistence-postgres, persistence-kv, event-sourced blueprint) conflicts here by design; the expected resolution is one project-level ADR that fixes the engine (D1 per this blueprint, or single-file SQLite, or another) and states the tier reasoning |
| `migrationDiscipline` | ADR-1402-persistence-data-d1-migration-discipline | Reused from the persistence-data-sqlite vocabulary (persistence-data-sqlite contributes a boot-time forward-only runner discipline on the same topic string). This blueprint contributes a wrangler-CLI-owned deploy-pipeline-gated discipline on the same topic string on purpose. | The one project-wide schema-evolution discipline. Composing this blueprint with persistence-data-sqlite (whose discipline runs at boot inside the process) or a future event-sourced-projection or bidirectional-migration blueprint conflicts here by design; the expected resolution is one project-level ADR that fixes the discipline for the project |

The persistence-data-d1 blueprint claims two global topics. Every other contribution is scope-local (the three operational ADRs, ADR-1403 through ADR-1405, do not contribute global topics; a composing blueprint that holds an opinion on event-secrecy, the module-boundary posture, or the recovery model authors its own project-level ADR if it wants to override).

Note on the delineation from the application-api-rest blueprint's `logging` topic: `logging` (owned by application-api-rest ADR-304) governs the wire-log shape of the HTTP tier. This blueprint's ADR-1403 governs the STORE-EVENT log shape (facadeReady, migrationsApplied, backupExported, timeTravelRestored, queryFailed). The two log surfaces may share a shipper but do not share a topic. A blueprint that contributes a unified log discipline across all tiers would author its own scope:global ADR on `logging` and expect to conflict with the REST blueprint there, not here.

Rules for new topics (inherited from the application-spa, application-api-rest, security-auth-magic-link, persistence-data-sqlite, delivery-ci-workflows, observability-essentials, security-secrets-management, security-auth-clerk, and email-smtp-resend vocabularies, restated as law): lower camel case, one concept per topic, no version suffixes. A topic names the decision area, not the chosen answer. Do not mint variants of existing strings (`store`, `dataStore`, `db`, `dbEngine`, `d1Store`, `edgeStore` are all wrong when `persistenceStore` already exists; `schemaMigrations`, `dbMigrations`, `wranglerMigrations`, `migrations` are all wrong when `migrationDiscipline` already exists).

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

US 13101-13107 sit at the LOW end of the 13101-13899 band on purpose. A project-side story that mechanically derives from a persistence-data-d1 REQ id into the number `13107` would collide against persistence-data-d1-US-13107 in this package; the band leaves headroom at the HIGH end (US 13181-13899) so a project's own stories anchored to persistence-data-d1 REQs can allocate without conflict. The watchpost run4 lesson applies here too.

ADR and TAC suffixes for this blueprint use the 1401-1499 block, continuing the four-digit widening opened by security-auth-clerk at 1001-1099 (security-auth-clerk topics.md notes that the three-digit space fills at 9xx and forthcoming blueprints continue widening at 1101, 1201, 1301, and now 1401). Sibling round-2 blueprints (deploy-cloudflare-workers at 1301-1399, observability-probe-endpoints at 1501-1599) allocate on the same widening.

## Shared expectations for future composing blueprints

- Reuse `persistenceStore` exactly as spelled here (matching persistence-data-sqlite's contribution on the same topic string) when your blueprint holds an opinion on the project's primary durable store engine; contribute your own scope:global ADR on that string and let composition surface the pairing. A vendor-committed persistence blueprint on a different engine (Postgres-hosted, KV-oriented, event-sourced) will conflict here by design; the operator resolves at apply.
- Reuse `migrationDiscipline` exactly as spelled here (matching persistence-data-sqlite's contribution on the same topic string) when your blueprint holds an opinion on schema evolution. A blueprint that contributes a boot-time application-side runner discipline (persistence-data-sqlite), an out-of-band vendor-CLI discipline (this blueprint), or an event-sourced projection discipline (future) conflicts here by design.
- Event-secrecy (ADR-1403), module boundary (ADR-1404), and recovery model (ADR-1405) are scope-local. A composing blueprint that holds an opinion on any of them authors its own project-level ADR; none of them are minted as globals because the space of legitimate variations is smaller than the space of legitimate `persistenceStore` or `migrationDiscipline` variations.
- Global topics that plausibly belong to a future blueprint and are NOT claimed by any shipped blueprint: `messageSerialisation` and `deliverySemantics` (a message-consumer blueprint's natural globals), `caching` (unclaimed by every shipped blueprint), `metricsExport` and `tracingProtocol` (natural globals for a metrics or tracing blueprint), `deploymentTarget` (expected to land with the round-2 `deploy-cloudflare-workers` blueprint). Define any of these in your own package's topics doc, in this file's format, and consider whether the band-registry table above needs your slug added.

## Deliberate-conflict statement

This blueprint's ADR-1401 on `persistenceStore` and ADR-1402 on `migrationDiscipline` are a Cloudflare-D1-committed vendor sibling to persistence-data-sqlite's ADR-601 and ADR-602 on the same two topic strings. Applying both on one project raises two `globalAdrTopic` conflicts the operator resolves via one of the four documented resolutions per topic (adopt one, keep the existing one, author a project-level supersede ADR, or `--resolve <topic>=project:<ADR-id>` on the add). The pairing precedent is `application-spa` + `application-api-rest` on `errorEnvelope` and `authModel` (two globals conflict at once because the two blueprints jointly cover both halves of a shared decision), and `security-auth-clerk` + `security-auth-magic-link` on `authModel` (two vendor-committed siblings conflict on one global because they hold different answers on the same decision area). This blueprint combines both precedents: two vendor-committed siblings on two shared globals at once. The operator's resolution is a project-level ADR per topic that fixes the engine and the discipline together; a project that mixes D1 for one tier and single-file SQLite for another is a supersede-and-forge shape the mechanism does not encourage.

## Rename awareness

Cross-references in this blueprint's prose use the target-state slugs from the ratified renames pass: `persistence-data-sqlite` (for the shipped former `persistence` blueprint), `application-spa`, `application-api-rest`, `security-auth-magic-link`, `observability-essentials`. The rename pass merged before this blueprint shipped; every slug named above resolves against a currently-shipped blueprint or a currently-reserved round-2 sibling.
