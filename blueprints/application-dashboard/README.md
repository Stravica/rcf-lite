# Dashboard blueprint (v1.0.0)

Vendor-neutral analytics-dashboard contract for a rcf-lite application. Ships the shell composition, the primary-KPI visual hierarchy, the per-tile four-state contract, the timeframe and filter chrome refetch fan-out, and the export handle with format delegation to charts. Consumes the application-charts render shell (TAC-1901) for every rendered chart; references application-datatable in the packaged design guidance's "when a table beats a chart" section. Ships a packaged design-guidance asset under `assets/guidance/dashboard-design.md` and a Playwright probe pack under `probe-packs/application-dashboard.pack.mjs` whose three checks are the runtime gate the delivery-ci-workflows runner drives (visual round spec 2026-09-04, section 5.3). No new global topics; suggests the `logging` and `errorHandling` companions. Third blueprint on the shelf that ships a Playwright probe pack under the T-0 runner extension.

## Apply

```
rcf define blueprint add <path-to>/blueprints/application-dashboard
```

Applies namespaced contributions into the project tree and records `manifest.blueprints[]`. Consumes the `logging` and `errorHandling` companions when they resolve to an applied provider or a registered library; falls back to the shelf providers otherwise.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version 1.0.0, category `application`, `suggestedCompanions: [{ logging }, { errorHandling }]`, `providesRoles: []`, 18 contributions in the 19xxx US band and 20xx ADR/TAC block |
| Doc set | `contributions/` | 5 REQs, 7 USs, 3 TACs, 3 ADRs, schema-valid and namespaced |
| Design guidance | `assets/guidance/dashboard-design.md` | Operator-and-agent-readable design guidance (eight sections; five https citations; each section names whether it hardens into an AC or stays guidance) |
| Probe pack | `probe-packs/application-dashboard.pack.mjs` | Three browser-verify checks anchored to AC-19102-1 (primary-KPI position by DOM order and CSS Grid position at 1440, 1024 and 360), AC-19104-1 (timeframe refetch fan-out with matching boundary and as-of stamp), AC-19103-1 (per-tile four-state contract with role region, aria-live polite and non-colour distinction) |
| Guide | `guide/application-dashboard.md` | Operator-facing: when to reach, when not, mechanism-reach gaps |
| Coordination vocabulary | `docs/topics.md` | Shelf id band registry update; no new global topics claimed |

## What it contributes, and what it deliberately does not

Contributed: REQ, US (with inline ACs), TAC, ADR, plus one shipped probe pack and one packaged design-guidance asset. Adherence is expressed as ACs; the blueprint ships no dashboard-framework source and no test files (the probe pack drives the real browser against the applying project's own runtime).

Deliberately not contributed: a choice of chart engine (the charts blueprint's ADR-1901 owns that); a chart-form set (application-charts REQ-001 owns that); a data-source contract (the applying project sources dashboard data through the applied `application-api-rest` blueprint or an equivalent); the sortable / filterable / exportable table (the applying `application-datatable` blueprint owns that; the dashboard's guidance section 6 delegates to it).

## The packaged design guidance

`assets/guidance/dashboard-design.md` is a shipped asset the applying agent reads at apply and the gate reviewer references at ship. Eight sections cover the ratified surface rules:

1. Primary KPI placement (hardens into AC-19102-1)
2. Tile density and count limits (stays operator guidance)
3. Timeframe and filter chrome (hardens into AC-19105-1 and the fan-out rule under AC-19104-1)
4. Loading, empty and error states (hardens into AC-19103-1 and AC-19103-2)
5. Colour and contrast (stays operator guidance for the tile row; hardens through the charts blueprint on the chart region)
6. When a table beats a chart, delegating to application-datatable (stays operator guidance)
7. Refresh cadence and staleness (hardens into AC-19104-1 and AC-19104-2)
8. Anti-patterns (stays operator guidance)

Five https-cited sources anchor the guidance: NN/g dashboard design, Few (Information Dashboard Design), Tufte (The Visual Display of Quantitative Information), GOV.UK Design System patterns, and WCAG 2.2 Understanding docs.

## The one runtime gate

`probe-packs/application-dashboard.pack.mjs` ships three checks the `rcf verify browser` runner invokes on any FBS whose surface matches the pack's `appliesTo` predicate (an FBS binding `TAC-2001-application-dashboard-tile-grid` or whose nav model routes name a dashboard path). Each check drives the real Playwright browser the runner provisions (through the pinned Playwright MCP or the consuming project's own `playwright` installation), reads the accessibility tree and the DOM, and returns a verdict. A failing block-severity check refuses ship through the existing `browserVerification` aggregate verdict.

