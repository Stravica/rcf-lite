# application-onboarding-tour CHANGELOG

## 1.1.3 - 2026-09-11

- Added a criterion-e probe pack (`contributions/probes/`) covering 4 properties the fixture engine at `packages/rcf-lite/test/fixtures/probe-pack-application-onboarding-tour/server.js` answers: `first-run-detection`, `stepper-role-dialog`, `checklist-anchor-open`, `completion-persistence`. Every response now carries an `x-fixture-request-id` header; probes record the id, the HTTP status and a body excerpt as positive evidence per rule 7d. Fixture README declares every env var the pack reads. Anatomy test at `packages/rcf-lite/test/blueprint/application-onboarding-tour-anatomy.test.js` pins the new pack files and asserts each result carries one of the four 7d evidence shapes.


## 1.1.2 (2026-09-10)

### Changed

- AC-26109-1 requires `<details open>` per ADR-2703 and references the ADR via ownerRef.
- ADR-2702 refusal-only decision: `server-side-per-principal` without an applied persistence blueprint refuses with `COMPLETION_STORE_MISSING_PROVIDER` and never falls back; TAC-2703 aligned.
- AC-26108-4 references `TAC-2703.interfaces.completionStore` via ownerRef; drops the principalId/tourVersion/dismissedAt restatement.
- AC-26104-2 names `server-side-per-principal` inline and its refusal `COMPLETION_STORE_MISSING_PROVIDER`.
- REQ-002.deliveredBy retargeted to `TAC-2701.interfaces.renderTourRunner`.
- Vendor citations on AC-26101-1 (WCAG keyboard) and AC-26102-1 (ARIA APG dialog-modal); AC-26102-2 URL naming tidied.

## 1.1.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.1.0 (2026-09-10, hardening pass)

### Added

- REQ-005 (dismissal-policy option coverage) and US-26108: dismiss-permanently, dismiss-until-next-major and dismiss-until-next-minor each carry a runtime clause tied to the completion store record shape. This is the section 7c worked example landed as written. Closes review finding [application-onboarding-tour] F-1.
- REQ-006 (checklist-anchor option coverage) and US-26109: dashboard-top, settings-page and custom-anchor each mount at a resolved slot with a defined default open state; custom-anchor falls back to the settings route on an unresolved/invisible/clipped selector with data-error=CHECKLIST_ANCHOR_UNRESOLVED. Closes review finding [application-onboarding-tour] F-2.
- Failure-path acceptance criteria on US-26101 (unresolved and clipped anchors, out-of-range step count), US-26102 (dialog-modal role/aria and focus trap with WCAG citation), US-26103 (settings-route fallback), US-26104 (missing-provider refusal, failed write and failed read on the completion store), US-26105 (unparseable completion record), US-26106 (failed clear on restart), US-26107 (polite live-region close announcement). Closes findings F-3 and F-4.
- Vendor citations on the ARIA APG dialog-modal, focus-trap and WCAG live-region acceptance criteria (verified 2026-09-10).

### Changed

- Every REQ now carries a deliveredBy link into TAC-2701 (step-runner), TAC-2702 (checklist-slot) or TAC-2703 (completion-store).
- Every AC on every user story now carries an explicit disposition (fixed or template).
- TAC-2702 responsibilities extended with resolveAnchor so REQ-006 delivery resolves.
- Review fix pass (2026-09-10): REQ-001 extended with runtime clauses naming the three string elicits `tour-step-manifest`, `anchor-selectors` and `per-step-content-voice` and their refusal branches; US-26101 gained three template ACs (AC-26101-5, AC-26101-6, AC-26101-7) each carrying an `Applying agent sets: <elicit-id>.` clause; README, guide and CHANGELOG register scrubbed (no work-item ids). Closes review-fix-pass findings F-3, O-4.

## 1.0.0 (visual round, spec 2026-09-06 section 5.5)

- First shipped version. Introduces the tour step runner (ARIA APG dialog-modal per step, focus lifecycle, `role="dialog"`, `aria-labelledby`, `aria-describedby`, keyboard trap inside the tooltip with Escape as the exit, focus-not-obscured at 1440 and 360 breakpoints via `browser.resize`), the checklist slot (dashboard-top open collapse on `application-dashboard` applied; settings-page closed collapse when not; `<details>` browser-native for keyboard-native keyboard behaviour and screen-reader-native semantics), and the completion-state store contract (three backend shapes selected at apply time from the elicited answer or the Q4 fallback `spa-local-storage` when no persistence blueprint is applied).
- Ships six elicits: `tour-step-manifest`, `anchor-selectors`, `per-step-content-voice` (all project-owned strings the blueprint contributes the WHAT for), `dismissal-policy` (default `dismiss-permanently`), `completion-state-store` (default `spa-local-storage` per Q4), `checklist-anchor` (default derived at apply time from the applied-blueprint set).
- Ships a Playwright probe pack under `probe-packs/application-onboarding-tour.pack.mjs` with four surface-observable checks anchored to `AC-26101-1` (step-container focus and Escape), `AC-26102-1` (tooltip-as-dialog contract at two breakpoints), `AC-26103-1` (checklist-slot on both dashboard-top and settings-page anchors), and `AC-26104-1` (completion-state persistence and restart-tour re-open).
- Ships a dependency-free sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-onboarding-tour/` realising the tour surface honestly across both checklist branches and multiple completion-store shapes, plus four break switches (`?break=no-role`, `?break=focus-escape`, `?break=no-collapse`, `?break=no-persist`) driving the negative runs.
- Composes on `application-spa` (routing and iconography), `application-dashboard` (dashboard-top anchor slot; settings-page fallback), `application-notifications-in-app` (polite `aria-live` completion announce), `application-account-settings` (restart-tour control home; any settings-shaped surface as fallback), and any `security-auth-*` blueprint (per-principal completion state; per-browser under a bare namespace as fallback).
- Q4 default: when no persistence blueprint is applied AND the operator does not answer `completion-state-store`, the store defaults to `spa-local-storage`. Rationale in ADR-2702 and the README's Q4 fallback section.
- Two documented mechanism-reach gaps: `AC-26105-1` first-run detection is fixture-verified via the manual boot line; `AC-26107-1` screen-reader traversal is asserted at the DOM contract level and verified manually via the fixture READMEs VoiceOver smoke.
- No new global topics claimed. Extends the section 5 shelf id band registry with `application-onboarding-tour` at 26101 to 26899 (US) and 27xx (ADR/TAC).
