# application-charts CHANGELOG

## 1.0.10 - 2026-09-12

- Positive-evidence row shape tightened in the anatomy helper: a positive row now requires a non-empty engine-returned `requestId` AND (a non-empty `bodyExcerpt` OR a non-empty `derived` object); a `{derived:{}}` alone or a `requestId` alone no longer counts, with two new negative-case tests covering the empty-derived and id-only patterns. No probe or fixture behaviour changes on this blueprint (charts probes already carry both request-id and non-empty derived on every positive row).

## 1.0.9 - 2026-09-12

- Rule-7d shape fix on the three de-claimed conformance rows across text-alternative-table (AC-18103-1), non-colour-distinction (AC-18102-1) and keyboard-traversal (AC-18104-3): each row now carries `anchorAcId: null` and names the anchored AC in the `limitation` field per the shipped shape (a `conformanceOnly:true` row must not simultaneously claim an anchor). Fixture README env-var manifest now declares `PROBE_BREAK` (the fixture reads it as an alternate to a per-request `?break=`) and the probe-utils `DECLARED_ENV` list mirrors the addition. Anatomy shape check tightened to reject an anchored `conformanceOnly` row (a positive evidence field no longer bypasses the null-anchor + limitation contract); a new negative-case test constructs an anchored `conformanceOnly` row and asserts the shape helper throws.

## 1.0.8 - 2026-09-11

- Shared `aggregate()` no longer promotes warn rows to pass: any row with verdict warn (including honest de-claim rows) lifts the aggregate to warn; a probe whose rows are all warn aggregates to warn, not pass. Shared teardown propagates a SIGKILL failure through the returned kill() promise instead of swallowing it. Overclaiming rows across every probe are de-claimed to `conformanceOnly:true` with `verdict:'warn'` on the observable half and a `limitation` field naming the anchored AC and the browser-only or varied-input clause that lives outside the Node HTTP probe. Positive-observation rows kept on `application-charts-AC-18103-3` (paired table cell-vs-coordinate equality) and on the anatomy-only fixture shape assertions. Anatomy test extended with a negative-variant assertion that each shipped fixture break switch drives the affected probe aggregate to fail.

## 1.0.7 - 2026-09-11

- keyboard-traversal AC-18104-1 row de-claimed to conformance-only (null anchor + `limitation` naming the AC clause NOT observed here: browser Tab focus movement is not observable by a Node HTTP probe; the DOM source-order walk of `[.chartDataPoint tabindex=0]` elements is a proxy but not authoritative). AC-18104-3 row keeps the AC anchor (aria-label token derivation is server-observable). Anatomy test extended to (a) enumerate the shipped AC/REQ id set from `contributions/user-stories/*.json` and `contributions/requirements/*.json` and refuse any row whose `anchorAcId` or `notObservableAcId` is not in that set, and (b) accept the conformance-only row shape (null anchor + non-empty `limitation`).

## 1.0.6 - 2026-09-11

- Rule-10 sweep on every probe row detail: each row now opens with the verbatim first eight words of its anchored AC's description (AC-18102-1, AC-18103-1, AC-18103-3, AC-18104-1, AC-18104-3) so the property claimed sits next to the observation made. Register cleanup on probe-utils.mjs, the anatomy test and the fixture README: reworded citations that carried banned register-label tokens to describe the rule by name.


## 1.0.5 - 2026-09-11

- Added a criterion-e probe pack (`contributions/probes/`) covering 3 properties the fixture engine at `packages/rcf-lite/test/fixtures/probe-pack-application-charts/server.js` answers: `non-colour-distinction`, `text-alternative-table`, `keyboard-traversal`. Every response now carries an `x-fixture-request-id` header; probes record the id, the HTTP status and a body excerpt as positive evidence per rule 7d. Fixture README declares every env var the pack reads. Anatomy test at `packages/rcf-lite/test/blueprint/application-charts-anatomy.test.js` pins the new pack files and asserts each result carries one of the four 7d evidence shapes.


## 1.0.4 - 2026-09-10

Fixes: Template-AC fill-in clauses on AC-18105-1, AC-18105-2, AC-18106-1, AC-18106-2 and AC-18106-3 now enumerate the specific applying-project substitutions (applied light and dark backgrounds and any operator brand-token overrides on `blueprint.json:elicits[palette-overrides]`, the elicited palette-overrides string value, the elicited engine token, the elicited engine choice failing the text-alternative check) in place of the generic phrasing. TAC-1901-application-charts-render-shell patch-bumped to 1.0.3: responsibilities[6] fixes the `data-chart-engine` attribute referenced from AC-18106-2, and responsibilities[5] now owns the render-log refusal-record shape (one warning entry per refused chart declaration, keyed to the accessible-name and naming the engine and the missing text-alternative surface) referenced from AC-18106-3 and AC-18106-4 in place of the shape restatement on AC-18106-4. ADR-1902 fixes the palette fallback expectation. Register cleanup on README shipped prose (removed the dated visual-specification reference, neutralised the follow-up naming and aligned the AC-18106-2 marker gap to the TAC-1901 owner) and on the guide (rewrote the spec-reference section to neutral spec-provenance without the operator-repo path or the internal review convention).


