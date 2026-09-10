# application-charts CHANGELOG

## 1.0.4 - 2026-09-10

Findings closed: F-1, F-2, F-3, F-4, F-5, F-6, F-7. Template-AC fill-in clauses on AC-18105-1, AC-18105-2, AC-18106-1, AC-18106-2 and AC-18106-3 now enumerate the specific applying-project substitutions (applied light and dark backgrounds and any operator brand-token overrides on `blueprint.json:elicits[palette-overrides]`, the elicited palette-overrides string value, the elicited engine token, the elicited engine choice failing the text-alternative check) in place of the generic phrasing. TAC-1901-application-charts-render-shell patch-bumped to 1.0.3: responsibilities[6] fixes the `data-chart-engine` attribute referenced from AC-18106-2, and responsibilities[5] now owns the render-log refusal-record shape (one warning entry per refused chart declaration, keyed to the accessible-name and naming the engine and the missing text-alternative surface) referenced from AC-18106-3 and AC-18106-4 in place of the shape restatement on AC-18106-4. ADR-1902 fixes the palette fallback expectation. Register cleanup on README shipped prose (removed the dated visual-specification reference, neutralised the follow-up naming and aligned the AC-18106-2 marker gap to the TAC-1901 owner) and on the guide (rewrote the spec-reference section to neutral spec-provenance without the operator-repo path or the internal review convention).


## 1.0.3 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.0.2 (application-core completion pass, 2026-09-09)

- Adds top-level elicits[] block on blueprint.json declaring the two apply-time answers (chart-engine, palette-overrides); each option value backed by a must REQ description with a runtime clause per section 7c. REQ-001 gains the chart-engine token set (recharts, echarts, chart-js, d3-primitives, hand-authored-svg) and the canvas-only refusal clause.
- Adds refusal-path ACs to US-18101 (per-form binder check, specialised-form CALLS MADE, empty-data-set labelled block), US-18102 (deuteranopia simulation check, direct-label rule vs legend-only, unique colour+pattern combination), US-18103 (cell-value match check, same-landmark rule, visually-hidden-vs-display:none), US-18104 (announced-string field order, series-by-series traversal, prefers-reduced-motion), US-18105 (dark-background contrast, undersupplied palette warning, runtime theme flip). Every story now at the 7a floor (4-5 ACs per story, 29 ACs total).
- Review fix pass 2026-09-10: F-1 vendorCitation added to AC-18102-2 (WCAG 1.4.1 use-of-color) and AC-18105-3 (WCAG 1.4.11 non-text contrast) with verifiedOn 2026-09-09; F-3 Applying agent sets clause appended to AC-18101-4 naming the specialised chart form, the CALLS MADE entry text and the superseding REQ id; F-4 REQ-002 (priority must) extended to name the `palette-overrides` elicit contract with runtime clauses per option value (empty override resolves to accessible defaults with no warnings; a malformed override is refused at project-side review) and AC-18105-2 and AC-18105-4 now reference `blueprint.json:elicits[].palette-overrides` verbatim so the section-7c option coverage binds; F-5 chart-engine canonical option tokens (owned by the manifest as `recharts`, `echarts`, `chart-js`, `d3-primitives`, `hand-authored-svg`) now appear verbatim in AC-18106-1 and AC-18106-2 so a section-7c string-scan matches every option.

## 1.0.1 (application-core hardening, 2026-09-09)

- hardening pass: chain-consistency lint zero (pass1 + pass2 already clean at baseline); added deliveredBy to every REQ, added ownerRef and disposition to every AC per section 7b.
- Added AC-18106-3 and AC-18106-4 (mount refusal before any DOM attaches and the render-log warning contract with one entry per refused declaration and no duplication on compliant re-mount) covering the 2026-09-08 review finding F-1 on TAC-1901.responsibilities[5].


## 1.0.0 (2026-09-04)

- First ratified version of the shelf's charts blueprint. Four REQs (chart form set, non-colour distinction, text-alternative table, keyboard traversal), six USs binding runtime-observable ACs, two TACs (render shell, keyboard traversal), three ADRs (elicited chart engine with canvas-only refusal, accessible palette light and dark, reduced motion via application-spa tokens). No new global topics.
- Ships `probe-packs/application-charts.pack.mjs`: three browser-verify checks anchored to AC-18102-1 (non-colour distinction), AC-18103-1 (text-alternative table with cell-per-value contract), AC-18104-1 (keyboard traversal contract with reduced-motion suppression). Every check carries a description field per spec section 9. Second blueprint on the shelf that ships a Playwright probe pack under the runner extension; first leaf blueprint the application-dashboard consumes.
- Ships a sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-charts/` (dependency-free Node HTTP server) so the pack can be probed at the shelf's own gate; the fixture is the golden the gate reviewer drives, with `?break=table`, `?break=pattern` and `?break=keyboard` query switches for the negative runs.
- Suggests the `logging` and `errorHandling` companions with the ratified spec's reasons.

### Patch note (2026-09-04, gate follow-up)

- `probe-packs/application-charts.pack.mjs`: navigate with `new URL('', runtimeUrl).toString()` instead of `runtimeUrl + '/'` on the three goto call sites (AC-18102-1, AC-18103-1, AC-18104-1). The concat form stripped a reviewer-supplied `?break=<mode>` from a CLI `--url`; the URL-resolver form preserves the runtime URL verbatim so a reviewer pointing the CLI at `?break=<mode>` sees the negative run naturally. Version stays at 1.0.0; behaviour unchanged on the default apply-side runtime URL.
