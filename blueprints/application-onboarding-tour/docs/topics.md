# application-onboarding-tour: coordination vocabulary

## Global topics

The blueprint claims no new global topics at v1.0.0. Onboarding-tour is a consumer of the applied SPA, dashboard, notifications-in-app and account-settings surfaces; every ADR (dismissal-policy, completion-state-store shape, checklist-anchor slot) is non-global.

## Deliberately unclaimed topics

- `completionStateStore` (the shape of a completion-state record beyond this blueprint's needs). Reserved for the applied persistence blueprint's own ADR set when server-side-per-principal is elicited. The onboarding-tour blueprint hands off the store to the applied provider through the completion-store interface.
- `stepManifestFormat` (the shape of a shared onboarding manifest across blueprints). Reserved until a second blueprint contributes a step-shaped manifest surface (a settings walk-through, a role-tour); the dashboardShell rejection precedent stands: mint a topic only when a second consumer arrives.

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
| platform-docker-compose-host | 38101-38899 | 39xx | shipped v1.0.0 | `containerHostContract` |

The shelf-wide band registry lives in `packages/rcf-lite/docs/blueprint-authoring.md` section 5.

## Cross-references

- `application-spa` (round 1, shipped v1.5.0+): supplies the routing shell (`/tour`, `/dashboard`, `/settings`), the iconography and theming the tour uses. The tour still renders without the SPA blueprint; the project supplies its own routing.
- `application-dashboard` (round 3, shipped v1.0.0): supplies the dashboard-top anchor slot where the checklist mounts as `<details open>` for returning principals. When absent, the checklist collapses to a `<details>` (closed) on the settings-page anchor (ADR-2703).
- `application-notifications-in-app` (round 3, shipped v1.0.0): supplies the polite `aria-live` live region the tour-completion announcement uses. When absent, the tour is silent at the announce layer (the step runner still logs one line if a logging companion is present).
- `application-account-settings` (round 4 T-4, shipped v1.0.0): supplies the settings surface where the restart-tour control lives. When absent, the restart-tour control renders on any settings-shaped surface (`/settings`, `/account`, `/account/settings`).
- `application-empty-error-states` (round 4 T-1, shipped v1.0.0): the tour composes on the forbidden state when a principal reaches `/tour` without an authenticated session and an auth blueprint is applied. When no auth blueprint is applied, the tour behaves as a single-principal experience per the composition table.

## Probe pack

`probe-packs/application-onboarding-tour.pack.mjs` ships four surface-observable checks anchored to blueprint AC ids:

- `AC-26101-1` step-container focus lifecycle and Escape (always fires).
- `AC-26102-1` tooltip-as-dialog contract at 1440 wide and 360 narrow breakpoints via `browser.resize` (always fires).
- `AC-26103-1` checklist slot on both dashboard-top (open) and settings-page (closed) branches (always fires; branch selection reads the applied-blueprint set from the sidecar).
- `AC-26104-1` completion-state persistence and restart-tour re-open (always fires; store selection reads the elicited `completion-state-store` answer, defaulting to `spa-local-storage` per Q4).

The pack applies to any FBS binding `TAC-2701-application-onboarding-tour-step-runner` or whose `navModel` routes match the operator-configured tour-anchor path glob (`/tour`, `/welcome`, `/getting-started`, `/onboarding`). See `packages/rcf-lite/docs/blueprint-authoring.md` section 8c for the pack authoring rules.
