# application-dashboard CHANGELOG

## 1.0.8 (criterion-e third-closure fix, 2026-09-11)

- Third-closure fix on the criterion-e pack:
  - Shell regions are now derived: startServer({ regions: [...] }) selects the region set; the probe drives two distinct sets (full vs reduced) and asserts the rendered DOM follows the input.
  - Export formats are now derived: startServer({ exportFormats: [...] }) selects the format list; the probe drives two distinct sets (shipped vs elicited) and asserts the listbox follows the input.
  - primary-kpi row drops the duplicate notObservableHere block; the single conformanceOnly row anchors AC-19102-1 with a limitation naming the browser-only viewport half.
  - notObservableHere rows drop anchorAcId / anchorReqId per Addendum 3 rule 11.
  - Anatomy test hardened (AC/REQ resolution, {} never counts as derived); version pin bumped to 1.0.8.

## 1.0.7 (criterion-e closure follow-up, 2026-09-11)

- Second closure follow-up on the criterion-e pack:
  - Anatomy test hardened to Addendum 3 rule 14.
  - Primary-KPI at 1440/1024/360 is a browser-only property; the row is recorded as notObservableHere(AC-19102-1) per Addendum 3 rule 11 rather than faking with static markup checks. A separate row asserts the shell markup satisfies the server-observable half (data-kpi-kind in ADR-2001 enum, non-empty inline styles) with request-id + body excerpt evidence.
  - Export-format focus-return-on-Escape and control-activation are notObservableHere(AC-19106-1); the server-observable half (three format handles rendered with distinct downloads) remains a real row with evidence.
  - Four-tile-states: the "supporting tile" checks now iterate each of the four states rather than always evaluating populated; the probe walks two tiles across four states.

## 1.0.5 (criterion-e positive-evidence probes, 2026-09-11)

- Adds a contributions/probes pack that meets rule 7d: real HTTP round trips against the dependency-free sample-app fixture at packages/rcf-lite/test/fixtures/probe-pack-application-dashboard/. Each probe records the fixture-echoed x-fixture-request-id header, response status and a distinctive body excerpt as evidence.
- Probes: shell-five-regions, primary-kpi-top-left, four-tile-states, export-handle-formats.
- No account-bound branch: the engine is a local fixture, so no CI_HAS_* gate is invented. Fixture README declares every env var the probes read (PORT, PROBE_PORT in the reserved 47300-47399 range).
- 7d addendum 2026-09-11 applied: probe-utils.aggregate([]) now returns fail with detail no checks ran (rule 3); anatomy test asserts each result carries one of the four 7d evidence shapes (rule 6); probe-vs-fixture symmetry avoided (rule 2); AC anchors ride on the anchorReqId when no AC states the property (rule 1).
- Anatomy test extended to pin the pack shape (probe modules, run-*.mjs wrappers, probe-utils.mjs helper, anchorReqId cross-check against contributed REQs, fixture env-var declaration).


## 1.0.4 - 2026-09-10

Findings closed: F-1, F-2, F-3, F-4, F-5, F-6. Template-AC fill-in clauses on AC-19104-2, AC-19106-1, AC-19106-2 and AC-19107-2 now enumerate the specific applying-project substitutions (auto-refresh interval, export-button accessible name and format list, chart-selection mechanism, primary-kpi kind and tile inventory) in place of the generic phrasing. AC-19107-1 changed to `disposition: fixed` (no project-side substitution: the shipped guidance file satisfies the AC directly). Register cleanup on README shipped prose (removed the dated visual-specification reference and neutralised the pack-browser seam-extension paragraph).


## 1.0.3 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.0.2 (application-core completion pass, 2026-09-09)

- Adds top-level elicits[] block on blueprint.json declaring the five apply-time answers (primary-kpi-kind, primary-kpi-custom-name, timeframe-presets, auto-refresh-interval-seconds, export-formats); each option value backed by a must REQ description with a runtime clause per section 7c. REQ-002 gains a data-kpi-name clause when kind is custom; REQ-004 gains an auto-refresh-interval-seconds clause; REQ-005 gains the lowercase csv/pdf/png-chart format tokens.
- Adds refusal-path ACs to US-19101 (silent region omission, duplicate region names, empty chart region), US-19102 (360 row-start conflict, custom kind requires data-kpi-name, invalid enum value), US-19103 (colour-only distinction refusal, error state requires visible reason, rapid-transition announcement throttling), US-19105 (invalid filter input, subset-reject fan-out stamp advancement, Clear filters reset), US-19107 (per-rule guidance check, design-guidance asset present, documented CALLS MADE deviation). US-19104 and US-19106 also extended with concurrent-preset cancellation, whole-surface failure announcement, elicited preset support and Escape focus return plus operator-authored export formats. Every story now at the 7a floor (3-5 ACs per story, 35 ACs total).
- Review fix pass 2026-09-10: F-1 vendorCitation added to AC-19103-3 (WCAG 1.4.1 use-of-color), AC-19106-4 (WCAG 2.4.3 focus-order) and AC-19107-3 (WCAG 1.4.1 use-of-color) with verifiedOn 2026-09-09; F-3 Applying agent sets clause appended to AC-19107-5 naming the CALLS MADE entry text, the superseding REQ id and the specific deviation; F-6 pre-existing internal work-item reference stripped from the README elicited-parameters paragraph.