The three shipped checks:

- `AC-19102-1` primary-KPI position by DOM order and CSS Grid position at 1440, 1024 and 360. Drives the pack-browser's `resize(width, height)` seam (new in T-3) to each of the three widths, reads DOM order and computed `grid-column-start`/`grid-row-start` on the primary tile, and asserts the top-left placement holds at every width.
- `AC-19104-1` timeframe refetch fan-out with matching boundary and as-of stamp. Clicks a second preset control, waits for the batch, reads the request log from `window.__dashboardFetches` and reconciles with the `GET /__requests` endpoint on the sample app, and asserts every fetch in the new batch carries the same `from`/`to`/`preset` trio and every tile's `data-as-of` matches the shell root in ISO-8601 form.
- `AC-19103-1` per-tile four-state contract. Drives the sample app's state-pinning switches (`?tile=primary&state=<state>`) for each of the four states, reads the accessibility tree and the DOM, and asserts every state carries `role="region"`, `aria-live="polite"`, the `data-tile-state` attribute, and a distinct non-colour visual cue.

The pack fires ONLY when its `appliesTo` returns true; a project whose FBS does not bind the tile-grid TAC or a dashboard route sees the pack recorded as `applicable: false` and no browser check runs.

## The shelf pattern for tile-state pinning and fetch capture

Two things this pack needs that the T-0 runner seam does not offer directly: viewport resize (added in T-3 through the `resize(width, height)` seam extension) and per-tile state mocking with fetch capture. Rather than adding a network interception seam, this blueprint documents a shelf pattern the applying project realises on its own runtime:

- **State pinning through query switches**: the sample app accepts `?tile=<id>&state=<state>` on the dashboard route so the pack can drive each of the four states without a synthetic-event seam. An applying project realises the same pattern through its own dev-mode query handling.
- **Fetch capture through a request log**: the sample app appends every fetch to `window.__dashboardFetches` (client-side) and to a server-side log the pack reads at `GET /__requests`. An applying project realises the same pattern through a dev-mode telemetry hook.

The pack-browser seam extension in T-3 adds `resize(width, height)`; the two patterns above stay a shelf convention this README documents.

## Elicited parameters (ADR-2001, ADR-2002, ADR-2003 and REQ notes)

The applying project elicits these at apply; the declarative ADR shape (`elicited: true`) records the intent on the manifest. The runner has no apply-time elicitation phase today (tracked as w-2026-09-04-dave-022, built in T-5); accept the declarative shape and gather the operator's answers by hand during the apply pass.

- **Primary-KPI kind** (ADR-2001): one of `revenue`, `active-users`, `error-rate`, `throughput`, `custom`. A `custom` value carries a short operator name in `data-kpi-name`.
- **Tile inventory with slots** (REQ-002 and TAC-2001): the tile list (primary tile plus up to seven supporting tiles) and each tile's slot on the CSS Grid.
- **Timeframe presets** (ADR-2002): the operator's preset set. Ships three by recommendedDefault (`last-7-days`, `last-30-days`, `quarter-to-date`); operator elicits an override.
- **Auto-refresh interval** (ADR-2002): OFF by default; operator elicits an interval in seconds if the surface needs unattended refresh.
- **Export formats** (ADR-2003): the operator's format list. Ships three by recommendedDefault (`csv`, `pdf`, `png-chart`); operator elicits an override.
- **Per-organisation vs per-user vs global scope** (REQ-004 note): the boundary on which the fan-out runs. A per-user dashboard passes the user id on every fetch; a per-organisation dashboard passes the tenant id; a global dashboard passes neither. Elicited at apply; recorded on the manifest.

## Standards trace

