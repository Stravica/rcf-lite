# application-datatable CHANGELOG

## 1.0.9 - 2026-09-11

- Adds a contributions/probes pack meeting rule 7d.
- Probes: apg-table-shape, sort-adapter-round-trip, search-adapter-round-trip, four-states-regions.
- Arrow-key cell focus (AC-17107-5) is a browser-only property and is recorded as notObservableHere with the shipped AC id and reason; the row anchors nothing else.
- Sort/search adapters observe the server round trip; the DOM click / typing halves are conformanceOnly + limitation naming the AC id and the browser property.
- No-results uses a non-empty filter and checks the no-filter negative case.
- Anatomy test pin bumped to 1.0.9.


## 1.0.4 - 2026-09-10

Findings closed: F-1, F-2, F-3, F-4, F-5, F-6, F-7, F-8. Template-AC fill-in clauses on AC-17101-3, AC-17102-1, AC-17108-2, AC-17108-3, AC-17109-1 and AC-17109-3 now enumerate the specific applying-project substitutions (column-id set, query-adapter endpoint and debounce, elicited query-adapter mode, applied default page size, elicited selection-persistence value, accessible-copy text near the bulk-action control) in place of the generic phrasing. TAC-1802 owns the `sort=<column>:<asc|desc>` grammar and the fixed `pageSize` query-parameter name; TAC-1803-application-datatable-selection-model patch-bumped to 1.0.2 with the `data-selection-persistence` marker on the bulk-action region added to responsibilities[3] and referenced from AC-17109-3. Register cleanup on the datatable README (removed the dated visual-specification reference and the residual mechanism-reach gap parenthetical) and on the guide (neutralised the dashboard-blueprint mention).


## 1.0.3 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.0.2 (application-core completion pass, 2026-09-09)

- Adds top-level elicits[] block on blueprint.json declaring the four apply-time answers (query-adapter-mode, url-state-strategy, page-size, selection-persistence); each option value backed by a must REQ description with a runtime clause per section 7c. REQ-001 gains a page-size 25 default clause; REQ-002 gains url-query / session-scoped URL-state clause; REQ-004 gains per-page / cross-page selection-persistence clause. capabilities[] not declared: leaf blueprint (no consumer requiresAppliedCapabilities on the shelf references a datatable capability).
- Register-and-citation sweep 2026-09-10: vendorCitation added to eight fixed ACs whose assertions rest on W3C facts: AC-17104-3 (WCAG 2.4.3 focus-order), AC-17104-6 (ARIA APG dialog-modal pattern), AC-17105-2 (WCAG 1.4.1 use-of-color), AC-17106-4 (WCAG 2.5.7 dragging-movements), AC-17107-2 (WCAG 4.1.2 name-role-value), AC-17107-3 (WCAG 1.3.1 info-and-relationships), AC-17107-4 (ARIA APG table pattern), AC-17107-5 (ARIA APG grid pattern); each citation carries verifiedOn 2026-09-09.
- Adds refusal-path ACs to US-17104 (bulk-action max-cap refusal, dialog Cancel focus return, focus trap), US-17106 (drag-only refusal, hidden-column orphan cells, hidden column with active sort/filter), US-17107 (read-only role=grid refusal, role=grid arrow navigation, mixed-interactive shell pattern), US-17108 (session-scoped no-URL contract, invalid-URL rejection, history.replaceState per micro-change), US-17109 (dialog aria-describedby total count, filter narrows presentation not selection, Clear selection control). Every story now at the 7a floor (4-6 ACs per story, 46 ACs total on the blueprint).

## 1.0.1 (application-core hardening, 2026-09-09)

- Hardening cleanup: chain-consistency lint clean at baseline; added deliveredBy to every REQ, added ownerRef and disposition to every AC per section 7b.
- Added AC-17101-4, AC-17102-4, AC-17103-4 and AC-17105-4 (loading indicator clears, announced error region replaces the pending state, last successful rows retained) covering the 2026-09-08 review finding F-1 on TAC-1802.internalStructure for sort, filter, pagination and URL-state page requests that reject.


## 1.0.0 (2026-09-04)

- First ratified version of the shelf's datatable blueprint. Six REQs (table shell, sort semantics, filter chrome, selection and bulk actions, empty / loading / error / no-results states, column visibility / reorder / resize), nine USs binding 27 runtime-observable ACs, three TACs (shell, query adapter, selection model), four ADRs (pattern choice, URL state, page size, selection persistence). No new global topics.
- Ships `probe-packs/application-datatable.pack.mjs`: six browser-verify checks anchored to AC-17101-1, AC-17102-1, AC-17103-2, AC-17104-3, AC-17105-1, AC-17106-1. First blueprint on the shelf that ships a Playwright probe pack under the runner extension.
- Ships a sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-datatable/` (dependency-free Node HTTP server) so the pack can be probed at the shelf's own gate; the fixture is the golden the probe pack drives.
- Suggests the `logging` and `errorHandling` companions with the ratified spec's reasons.
