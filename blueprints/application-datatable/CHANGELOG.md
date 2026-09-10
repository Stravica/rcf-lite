# application-datatable CHANGELOG

## 1.0.4 - 2026-09-10

Template-AC fill-in clauses on AC-17101-3, AC-17102-1, AC-17108-2, AC-17108-3, AC-17109-1 and AC-17109-3 now enumerate the specific applying-project substitutions (column-id set, query-adapter endpoint and debounce, sort variant, page-size default, selection-persistence value, accessible-copy text) in place of the generic phrasing. Register cleanup on README (dated visual-specification reference) and on the guide (removed the internal round-label reference on the dashboard-blueprint mention).


## 1.0.3 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.0.2 (application-core completion pass, 2026-09-09)

- Adds top-level elicits[] block on blueprint.json declaring the four apply-time answers (query-adapter-mode, url-state-strategy, page-size, selection-persistence); each option value backed by a must REQ description with a runtime clause per section 7c. REQ-001 gains a page-size 25 default clause; REQ-002 gains url-query / session-scoped URL-state clause; REQ-004 gains per-page / cross-page selection-persistence clause. capabilities[] not declared: leaf blueprint (no consumer requiresAppliedCapabilities on the shelf references a datatable capability).
- Review fix pass 2026-09-10: F-1 vendorCitation added to eight fixed ACs whose assertions rest on W3C facts: AC-17104-3 (WCAG 2.4.3 focus-order), AC-17104-6 (ARIA APG dialog-modal pattern), AC-17105-2 (WCAG 1.4.1 use-of-color), AC-17106-4 (WCAG 2.5.7 dragging-movements), AC-17107-2 (WCAG 4.1.2 name-role-value), AC-17107-3 (WCAG 1.3.1 info-and-relationships), AC-17107-4 (ARIA APG table pattern), AC-17107-5 (ARIA APG grid pattern); each citation carries verifiedOn 2026-09-09.
- Adds refusal-path ACs to US-17104 (bulk-action max-cap refusal, dialog Cancel focus return, focus trap), US-17106 (drag-only refusal, hidden-column orphan cells, hidden column with active sort/filter), US-17107 (read-only role=grid refusal, role=grid arrow navigation, mixed-interactive shell pattern), US-17108 (session-scoped no-URL contract, invalid-URL rejection, history.replaceState per micro-change), US-17109 (dialog aria-describedby total count, filter narrows presentation not selection, Clear selection control). Every story now at the 7a floor (4-6 ACs per story, 46 ACs total on the blueprint).

## 1.0.1 (application-core hardening, 2026-09-09)

- hardening pass: chain-consistency lint zero (pass1 + pass2 already clean at baseline); added deliveredBy to every REQ, added ownerRef and disposition to every AC per section 7b.
- Added AC-17101-4, AC-17102-4, AC-17103-4 and AC-17105-4 (loading indicator clears, announced error region replaces the pending state, last successful rows retained) covering the 2026-09-08 review finding F-1 on TAC-1802.internalStructure for sort, filter, pagination and URL-state page requests that reject.


## 1.0.0 (visual round, spec 2026-09-04)

- First ratified version of the shelf's datatable blueprint. Six REQs (table shell, sort semantics, filter chrome, selection and bulk actions, empty / loading / error / no-results states, column visibility / reorder / resize), nine USs binding 27 runtime-observable ACs, three TACs (shell, query adapter, selection model), four ADRs (pattern choice, URL state, page size, selection persistence). No new global topics.
- Ships `probe-packs/application-datatable.pack.mjs`: six browser-verify checks anchored to AC-17101-1, AC-17102-1, AC-17103-2, AC-17104-3, AC-17105-1, AC-17106-1. First blueprint on the shelf that ships a Playwright probe pack under the runner extension.
- Ships a sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-datatable/` (dependency-free Node HTTP server) so the pack can be probed at the shelf's own gate; the fixture is the golden the gate reviewer drives.
- Suggests the `logging` and `errorHandling` companions with the ratified spec's reasons.
