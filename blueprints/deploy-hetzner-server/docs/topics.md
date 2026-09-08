# deploy-hetzner-server topics

Shelf registry of global ADR topics and shelf-band anchors relevant
to `deploy-hetzner-server` v1.0.0.

## Global topics minted by this blueprint

| Topic | ADR | Meaning |
|---|---|---|
| `linuxCloudHostContract` | `ADR-3801` | The Hetzner Cloud VM as the shipped `cloudHost` shape. A future non-Hetzner sibling (Vultr, DigitalOcean, Fly.io) contributes the same topic string with a different provider and forces a deliberate conflict. |
| `snapshotAndBackupCadence` | `ADR-3802` | Weekly snapshot as the shipped default, daily and off alternatives, Hetzner-managed backups as an elicited paid opt-in at approximately 20 percent of monthly server price. |

## Shelf-band registry (blueprint rows shipped to date)

Every shelf blueprint appends one row to every other blueprint's
`docs/topics.md` on ship, per hetzner-round-7-spec-2026-09-07.md
section 3.4 lesson 2. Rows below are in ship order.

| Blueprint | Version | Capability |
|---|---|---|
| application-account-settings | 1.0.0 | (none) |
| application-admin-console | 1.1.0 | (none; reads `zeroTrustGate`) |
| application-api-rest | 1.0.0 | (none) |
| application-charts | 1.0.0 | (none) |
| application-dashboard | 1.0.0 | (none) |
| application-datatable | 1.0.0 | (none) |
| application-empty-error-states | 1.0.0 | (none) |
| application-error-handling | 1.0.0 | (none) |
| application-file-upload | 1.0.0 | (none) |
| application-forms-wizard | 1.0.0 | (none) |
| application-notifications-in-app | 1.0.0 | (none) |
| application-onboarding-tour | 1.0.0 | (none) |
| application-spa | 1.0.0 | (none) |
| delivery-ci-workflows | 1.0.0 | (none) |
| deploy-cloudflare-workers | 1.2.0 | (none) |
| deploy-hetzner-server | 1.0.0 | `cloudHost` |
| edge-cloudflare-access | 1.0.0 | `zeroTrustGate` |
| edge-cloudflare-rate-limiting | 1.0.0 | `edgeRateLimit` |
| edge-cloudflare-turnstile | 1.0.0 | `humanCheck` |
| email-smtp-resend | 1.0.0 | (none) |
| jobs-background | 1.0.0 | `backgroundJobs` |
| messaging-queue-cloudflare | 1.0.0 | `queue` |
| object-storage-s3 | 1.0.0 | `objectStorage` |
| observability-essentials | 1.0.0 | (none) |
| observability-logging | 1.0.0 | (none) |
| observability-probe-endpoints | 1.0.0 | (none) |
| persistence-data-d1 | 1.0.0 | (none) |
| persistence-data-postgres | 1.0.0 | `relationalStore` |
| persistence-data-sqlite | 1.0.0 | (none) |
| platform-cloudflare-cron-triggers | 1.0.0 | `scheduledTrigger` |
| platform-cloudflare-durable-objects | 1.0.0 | `strongConsistencyCell`, `hibernatableWebSocket` |
| platform-cloudflare-kv | 1.0.0 | `keyValueStore` |
| security-auth-clerk | 1.0.0 | (none) |
| security-auth-keycloak | 1.0.0 | (none) |
| security-auth-magic-link | 1.0.0 | (none) |
| security-auth-oauth2 | 1.0.0 | (none) |
| security-secrets-management | 1.0.1 | `secretsProvider` |
