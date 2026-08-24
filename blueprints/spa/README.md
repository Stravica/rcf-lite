# SPA blueprint (v1.2.0)

The first content blueprint on the rcf-build-lite blueprint mechanism (design brief v2, ratified; Phase 2 of the blueprint programme). Scope: single-page applications with public and authenticated surfaces, session-based auth, single deployable, dark and light by default, fully responsive by default.

## Apply

```
rcf blueprint add <path-to>/blueprints/spa
```

Phase 1 resolves local path sources only; registry and git-ref resolution is a mechanism follow-up. Apply is idempotent; `rcf blueprint list` shows the applied entry; `rcf blueprint remove spa` cleanly removes an unreferenced application.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version, and the 70 contributions with scope/topic on the five global ADRs |
| Doc set | `contributions/` | 21 REQs, 31 USs (181 ACs), 9 TACs, 9 ADRs, all schema-valid against rcf-schemas 0.4.4 and namespaced (`spa-REQ-001` prefix family; `ADR-201-spa-routing` suffix family) |
| Design tokens | `assets/tokens/design-tokens.json` | Colour (both themes, contrast-validated), spacing, radius, typography, elevation, motion, breakpoints |
| Stylesheet | `assets/tokens/theme.css` | The tokens realised as CSS custom properties with the theme-switch, focus, and reduced-motion machinery |
| Wireframes | `assets/wireframes/` | Nine canonical surfaces: dashboard, list, detail, form, empty, error, sign-in, sign-out, session-expired |
| Component specs | `assets/component-specs/` | Behaviour contracts for the full spa-REQ-006 component inventory |
| Viewport table | `assets/viewports.md` | The ratified 360/768/1024/1440 baseline and per-breakpoint layout rules |
| Sample data | `assets/sample-data/` | Neutral entities for skeletons, wireframe realisation, and state demos |
| Guide | `guide/spa.md` | Operator-facing: when to use it, when not, what stays your call |
| Coordination vocabulary | `docs/topics.md` | Exact global-topic strings and id number bands for composing blueprints |

The doc set is contributions (copied into the project tree by `rcf blueprint add`); the guide, assets, and docs are package-resident references. Guide rendering into `rcf/knowledge/docs/blueprint-guides/` and asset ingestion are mechanism follow-ups; until they land, the working agent reads them from the applied blueprint's source path recorded in `manifest.blueprints[].source`.

## What it contributes, and what it deliberately does not

Contributed kinds: REQ, US (with inline ACs), TAC, ADR. Adherence is expressed as ACs; the blueprint ships no test files (ratified decision 5) and no code.

No FBS contributions, as a matter of principle (ratified policy 2026-08-19): FBSs are the work of the implementing agent, not the blueprint; project constraints have to be applied at the time of creation. The blueprint contributes the WHAT; the implementing agent derives the HOW-tasks (FBS) in the host project, where the ACs contributed here get picked up by the project's own build sequencing. Structurally the same conclusion falls out of the mechanism: an FBS binds to a bsId and a buildOrder slot the blueprint cannot know.

## The five global decisions

ADR-201 clientRouting, ADR-202 theming, ADR-203 clientState, ADR-204 errorEnvelope, ADR-205 authModel ship `scope: global`. Composing with the REST blueprint deliberately conflicts on `errorEnvelope` and `authModel`; see `docs/topics.md` for the exact strings, the expected resolutions, and the AC id band allocation (SPA owns 1101-1899).

## Quality bar (ratified)

WCAG 2.2 AA (contrast 4.5:1 body / 3:1 large-and-non-text, visible focus, 24x24 targets, no traps), breakpoints 360/768/1024/1440 with zero horizontal overflow, dark/light token parity, modular type scale with 14/16px body floors, motion tokens honouring reduced motion, performance budget (FMP under 2s on 3G-fast, Lighthouse 90+, main-thread under 3s). Every bar is carried by ACs in the doc set, not by this README.

## What v1.1.0 adds

v1.1.0 is an additive-non-global minor bump. No global topics change; no contribution is removed. The bump introduces the mechanism-reach cure for the icon and semantic-token disciplines that watchpost run4 caught shipping while the build cycle ran green.

- `spa-US-1129` (anchored to spa-REQ-005) with four ACs binding the token-adherence probe.
- `spa-US-1130` (anchored to spa-REQ-011) with four ACs binding the icon-adherence probe.
- `TAC-207-spa-token-adherence-probe`: a Node build-scan probe the project realises; scans the built component-scope stylesheets for raw palette literals, diffs the light and dark token key sets for parity, writes a stable JSON report, and exits non-zero on any violation.
- `TAC-208-spa-icon-adherence-probe`: a Node build-scan probe the project realises; scans the component source for inline SVG outside the icon registry and for icon references naming aliases the registry does not declare, writes a stable JSON report, and exits non-zero on any violation.
- `ADR-202-spa-theming` and `ADR-206-spa-iconography` are amended in place at version 1.1.0: the decision is unchanged; the consequences narrative names the new probe and the ci-pipeline gate-failure path the probe rides.

The v1.1 probes are runtime-observable AC binding at the ship gate. When a project wires each probe as a required gate in the ci-pipeline runner (TAC-701), a violation refuses ship through TAC-702's per-gate report and TAC-703's aggregate report; the run4 pattern of a discipline declared but not compelled no longer applies to these two categories.

## Known mechanism-reach gaps

The blueprint declares a broader UI floor than v1.1 cures. The following categories still declare their discipline through the AC layer but have no blueprint-side runtime-observable probe; a project inherits them as project-side ownership until a future minor bump (v1.2.0 or beyond) adds probes.

- **Component-library baseline (spa-REQ-006, US-1111 and peers).** The component-library discipline (cards, tables, tabs, pagination, forms) is declared through ACs anchored to TAC-203-spa-component-library. A project ships components without a blueprint-side probe checking that shipped components realise the discipline; project-side TCs bind the ACs to the runtime surface, and `rcf coverage --strict` refuses ship when a component AC is uncovered. Blueprint-side probe candidate for v1.2.0.
- **Responsive baseline (spa-REQ-004, US-1105).** The 360/768/1024/1440 no-horizontal-overflow discipline is declared through ACs; there is no blueprint-side probe that renders every route at every baseline and reports overflow. `rcf browser-verify` covers a subset when the project wires the uiBaseline pack; the mechanism-reach question of which routes the pack visits is project-owned.
- **Motion and reduced-motion (spa-REQ-012, US-1112).** Reduced-motion respect is declared through ACs; no blueprint-side probe inspects the built stylesheet output for animation declarations that ignore `prefers-reduced-motion`.

These gaps are the honest v1.1 residual. The icon and token cures demonstrate the shape a v1.2.0 sweep would take for the remaining categories: name the runtime-observable surface, ship a Node probe TAC, add a low-band US with runtime-observable ACs binding the TAC, amend the anchor ADR to name the probe in its consequences narrative.
