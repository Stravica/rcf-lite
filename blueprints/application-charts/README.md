# Charts blueprint (v1.0.0)

Vendor-neutral chart-component contract for a rcf-lite application. Ships the accessibility, palette, text-alternative and keyboard-traversal discipline every chart on the shipped surface must meet. Ships a Playwright probe pack under `probe-packs/application-charts.pack.mjs` whose three checks are the runtime gate the delivery-ci-workflows runner drives (visual round spec 2026-09-04, section 5.2). No new global topics; suggests the `logging` and `errorHandling` companions. Leaf blueprint: application-dashboard (visual round T-3) consumes it; no other blueprint in this round does.

## Apply

```
rcf define blueprint add <path-to>/blueprints/application-charts
```

Applies namespaced contributions into the project tree and records `manifest.blueprints[]`. Consumes the `logging` and `errorHandling` companions when they resolve to an applied provider or a registered library; falls back to the shelf providers otherwise.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version 1.0.0, category `application`, `suggestedCompanions: [{ logging }, { errorHandling }]`, 15 contributions in the 18xx US band and 19xx ADR/TAC block |
| Doc set | `contributions/` | 4 REQs, 6 USs, 2 TACs, 3 ADRs, schema-valid and namespaced |
| Probe pack | `probe-packs/application-charts.pack.mjs` | Three browser-verify checks anchored to AC-18102-1 (non-colour distinction), AC-18103-1 (text-alternative table), AC-18104-1 (keyboard traversal with reduced motion) |
| Guide | `guide/application-charts.md` | Operator-facing: when to reach, when not, mechanism-reach gaps |
| Coordination vocabulary | `docs/topics.md` | Shelf id band registry update; no new global topics claimed |

## What it contributes, and what it deliberately does not

Contributed: REQ, US (with inline ACs), TAC, ADR, plus one shipped probe pack. Adherence is expressed as ACs; the blueprint ships no chart-engine source and no test files (the probe pack drives the real browser against the applying project's own runtime).

Deliberately not contributed: a choice of chart engine (Recharts, ECharts, Chart.js, D3 primitives, hand-authored SVG); a data-source contract (the applying project sources chart data through the applied `application-api-rest` blueprint or an equivalent); a dashboard layout contract (the applying `application-dashboard` blueprint owns tile placement and hierarchy).

## The engine refusal rule

`ADR-1901` elicits the chart engine at apply, and refuses a canvas-only engine that offers no text-alternative surface. The refusal is documented here on the blueprint's README so applying projects and gate reviewers see the rule in one place:

- Recharts, ECharts, Chart.js and D3 primitives all satisfy the shell contract when paired with the shell's text-alternative table slot. Chart.js's canvas surface is paired with the shell's `<table>` slot; the shell renders both, so screen readers reach the values.
- A chart engine that renders exclusively to a `<canvas>` and does NOT offer either a shell-rendered `<table>` or an equivalent DOM path is refused at project-side review. The applying project either replaces the engine or supersedes this blueprint with a project-authored engine contract naming the residuals.

## The one runtime gate

`probe-packs/application-charts.pack.mjs` ships three checks the `rcf verify browser` runner invokes on any FBS whose surface matches the pack's `appliesTo` predicate (an FBS that binds `TAC-1901-application-charts-render-shell` or whose nav model routes name a chart or dashboard path). Each check drives the real Playwright browser the runner provisions (through the pinned Playwright MCP or the consuming project's own `playwright` installation), reads the accessibility tree and the DOM, and returns a verdict. A failing block-severity check refuses ship through the existing `browserVerification` aggregate verdict.

The pack fires ONLY when its `appliesTo` returns true; a project whose FBS does not bind the shell TAC or a chart route sees the pack recorded as `applicable: false` and no browser check runs.

## Elicited parameters (ADR-1901, ADR-1902, ADR-1903 and REQ notes)

- **Chart engine**: Recharts, ECharts, Chart.js, D3 primitives, or a hand-authored SVG mount. Elicited at apply, recorded in the manifest; a canvas-only engine with no text-alternative path is refused (ADR-1901).
- **Default categorical palette**: light and dark accessible-defaults ship as the recommended default; operator brand tokens can override at apply, fall back to the defaults on missing tokens (ADR-1902).
- **Interactive traversal scope**: either every chart on the surface (default) or only detail-view charts. When only detail views are interactive, the shell binds the keyboard-traversal contract on those charts and skips it on the overview charts (ADR-1901 alternative decision).
- **Sparkline behaviour**: in-tile (mounted inside a stat tile via `application-dashboard`) or standalone (mounted on the shipped surface as one chart). The shell handles both; the applying project picks per surface.

