# application-account-settings CHANGELOG

## 1.2.0 (2026-09-10)

### Added

- REQ-009: custom-auth-provides-* runtime clauses covering the four boolean elicits with a per-token clause on the applied capability union.
- Vendor citations on AC-25101-1 (APG tabs), AC-25102-3 (WCAG 1.3.5), AC-25105-2 (APG dialog) and AC-25108-2 (APG radio).

### Changed

- ADR-2604.decision references `blueprint.json.elicits[id=reauth-window].options` (never|5|15|60) via ownerRef.
- TAC-2604.tradeoffs references the manifest's `reauth-window` default (`15`) via ownerRef; `sessionRecord` shape references the session-verifier owner (`TAC-1003-security-auth-clerk-session-verifier.interfaces.sessionInventory`) via ownerRef.
- REQ-003.deliveredBy retargeted to `TAC-2603.interfaces.renderSecuritySurface`.
- REQ-006.deliveredBy retargeted to `TAC-2601.responsibilities.renderThemeSurface` (new responsibility carrying the theme-persistence clauses).

## 1.1.0 (2026-09-10, hardening pass B6b)

### Added

- REQ-007 (reauth-window option coverage) and US-25111: never, 5, 15 and 60 each carry a defined runtime clause tied to the applied auth providers session inventory (owner TAC-1003-security-auth-clerk-session-verifier interfaces.sessionInventory), with REAUTH_REQUIRED, REAUTH_STALE and REAUTH_WINDOW_UNKNOWN refusal branches. Closes review finding [application-account-settings] F-1.
- Failure-path acceptance criteria on US-25101 (unauthenticated /account routes to the T-1 forbidden state with sign-in link and no profile data), US-25105 (inventory read failure, terminate write failure, current-session protection). Closes findings F-2 and F-3.

### Changed

- sessionInventory prose corrected across README (provider table row and companion paragraph), blueprint.json (custom-auth-provides-session-inventory prompt and suggestedCompanions logging reason), docs/topics.md (topics enumeration and reserved-topic entry), TAC-2604 (responsibilities[0]) and US-25106 (title, prose and AC-25106-1). observability-logging 1.3.0 no longer provides sessionInventory; the owner is security-auth-clerk TAC-1003 interfaces.sessionInventory and equivalent TACs on other auth blueprints. requiresAppliedCapabilities remains [principalDirectory]. Closes routed finding F-5 from the B4 review.
- Every REQ now carries a deliveredBy link into TAC-2601, TAC-2603 or TAC-2604.
- Every AC on every user story now carries an explicit disposition (fixed or template); ACs that observe a session-inventory row carry ownerRef into TAC-1003.
- TAC-2601 responsibilities extended with renderProfileSurface, renderPreferencesSurface and renderCorrelationId; TAC-2604 extended with reauthWindowGate and sessionInventoryConsumer.
- Review fix pass (2026-09-10): elicit-token coverage tightened on REQ-003 to name `self-service`, `hosted-link-out` and `hosted-embed` literally alongside the branch prose; principalDirectory named literally in REQ-001; template ACs on US-25104, US-25108 and US-25101 carry an `Applying agent sets: <elicit-id>.` clause; anatomy test name at TC-056-shelf-doc-consistency renamed to say observability-logging drops sessionInventory; README register scrubbed (no operator names). Closes review-fix-pass findings F-1, F-2, O-1.

## 1.0.0 (visual round T-4, spec 2026-09-06 section 5.4)

- First shipped version. Introduces the account-settings shell (ARIA APG tabs, WCAG 2.4.6 landmark), the profile surface (WCAG 1.3.5 autocomplete tokens, aria-live save-status), the security surface (self-service branch and hosted-UI branch through ADR-2602's elicited security-surface-shape), the sessions surface (ARIA APG dialog-modal terminate flow, aria-live session-terminated announcement, current-session cannot terminate itself), the notification-preferences surface (per-category silence, per-channel opt-in) and the theme surface (light/dark/system radiogroup persisted per ADR-2603's elicited theme-persistence).
- Declares `requiresAppliedCapabilities: [principalDirectory]` with `refusalMessageId: application-account-settings-bare-spa` and `allowSkipFlag: allow-no-auth-yet`. The refusal template ships in this PR's mechanism minor at `packages/rcf-lite/src/blueprint/capabilities.js` (`buildRefusalMessage`). The Q3 gate (a project declaring neither `credentialSelfService` nor `hostedIdentityUi`) is enforced through the shell's tab-suppression rule (AC-25101-1 probed by the pack), the mechanism's silent gating of the `security-surface-shape` elicit (its `when` predicate refuses), and the surface-side hosted-UI bridge TAC-2603 refusal (documented mechanism-reach gap under AC-25110-1).
- Ships four capability-gated custom-auth elicits (`custom-auth-provides-principal-directory`, `custom-auth-provides-credential-self-service`, `custom-auth-provides-session-inventory`, `custom-auth-provides-hosted-identity-ui`) that let a project ship its own auth surface without a shelf `security-auth-*` blueprint.
- Ships four regular elicits (`security-surface-shape`, `hosted-identity-url`, `theme-persistence`, `reauth-window`) whose `when` predicates gate on the applied capability set.
- Ships a Playwright probe pack under `probe-packs/application-account-settings.pack.mjs` with five checks anchored to `AC-25101-1` (shell tabs mirror caps), `AC-25102-1` (profile autocomplete tokens), `AC-25105-1` (security branch matches applied + elicit), `AC-25106-1` (sessions rows and dialog-modal) and `AC-25108-1` (theme radiogroup and persistence). Every check gates via `readAppliedCapabilities(projectRoot)`; an absent capability records `verdict: skipped` per spec section 3.3.
- Ships a dependency-free sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-account-settings/` realising the five conditional surfaces honestly plus four break switches (`?break=leak-tab`, `?break=no-autocomplete`, `?break=no-dialog`, `?break=no-persist`) driving the negative runs.
- Composes on `application-empty-error-states` (T-1) for the forbidden and empty-history states; no bespoke access-denied UI is invented here.
- Rides with the auth blueprints minor bumps (`security-auth-clerk` 1.3.0, `security-auth-keycloak` 1.2.0, `security-auth-oauth2` 1.2.0, `security-auth-magic-link` 1.2.0 doc-only) and the `observability-logging` 1.2.0 minor bump (declares `sessionInventory` as the logging-projection provider), extending the section 6a capability table with `credentialSelfService`, `sessionInventory` and `hostedIdentityUi`.
