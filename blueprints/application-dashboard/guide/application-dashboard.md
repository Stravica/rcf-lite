# Guide: application-dashboard (v1.0.0)

## What it is

A shipped, vendor-neutral analytics-dashboard contract for a rcf-lite application. One tile grid with primary-KPI hierarchy at the ratified breakpoints (TAC-2001), one timeframe picker and filter chrome with a refetch fan-out contract (TAC-2002), one export handle with format delegation to charts (TAC-2003), a packaged design-guidance asset the applying agent reads at apply, and a shipped Playwright probe pack that gates ship on the three runtime-observable surfaces the shelf assures: the primary KPI sits top-left at every ratified breakpoint, a timeframe change refetches every tile with the same boundary and one as-of stamp, and every tile honours the four-state contract with role region, aria-live polite and non-colour distinction.

## What it deliberately is not

- Not a dashboard framework. The shell is a contract; the applying project picks React, Vue, Svelte or hand-authored DOM and writes the mount function against the same DOM contract.
- Not a chart library. The chart region delegates rendering to the application-charts render shell (TAC-1901); the shell contract and the accessibility ACs on that blueprint apply.
- Not a records table. When the reader wants to sort, filter, page, select or export a list of records, ship the application-datatable blueprint's table; the tile row is not a replacement.
- Not a data-source contract. The applying application-api-rest blueprint owns the wire endpoint; the dashboard shell reads the data it is given.

## When to reach for it

- Any shipped surface that renders a mix of stat tiles and one or more charts with a shared timeframe control. Analytics dashboards, admin overview surfaces, per-organisation summary views, ops screens.
- Projects that want the primary-KPI-hierarchy discipline enforced at ship without hand-authoring per surface.
- Any project that already applies application-charts and needs the composed dashboard shape on top.

## When it does not fit

- Print-only or export-only dashboard output where the runtime accessibility contract does not apply. A weekly PDF report pipeline is a separate concern.
- Highly bespoke dashboards outside the tile-row-plus-chart-region shape (a network-topology dashboard, a physical-space dashboard). Those supersede the blueprint with a project-authored shell contract naming the residuals.
- A dashboard that is really a records table with a header row. Apply application-datatable instead.

## What a good outcome looks like

Every dashboard surface renders the five labelled regions. The primary KPI tile sits top-left in DOM order and top-left in CSS Grid at 1440, 1024 and 360. Every tile carries the four-state contract with a role region wrapper, an aria-live polite announcer and a non-colour visual cue distinct per state. A timeframe preset change fans out one refetch per tile with the same boundary, and the shell renders one shared as-of stamp every tile inherits. The export handle is a labelled button opening a keyboard-reachable format list; PNG-of-chart delegates to the application-charts render shell. Auto-refresh is off unless the operator elicited an interval. The shipped probe pack runs green on the delivery-ci-workflows gate.

## The operator decisions that remain open

- **Primary-KPI kind** (ADR-2001). One of revenue, active-users, error-rate, throughput, custom. A `custom` value carries a short operator name.
- **Timeframe presets and auto-refresh** (ADR-2002). Three presets by recommendedDefault; operator elicits an override. Auto-refresh off unless the operator elicits an interval.
- **Export formats** (ADR-2003). Three formats by recommendedDefault (CSV, PDF, PNG-of-chart); operator elicits an override.
- **Tile inventory and slots**. The full tile list and each tile's CSS Grid slot.
- **Boundary scope**. Per-user, per-organisation or global; carried on every fetch record.

## Common gotchas

- The primary KPI is a fixed enum (five values plus `custom` with a name). A free-form `data-kpi-kind` is refused at project-side review.
- The as-of stamp lives on the shell root and every tile carries the same value. A tile whose stamp drifts is a defect.
- Auto-refresh is off unless the operator opted in with an interval. A dashboard that refreshes every 30 seconds without an opt-in is a common accessibility and cost defect.
- The export handle carries no PNG generator of its own. PNG-of-chart delegates to the application-charts render shell; a project that ships a chart engine outside the render shell either supersedes the delegation or loses the PNG affordance.
- The pack fires on any FBS whose surface matches the `appliesTo` predicate. A page with no dashboard shape declares no dashboard route and no tile-grid TAC binding; the pack records `applicable: false`.

## Cost honesty

Shipping this blueprint costs the project a design pass on the tile inventory (which tile is the primary KPI, how many supporting tiles) and an operator conversation on the timeframe and export sets. It buys the accessibility contract on every tile, the fan-out contract on every timeframe change, the packaged design guidance the applying agent reads at apply, and the probe pack that refuses ship on a broken tile grid or a drifted fan-out. The gate reviewer verifies the pack runs green against the sample-app fixture and reviews the applying project's own dashboard surface against the packaged guidance's eight sections.
