# SPA blueprint (v1.0.0)

The first content blueprint on the rcf-build-lite blueprint mechanism (design brief v2, ratified; Phase 2 of the blueprint programme). Scope: single-page applications with public and authenticated surfaces, session-based auth, single deployable, dark and light by default, fully responsive by default.

## Apply

```
rcf blueprint add <path-to>/blueprints/spa
```

Phase 1 resolves local path sources only; registry and git-ref resolution is a mechanism follow-up. Apply is idempotent; `rcf blueprint list` shows the applied entry; `rcf blueprint remove spa` cleanly removes an unreferenced application.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version, and the 64 contributions with scope/topic on the five global ADRs |
| Doc set | `contributions/` | 21 REQs, 28 USs (167 ACs), 6 TACs, 9 ADRs, all schema-valid against rcf-schemas 0.4.4 and namespaced (`spa-REQ-001` prefix family; `ADR-201-spa-routing` suffix family) |
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
