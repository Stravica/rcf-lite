# deploy-hetzner-server topics

Shelf registry of global ADR topics and shelf-band anchors relevant
to `deploy-hetzner-server` v1.0.0.

## Global topics minted by this blueprint

| Topic | ADR | Meaning |
|---|---|---|
| `linuxCloudHostContract` | `ADR-3801` | The Hetzner Cloud VM as the shipped `cloudHost` shape. A future non-Hetzner sibling (Vultr, DigitalOcean, Fly.io) contributes the same topic string with a different provider and forces a deliberate conflict per the round-2 pattern. |
| `snapshotAndBackupCadence` | `ADR-3802` | Weekly snapshot as the shipped default, daily and off alternatives, Hetzner-managed backups as an elicited paid opt-in at approximately 20 percent of monthly server price. |

## Shelf id band and suffix block

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
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

The shelf-wide band registry lives in `packages/rcf-lite/docs/blueprint-authoring.md` section 5.

## Cross-references

- `security-secrets-management` (v1.0.1): the provisioner facade reads `HETZNER_ACCOUNT_API_KEY` through the applied secrets facade. The facade is the sole reader; every other module in the applying project imports the facade and never dereferences the token.
- `deploy-cloudflare-workers` (v1.2.0): sibling in the `deploy-*` family. The family enforces one-target-per-project at apply time (a project applying both refuses with `deploy-family-multiple-targets`).
- Round-7 T-2 `platform-docker-compose-host`: composes on `capabilities: [cloudHost]`; ships the compose runtime on the Hetzner host this blueprint provisions.
- Round-7 T-3 `edge-cloudflare-tunnel`: composes on `cloudHost` (systemd unit shape) or on `containerHost` (compose service shape); either shape bridges the Hetzner host to the Cloudflare edge without opening origin ports.
