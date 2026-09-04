# application-charts CHANGELOG

## 1.0.0 (visual round T-2, spec 2026-09-04)

- First ratified version of the shelf's charts blueprint. Four REQs (chart form set, non-colour distinction, text-alternative table, keyboard traversal), six USs binding runtime-observable ACs, two TACs (render shell, keyboard traversal), three ADRs (elicited chart engine with canvas-only refusal, accessible palette light and dark, reduced motion via application-spa tokens). No new global topics.
- Ships `probe-packs/application-charts.pack.mjs`: three browser-verify checks anchored to AC-18102-1 (non-colour distinction), AC-18103-1 (text-alternative table with cell-per-value contract), AC-18104-1 (keyboard traversal contract with reduced-motion suppression). Every check carries a description field per spec section 9. Second blueprint on the shelf that ships a Playwright probe pack under the T-0 runner extension; first leaf blueprint the T-3 application-dashboard consumes.
- Ships a sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-charts/` (dependency-free Node HTTP server) so the pack can be probed at the shelf's own gate; the fixture is the golden the gate reviewer drives, with `?break=table`, `?break=pattern` and `?break=keyboard` query switches for the negative runs.
- Suggests the `logging` and `errorHandling` companions with the ratified spec's reasons.

### Patch note (2026-09-04, T-3 gate follow-up)

- `probe-packs/application-charts.pack.mjs`: navigate with `new URL('', runtimeUrl).toString()` instead of `runtimeUrl + '/'` on the three goto call sites (AC-18102-1, AC-18103-1, AC-18104-1). The concat form stripped a reviewer-supplied `?break=<mode>` from a CLI `--url`; the URL-resolver form preserves the runtime URL verbatim so a reviewer pointing the CLI at `?break=<mode>` sees the negative run naturally. Version stays at 1.0.0; behaviour unchanged on the default apply-side runtime URL.
