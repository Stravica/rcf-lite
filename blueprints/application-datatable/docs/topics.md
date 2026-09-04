# application-datatable: coordination vocabulary

## Global topics

The blueprint claims no new global topics at v1.0.0. The datatable shell is a general enterprise practice contract; every ADR (pattern choice, URL state, page size, selection persistence) is non-global.

## Deliberately unclaimed topics

- `dataGridEngine` (the chosen data-table library). Reserved for the applying project as an elicited choice, not a global topic; a second datatable-shaped blueprint that composes with a specific engine would either supersede this blueprint or share the shell TAC.
- `columnRegistry` (a shared column vocabulary across surfaces). No blueprint claims it today; a future admin-console blueprint (visual round T-5) may elicit column reuse without minting a global topic.

## Shelf id band and suffix block

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
| application-datatable | 17101-17899 | 18xx | shipped v1.0.0 | none |
| application-charts | 18101-18899 | 19xx | shipped v1.0.0 | none |

The shelf-wide band registry lives in `packages/rcf-lite/docs/blueprint-authoring.md` section 5.

## Probe pack

`probe-packs/application-datatable.pack.mjs` ships six checks anchored to blueprint AC ids:

- `AC-17101-1` sort click reorders rows
- `AC-17102-1` filter text search issues q request
- `AC-17103-2` pagination announcement in aria-live region
- `AC-17104-3` bulk-action confirmation dialog returns focus to originating row
- `AC-17105-1` state distinctness (empty / loading / error / no-results)
- `AC-17106-1` column reorder keyboard alternative

The pack applies to any FBS binding `TAC-1801-application-datatable-shell` or whose navModel routes name a datatable path. See `packages/rcf-lite/docs/blueprint-authoring.md` section 8c for the pack authoring rules.
