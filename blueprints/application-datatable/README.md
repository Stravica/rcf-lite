# Datatable blueprint (v1.0.0)

Vendor-neutral datatable contract for a rcf-lite application. Ships the ARIA APG table / grid pattern choice (per interactivity), the sort / filter / paginate discipline, the selection model with a bulk-action confirmation dialog, the four-state region contract (empty / loading / error / no-results), and a non-drag keyboard path for column visibility / reorder / resize. Ships a Playwright probe pack under `probe-packs/application-datatable.pack.mjs` whose six checks are the runtime gate the delivery-ci-workflows runner drives (visual round spec 2026-09-04). No new global topics; suggests the `logging` and `errorHandling` companions.

## Apply

```
rcf define blueprint add <path-to>/blueprints/application-datatable
```

Applies namespaced contributions into the project tree and records `manifest.blueprints[]`. Consumes the `logging` and `errorHandling` companions when they resolve to an applied provider or a registered library; falls back to the shelf providers otherwise.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version 1.0.0, category `application`, `suggestedCompanions: [{ logging }, { errorHandling }]`, 22 contributions in the 17xx band |
| Doc set | `contributions/` | 6 REQs, 9 USs (27 runtime-observable ACs), 3 TACs, 4 ADRs, schema-valid and namespaced |
| Probe pack | `probe-packs/application-datatable.pack.mjs` | Six browser-verify checks anchored to AC-17101-1, AC-17102-1, AC-17103-2, AC-17104-3, AC-17105-1, AC-17106-1 |
| Guide | `guide/application-datatable.md` | Operator-facing: when to reach, when not, mechanism-reach gaps |
| Coordination vocabulary | `docs/topics.md` | Shelf id band registry update; no new global topics claimed |

## What it contributes, and what it deliberately does not

Contributed: REQ, US (with inline ACs), TAC, ADR, plus one shipped probe pack. Adherence is expressed as ACs; the blueprint ships no framework source and no test files (the probe pack drives the real browser against the applying project's own runtime).

Deliberately not contributed: a choice of data-table library (TanStack Table, MUI DataGrid, AG Grid, or a hand-rolled `<table>`); a wire endpoint for the data source (the query adapter targets whatever the applied `application-api-rest` or GraphQL contract shapes); an authentication or authorisation contract for row-level visibility (the applied auth blueprint owns that decision); a caching or optimistic-update policy (client-state is the applied `application-spa` blueprint's ADR-203 territory).

## The one runtime gate

`probe-packs/application-datatable.pack.mjs` ships six checks the `rcf verify browser` runner invokes on any FBS whose surface matches the pack's `appliesTo` predicate (an FBS that binds `TAC-1801-application-datatable-shell` or whose nav model routes name a datatable path). Each check drives the real Playwright browser the runner provisions (through the pinned Playwright MCP or the consuming project's own `playwright` installation), reads the accessibility tree and the DOM, and returns a verdict. A failing block-severity check refuses ship through the existing `browserVerification` aggregate verdict.

The pack fires ONLY when its `appliesTo` returns true; a project whose FBS does not bind the shell TAC or a datatable route sees the pack recorded as `applicable: false` and no browser check runs.

## Quality bar

Table or grid ARIA APG pattern per interactivity (ADR-1801); sortable columns keyboard-reachable with `aria-sort` announcing direction; text filter carrying `q` into the query adapter with per-column dropdowns composing deterministically; pagination controls with an `aria-live=\"polite\"` region reading `Page N of M`; selection model with per-row toggles and a page-level toggle; bulk actions opening a dialog under ARIA APG dialog-modal (`role=\"dialog\"`, `aria-modal=\"true\"`, `aria-labelledby`, `aria-describedby`, focus return to the originating row on close); four distinct states in `role=\"region\"` with `aria-live=\"polite\"`; non-colour distinction on every state (WCAG 1.4.1); URL-state serialisation of sort, filter and page as the recommended default (ADR-1802); default page size 25 elicitable at apply (ADR-1803); selection persistence elicited (ADR-1804); non-drag keyboard alternative for column visibility, reorder and resize (WCAG 2.5.7). Every bar is carried by ACs in the doc set and probed by the shipped pack.

## Known mechanism-reach gaps

- **Framework-agnostic focus containment.** The pack asserts focus return to the originating row on dialog close, but cannot prove a given framework's focus trap never leaks into the browser chrome; a project-side keyboard smoke supplement per applied framework closes the class.
- **Chart-adjacent chart integration.** A datatable that renders a per-row sparkline (`application-charts` chart-style) is not covered by the datatable pack; the `application-charts` blueprint's own probe pack (visual round T-2) reaches those surfaces.
- **Live-region debouncing on rapid filter typing.** Per-keystroke pagination announcements can flood assistive tech; the pack asserts the announcement fires, not the debounce. A v1.1 minor bump candidate adds a check for a bounded announcement rate.
