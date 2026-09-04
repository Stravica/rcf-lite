# Guide: application-datatable (v1.0.0)

## What it is

A shipped, vendor-neutral datatable contract for a rcf-lite application. One shell (TAC-1801), one query adapter (TAC-1802), one selection model (TAC-1803), plus a shipped Playwright probe pack that gates ship on the six runtime-observable surfaces the shelf assures: sort activation reorders rendered rows, filter text search issues a `q` request, pagination announces `Page N of M` through an aria-live region, bulk actions open an APG dialog and return focus to the originating row, four states each render in their own region, and columns reorder without a drag.

## What it deliberately is not

- Not a data-table library. The shell is a contract; the applying project chooses TanStack Table, MUI DataGrid, AG Grid, a hand-rolled `<table>`, or any other realisation. The ACs are what ship must meet; the HOW is the project's decision.
- Not a data-source contract. The query adapter (TAC-1802) targets a REST endpoint on the applied `application-api-rest`, a GraphQL query, or an in-memory adapter for small collections; the adapter shape is one project decision above the data source.
- Not a row-level authorisation contract. The applied auth blueprint owns row-level visibility; the datatable reads the rows it is given.

## When to reach for it

- Any surface with tabular data the operator sorts, filters, paginates, or bulk-operates on. Users tables, orders, notifications, records, audit views. The dashboard blueprint (visual round T-3) consumes this shell for its `application-datatable` recent-items strip.
- Projects that want the ARIA APG discipline (table vs grid per interactivity) enforced at ship without hand-authoring the rule per surface.

## When it does not fit

- Read-only presentation of static data where sort, filter or pagination are not needed. A plain `<table>` inside a marketing surface does not need this shell.
- Highly bespoke tabular surfaces that render two-dimensional keyboard navigation over a non-table structure (a spreadsheet-shaped editor). Those supersede TAC-1801 with a project-authored shell.

## What a good outcome looks like

The rendered surface is a `<table role="grid">` when the shell ships interactive controls; sort activation reorders rows against the query adapter's response and announces the direction via `aria-sort`; the filter input carries `q` into the adapter; the pagination status region reads `Page N of M` and updates on advance; the bulk-action confirmation dialog opens as `role="dialog"` `aria-modal="true"` with `aria-labelledby` and `aria-describedby` set, initial focus lands on confirm, and cancel returns focus to the row control that opened the dialog; the four states each render inside their own `role="region"` with `aria-live="polite"`; column reorder has a paired left / right keyboard control per column; the shipped probe pack runs green on the delivery-ci-workflows gate.

## The operator decisions that remain open

- **The data-table realisation** (framework choice). TanStack Table, MUI DataGrid, AG Grid, hand-rolled `<table>`, or another. The ACs shape the outcome; the HOW is elicited at build time.
- **Server-side or client-side query adapter** (ADR-1802). Server-side default; client-side elicited alternative for small in-memory collections.
- **URL-state serialisation** (ADR-1802). Recommended default writes sort, filter and page into the URL; the session-scoped alternative is elicited for surfaces where deep-linking is undesirable.
- **Default page size** (ADR-1803). Default 25; elicit an override at apply.
- **Selection persistence across pages** (ADR-1804). Default `perPage`; `crossPage` elicited for high-cardinality bulk workflows.
- **Per-column filter dropdowns** (REQ-003). Which columns expose them, and what the value set is per column. Elicited at build.

## Cost-honesty

Adds six REQs, nine USs (with 27 runtime-observable ACs), three TACs, four ADRs, one shipped probe pack, and one sample-app fixture to the shipped shelf. The runtime cost is one probe-pack run per shell FBS on the delivery-ci-workflows gate (approximately 5 to 15 seconds per pack invocation against a live server). No runtime dependency added to the applying project's `package.json`; the probe pack drives the browser the runner provisions through the pinned Playwright MCP or the project's own `playwright` when installed. The elicited parameters (data source shape, page size, URL-state, selection persistence) shape the applying project's surface without expanding the shipped shelf.
