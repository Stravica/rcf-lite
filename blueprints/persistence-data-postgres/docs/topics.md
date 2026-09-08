# persistence-data-postgres blueprint coordination vocabulary

This file is the persistence-data-postgres half of the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | persistence-data-postgres contribution | Origin | Composition note |
|---|---|---|---|
| `persistenceStore` | ADR-2801-persistence-data-postgres-driver | Reused from persistence-data-sqlite and persistence-data-d1 (both contribute the same topic string). This blueprint contributes a Postgres store on the same topic string on purpose. | The one project-wide decision on the primary durable store engine. Composing this blueprint with persistence-data-sqlite or persistence-data-d1 conflicts here by design; expected resolution is one project-level ADR that fixes the engine end to end |
| `migrationDiscipline` | ADR-2802-persistence-data-postgres-migration-shape | Reused from persistence-data-sqlite (boot-time forward-only runner discipline) and persistence-data-d1 (wrangler-CLI-owned deploy-pipeline discipline). This blueprint contributes numbered forward-only .sql migrations applied by an in-tree runner one file one transaction. | The one project-wide schema-evolution discipline. Composing this blueprint with persistence-data-sqlite or persistence-data-d1 conflicts here by design; expected resolution is one project-level ADR |

The persistence-data-postgres blueprint claims two global topics. Every other contribution is scope-local (ADR-2803 runner mode, ADR-2804 recovery, ADR-2805 connection-pool posture do not contribute global topics; a composing blueprint that holds an opinion on any of them authors its own project-level ADR).

Note on the round-6 reserved Hyperdrive adapter slot: the v1.0.0 facade holds the driver reference OPAQUE at ADR-2801 boundary so the round-6 v1.1.0 Hyperdrive adapter slots in as an additive minor without a topic conflict. See infra round 5 spec section 5.7 for the reserved-slot register.

Rules for new topics: lower camel case, one concept per topic, no version suffixes. A topic names the decision area, not the chosen answer.

## Id number bands (registry bootstrap)

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
| security-secrets-management | 8101-8899 | 9xx | shipped v1.0.1 | `secretsSource` |
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
| application-admin-console | 21101-21899 | 22xx | shipped v1.1.0 | `adminConsoleSignInSurface` |
| application-forms-wizard | 24101-24899 | 25xx | shipped v1.0.0 | none |
| application-account-settings | 25101-25899 | 26xx | shipped v1.0.0 | none |
| application-onboarding-tour | 26101-26899 | 27xx | shipped v1.0.0 | none |
| persistence-data-postgres | 27101-27899 | 28xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| object-storage-s3 | 28101-28899 | 29xx | shipped v1.1.0 | `objectStorageContract` |
| messaging-queue-cloudflare | 29101-29899 | 30xx | shipped v1.0.0 | `deliverySemantics` |
| jobs-background | 30101-30899 | 31xx | shipped v1.0.0 | `backgroundJobModel` |
| platform-cloudflare-kv | 31101-31899 | 32xx | shipped v1.0.0 | `keyValueStoreContract` |
| platform-cloudflare-cron-triggers | 32101-32899 | 33xx | shipped v1.0.0 | `scheduledTriggerContract` |
| platform-cloudflare-durable-objects | 33101-33899 | 34xx | shipped v1.0.0 | `strongConsistencyCellContract`, `websocketHubContract` |
| edge-cloudflare-access | 34101-34899 | 35xx | shipped v1.0.0 | `edgeAuthenticationGate` |
| edge-cloudflare-turnstile | 35101-35899 | 36xx | shipped v1.0.0 | `humanVerificationGate` |
| edge-cloudflare-rate-limiting | 36101-36899 | 37xx | shipped v1.0.0 | `edgeThrottleContract` |
| deploy-hetzner-server | 37101-37899 | 38xx | shipped v1.0.0 | `linuxCloudHostContract`, `snapshotAndBackupCadence` |
| platform-docker-compose-host | 38101-38899 | 39xx | shipped v1.0.0 | `containerHostContract` |
| edge-cloudflare-tunnel | 39101-39899 | 40xx | shipped v1.0.0 | `edgeIngressBridge` |

US 27101-27110 sit at the LOW end of the 27101-27899 band on purpose (watchpost run-4 lesson). A project-side story mechanically derived from a persistence-data-postgres REQ id into the number 27110 would collide against the shipped US-27110; band headroom (27111-27899) leaves that space.

Postgres suffixes for this blueprint use the 2801-2899 block, continuing the widening pattern (persistence-data-sqlite 6xx, persistence-data-d1 14xx, and persistence-data-postgres 28xx).

## Shared expectations for future composing blueprints

- Reuse `persistenceStore` exactly as spelled here when your blueprint holds an opinion on the project's primary durable store engine; contribute your own scope:global ADR on that string and let composition surface the pairing.
- Reuse `migrationDiscipline` exactly as spelled here when your blueprint holds an opinion on schema evolution.
- Round-6 reserved slot: the Hyperdrive adapter inside `persistence-data-postgres` v1.1.0 wraps the same facade contract with the Cloudflare Hyperdrive connection-pool and query-cache surface. No topic conflict, no facade re-shape; the driver reference is opaque at the ADR-2801 boundary.

## Deliberate-conflict statement

This blueprint's ADR-2801 on `persistenceStore` and ADR-2802 on `migrationDiscipline` are a Postgres-committed vendor sibling to persistence-data-sqlite (ADR-601, ADR-602) and persistence-data-d1 (ADR-1401, ADR-1402) on the same two topic strings. Applying two of the three on one project raises two `globalAdrTopic` conflicts the operator resolves via one of the four documented resolutions per topic (adopt one, keep the existing one, author a project-level supersede ADR, or `--resolve <topic>=project:<ADR-id>` on the add).
