# application-charts CHANGELOG

## 1.0.2 (B6a application core completion pass, 2026-09-09)

- Adds top-level elicits[] block on blueprint.json declaring the two apply-time answers (chart-engine, palette-overrides); each option value backed by a must REQ description with a runtime clause per section 7c. REQ-001 gains the chart-engine token set (recharts, echarts, chart-js, d3-primitives, hand-authored-svg) and the canvas-only refusal clause.
- Adds refusal-path ACs to US-18101 (per-form binder check, specialised-form CALLS MADE, empty-data-set labelled block), US-18102 (deuteranopia simulation check, direct-label rule vs legend-only, unique colour+pattern combination), US-18103 (cell-value match check, same-landmark rule, visually-hidden-vs-display:none), US-18104 (announced-string field order, series-by-series traversal, prefers-reduced-motion), US-18105 (dark-background contrast, undersupplied palette warning, runtime theme flip). Every story now at the 7a floor (4-5 ACs per story, 29 ACs total).

## 1.0.1 (B6a application core hardening, 2026-09-09)

- B6a hardening pass: chain-consistency lint zero (pass1 + pass2 already clean at baseline); added deliveredBy to every REQ, added ownerRef and disposition to every AC per section 7b.
- Added AC-18106-3 and AC-18106-4 (mount refusal before any DOM attaches and the render-log warning contract with one entry per refused declaration and no duplication on compliant re-mount) covering the 2026-09-08 review finding F-1 on TAC-1901.responsibilities[5].


## 1.0.0 (visual round T-2, spec 2026-09-04)

- First ratified version of the shelf's charts blueprint. Four REQs (chart form set, non-colour distinction, text-alternative table, keyboard traversal), six USs binding runtime-observable ACs, two TACs (render shell, keyboard traversal), three ADRs (elicited chart engine with canvas-only refusal, accessible palette light and dark, reduced motion via application-spa tokens). No new global topics.
- Ships `probe-packs/application-charts.pack.mjs`: three browser-verify checks anchored to AC-18102-1 (non-colour distinction), AC-18103-1 (text-alternative table with cell-per-value contract), AC-18104-1 (keyboard traversal contract with reduced-motion suppression). Every check carries a description field per spec section 9. Second blueprint on the shelf that ships a Playwright probe pack under the T-0 runner extension; first leaf blueprint the T-3 application-dashboard consumes.
- Ships a sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-charts/` (dependency-free Node HTTP server) so the pack can be probed at the shelf's own gate; the fixture is the golden the gate reviewer drives, with `?break=table`, `?break=pattern` and `?break=keyboard` query switches for the negative runs.
- Suggests the `logging` and `errorHandling` companions with the ratified spec's reasons.

### Patch note (2026-09-04, T-3 gate follow-up)

- `probe-packs/application-charts.pack.mjs`: navigate with `new URL('', runtimeUrl).toString()` instead of `runtimeUrl + '/'` on the three goto call sites (AC-18102-1, AC-18103-1, AC-18104-1). The concat form stripped a reviewer-supplied `?break=<mode>` from a CLI `--url`; the URL-resolver form preserves the runtime URL verbatim so a reviewer pointing the CLI at `?break=<mode>` sees the negative run naturally. Version stays at 1.0.0; behaviour unchanged on the default apply-side runtime URL.
