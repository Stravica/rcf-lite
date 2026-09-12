# application-dashboard CHANGELOG

## 1.0.9 - 2026-09-11

- Adds a contributions/probes pack meeting rule 7d.
- Probes: shell-five-regions (region layout derived from probe-controlled region enum), primary-kpi-top-left, four-tile-states, export-handle-formats.
- Export probe rethrows any teardown exception; a swallowed teardown error would hide a boundary failure.
- Primary-KPI at ratified viewports is a browser-only property; the row is conformanceOnly + limitation naming the specific AC id and the browser property not observed.
- notObservableHere rows anchor nothing else; conformanceOnly rows always carry a limitation.
- Anatomy test pin bumped to 1.0.9.


## 1.0.4 - 2026-09-10

Template-AC fill-in clauses on AC-19104-2, AC-19106-1, AC-19106-2 and AC-19107-2 now enumerate the specific applying-project substitutions (auto-refresh interval, export-button accessible name and format list, chart-selection mechanism, primary-kpi kind and tile inventory) in place of the earlier generic phrasing, so applying projects have precise values to fill in. AC-19107-1 changed to `disposition: fixed` (no project-side substitution: the shipped guidance file satisfies the AC directly). README shipped prose neutralised: the dated visual-specification reference has been dropped and the pack-browser seam-extension paragraph has been rewritten.


## 1.0.3 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.0.2 (application-core completion pass, 2026-09-09)

- Adds top-level elicits[] block on blueprint.json declaring the five apply-time answers (primary-kpi-kind, primary-kpi-custom-name, timeframe-presets, auto-refresh-interval-seconds, export-formats); each option value backed by a must REQ description with a runtime clause per section 7c. REQ-002 gains a data-kpi-name clause when kind is custom; REQ-004 gains an auto-refresh-interval-seconds clause; REQ-005 gains the lowercase csv/pdf/png-chart format tokens.
- Adds refusal-path ACs to US-19101 (silent region omission, duplicate region names, empty chart region), US-19102 (360 row-start conflict, custom kind requires data-kpi-name, invalid enum value), US-19103 (colour-only distinction refusal, error state requires visible reason, rapid-transition announcement throttling), US-19105 (invalid filter input, subset-reject fan-out stamp advancement, Clear filters reset), US-19107 (per-rule guidance check, design-guidance asset present, documented CALLS MADE deviation). US-19104 and US-19106 also extended with concurrent-preset cancellation, whole-surface failure announcement, elicited preset support and Escape focus return plus operator-authored export formats. Every story now at the 7a floor (3-5 ACs per story, 35 ACs total).
- Register-and-citation sweep 2026-09-10: vendorCitation added to AC-19103-3 (WCAG 1.4.1 use-of-color), AC-19106-4 (WCAG 2.4.3 focus-order) and AC-19107-3 (WCAG 1.4.1 use-of-color) with verifiedOn 2026-09-09; an Applying agent sets clause appended to AC-19107-5 naming the CALLS MADE entry text, the superseding REQ id and the specific deviation; a pre-existing internal work-item reference stripped from the README elicited-parameters paragraph.

## 1.0.1 (application-core hardening, 2026-09-09)

- Hardening cleanup: chain-consistency lint clean; added deliveredBy to every REQ, added ownerRef and disposition to every AC per section 7b, closed `primary-KPI` case drifts in AC-19107-2, ADR-2001 and the guide body to match the `primary-kpi` spelling owned by TAC-2001.responsibilities[0].
- Added AC-19104-2 (fan-out partial failure: failed tiles render error state with aria-live and retry control, shared refresh-stamp advances only after every tile has settled) on TAC-2002.responsibilities[3]. Added AC-19106-2 and AC-19106-3 (export success and rejection cases: valid blob/filename on the current slice, no download on rejection with an announced failure) on TAC-2003.interfaces[0]. Applying projects now have explicit acceptance criteria for the fan-out partial-failure and export success/rejection paths.


## 1.0.0 (2026-09-04)

- First ratified version of the shelf's application-dashboard blueprint. Five REQs (shell composition; primary-KPI top-left visual hierarchy on the F-scan across 1440, 1024 and 360; per-tile four-state contract with role region, aria-live polite and non-colour distinction; timeframe and filter chrome refetch fan-out with matching as-of stamp; export handle with format delegation to charts), seven USs binding runtime-observable ACs plus one on packaged-guidance adherence, three TACs (tile grid with CSS Grid position semantics and breakpoint reflow; timeframe picker and filter chrome with the fan-out contract; export handle with delegation to the application-charts render shell), three ADRs (primary-KPI kinds enum with elicited overrides; timeframe presets with recommendedDefault and elicited overrides plus auto-refresh off by default; export formats with recommendedDefault and elicited overrides). No new global topics.
- Ships `assets/guidance/dashboard-design.md`: eight sections (primary KPI placement; tile density and count limits; timeframe and filter chrome; loading, empty and error states; colour and contrast; when a table beats a chart, delegating to application-datatable; refresh cadence and staleness; anti-patterns) with five https-cited sources (NN/g dashboard design, Few, Tufte, GOV.UK Design System patterns, WCAG 2.2 Understanding docs). Each section names whether the rule hardens into an AC on this blueprint or stays operator guidance. The applying agent reads this asset at apply and the probe pack references it at ship.
- Ships `probe-packs/application-dashboard.pack.mjs`: three browser-verify checks anchored to blueprint AC ids, every check carrying a description field per spec section 9. `AC-19102-1` primary-KPI position by DOM order and CSS Grid position at 1440, 1024 and 360 (drives the new pack-browser `resize(width, height)` seam to each width). `AC-19104-1` timeframe refetch fan-out with matching boundary and as-of stamp (reads the request log from `window.__dashboardFetches` and reconciles with the `GET /__requests` endpoint). `AC-19103-1` per-tile four-state contract with role region, aria-live polite and non-colour distinction (drives `?tile=primary&state=<state>` for each of the four states). Third blueprint on the shelf that ships a Playwright probe pack under the runner extension.
- Ships a sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-dashboard/` (dependency-free Node HTTP server) so the pack can be probed at the shelf's own gate; the fixture is the golden the probe pack drives, with `?break=kpi-position`, `?break=fanout` and `?break=state-aria` query switches for the negative runs, `?tile=<id>&state=<state>` state pinning for the four-state check, and `?asof=<iso>` for a fixed shell as-of stamp.
- Suggests the `logging` and `errorHandling` companions with the ratified spec's reasons. `providesRoles` absent, leaf blueprint per the loader contract (an empty array is refused, an omitted field marks the blueprint as a leaf).
- Extends the pack-browser seam (`packages/rcf-lite/src/browser-verify/pack-browser.js`) with a `resize(width, height)` method: on the MCP route the method calls the pinned Playwright MCP's `browser_resize` tool; on the project route it calls `page.setViewportSize({ width, height })`. The next blueprints on the shelf that ship breakpoint-scoped visual ACs (notifications-in-app, admin-console) reuse the same seam.
