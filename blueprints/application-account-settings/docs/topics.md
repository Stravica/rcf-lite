# application-account-settings: coordination vocabulary

## Global topics

The blueprint claims no new global topics at v1.0.0. Account-settings is a consumer of the identity capability set the applied auth blueprints (and the observability-logging companion) declare through `capabilities[]`; every ADR (capability-vocabulary extension, security-surface-shape, theme-persistence, reauth-window) is non-global.

## Deliberately unclaimed topics

- `themePersistence` (the shape of theme persistence). Reserved for the applied `application-spa` blueprint's own ADR set; the account-settings blueprint offers the operator surface for choosing the theme and hands the persistence to the SPA blueprint via the elicited `theme-persistence` answer.
- `sessionInventory` (the shape of a session-inventory record). Reserved for the applied provider's ADR set (an auth blueprint, or observability-logging as the logging-projection provider). The account-settings blueprint reads the inventory through the applied provider's interface.
- `credentialSelfService` (the shape of a credential surface). Reserved for the applied auth blueprint's ADR set for the same reason.
- `hostedIdentityUi` (the shape of a hosted identity portal). Reserved for the applied auth blueprint's ADR set for the same reason.

## Shelf id band and suffix block

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
| application-datatable | 17101-17899 | 18xx | shipped v1.0.0 | none |
| application-charts | 18101-18899 | 19xx | shipped v1.0.0 | none |
| application-dashboard | 19101-19899 | 20xx | shipped v1.0.0 | none |
| application-notifications-in-app | 20101-20899 | 21xx | shipped v1.0.0 | none |
| application-admin-console | 21101-21899 | 22xx | shipped v1.0.0 | none |
| application-empty-error-states | 22101-22899 | 23xx | shipped v1.0.0 | none |
| application-file-upload | 23101-23899 | 24xx | shipped v1.0.0 | none |
| application-forms-wizard | 24101-24899 | 25xx | shipped v1.0.0 | none |
| application-account-settings | 25101-25899 | 26xx | shipped v1.0.0 | none |
| application-onboarding-tour | 26101-26899 | 27xx | shipped v1.0.0 | none |
| persistence-data-postgres | 27101-27899 | 28xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| object-storage-s3 | 28101-28899 | 29xx | shipped v1.0.0 | `objectStorageContract` |
| messaging-queue-cloudflare | 29101-29899 | 30xx | shipped v1.0.0 | `deliverySemantics` |
| jobs-background | 30101-30899 | 31xx | shipped v1.0.0 | `backgroundJobModel` |

The shelf-wide band registry lives in `packages/rcf-lite/docs/blueprint-authoring.md` section 5.

## Cross-references

- `application-empty-error-states` (T-1, shipped v1.0.0): the shell composes on the `forbidden` and `empty-list` states rather than inventing bespoke access-denied UI. Every project applying `application-account-settings` should also apply `application-empty-error-states`.
- `application-admin-console` (T-5, shipped v1.0.0): shares the capability-declaration mechanism (`capabilities[]` on identity blueprints) and the apply-time discovery, refusal and custom-auth elicitation. The two blueprints are separate consumers (the account-settings surface is per-principal; the admin-console surface is per-operator-with-admin-scope) and never render the same surface.

## Probe pack

`probe-packs/application-account-settings.pack.mjs` ships five capability-gated checks anchored to blueprint AC ids:

- `AC-25101-1` shell tabs mirror applied caps (always fires; guard on the leak branch)
- `AC-25102-1` profile autocomplete tokens (always fires)
- `AC-25105-1` security surface branch matches applied + elicit (fires when `credentialSelfService` or `hostedIdentityUi` is applied)
- `AC-25106-1` sessions rows and dialog-modal (fires when `sessionInventory` is applied)
- `AC-25108-1` theme radiogroup and persistence (fires when the theme-persistence elicit is answered, mirroring the `application-spa` applied gate)

The pack applies to any FBS binding `TAC-2601-application-account-settings-shell` or whose navModel routes name an `/account`, `/settings` or `/profile` path. See `packages/rcf-lite/docs/blueprint-authoring.md` section 8c for the pack authoring rules.
