# application-datatable CHANGELOG

## 1.0.1 (B6a application core hardening, 2026-09-09)

- B6a hardening pass: chain-consistency lint zero (pass1 + pass2 already clean at baseline); added deliveredBy to every REQ, added ownerRef and disposition to every AC per section 7b.
- Added AC-17101-4, AC-17102-4, AC-17103-4 and AC-17105-4 (loading indicator clears, announced error region replaces the pending state, last successful rows retained) covering the 2026-09-08 review finding F-1 on TAC-1802.internalStructure for sort, filter, pagination and URL-state page requests that reject.


## 1.0.0 (visual round T-1, spec 2026-09-04)

- First ratified version of the shelf's datatable blueprint. Six REQs (table shell, sort semantics, filter chrome, selection and bulk actions, empty / loading / error / no-results states, column visibility / reorder / resize), nine USs binding 27 runtime-observable ACs, three TACs (shell, query adapter, selection model), four ADRs (pattern choice, URL state, page size, selection persistence). No new global topics.
- Ships `probe-packs/application-datatable.pack.mjs`: six browser-verify checks anchored to AC-17101-1, AC-17102-1, AC-17103-2, AC-17104-3, AC-17105-1, AC-17106-1. First blueprint on the shelf that ships a Playwright probe pack under the T-0 runner extension.
- Ships a sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-datatable/` (dependency-free Node HTTP server) so the pack can be probed at the shelf's own gate; the fixture is the golden the gate reviewer drives.
- Suggests the `logging` and `errorHandling` companions with the ratified spec's reasons.
