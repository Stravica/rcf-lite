# application-empty-error-states: coordination vocabulary

## Global topics

The blueprint claims no new global topics at v1.0.0. Every ADR (HTTP status contract, stack-trace visibility, offline strategy) is non-global.

## Deliberately unclaimed topics

- `errorEnvelope` (the shape of a server error response body). Reserved for the applied API blueprint (`application-api-rest` claims it today); this blueprint reads the HTTP status code, not the envelope body shape, so no claim collides.
- `sensitivePatternsRegistry` (the tokeniser vocabulary the 500 surface refuses on). Reserved for a future v1.1.0 minor bump if three or more consumer blueprints start elicitizing the same extensions. Held here as an unclaimed topic so a composing author sees the reservation.
- `stateVisualTokens` (the palette, spacing and typography per state). Reserved for `application-spa` which owns the visual tokens; this blueprint owns the state list and the recovery-action router.

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

The shelf-wide band registry lives in `packages/rcf-lite/docs/blueprint-authoring.md` section 5.

## Composition with application-spa

`application-spa` REQ-006 ships empty, loading, error, banner and alert components as part of its component library. Applying this blueprint alongside `application-spa` composes cleanly: SPA holds the tab-title convention and the state-visual tokens; this blueprint holds the state list, the recovery-action router and the runtime enforcement pack. No `scope: "global"` ADR conflict.

## Composition with application-notifications-in-app

The `forbidden` and `permission-denied` states POST request-access submissions to the applied notification centre. When `application-notifications-in-app` is applied, the pack asserts the applied notification centre receives the submission (a v1.1.0 mechanism-reach gap today; the current pack asserts the control's shape only). No global-topic overlap.

## Probe pack

`probe-packs/application-empty-error-states.pack.mjs` ships eight surface-observable checks anchored to blueprint AC ids, one per named state:

- `AC-22101-1` not-found (heading, parent-surface link, search entry, tab title)
- `AC-22102-1` forbidden (request-access control, no resource-id leak)
- `AC-22103-1` server-error (retry, no stack trace, no path shape, no env-key shape)
- `AC-22104-1` permission-denied (class-level cause, no resource id)
- `AC-22105-1` offline (banner, buffered synthetic write, polite reconnection announcement)
- `AC-22106-1` empty-list (distinct visual wrapper, creation-affordance recovery)
- `AC-22107-1` no-search-results (distinct visual wrapper, echoed query, clear-filters recovery)
- `AC-22108-1` error-boundary (role=alert, retry control, no stack detail)

The pack applies to any FBS binding `TAC-2301-application-empty-error-states-state-machine` or whose navModel routes name an operator-configured error-shell path (matching `/probe/(not-found|forbidden|server-error|permission-denied|offline|empty-list|search|error-boundary)`). See `packages/rcf-lite/docs/blueprint-authoring.md` section 8c for the pack authoring rules.