## 1.0.1 (application-core hardening, 2026-09-09)

- hardening pass: chain-consistency lint zero (pass1 + pass2); added deliveredBy to every REQ, added ownerRef and disposition to every AC per section 7b, closed `primary-KPI` case drifts in AC-19107-2, ADR-2001 and the guide body to match the `primary-kpi` spelling owned by TAC-2001.responsibilities[0].
- Added AC-19104-2 (fan-out partial failure: failed tiles render error state with aria-live and retry control, shared refresh-stamp advances only after every tile has settled) covering the 2026-09-08 review finding F-1 on TAC-2002.responsibilities[3]. Added AC-19106-2 and AC-19106-3 (export success and rejection cases: valid blob/filename on the current slice, no download on rejection with an announced failure) covering F-2 on TAC-2003.interfaces[0].


## 1.0.0 (2026-09-04)

- First ratified version of the shelf's application-dashboard blueprint. Five REQs (shell composition; primary-KPI top-left visual hierarchy on the F-scan across 1440, 1024 and 360; per-tile four-state contract with role region, aria-live polite and non-colour distinction; timeframe and filter chrome refetch fan-out with matching as-of stamp; export handle with format delegation to charts), seven USs binding runtime-observable ACs plus one on packaged-guidance adherence, three TACs (tile grid with CSS Grid position semantics and breakpoint reflow; timeframe picker and filter chrome with the fan-out contract; export handle with delegation to the application-charts render shell), three ADRs (primary-KPI kinds enum with elicited overrides; timeframe presets with recommendedDefault and elicited overrides plus auto-refresh off by default; export formats with recommendedDefault and elicited overrides). No new global topics.
- Ships `assets/guidance/dashboard-design.md`: eight sections (primary KPI placement; tile density and count limits; timeframe and filter chrome; loading, empty and error states; colour and contrast; when a table beats a chart, delegating to application-datatable; refresh cadence and staleness; anti-patterns) with five https-cited sources (NN/g dashboard design, Few, Tufte, GOV.UK Design System patterns, WCAG 2.2 Understanding docs). Each section names whether the rule hardens into an AC on this blueprint or stays operator guidance. The applying agent reads this asset at apply and the gate reviewer references it at ship.
- Ships `probe-packs/application-dashboard.pack.mjs`: three browser-verify checks anchored to blueprint AC ids, every check carrying a description field per spec section 9. `AC-19102-1` primary-KPI position by DOM order and CSS Grid position at 1440, 1024 and 360 (drives the new pack-browser `resize(width, height)` seam to each width). `AC-19104-1` timeframe refetch fan-out with matching boundary and as-of stamp (reads the request log from `window.__dashboardFetches` and reconciles with the `GET /__requests` endpoint). `AC-19103-1` per-tile four-state contract with role region, aria-live polite and non-colour distinction (drives `?tile=primary&state=<state>` for each of the four states). Third blueprint on the shelf that ships a Playwright probe pack under the runner extension.
- Ships a sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-dashboard/` (dependency-free Node HTTP server) so the pack can be probed at the shelf's own gate; the fixture is the golden the gate reviewer drives, with `?break=kpi-position`, `?break=fanout` and `?break=state-aria` query switches for the negative runs, `?tile=<id>&state=<state>` state pinning for the four-state check, and `?asof=<iso>` for a fixed shell as-of stamp.
- Suggests the `logging` and `errorHandling` companions with the ratified spec's reasons. `providesRoles` absent, leaf blueprint per the loader contract (an empty array is refused, an omitted field marks the blueprint as a leaf).
- Extends the pack-browser seam (`packages/rcf-lite/src/browser-verify/pack-browser.js`) with a `resize(width, height)` method: on the MCP route the method calls the pinned Playwright MCP's `browser_resize` tool; on the project route it calls `page.setViewportSize({ width, height })`. The next blueprints on the shelf that ship breakpoint-scoped visual ACs (notifications-in-app, admin-console) reuse the same seam.
