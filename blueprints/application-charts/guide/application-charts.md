# Guide: application-charts (v1.0.0)

## What it is

A shipped, vendor-neutral chart-component contract for a rcf-lite application. One render shell (TAC-1901), one keyboard-traversal contract (TAC-1902), an accessible-defaults palette, and a shipped Playwright probe pack that gates ship on the three runtime-observable surfaces the shelf assures: series distinguish on colour plus pattern plus label, every chart pairs with a text-alternative table in the same landmark, and interactive charts expose a keyboard traversal path with reduced-motion suppression.

## What it deliberately is not

- Not a chart library. The shell is a contract; the applying project picks Recharts, ECharts, Chart.js, D3 primitives or a hand-authored SVG mount. The ACs are what ship must meet; the HOW is the project's decision.
- Not a data-source contract. The applying `application-api-rest` blueprint owns the wire endpoint; the render shell reads the data it is given.
- Not a dashboard layout. The applying `application-dashboard` blueprint owns tile placement, hierarchy and export handles; the charts blueprint owns the chart contract every tile carries.

## When to reach for it

- Any shipped surface that renders bar, line, area, pie, donut, single-value with sparkline, or heatmap charts. Analytics dashboards, admin overview surfaces, per-record trend views, monitoring UIs.
- Projects that want the ARIA-first, palette-safe, keyboard-reachable discipline enforced at ship without hand-authoring per chart.
- Any project where the T-3 application-dashboard is applied (charts is the leaf application-dashboard consumes).

## When it does not fit

- Print-only or export-only chart output where the runtime accessibility contract does not apply. A PDF report generation pipeline is a separate concern.
- Highly bespoke visualisations outside the six committed forms (a network graph, a Sankey, a candlestick). Those supersede the blueprint with a project-authored engine contract naming the residuals.

## What a good outcome looks like

Every rendered chart on the surface mounts through the render shell; every multi-series chart carries colour AND a non-colour pattern AND a direct label at the series; every chart ships a paired `<table>` in the same landmark, focus-reachable through a labelled control, cell-per-value; every interactive chart tabs through its data points in reading order and announces `<seriesName>, <xValue>, <yValue> <unit>` on focus; `prefers-reduced-motion: reduce` suppresses transitions on every chart on the surface. The shipped probe pack runs green on the delivery-ci-workflows gate.

## The operator decisions that remain open

- **Chart engine** (ADR-1901). Recharts, ECharts, Chart.js, D3 primitives, hand-authored SVG. Elicited at apply; canvas-only-no-text-alternative is refused.
- **Categorical palette** (ADR-1902). Light and dark accessible-defaults ship as the recommended default; operator brand tokens accepted with a fallback to the defaults on missing tokens.
- **Interactive traversal scope**. Every chart interactive, or only detail-view charts. The shell binds the keyboard traversal contract on the interactive charts.
- **Sparkline behaviour**. In-tile (mounted inside a stat tile via application-dashboard) or standalone (mounted on the shipped surface as one chart).

## Common gotchas

- Chart.js is canvas-based. The shell renders the text-alternative table for you; do not disable it because your engine has its own accessibility mode.
- Colour-only series distinction is the single most common defect on shipped charts. The blueprint's palette is safe, but the pattern and label cues are still required regardless of palette.
- `prefers-reduced-motion` is a real user preference. Do not gate it behind a feature flag or a build variable; the shell handles it via CSS media query on every chart on the surface.
- A blueprint pack fires on any FBS whose surface matches the `appliesTo` predicate. A page with no chart declares no chart route and the pack records `applicable: false`; no need to disable the pack.

## Ratified spec reference

`projects/blueprint-library/specs/visual-round-spec-2026-09-04.md` section 5.2 in the operator repo names the contract this blueprint realises. Every content decision in the shipped v1.0.0 comes from the spec verbatim; where the shell contract carries a documented deviation from the spec, the blueprint README names it under CALLS MADE.
