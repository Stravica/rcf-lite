# application-spa blueprint (v1.3.0)

The first content blueprint on the rcf-build-lite blueprint mechanism (design brief v2, ratified; Phase 2 of the blueprint programme). Scope: single-page applications with public and authenticated surfaces, session-based auth, single deployable, dark and light by default, fully responsive by default.

## Apply

```
rcf define blueprint add <path-to>/blueprints/application-spa
```

Phase 1 resolves local path sources only; registry and git-ref resolution is a mechanism follow-up. Apply is idempotent; `rcf define blueprint list` shows the applied entry; `rcf define blueprint remove application-spa` cleanly removes an unreferenced application.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version, and the 74 contributions with scope/topic on the five global ADRs |
| Doc set | `contributions/` | 21 REQs, 33 USs (193 ACs), 11 TACs, 9 ADRs, all schema-valid against rcf-schemas 0.4.5 and namespaced (`application-spa-REQ-001` prefix family; `ADR-201-application-spa-routing` suffix family) |
| Design tokens | `assets/tokens/design-tokens.json` | Colour (both themes, contrast-validated), spacing, radius, typography, elevation, motion, breakpoints |
| Stylesheet | `assets/tokens/theme.css` | The tokens realised as CSS custom properties with the theme-switch, focus, and reduced-motion machinery |
| Wireframes | `assets/wireframes/` | Nine canonical surfaces: dashboard, list, detail, form, empty, error, sign-in, sign-out, session-expired |
| Component specs | `assets/component-specs/` | Behaviour contracts for the full application-spa-REQ-006 component inventory |
| Viewport table | `assets/viewports.md` | The ratified 360/768/1024/1440 baseline and per-breakpoint layout rules |
| Sample data | `assets/sample-data/` | Neutral entities for skeletons, wireframe realisation, and state demos |
| Guide | `guide/application-spa.md` | Operator-facing: when to use it, when not, what stays your call |
| Coordination vocabulary | `docs/topics.md` | Exact global-topic strings and id number bands for composing blueprints |

The doc set is contributions (copied into the project tree by `rcf define blueprint add`); the guide, assets, and docs are package-resident references. Guide rendering into `rcf/knowledge/docs/blueprint-guides/` and asset ingestion are mechanism follow-ups; until they land, the working agent reads them from the applied blueprint's source path recorded in `manifest.blueprints[].source`.

## What it contributes, and what it deliberately does not

Contributed kinds: REQ, US (with inline ACs), TAC, ADR. Adherence is expressed as ACs; the blueprint ships no test files (ratified decision 5) and no code.

No FBS contributions, as a matter of principle (ratified policy 2026-08-19): FBSs are the work of the implementing agent, not the blueprint; project constraints have to be applied at the time of creation. The blueprint contributes the WHAT; the implementing agent derives the HOW-tasks (FBS) in the host project, where the ACs contributed here get picked up by the project's own build sequencing. Structurally the same conclusion falls out of the mechanism: an FBS binds to a bsId and a buildOrder slot the blueprint cannot know.

## The five global decisions

ADR-201 clientRouting, ADR-202 theming, ADR-203 clientState, ADR-204 errorEnvelope, ADR-205 authModel ship `scope: global`. Composing with the application-api-rest blueprint deliberately conflicts on `errorEnvelope` and `authModel`; see `docs/topics.md` for the exact strings, the expected resolutions, and the AC id band allocation (application-spa owns 1101-1899).

## Quality bar (ratified)

WCAG 2.2 AA (contrast 4.5:1 body / 3:1 large-and-non-text, visible focus, 24x24 targets, no traps), breakpoints 360/768/1024/1440 with zero horizontal overflow, dark/light token parity, modular type scale with 14/16px body floors, motion tokens honouring reduced motion, performance budget (FMP under 2s on 3G-fast, Lighthouse 90+, main-thread under 3s). Every bar is carried by ACs in the doc set, not by this README.

## What v1.1.0 adds

v1.1.0 is an additive-non-global minor bump. No global topics change; no contribution is removed. The bump introduces the mechanism-reach cure for the icon and semantic-token disciplines that watchpost run4 caught shipping while the build cycle ran green.

- `application-spa-US-1129` (anchored to application-spa-REQ-005) with four ACs binding the token-adherence probe.
- `application-spa-US-1130` (anchored to application-spa-REQ-011) with four ACs binding the icon-adherence probe.
- `TAC-207-application-spa-token-adherence-probe`: a Node build-scan probe the project realises; scans the built component-scope stylesheets for raw palette literals, diffs the light and dark token key sets for parity, writes a stable JSON report, and exits non-zero on any violation.
- `TAC-208-application-spa-icon-adherence-probe`: a Node build-scan probe the project realises; scans the component source for inline SVG outside the icon registry and for icon references naming aliases the registry does not declare, writes a stable JSON report, and exits non-zero on any violation.
- `ADR-202-application-spa-theming` and `ADR-206-application-spa-iconography` are amended in place at version 1.1.0: the decision is unchanged; the consequences narrative names the new probe and the ci-pipeline gate-failure path the probe rides.

The v1.1 probes are runtime-observable AC binding at the ship gate. When a project wires each probe as a required gate in the ci-pipeline runner (TAC-701), a violation refuses ship through TAC-702's per-gate report and TAC-703's aggregate report; the run4 pattern of a discipline declared but not compelled no longer applies to these two categories.

## What v1.2.0 adds

