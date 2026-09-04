# probe-pack-application-dashboard sample-app fixture

Dependency-free Node HTTP server exercising every surface the `application-dashboard` probe pack asserts on. Used at the shelf gate to drive the pack against a golden and against three broken variants.

## Boot

Two-line manual boot for the gate reviewer:

```
cd packages/rcf-lite/test/fixtures/probe-pack-application-dashboard
PORT=3000 node server.js
```

Once bound, the server prints one line to stdout:

```
LISTENING 3000
```

`PORT` is an env var (default `3000`). Any free port is fine; the pack drives whatever URL the reviewer passes to `rcf verify browser --url`.

Stop the server with Ctrl+C or `kill <pid>` (SIGTERM is honoured).

## Routes

- `GET /` (also `GET /index.html`): renders the dashboard shell composed of the five ratified regions.
  - Tile row region: a primary KPI tile at top-left (`data-tile-role="primary-kpi"`, `data-kpi-kind="revenue"`) plus three supporting stat tiles. Each tile wraps its content in `role="region"` with `aria-live="polite"` and a `data-tile-state` attribute.
  - Chart region: reuses the application-charts sample-app markup shape (`section.chartRegion[role="region"]` with a `svg.chartSvg` and a paired `<table class="chartAltTable">`).
  - Filter chrome: two labelled filter chip buttons before the tile row.
  - Timeframe picker region: three labelled preset buttons (`last-7-days`, `last-30-days`, `quarter-to-date`).
  - Export handle region: one labelled `<button>` opening an accessible list of the three shipped formats (`csv`, `pdf`, `png-chart`).
- `GET /__requests`: returns the append-only request log as JSON. Each entry is `{ from, to, preset, filters, tileId, chartId, at }`. Used by the pack to reconcile the timeframe-fan-out batch alongside `window.__dashboardFetches`.
- `GET /api/tile?tileId=<id>&preset=<preset>&from=<iso>&to=<iso>`: returns the fixture data for one tile at the given boundary. The server appends the request to `__requests` (visible to the pack).
- `GET /api/chart?chartId=<id>&preset=<preset>&from=<iso>&to=<iso>`: same for the chart region.
- `GET /healthz`: returns `200 ok`.

## Query switches

The root route accepts three query parameters, `?break=<mode>`, `?tile=<id>&state=<state>` (state pinning for the four-state check), and `?asof=<iso>` (a fixed as-of stamp for the fan-out check). Each break mode drops one surface the pack asserts on so the pack refuses ship the corresponding check.

| Switch | What it does | Pack check that must fail | Severity |
|---|---|---|---|
| `?break=kpi-position` | Puts a non-primary tile before the primary KPI in DOM order (and drops the primary tile's `grid-column-start`). | `AC-19102-1` primary-KPI position | block |
| `?break=fanout` | Drifts every second refetch's `to` boundary by one hour so the fan-out batch is inconsistent. | `AC-19104-1` timeframe refetch fan-out | block |
| `?break=state-aria` | Drops `aria-live` and `role="region"` from every tile. | `AC-19103-1` per-tile four-state contract | block |

`?tile=primary&state=<loading|empty|error|populated>` pins the primary tile into the named state so the four-state check drives each state's DOM without triggering a refetch. `?tile=primary` on its own is the populated state.

`?asof=<iso>` overrides the shell's `data-as-of` stamp with the given ISO value (used by the pack's fan-out check to assert boundary matching).

## Shape asserted

- Shell root exposes `role="region"` regions labelled `tile-row`, `chart-region`, `filter-chrome`, `timeframe-picker`, `export-handle` via `data-region` and `aria-label`.
- Primary KPI tile carries `data-tile-role="primary-kpi"`, `data-kpi-kind="revenue"`, `data-tile-id="primary"` and lives at `grid-column-start: 1; grid-row-start: 1` at 1440 and 1024. At 360 the tile grid reflows to one column and the primary tile is first in DOM order with `grid-row-start: 1`.
- Every tile wraps its content in `role="region"` with `aria-live="polite"`, a `data-tile-state` attribute naming the current state, and a `[data-state-cue]` child whose text is a non-colour label.
- Shell root exposes a `data-as-of` attribute in ISO-8601 form and a `data-auto-refresh="off"` attribute (auto-refresh off unless the operator elicits an interval).
- Every tile carries its own `data-as-of` attribute matching the shell root.
- `window.__dashboardFetches` is an append-only array of every fetch record; `/__requests` mirrors the same content server-side.

## What this fixture is not

- Not a dashboard framework. It is one dependency-free Node HTTP server that emits the exact DOM shape the pack asserts on. A real applying project mounts through the render shell (TAC-2001) and drives the shape from its own data source.
- Not the shipped blueprint. The blueprint lives at `blueprints/application-dashboard/`; this fixture is the golden the pack probes at the shelf gate.

## Related

- Probe pack: `blueprints/application-dashboard/probe-packs/application-dashboard.pack.mjs`
- Blueprint README: `blueprints/application-dashboard/README.md`
- Packaged design guidance: `blueprints/application-dashboard/assets/guidance/dashboard-design.md`
- Ratified spec: `projects/blueprint-library/specs/visual-round-spec-2026-09-04.md` section 5.3 (in the operator repo).
