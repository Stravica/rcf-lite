# object-storage-s3 blueprint coordination vocabulary

This file is the object-storage-s3 half of the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | object-storage-s3 contribution | Origin | Composition note |
|---|---|---|---|
| `objectStorageContract` | ADR-2904-object-storage-s3-contract | Minted by this blueprint. Names the wire-shape contract for object storage; the shipped answer is the AWS S3 API (per https://developers.cloudflare.com/r2/api/s3/api/ Cloudflare R2 is S3-compatible and per https://docs.min.io/community/minio-object-store/administration/object-management/object-lifecycle-management.html MinIO derives from the same shape). | The one project-wide decision on the wire-shape contract for object storage. A future non-S3-shape sibling (`object-storage-native-gcs`, `object-storage-native-azure`) would contribute the same topic string with a different answer, forcing a DELIBERATE conflict the operator resolves with a project-level ADR |

The object-storage-s3 blueprint claims one global topic. Every other contribution is scope-local (ADR-2901 adapter, ADR-2902 presigned TTL floor, ADR-2903 multipart threshold do not contribute global topics; a composing blueprint that holds an opinion on any of them authors its own project-level ADR).

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
| application-empty-error-states | 22101-22899 | 23xx | shipped v1.0.0 | none |
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

US 28101-28108 sit at the LOW end of the 28101-28899 band on purpose. A project-side story mechanically derived from an object-storage-s3 REQ id into the number 28110 would collide against a shipped US-28110; band headroom (28109-28899) leaves that space.

ADR/TAC suffixes for this blueprint use the 2901-2999 block, continuing the shelf pattern.

## Shared expectations for future composing blueprints

- Reuse `objectStorageContract` exactly as spelled here when your blueprint holds an opinion on the wire-shape contract for object storage; contribute your own scope:global ADR on that string and let composition surface the pairing.
- A future `object-storage-native-gcs` or `object-storage-native-azure` sibling mints on demand; it composes on `security-secrets-management` for its own credential pair (same discipline as this blueprint) and conflicts by design on `objectStorageContract`.
- Consumer blueprints storing large binary payloads (uploads, attachments, generated reports) read the `objectStorage` capability declared on `blueprint.json` per section 6a of `blueprint-authoring.md`.

## Deliberate-conflict statement

This blueprint's ADR-2904 on `objectStorageContract` is a first shipped answer to a topic that will conflict, by design, with future non-S3-shape siblings. Applying `object-storage-s3` alongside a hypothetical `object-storage-native-gcs` raises one `globalAdrTopic` conflict the operator resolves via one of the four documented resolutions per topic (adopt one, keep the existing one, author a project-level supersede ADR, or `--resolve <topic>=project:<ADR-id>` on the add).
