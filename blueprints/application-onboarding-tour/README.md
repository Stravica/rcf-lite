# Onboarding-tour blueprint (v1.0.0)

Vendor-neutral onboarding-tour surface for an rcf-lite application. Composes on the SPA, dashboard, notifications-in-app, account-settings and any auth blueprint the project has applied, without a hard dependency on any of them: where a compose target is present the tour uses it, where it is not the tour uses the documented fallback per Q4. Ships a tour step runner mounted as an ARIA APG dialog-modal per step, a first-run checklist that renders on the dashboard shell when `application-dashboard` is applied and collapses to the settings page when not, a completion-state store with three backend shapes, and a restart-tour affordance on the settings surface. Ships a Playwright probe pack under `probe-packs/application-onboarding-tour.pack.mjs` whose four checks drive the real browser against a dependency-free sample-app fixture.

## Apply

```
rcf define blueprint add <path-to>/blueprints/application-onboarding-tour
```

No `requiresAppliedCapabilities`: T-5 has no hard dependency, and the compose targets (SPA, dashboard, notifications-in-app, account-settings, any auth) are all optional. Prompts the elicitation phase for six parameters: the step manifest (3 to 5 steps with per-step anchor and content), the anchor selectors, the per-step content voice, the dismissal policy (default `dismiss-permanently`), the completion-state store shape (default `spa-local-storage`, the Q4 fallback), and the checklist anchor slot (default derived at apply time from what is applied). Writes a sidecar `rcf/blueprints/application-onboarding-tour.applied.json` capturing the answered elicits and the discovered `appliedBlueprints[]` (dashboard, notifications-in-app, account-settings, spa presence). Consumes the `logging` and `errorHandling` companions when they resolve to an applied provider or a registered library.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version 1.0.0, category `application`, no `requiresAppliedCapabilities`, six elicits, `suggestedCompanions: [logging, errorHandling]`, 17 contributions in the 26xxx / 27xx bands |
| Doc set | `contributions/` | 4 REQs, 7 USs (7 runtime-observable ACs; two documented mechanism-reach gaps on AC-26105-1 and AC-26107-1), 3 TACs, 3 ADRs |
| Probe pack | `probe-packs/application-onboarding-tour.pack.mjs` | Four surface-observable browser-verify checks anchored to AC-26101-1 step-container focus, AC-26102-1 tooltip-as-dialog, AC-26103-1 checklist-slot, AC-26104-1 completion-state persistence |
| Guide | `guide/application-onboarding-tour.md` | Operator-facing: when to reach, when not, mechanism-reach gaps, ARIA APG dialog-modal pattern and WCAG SCs the tour honours |
| Coordination vocabulary | `docs/topics.md` | Shelf id band registry update; no new global topics claimed; cross-references to `application-dashboard`, `application-notifications-in-app`, `application-account-settings`, `application-spa` |
| Sample-app fixture | `packages/rcf-lite/test/fixtures/probe-pack-application-onboarding-tour/` | Dependency-free Node HTTP server the pack is probed against on the shelf gate |

## Composition: what the tour reaches when

| Applied blueprint | Effect on the tour |
|---|---|
| `application-spa` applied | Routing (`/tour`, `/dashboard`, `/settings`), iconography, theming carry through. Absent: the tour still renders but the project supplies the routing shell. |
| `application-dashboard` applied | Checklist anchor defaults to `dashboard-top` inside a `<details open>` element on the dashboard shell. Absent: checklist anchor defaults to `settings-page` inside a `<details>` (closed) element on the settings surface, per ADR-2703 and AC-26103-1. |
| `application-notifications-in-app` applied | Tour completion emits a polite `aria-live` announcement through the notifications-in-app live region. Absent: the completion is silent at the announce layer (the step runner still logs one line if a `logging` companion resolves). |
| `application-account-settings` applied | Restart-tour control lives inside the account settings surface. Absent: the restart-tour control renders on any settings-shaped surface the project supplies (`/settings`, `/account`, `/account/settings`). |
| Any `security-auth-*` applied | Completion state persists per principal identifier (the sidecar carries the principal namespace at apply). Absent: completion state persists per browser under a bare namespace; the tour behaves as a single-principal experience. |

## Q4 fallback: completion-state store shape

