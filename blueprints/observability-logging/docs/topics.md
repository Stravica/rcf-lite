# observability-logging: coordination vocabulary

## Global topics

| Topic | Owning ADR | Meaning | Composition note |
|---|---|---|---|
| `logging` | `ADR-1601-observability-logging-line-shape` | Structured single-line JSON emission contract with the shared minimum field set. | Shelf-canonical claim from v1.0.0. A composing blueprint that ships a different logging contract (structured multi-line, per-service special format, non-JSON) conflicts by design; the operator resolves at project level via `rcf define blueprint supersede logging --incoming <source>`. A library-registered logging provider (wsd-logging, acme-log-emit) is preferred over this shelf provider by the companion-suggestion mechanism. |

## Deliberately unclaimed topics

- `logRedaction` (text-level redaction of the `message` string). Named here so a future companion blueprint can claim it cleanly; this blueprint's redaction is field-name granularity per ADR-1603.
- `logTransport` (the transport downstream of stdout). Owned by the surrounding platform; a future blueprint may claim it if the shelf ever ships one.
- `logMetricsBridge` (emitting log-derived metrics). Named here so a future `metrics-store` companion can claim it cleanly.

## Shelf id band and suffix block

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
| observability-logging | 15101-15899 | 16xx | shipped v1.0.0 | `logging` |
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

The shelf-wide band registry lives in `packages/rcf-lite/docs/blueprint-authoring.md` section 5.
