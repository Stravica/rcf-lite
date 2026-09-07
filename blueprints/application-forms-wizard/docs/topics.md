# application-forms-wizard: coordination vocabulary

## Global topics

The blueprint claims no new global topics at v1.0.0. Every ADR (navigation posture, save-and-return transport, step-indicator shape) is non-global.

## Deliberately unclaimed topics

- `formsEngine` (the validation and field-component engine). Reserved for `application-spa` which owns the engine via TAC-205; this blueprint reads the engine through TAC-2502 and adds the wizard-shell contract on top.
- `draftSyncEngine` (a shared sync engine across UI and persistence blueprints). Reserved for a future `application-draft-sync` v1.0.0 if three or more consumer blueprints start elicitizing the same cross-tab or server-side sync shape.
- `emptyStateWrapper` (the DOM shape of the empty-list wrapper). Reserved for `application-empty-error-states` which owns it via TAC-2301; this blueprint delegates the no-in-progress empty case to the sibling and does not re-claim the wrapper.

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
| object-storage-s3 | 28101-28899 | 29xx | shipped v1.0.0 | `objectStorage` |
| messaging-queue-cloudflare | 29101-29899 | 30xx | shipped v1.0.0 | `deliverySemantics` |
| jobs-background | 30101-30899 | 31xx | shipped v1.0.0 | `backgroundJobModel` |
| platform-cloudflare-kv | 31101-31899 | 32xx | shipped v1.0.0 | `keyValueStoreContract` |
| platform-cloudflare-cron-triggers | 32101-32899 | 33xx | shipped v1.0.0 | `scheduledTriggerContract` |

The shelf-wide band registry lives in `packages/rcf-lite/docs/blueprint-authoring.md` section 5.

## Composition with application-spa

`application-spa` REQ-006 ships the forms-engine (TAC-205) and the field-component library. Applying this blueprint alongside `application-spa` composes cleanly: SPA holds the engine and the field components; this blueprint holds the wizard shell, the task-list, the error-summary contract, the summary review and the save-and-return draft store. No `scope: "global"` ADR conflict.

## Composition with application-empty-error-states

The `no-in-progress-forms` case on the /in-progress list surface delegates to the sibling's `empty-list` state (`[data-surface="empty-list"]` with a `[data-recovery="create"]` control). Per the sibling's `docs/topics.md`: SPA holds the tab-title convention, the component contracts and the state-visual tokens; this sibling holds the state list, the recovery-action router and the runtime enforcement pack. This blueprint's TAC-2503 reads that state on the zero-drafts branch and does not re-claim the wrapper.

## Probe pack

`probe-packs/application-forms-wizard.pack.mjs` ships four surface-observable checks anchored to blueprint AC ids, one per core contract:

- `AC-24101-1` task-list (per-step state from {Cannot start yet, Not started, In progress, Completed}, ARIA progressbar wrapper, ordered step enumeration)
- `AC-24103-1` error-summary (top-of-page summary, skip links per failed field, aria-invalid on the field, aria-describedby to the field-level error message, focus to summary heading)
- `AC-24104-1` summary-review (summary-list rows per step, Change link per row, answer retention across an edit-and-save round-trip)
- `AC-24105-1` save-and-return (server-draft-table transport POST/GET round-trip, client-local-buffer transport localStorage write with a sync tick)

The pack applies to any FBS binding `TAC-2501-application-forms-wizard-task-list` or whose navModel routes name an operator-configured wizard-route path (matching `/(task-list|step|summary|in-progress|wizard)`). See `packages/rcf-lite/docs/blueprint-authoring.md` section 8c for the pack authoring rules.
