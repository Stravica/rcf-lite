# application-onboarding-tour guide

Operator-facing guide to the onboarding-tour blueprint. Reach for it when your project wants a keyboard-accessible product tour with a first-run checklist that composes on the surfaces you already have, and where the completion state honestly persists.

## When to reach for this blueprint

- You have a first-run onboarding narrative that fits 3 to 5 steps and every step anchors on a live element in your DOM.
- You want the tour to honour WCAG 2.2 AA keyboard rules (2.1.1 Keyboard, 2.1.2 No Keyboard Trap, 2.4.3 Focus Order, 2.4.11 Focus Not Obscured Minimum) and the ARIA APG dialog-modal pattern out of the box, without a hand-rolled tooltip library.
- You want a checklist surface that meets returning principals where they are (on the dashboard when the dashboard blueprint is applied, on the settings surface when it is not) and does not intrude when the tour is done.
- You want a documented restart-tour affordance without inventing the persistence flow.

## When NOT to reach for this blueprint

- You need a multi-hour interactive product simulation. This blueprint contributes an onboarding contract, not a training platform.
- Your tour has more than five steps per surface. Refactor into multiple applied tours (one per surface family) rather than one long tour.
- You need per-org customisation of the tour content at runtime. The blueprint contributes the WHAT; the elicited `per-step-content-voice` is a project-owned string, not a per-tenant surface.

## Standards trace

- ARIA APG dialog-modal pattern (`https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/`): the tooltip is a modal dialog with `role="dialog"`, `aria-labelledby` to the step heading, `aria-describedby` to the step body, focus into the tooltip on open and back to the anchor on close.
- WCAG 2.2 AA 2.1.1 Keyboard (`https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html`): every tour control activatable with the keyboard.
- WCAG 2.2 AA 2.1.2 No Keyboard Trap (`https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html`): Escape always exits; focus never permanently trapped.
- WCAG 2.2 AA 2.4.3 Focus Order (`https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html`): Tab reaches every tour control in DOM order inside the tooltip.
- WCAG 2.2 AA 2.4.11 Focus Not Obscured Minimum (`https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html`): the tooltip is visible at the 1440 wide and 360 narrow breakpoints (probed via `browser.resize`).

## Q4 fallback

When no persistence blueprint is applied AND the operator does not answer `completion-state-store` explicitly, the store defaults to `spa-local-storage` per Q4 of the ratified spec. A per-session tour that re-plays on every new session is worse than a one-time tour that persists across sessions on that browser; the elicit surface offers all three shapes for a deliberate override.

## Mechanism-reach gaps

- `AC-26105-1` first-run detection: manual verification via the fixture README boot line (open `/tour` twice, confirm the tour auto-opens on run 1 and does not on run 2).
- `AC-26107-1` screen-reader traversal: the pack asserts the DOM contract; the manual VoiceOver smoke is in the fixture README.

Both gaps ride runner cleanup `w-2026-09-04-dave-020`.

## Compose targets

The tour reaches these applied blueprints with the effect named in the README's composition table. None is a hard dependency; every unapplied target has a documented fallback.

- `application-spa` (routing, iconography, theming).
- `application-dashboard` (dashboard-top checklist anchor; fallback `settings-page`).
- `application-notifications-in-app` (polite `aria-live` announce on completion; fallback silent at announce layer).
- `application-account-settings` (restart-tour control home; fallback any settings-shaped surface).
- Any `security-auth-*` (per-principal completion state; fallback per-browser bare namespace).

## Apply

```
rcf define blueprint add <path-to>/blueprints/application-onboarding-tour
```

## Verify

```
rcf verify browser <fbs-id> --url <runtime-url> --probe-pack application-onboarding-tour --json
```

Runs the four checks against the shipped fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-onboarding-tour/`. See the fixture README for the four break-switch runs the gate reviewer walks manually.
