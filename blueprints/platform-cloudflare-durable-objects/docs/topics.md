# platform-cloudflare-durable-objects blueprint coordination vocabulary

This file is the platform-cloudflare-durable-objects half of the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | platform-cloudflare-durable-objects contribution | Origin | Composition note |
|---|---|---|---|
| `strongConsistencyCellContract` | ADR-3401-platform-cloudflare-durable-objects-single-cell-contract | Minted by this blueprint. Names the wire-shape contract for a strongly consistent single-instance authoritative cell (counter, session store, lock); the shipped answer is a Cloudflare Durable Object named instance per https://developers.cloudflare.com/durable-objects/. | The one project-wide decision on the strong-consistency cell contract at the shipped-shape boundary. A future non-Cloudflare sibling (a Postgres advisory-lock singleton, a Redis single-master pattern) would contribute the same topic string with a different answer, forcing a DELIBERATE conflict the operator resolves with a project-level ADR. |
| `websocketHubContract` | ADR-3402-platform-cloudflare-durable-objects-websocket-hub-contract | Minted by this blueprint. Names the wire-shape contract for a coordinated-multiplayer websocket hub; the shipped answer is a Cloudflare Durable Object hub instance with hibernatable WebSockets per https://developers.cloudflare.com/durable-objects/. | The one project-wide decision on the hub contract. A future non-Cloudflare hub sibling (Redis pub-sub broker, a bespoke websocket server) would contribute the same topic string with a different answer, forcing a DELIBERATE conflict the operator resolves with a project-level ADR. |

The platform-cloudflare-durable-objects blueprint claims two global topics (both minted here, both under Cloudflare Durable Objects on the shipped path). Every other contribution is scope-local (ADR-3403 storage backend, ADR-3404 migrations shape, ADR-3405 hibernation posture do not contribute global topics; a composing blueprint that holds an opinion on any of them authors its own project-level ADR).

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
| deploy-cloudflare-workers | 12101-12899 | 13xx | shipped v1.2.0 | `deploymentTarget` |
| persistence-data-d1 | 13101-13899 | 14xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| observability-probe-endpoints | 14101-14899 | 15xx | shipped v1.1.0 | `healthProbes`, `readinessSemantics` |
| observability-logging | 15101-15899 | 16xx | shipped v1.0.0 | `logging` |
| application-error-handling | 16101-16899 | 17xx | shipped v1.0.0 | `errorHandling` |
| application-datatable | 17101-17899 | 18xx | shipped v1.0.0 | none |
| application-charts | 18101-18899 | 19xx | shipped v1.0.0 | none |
| application-dashboard | 19101-19899 | 20xx | shipped v1.0.0 | none |
| application-notifications-in-app | 20101-20899 | 21xx | shipped v1.0.0 | none |
| application-admin-console | 21101-21899 | 22xx | shipped v1.1.0 | `adminConsoleSignInSurface` |
| application-empty-error-states | 22101-22899 | 23xx | shipped v1.0.0 | none |
| application-file-upload | 23101-23899 | 24xx | shipped v1.0.0 | none |
| application-forms-wizard | 24101-24899 | 25xx | shipped v1.0.0 | none |
| application-account-settings | 25101-25899 | 26xx | shipped v1.0.0 | none |
| application-onboarding-tour | 26101-26899 | 27xx | shipped v1.0.0 | none |
| persistence-data-postgres | 27101-27899 | 28xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| object-storage-s3 | 28101-28899 | 29xx | shipped v1.0.0 | `objectStorageContract` |
| messaging-queue-cloudflare | 29101-29899 | 30xx | shipped v1.0.0 | `deliverySemantics` |
| jobs-background | 30101-30899 | 31xx | shipped v1.0.0 | `backgroundJobModel` |
| platform-cloudflare-kv | 31101-31899 | 32xx | shipped v1.0.0 | `keyValueStoreContract` |
| platform-cloudflare-cron-triggers | 32101-32899 | 33xx | shipped v1.0.0 | `scheduledTriggerContract` |
| platform-cloudflare-durable-objects | 33101-33899 | 34xx | shipped v1.0.0 | `strongConsistencyCellContract`, `websocketHubContract` |
| edge-cloudflare-access | 34101-34899 | 35xx | shipped v1.0.0 | `edgeAuthenticationGate` |
| edge-cloudflare-turnstile | 35101-35899 | 36xx | shipped v1.0.0 | `humanVerificationGate` |
| edge-cloudflare-rate-limiting | 36101-36899 | 37xx | shipped v1.0.0 | `edgeThrottleContract` |
| deploy-hetzner-server | 37101-37899 | 38xx | shipped v1.0.0 | `linuxCloudHostContract`, `snapshotAndBackupCadence` |

US 33101-33112 sit at the LOW end of the 33101-33899 band on purpose (watchpost run-4 lesson). A project-side story mechanically derived from a platform-cloudflare-durable-objects REQ id into the number 33113 would collide against a shipped US-33113; band headroom (33113-33899) leaves that space.

ADR/TAC suffixes for this blueprint use the 3401-3499 block, continuing the shelf pattern.

## Shared expectations for future composing blueprints

- Reuse `strongConsistencyCellContract` exactly as spelled here when your blueprint holds an opinion on the strong-consistency cell contract; contribute your own scope:global ADR on that string and let composition surface the pairing.
- Reuse `websocketHubContract` exactly as spelled here when your blueprint holds an opinion on the websocket-hub contract; the same pattern applies.
- A future non-Cloudflare adapter on either contract mints on demand; each claims the same topic string and conflicts by design.
- Consumer blueprints reading the `strongConsistencyCell` or `hibernatableWebSocket` capability declared on `blueprint.json` per section 6a of `blueprint-authoring.md` obtain the DO facade wiring at apply time via the T-5 visual-round capability-declaration mechanism.

## Deliberate-conflict statement

This blueprint's ADR-3401 on `strongConsistencyCellContract` and ADR-3402 on `websocketHubContract` are the first shipped answers to two topics that will conflict, by design, with future non-Cloudflare siblings. Applying `platform-cloudflare-durable-objects` alongside such a sibling would raise `globalAdrTopic` conflicts the operator resolves via one of the four documented resolutions per topic (adopt one, keep the existing one, author a project-level supersede ADR, or `--resolve <topic>=project:<ADR-id>` on the add).