Q4 of the ratified spec (section 10) settles the completion-state fallback. When no persistence blueprint is applied AND the operator does not answer `completion-state-store` explicitly, the store defaults to `spa-local-storage`: a per-browser record so a returning principal on the same browser is not re-onboarded, and a different browser is re-onboarded. Rationale: a per-session tour that re-plays on every new session is worse than a one-time tour that persists across sessions on that browser; per the elicit surface, the operator can override to `spa-session-storage` (per-session refresh) or `server-side-per-principal` (cross-device; requires an applied persistence blueprint).

## Standards trace

- ARIA APG dialog-modal pattern: `role="dialog"`, `aria-labelledby` on the step heading, `aria-describedby` on the step body, focus moves to the tooltip on open, focus returns to the anchor on close. `AC-26102-1`, `AC-26107-1`.
- WCAG 2.2 AA 2.1.1 Keyboard: every tour control activatable with the keyboard. `AC-26101-1`.
- WCAG 2.2 AA 2.1.2 No Keyboard Trap: Escape always exits, focus never permanently trapped. `AC-26101-1`.
- WCAG 2.2 AA 2.4.3 Focus Order: Tab reaches every tour control in DOM order inside the tooltip. `AC-26101-1`.
- WCAG 2.2 AA 2.4.11 Focus Not Obscured Minimum: tooltip visible at the 1440 wide and 360 narrow breakpoints (probed via `browser.resize`). `AC-26102-1`.

Spec `standardsTrace` empty at the blueprint level; each ADR contribution carries a non-null `standardsTraceClause` per authoring section 8a.4 (the sentinel `generic enterprise practice` used where no SC applies).

## Known mechanism-reach gaps

- `AC-26105-1` (first-run detection): the runner cannot fully prove the first-run vs returning-principal branch in one browser session without a persisted state seed; the pack drives the first-run branch via `?first-run=1` and the returning branch is verified by the fixture READMEs manual boot line (walk `/tour` twice, confirm the tour auto-opens on run 1 and does not on run 2).
- `AC-26107-1` (screen-reader traversal): the pack asserts the DOM contract (`aria-labelledby`, `aria-describedby`) but does not drive a real screen reader in CI. The fixture README names the manual VoiceOver smoke. Runner cleanup planned for a follow-up minor.
- `AC-26106-1` (restart-tour clears state and re-opens): fully exercised inside the AC-26104-1 pack check end-to-end (the check clicks restart, then navigates to `/tour` and asserts the tooltip re-appears).

## Elicited parameters

- `tour-step-manifest` (string; project-owned): the ordered list of 3 to 5 steps with per-step anchor, heading and body slot.
- `anchor-selectors` (string; project-owned): the CSS selectors the runner resolves at step-open time.
- `per-step-content-voice` (string; project-owned): the copy for each step.
- `dismissal-policy` (enum: `dismiss-permanently` | `dismiss-until-next-major` | `dismiss-until-next-minor`; default `dismiss-permanently`).
- `completion-state-store` (enum: `spa-local-storage` | `spa-session-storage` | `server-side-per-principal`; default `spa-local-storage` per Q4).
- `checklist-anchor` (enum: `dashboard-top` | `settings-page` | `custom-anchor`; default derived at apply time from what is applied).

## Suggested companions

- `logging`: every step transition and tour completion writes one request-scoped log line with the correlation identifier.
- `errorHandling`: a completion-state persistence failure constructs an internal error record.

## Probe pack

`probe-packs/application-onboarding-tour.pack.mjs` ships four surface-observable checks anchored to blueprint AC ids:

- `AC-26101-1` step-container focus lifecycle and Escape.
- `AC-26102-1` tooltip-as-dialog contract at 1440 and 360 breakpoints (via `browser.resize`).
- `AC-26103-1` checklist slot on both dashboard-top (open) and settings-page (closed) branches.
- `AC-26104-1` completion-state persistence and restart-tour re-open.

The pack applies to any FBS binding `TAC-2701-application-onboarding-tour-step-runner` or whose `navModel` routes match the operator-configured tour-anchor path glob (`/tour`, `/welcome`, `/getting-started`, `/onboarding`). Every URL string is composed through the `withUrl(runtimeUrl, path)` helper (no bare string concatenation).
