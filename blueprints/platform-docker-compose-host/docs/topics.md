# platform-docker-compose-host: docs topics

## Shelf-wide id band registry (rows appended by every blueprint)

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
| application-account-settings | 12801-13299 | 1329 | shipped | none |
| application-admin-console | 13301-13899 | 1330-1338 | shipped | none |
| application-api-rest | 800-899 | 8 | shipped | apiSurfaceContract |
| application-charts | 14201-14899 | 1420-1428 | shipped | none |
| application-dashboard | 15001-15899 | 1500-1508 | shipped | none |
| application-datatable | 16001-16899 | 1600-1608 | shipped | none |
| application-empty-error-states | 17001-17899 | 1700-1708 | shipped | none |
| application-error-handling | 18001-18899 | 1800-1808 | shipped | none |
| application-file-upload | 19001-19899 | 1900-1908 | shipped | none |
| application-forms-wizard | 20001-20899 | 2000-2008 | shipped | none |
| application-notifications-in-app | 22001-22899 | 2200-2208 | shipped | none |
| application-onboarding-tour | 23001-23899 | 2300-2308 | shipped | none |
| application-spa | 1000-1099 | 10 | shipped | spaCoreContract |
| delivery-ci-workflows | 3200-3299 | 32 | shipped | ciExecutionEnvironmentContract |
| deploy-cloudflare-workers | 24001-24999 | 2400-2499 | shipped | edgeRuntimeDeployment |
| deploy-hetzner-server | 37101-37899 | 3800-3899 | shipped | linuxCloudHostContract, snapshotAndBackupCadence |
| edge-cloudflare-access | 32001-32999 | 3200-3299 | shipped | zeroTrustGate |
| edge-cloudflare-rate-limiting | 36001-36999 | 3700-3799 | shipped | edgeRateLimit |
| edge-cloudflare-turnstile | 33001-33999 | 3300-3399 | shipped | humanVerificationGate |
| email-smtp-resend | 3600-3699 | 36 | shipped | none |
| jobs-background | 30101-30999 | 3100-3199 | shipped | jobScheduling |
| messaging-queue-cloudflare | 29101-29999 | 3000-3099 | shipped | queueMessaging |
| object-storage-s3 | 28101-28999 | 2900-2999 | shipped | objectStorageContract |
| observability-essentials | 2500-2599 | 25 | shipped | none |
| observability-logging | 2600-2699 | 26 | shipped | none |
| observability-probe-endpoints | 2700-2799 | 27 | shipped | none |
| persistence-data-d1 | 3400-3499 | 34 | shipped | relationalStore |
| persistence-data-postgres | 27101-27999 | 2800-2899 | shipped | relationalStore |
| persistence-data-sqlite | 3500-3599 | 35 | shipped | relationalStore |
| platform-cloudflare-cron-triggers | 32001-32999 | 3200-3299 | shipped | scheduledTrigger |
| platform-cloudflare-durable-objects | 33001-33999 | 3300-3399 | shipped | strongConsistencyCell, hibernatableWebSocket |
| platform-cloudflare-kv | 31001-31999 | 3100-3199 | shipped | keyValueStore |
| platform-docker-compose-host | 38101-38899 | 3900-3999 | shipped | containerHostContract |
| security-auth-clerk | 3900-3999 | 39 | shipped | authProvider |
| security-auth-keycloak | 4000-4099 | 40 | shipped | authProvider |
| security-auth-magic-link | 4100-4199 | 41 | shipped | authProvider |
| security-auth-oauth2 | 4200-4299 | 42 | shipped | authProvider |
| security-secrets-management | 4300-4399 | 43 | shipped | secretsProvider |

## Contribution ids for platform-docker-compose-host

| Kind | Id | File |
|---|---|---|
| REQ | platform-docker-compose-host-REQ-001 | requirements/platform-docker-compose-host-req-001.json |
| REQ | platform-docker-compose-host-REQ-002 | requirements/platform-docker-compose-host-req-002.json |
| REQ | platform-docker-compose-host-REQ-003 | requirements/platform-docker-compose-host-req-003.json |
| REQ | platform-docker-compose-host-REQ-004 | requirements/platform-docker-compose-host-req-004.json |
| REQ | platform-docker-compose-host-REQ-005 | requirements/platform-docker-compose-host-req-005.json |
| REQ | platform-docker-compose-host-REQ-006 | requirements/platform-docker-compose-host-req-006.json |
| US  | platform-docker-compose-host-US-38101 | user-stories/platform-docker-compose-host-us-38101.json |
| US  | platform-docker-compose-host-US-38102 | user-stories/platform-docker-compose-host-us-38102.json |
| US  | platform-docker-compose-host-US-38103 | user-stories/platform-docker-compose-host-us-38103.json |
| US  | platform-docker-compose-host-US-38104 | user-stories/platform-docker-compose-host-us-38104.json |
| US  | platform-docker-compose-host-US-38105 | user-stories/platform-docker-compose-host-us-38105.json |
| US  | platform-docker-compose-host-US-38106 | user-stories/platform-docker-compose-host-us-38106.json |
| US  | platform-docker-compose-host-US-38107 | user-stories/platform-docker-compose-host-us-38107.json |
| US  | platform-docker-compose-host-US-38108 | user-stories/platform-docker-compose-host-us-38108.json |
| US  | platform-docker-compose-host-US-38109 | user-stories/platform-docker-compose-host-us-38109.json |
| TAC | TAC-3901-platform-docker-compose-host-compose-layout | tacs/tac-3901-platform-docker-compose-host-compose-layout.json |
| TAC | TAC-3902-platform-docker-compose-host-secrets-mount | tacs/tac-3902-platform-docker-compose-host-secrets-mount.json |
| TAC | TAC-3903-platform-docker-compose-host-healthcheck-lint | tacs/tac-3903-platform-docker-compose-host-healthcheck-lint.json |
| TAC | TAC-3904-platform-docker-compose-host-reverse-proxy-artefact | tacs/tac-3904-platform-docker-compose-host-reverse-proxy-artefact.json |
| ADR | ADR-3901-platform-docker-compose-host-contract | adrs/adr-3901-platform-docker-compose-host-contract.json |
| ADR | ADR-3902-platform-docker-compose-host-reverse-proxy | adrs/adr-3902-platform-docker-compose-host-reverse-proxy.json |
| ADR | ADR-3903-platform-docker-compose-host-reject-coolify | adrs/adr-3903-platform-docker-compose-host-reject-coolify.json |
| ADR | ADR-3904-platform-docker-compose-host-log-driver | adrs/adr-3904-platform-docker-compose-host-log-driver.json |