NN/g F-scan on primary-KPI placement (ADR-2001, guidance section 1). NN/g dashboard design on refresh cadence (guidance section 7). GOV.UK Design System download patterns and WCAG 1.3.1 on the export handle (ADR-2003, guidance section 3). WCAG 2.2 (1.4.1, 1.4.3, 1.4.11, 2.1.1, 4.1.3) on the four-state contract, filter chrome and colour discipline. `standardsTraceClause` on each ADR carries the primary source.

## Quality bar

Every dashboard surface renders the five shell regions (tile row, chart region, filter chrome, timeframe picker, export handle) as labelled `role="region"` elements. The primary KPI tile is first in DOM order and top-left in CSS Grid at 1440, 1024 and 360. Every tile carries the four-state contract with role region, aria-live polite, a `data-tile-state` attribute and a non-colour visual cue distinct per state. A timeframe preset change fans out one refetch per tile with the same from/to/preset trio and one shared `as of <ISO-8601>` stamp. Auto-refresh is off unless the elicited interval is set. The export handle is a labelled `<button>` opening an accessible format list, and PNG-of-chart delegates to the application-charts render shell.

## Known mechanism-reach gaps

Every runtime-observable AC that is not bound to a pack check appears here individually per the T-1 gate discipline (`blueprint-authoring-checklist.md` section 6.g): categories are not enough. The pack has three checks; every other runtime-observable AC on this blueprint is a mechanism-reach gap named below.

- **AC-19101-1 five-region shell composition**. The pack drives the primary-KPI region (AC-19102-1) and the timeframe region (AC-19104-1), which implies the shell renders at least those two, but the pack does not enumerate all five regions and their labels. A v1.1 minor bump could add a region-enumeration pre-check that walks `[data-region]` on the shell root.
- **AC-19101-2 chart region mounts through the charts shell**. The application-charts pack fires on the dashboard's chart route through its own `appliesTo` predicate; the dashboard's pack does not itself assert the chart-shell contract on the region. Project-side review is the current mechanism.
- **AC-19102-2 no-primary-KPI supersession fallback**. The pack asserts the primary KPI exists (AC-19102-1); the documentation-and-review contract on a surface with no primary KPI is not observable at runtime.
- **AC-19103-2 state-transition announcement**. The pack does not simulate the transition today (the runner has no synthetic-event seam beyond click / type / press). A v1.2 runner minor with an event-emit seam would close the class.
- **AC-19104-2 auto-refresh default and elicited interval**. The pack asserts `data-auto-refresh="off"` on the shell root at initial render (implied by the fixture); a runtime observation of the elicited-interval refresh cadence is not exercised. Project-side review carries the residual.
- **AC-19105-1 filter chrome accessible controls**. The pack does not enumerate filter controls today. A v1.1 minor bump could add a filter-control enumeration check.
- **AC-19105-2 filter fan-out**. The pack asserts the timeframe fan-out (AC-19104-1); the filter-change fan-out is a mechanism-reach gap. A v1.1 minor bump could add a paired filter-change check driving the filter chip and reading the same request log.
- **AC-19106-1 export handle accessible format list**. The pack does not open the export list today. A v1.1 minor bump could add a check that activates the export button, reads the exposed listbox and asserts the format entries.
- **AC-19106-2 PNG-of-chart delegation**. The pack browser has no download-capture seam today, so the PNG delegation is proven at project-side review. A v1.2 runner minor with a download-capture seam would close the class.
- **AC-19107-2 dashboard shape reflects guidance rules**. The pack asserts the specific attributes the fixture emits (primary-KPI kind, as-of stamp, auto-refresh default); a general check that a shipped surface honours the guidance's hardened rules is project-side review.

## The pack-browser resize seam extension

This blueprint's train adds a small, honest extension to the T-0 pack-browser seam: `resize(width, height)`. On the MCP route the method calls the pinned Playwright MCP's `browser_resize` tool; on the project route it calls `page.setViewportSize({ width, height })`. The extension lets the primary-KPI position check (AC-19102-1) drive the three ratified breakpoints (1440, 1024, 360) through the same browser handle. The next blueprints on the shelf that carry breakpoint-scoped visual ACs (T-4 notifications-in-app, T-5 admin-console) reuse the same seam.
