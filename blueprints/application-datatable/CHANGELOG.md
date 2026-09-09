# application-datatable CHANGELOG

## 1.0.2 (B6a application core completion pass, 2026-09-09)

- Adds top-level elicits[] block on blueprint.json declaring the four apply-time answers (query-adapter-mode, url-state-strategy, page-size, selection-persistence); each option value backed by a must REQ description with a runtime clause per section 7c. REQ-001 gains a page-size 25 default clause; REQ-002 gains url-query / session-scoped URL-state clause; REQ-004 gains per-page / cross-page selection-persistence clause. capabilities[] not declared: leaf blueprint (no consumer requiresAppliedCapabilities on the shelf references a datatable capability).
- Adds refusal-path ACs to US-17104 (bulk-action max-cap refusal, dialog Cancel focus return, focus trap), US-17106 (drag-only refusal, hidden-column orphan cells, hidden column with active sort/filter), US-17107 (read-only role=grid refusal, role=grid arrow navigation, mixed-interactive shell pattern), US-17108 (session-scoped no-URL contract, invalid-URL rejection, history.replaceState per micro-change), US-17109 (dialog aria-describedby total count, filter narrows presentation not selection, Clear selection control). Every story now at the 7a floor (4-6 ACs per story, 46 ACs total on the blueprint).

## 1.0.1 (B6a application core hardening, 2026-09-09)

- B6a hardening pass: chain-consistency lint zero (pass1 + pass2 already clean at baseline); added deliveredBy to every REQ, added ownerRef and disposition to every AC per section 7b.
- Added AC-17101-4, AC-17102-4, AC-17103-4 and AC-17105-4 (loading indicator clears, announced error region replaces the pending state, last successful rows retained) covering the 2026-09-08 review finding F-1 on TAC-1802.internalStructure for sort, filter, pagination and URL-state page requests that reject.


## 1.0.0 (visual round T-1, spec 2026-09-04)

- First ratified version of the shelf's datatable blueprint. Six REQs (table shell, sort semantics, filter chrome, selection and bulk actions, empty / loading / error / no-results states, column visibility / reorder / resize), nine USs binding 27 runtime-observable ACs, three TACs (shell, query adapter, selection model), four ADRs (pattern choice, URL state, page size, selection persistence). No new global topics.
- Ships `probe-packs/application-datatable.pack.mjs`: six browser-verify checks anchored to AC-17101-1, AC-17102-1, AC-17103-2, AC-17104-3, AC-17105-1, AC-17106-1. First blueprint on the shelf that ships a Playwright probe pack under the T-0 runner extension.
- Ships a sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-datatable/` (dependency-free Node HTTP server) so the pack can be probed at the shelf's own gate; the fixture is the golden the gate reviewer drives.
- Suggests the `logging` and `errorHandling` companions with the ratified spec's reasons.