## 1.0.3 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.0.2 (2026-09-09)

- Adds top-level elicits[] block on blueprint.json declaring the two apply-time answers (chart-engine, palette-overrides); each option value backed by a must REQ description with a runtime clause per section 7c. REQ-001 gains the chart-engine token set (recharts, echarts, chart-js, d3-primitives, hand-authored-svg) and the canvas-only refusal clause.
- Adds refusal-path ACs to US-18101 (per-form binder check, specialised-form CALLS MADE, empty-data-set labelled block), US-18102 (deuteranopia simulation check, direct-label rule vs legend-only, unique colour+pattern combination), US-18103 (cell-value match check, same-landmark rule, visually-hidden-vs-display:none), US-18104 (announced-string field order, series-by-series traversal, prefers-reduced-motion), US-18105 (dark-background contrast, undersupplied palette warning, runtime theme flip). Every story now at the 7a floor (4-5 ACs per story, 29 ACs total).
- vendorCitation added to AC-18102-2 (WCAG 1.4.1 use-of-color) and AC-18105-3 (WCAG 1.4.11 non-text contrast) with verifiedOn 2026-09-09. Applying agent sets clause appended to AC-18101-4 naming the specialised chart form, the CALLS MADE entry text and the superseding REQ id. REQ-002 (priority must) extended to name the `palette-overrides` elicit contract with runtime clauses per option value (empty override resolves to accessible defaults with no warnings; a malformed override is refused when the applying project inspects the manifest) and AC-18105-2 and AC-18105-4 now reference `blueprint.json:elicits[].palette-overrides` verbatim so the section-7c option coverage binds. Chart-engine canonical option tokens (owned by the manifest as `recharts`, `echarts`, `chart-js`, `d3-primitives`, `hand-authored-svg`) now appear verbatim in AC-18106-1 and AC-18106-2 so a section-7c string-scan matches every option.

## 1.0.1 (2026-09-09)

- Chain-consistency lint at zero. Added deliveredBy to every REQ, added ownerRef and disposition to every AC per section 7b.
- Added AC-18106-3 and AC-18106-4 (mount refusal before any DOM attaches and the render-log warning contract with one entry per refused declaration and no duplication on compliant re-mount) covering the mount-time refusal branch on TAC-1901.responsibilities[5].


## 1.0.0 (2026-09-04)

- Initial shipped version of the shelf's charts blueprint. Four REQs (chart form set, non-colour distinction, text-alternative table, keyboard traversal), six USs binding runtime-observable ACs, two TACs (render shell, keyboard traversal), three ADRs (elicited chart engine with canvas-only refusal, accessible palette light and dark, reduced motion via application-spa tokens). No new global topics.
- Ships `probe-packs/application-charts.pack.mjs`: three browser-verify checks anchored to AC-18102-1 (non-colour distinction), AC-18103-1 (text-alternative table with cell-per-value contract), AC-18104-1 (keyboard traversal contract with reduced-motion suppression). Every check carries a description field per spec section 9. Second blueprint on the shelf that ships a Playwright probe pack under the runner extension; first leaf blueprint the application-dashboard consumes.
- Ships a sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-charts/` (dependency-free Node HTTP server) so the pack can be probed at the shelf's own gate; the fixture is the golden the gate reviewer drives, with `?break=table`, `?break=pattern` and `?break=keyboard` query switches for the negative runs.
- Suggests the `logging` and `errorHandling` companions with the shipped spec's reasons.

### Patch note (2026-09-04, gate follow-up)

- `probe-packs/application-charts.pack.mjs`: navigate with `new URL('', runtimeUrl).toString()` instead of `runtimeUrl + '/'` on the three goto call sites (AC-18102-1, AC-18103-1, AC-18104-1). The concat form stripped an operator-supplied `?break=<mode>` from a CLI `--url`; the URL-resolver form preserves the runtime URL verbatim so an operator pointing the CLI at `?break=<mode>` sees the negative run naturally. Version stays at 1.0.0; behaviour unchanged on the default apply-side runtime URL.
