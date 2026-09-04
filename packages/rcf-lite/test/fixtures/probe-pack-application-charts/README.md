# probe-pack-application-charts sample-app fixture

Dependency-free Node HTTP server exercising every surface the `application-charts` probe pack asserts on. Used at the shelf gate to drive the pack against a golden and against three broken variants.

## Boot

Two-line manual boot for the gate reviewer:

```
cd packages/rcf-lite/test/fixtures/probe-pack-application-charts
PORT=3000 node server.js
```

Once bound, the server prints one line to stdout:

```
LISTENING 3000
```

`PORT` is an env var (default `3000`). Any free port is fine; the pack drives whatever URL the reviewer passes to `rcf verify browser --url`.

Stop the server with Ctrl+C or `kill <pid>` (SIGTERM is honoured).

## Routes

- `GET /` (also `GET /index.html`): renders two charts on one landmark:
  - a two-series bar chart (`Prod` solid fill, `Staging` hatched fill) with a paired `<table>` under a visually-hidden focus-reachable wrapper;
  - a two-series line chart (`p50` solid, `p95` dashed) with the same paired-table shape.
- `GET /healthz`: returns `200 ok`; used by callers that want a reachability probe without touching the shell.

## Query switches

The root route accepts one query parameter, `?break=<mode>`. Each mode drops one surface the pack asserts on so the pack refuses ship the corresponding check.

| Switch | What it does | Pack check that must fail | Severity |
|---|---|---|---|
| `?break=table` | Drops the `<table>` element from every chart landmark. | `AC-18103-1` text-alternative table | block |
| `?break=pattern` | Drops the `data-pattern` attribute from every series and every line group. | `AC-18102-1` non-colour distinction | block |
| `?break=keyboard` | Drops `tabindex="0"` and `aria-label` from every data-point element. | `AC-18104-1` keyboard traversal contract | block |

No break is `?break` absent (the golden). Any other value is ignored (the fixture renders the golden). Combining break switches is not supported: pass one at a time.

## Shape asserted

- Each chart's SVG carries `role="img"` and an `aria-label` so it exposes an accessible name.
- Each series in the SVG carries `data-pattern="<solid|hatched|dashed>"` (a non-colour cue the pack reads at the DOM level) and a `chartSeriesLabel` text node next to the series glyph (the direct-label cue).
- Each data point (bar `<rect>` or line marker `<circle>`) carries `tabindex="0"` and an `aria-label` matching the announced-string format `<seriesName>, <xValue>, <yValue> <unit>` (comma-separated).
- Each chart's paired `<table>` lives inside the same `<section role="region">` as the chart SVG (the same landmark, per WCAG 1.1.1 the shelf inherits) and lives inside a `chartAltTableWrapper` div that is visually-hidden by default and revealed on focus. A labelled `<button class="chartShowAltTable">Show data table</button>` moves focus into the wrapper on click; the same button is keyboard-reachable in tab order before the chart's data points.
- A `@media (prefers-reduced-motion: reduce)` block on the shell CSS zeroes `transition-duration` and `animation-duration` on the animated chart elements.

## What this fixture is not

- Not a chart library. It is one dependency-free static SVG renderer that emits the exact DOM shape the pack asserts on. A real applying project mounts through the render shell (TAC-1901) and lets a chart engine (Recharts, ECharts, Chart.js, D3 primitives) render the SVG; the shape the engine emits must match the shape this fixture emits for the pack to pass.
- Not the shipped blueprint. The blueprint lives at `blueprints/application-charts/`; this fixture is the golden the pack probes at the shelf gate.

## Related

- Probe pack: `blueprints/application-charts/probe-packs/application-charts.pack.mjs`
- Blueprint README: `blueprints/application-charts/README.md`
- Ratified spec: `projects/blueprint-library/specs/visual-round-spec-2026-09-04.md` section 5.2 (in the operator repo).