## Standards trace

WCAG 2.2 AA: 1.4.1 (Use of Colour), 1.4.3 (Contrast Minimum), 1.4.11 (Non-text Contrast), 2.1.1 (Keyboard), 2.3.3 (Animation from Interactions). `standardsTrace` empty on the blueprint; `standardsTraceClause` on each ADR carries the WCAG clause.

## Quality bar

Every chart on the shipped surface mounts through the render shell (TAC-1901). Every multi-series chart carries colour AND a non-colour pattern (data-pattern attribute, stroke-dasharray, hatched fill or marker shape) AND a direct label at the series (AC-18102-1). Every chart is paired with a `<table>` in the same landmark, cell-per-value, focus-reachable through a labelled control (AC-18103-1, AC-18103-2). Every interactive chart exposes a keyboard traversal path with the announced string `<seriesName>, <xValue>, <yValue> <unit>` on focus, and `prefers-reduced-motion: reduce` suppresses transitions (AC-18104-1). Chart engine is elicited at apply and canvas-only-no-text-alternative is refused (ADR-1901, AC-18106-1).

## Known mechanism-reach gaps

Every runtime-observable AC that is not bound to a pack check appears here individually per the T-1 gate discipline (`blueprint-authoring-checklist.md` section 6.g): categories are not enough. The pack has three checks; every other runtime-observable AC on this blueprint is a mechanism-reach gap named below.

- **AC-18101-1 form-set membership**. the pack does not inspect a chart's declared form against the six-form set. A project-side review is the current mechanism. A v1.1 minor bump could add a fourth pack check reading the `data-chart-form` attribute the shell emits and asserting membership.
- **AC-18101-2 shell-mount routing**. the pack does not inspect the mount seam; a chart bypass to the raw chart-library mount is caught at project-side review. A build-scan pre-check in a v1.1 minor bump can grep the applying project's source for engine-specific mount calls.
- **AC-18102-2 single-series exemption**. the pack does not skip single-series charts explicitly today; the runner reports `applicable: false` for the check on a surface with only single-series charts based on the DOM inspection. A v1.1 minor bump can formalise the skip on the pack seam.
- **AC-18103-2 show-table control label and reading order**. the pack asserts the control is present but does not assert the control's accessible-name text or its position in tab order before the chart's data points. A v1.1 minor bump can add a pack check that tabs into the region and reads the tab order.
- **AC-18104-2 non-interactive-chart exemption**. the pack does not skip non-interactive charts explicitly today; the check fails on a surface whose data points miss `tabindex="0"`, whether or not the chart is interactive. Project-side review names non-interactive charts and the reviewer skips the check by hand.
- **AC-18105-1 palette contrast**. the pack does not measure contrast ratios today. Palette contrast is a build-scan surface (colour tokens are inspectable from the applied palette module). A v1.1 minor bump can add a Node build-scan pre-check that reads the applied palette and checks the ratios against WCAG 1.4.3 and 1.4.11.
- **AC-18105-2 palette override fallback**. the fallback behaviour is exercised by the applying project's own tests, not this blueprint's pack. The applying project owns the assertion.
- **AC-18106-1 canvas-only refusal**. the refusal is documented in the README's engine-refusal rule; project-side review enforces it. A v1.1 minor bump could add a pack pre-check that reads the applied engine and refuses on a canvas-only engine with no `<table>` companion.
- **AC-18106-2 engine-name marker**. the applying project ships a `data-chart-engine` attribute or an equivalent DOM marker. The pack does not assert this today; a v1.1 minor bump could read the marker and add it to the pack record for downstream tooling.

## Vision-deficiency emulation is a runner-seam gap

The runner has no `emulateVisionDeficiency` seam on the pack browser today (`goto`, `snapshot`, `evaluate`, `click`, `type`, `press`, `screenshot` is the current API). AC-18102-1 is therefore proven at the DOM level: every series carries a non-colour cue AND a direct label. A future runner minor that adds `emulateVisionDeficiency` to the seam lets this pack add a deuteranopia render pass; that follow-up is named under CONCERNS in the T-2 dispatch report as the smallest runner change that would close the class.
