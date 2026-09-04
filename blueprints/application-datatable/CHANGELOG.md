# application-datatable CHANGELOG

## 1.0.0 (visual round T-1, spec 2026-09-04)

- First ratified version of the shelf's datatable blueprint. Six REQs (table shell, sort semantics, filter chrome, selection and bulk actions, empty / loading / error / no-results states, column visibility / reorder / resize), nine USs binding 27 runtime-observable ACs, three TACs (shell, query adapter, selection model), four ADRs (pattern choice, URL state, page size, selection persistence). No new global topics.
- Ships `probe-packs/application-datatable.pack.mjs`: six browser-verify checks anchored to AC-17101-1, AC-17102-1, AC-17103-2, AC-17104-3, AC-17105-1, AC-17106-1. First blueprint on the shelf that ships a Playwright probe pack under the T-0 runner extension.
- Ships a sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-datatable/` (dependency-free Node HTTP server) so the pack can be probed at the shelf's own gate; the fixture is the golden the gate reviewer drives.
- Suggests the `logging` and `errorHandling` companions with the ratified spec's reasons.