v1.2.0 is an additive-non-global minor bump. No global topics change; no contribution is removed. The bump cures the styled-under-shipped-CSP mechanism-reach gap watchpost caught at first production review (w-2026-08-24-003, w-2026-08-24-004): FBS-011 declared strict CSP (`style-src 'self'`, no `'unsafe-inline'`), FBS-013/015 rendered inline `<style>` blocks, every existing UI-bearing gate passed, and every production page rendered unstyled at deploy because the harness bypassed the production security-header path.

- `application-spa-US-1131` (anchored to application-spa-REQ-018) with six ACs binding the styled-under-shipped-CSP probe.
- `TAC-209-application-spa-csp-styled-adherence-probe`: a Node probe the project realises; boots the target server through the production entry-point path, drives a real headless browser at every enumerated UI route, refuses on any inline `<style>` block, any style-src relaxation, any browser-default computed body background, or any non-200 text/css stylesheet response.
- The rcf-lite package gains a matching `noInlineStyleBlocks` block-severity invariant in `V1_INVARIANTS` (DOM-string arm of AC-1131-2 the browser-verify runner can enforce natively).

## What v1.3.0 adds

v1.3.0 is an additive-non-global minor bump. No global topics change; no contribution is removed. The bump cures the deployment-gate class defect the watchpost first-production review caught (w-2026-08-24-005, class cure w-2026-08-24-006): the app was signed off as DEPLOYED with the only login path (magic-link email) inert because RESEND_API_KEY carried a placeholder value, admin access was reachable only via manually minted tokens, and the gap was filed as a "quirk" note in status.md rather than blocked at gate time. A real key existed in the estate the whole time.

The bump encodes three class rules the deployment / handover gates now compel:

1. **External-service dependency provisioning.** Every external service the app calls at runtime is enumerated on a stable manifest; every credential field is checked against the canonical placeholder-shape detector; every `verified` dependency requires captured live-handshake evidence from the shipped runtime; every `deferred` dependency requires an operator-ratified persistent record (a README note or a status.md quirk line does NOT satisfy).
2. **Core-flow end-to-end.** Every core user flow is enumerated on a stable manifest; authentication is ALWAYS included when the app has a application-spa-REQ-009 surface; every flow executes end-to-end against the shipped runtime (production entry-point construction, production security headers, real external providers) driven by a real browser, with captured evidence per flow; a skipped, timed-out, or absent flow is a hard refusal.
3. **Sign-off vocabulary.** A run in which every core flow completes and every external dependency is verified-or-ratified-deferred lands at aggregate verdict `ok`. Any placeholder-shape credential, any missing handshake evidence, any unratified deferral, any core-flow fail-or-skip lands at aggregate verdict `deployed-with-defects`. A "documented workaround exists" does not convert a broken flow into `ok`; the aggregate verdict is what the ci-pipeline runner surfaces.

Contributions:

- `application-spa-US-1132` (anchored to application-spa-REQ-018) with six ACs binding the external-service-dependency provisioning probe.
- `application-spa-US-1133` (anchored to application-spa-REQ-008) with six ACs binding the core-flow end-to-end probe.
- `TAC-210-application-spa-external-dependency-provisioning-probe`: a Node probe the project realises; reads the external-service-dependency manifest, applies the canonical placeholder-shape detector to every credential field, replays a live handshake against the shipped runtime for every `verified` entry, and reads the ratified-deferrals store for every `deferred` entry. Writes `reports/external-dependency-provisioning.json`.
- `TAC-211-application-spa-core-flow-e2e-probe`: a Node probe the project realises; boots the target server through the production entry-point path, drives a real headless browser through every enumerated core flow against real external providers, and refuses on any fail/skip/absent flow. Writes `reports/core-flow-e2e-adherence.json`.
- The rcf-lite package gains a shared `detectPlaceholderCredentialShape` utility under `packages/rcf-lite/src/deployment/` that TAC-210 realisations import; extending the placeholder-shape ruleset is a rcf-lite minor bump, never a per-project fork.

## Known mechanism-reach gaps

The blueprint declares a broader UI floor than v1.1-v1.3 cures. The following categories still declare their discipline through the AC layer but have no blueprint-side runtime-observable probe; a project inherits them as project-side ownership until a future minor bump adds probes.

- **Component-library baseline (application-spa-REQ-006, US-1111 and peers).** The component-library discipline (cards, tables, tabs, pagination, forms) is declared through ACs anchored to TAC-203-application-spa-component-library. A project ships components without a blueprint-side probe checking that shipped components realise the discipline; project-side TCs bind the ACs to the runtime surface, and `rcf audit coverage --strict` refuses ship when a component AC is uncovered. Blueprint-side probe candidate for a future minor.
- **Responsive baseline (application-spa-REQ-004, US-1105).** The 360/768/1024/1440 no-horizontal-overflow discipline is declared through ACs; there is no blueprint-side probe that renders every route at every baseline and reports overflow. `rcf verify browser` covers a subset when the project wires the uiBaseline pack; the mechanism-reach question of which routes the pack visits is project-owned.
- **Motion and reduced-motion (application-spa-REQ-012, US-1112).** Reduced-motion respect is declared through ACs; no blueprint-side probe inspects the built stylesheet output for animation declarations that ignore `prefers-reduced-motion`.

These gaps are the honest residual. The icon, token, styled-under-CSP, external-dependency provisioning, and core-flow E2E cures demonstrate the shape a future sweep takes for the remaining categories: name the runtime-observable surface, ship a Node probe TAC, add a low-band US with runtime-observable ACs binding the TAC, amend the anchor ADR when the consequences narrative needs the probe named.
