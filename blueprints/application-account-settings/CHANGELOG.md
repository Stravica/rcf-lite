# application-account-settings CHANGELOG

## 1.2.6 - 2026-09-12

- Positive-evidence row shape tightened in the anatomy helper: a positive row now requires a non-empty engine-returned `requestId` AND (a non-empty `bodyExcerpt` OR a non-empty `derived` object); a `{derived:{}}` alone or a `requestId` alone no longer counts, with two new negative-case tests covering the empty-derived and id-only patterns. Fixture `?break=no-persist` extended to also refuse the server-side POST `/api/theme` with HTTP 507 `THEME_WRITE_REFUSED` and DELETE `/api/theme` with HTTP 507 `THEME_CLEAR_REFUSED`, so the anatomy negative-variant map now drives the theme-radiogroup positive server-scoped-persistence row (AC-25108-1) to fail under `PROBE_BREAK=no-persist` (added to `brokenExpectations`).

## 1.2.5 - 2026-09-12

- Rule-7d shape fix on the de-claimed conformance rows across shell-tablist (AC-25101-1), profile-form-autocomplete (AC-25102-1) and sessions-surface-shape (both AC-25105-1 branches): each row now carries `anchorAcId: null` and names the anchored AC in the `limitation` field per the shipped shape (a `conformanceOnly:true` row must not simultaneously claim an anchor). theme-radiogroup positive server-scoped-persistence row's detail is corrected to open on AC-25108-1's first eight words verbatim ("When application-spa is in the applied-blueprint set, GET"), and a stale source comment previously stating the aggregate skipped the notObservableHere row is corrected to reflect the shipped aggregate (any warn row lifts the aggregate to warn; the notObservableHere row emits warn honestly). Prior 1.2.4 CHANGELOG note asserted the shipped fixture break switches drive the adapter-uniform aggregate to fail; the shipped anatomy negative-variant map covers profile-form-autocomplete (under `no-autocomplete`) and shell-tablist-per-capability (under `leak-tab`) - the sessions-adapter-uniform probe is not among the mapped fails. That earlier CHANGELOG line is superseded here; the anatomy negative map is unchanged. Fixture README env-var manifest now declares `PROBE_BREAK` (the fixture reads it as an alternate to a per-request `?break=`) and the probe-utils `DECLARED_ENV` list mirrors the addition. Anatomy shape check tightened to reject an anchored `conformanceOnly` row (a positive evidence field no longer bypasses the null-anchor + limitation contract); a new negative-case test constructs an anchored `conformanceOnly` row and asserts the shape helper throws.

## 1.2.4 - 2026-09-11

- Shared `aggregate()` no longer promotes warn rows to pass: any row with verdict warn (including honest de-claim rows) lifts the aggregate to warn; a probe whose rows are all warn aggregates to warn, not pass. Shared teardown propagates a SIGKILL failure through the returned kill() promise instead of swallowing it. Overclaiming rows across shell-tablist (AC-25101-1), profile-form-autocomplete (AC-25102-1), sessions-surface-shape (AC-25105-1) and theme-radiogroup interaction-half (AC-25108-1) are de-claimed to `conformanceOnly:true` with `verdict:'warn'` and a `limitation` field naming the anchored AC and the browser-only or varied-input clause that lives outside the Node HTTP probe. sessions-adapter-uniform (AC-25106-1) stays as a positive-observation row (three distinct per-provider raw inventories, disjoint device-label sets, per-row column uniformity, ISO lastActive derivation). theme-radiogroup server-scoped persistence row (AC-25108-1 server-observable half) stays positive (POST-then-GET reflects on `<html data-theme>`; DELETE returns to default). Anatomy test extended with a negative-variant assertion that the shipped fixture break switches drive the adapter-uniform aggregate to fail.

## 1.2.3 - 2026-09-11

- sessions-adapter-uniform now proves the AC-25106-1 uniform-render contract against three DISTINCT per-provider raw inventories. Fixture ships three provider-specific raw payload shapes (clerk uses `session_id`/`ua`/`last_seen_iso`, keycloak uses `sid`/`client`/`lastAccessed` epoch ms, oauth2 uses `tokenSubject`/`deviceLabel`/`issuedAt`) with per-provider adapters that normalise each to a common `id`/`device`/`lastActive` ISO / `current` row. Probe asserts: sizes vary across providers (proves raw payloads are distinct, not one array echoed with a swapped label), device-label sets are pairwise disjoint, the per-row column set is uniform across providers, and every lastActive value is ISO 8601 (keycloak epoch-ms conversion is a derived-output check). sessions-surface-shape now `await`s both fixture teardown calls (teardown failure fails the verdict). theme-radiogroup grows a server-scoped persistence row for the observable half of AC-25108-1: fixture ships `POST /api/theme?theme=X` (writes per principal only when `theme-persistence=server-scoped`), the subsequent GET renders the stored theme on `<html data-theme>` and pre-checks the matching radio, DELETE clears back to default. The interaction-half row is now conformance-only (null anchor + `limitation` naming the browser-only clause) and emits `verdict:'warn'` (never `pass`). Anatomy test extended to enumerate the shipped AC/REQ id set and refuse any row whose anchor is not in it, and to accept the conformance-only row shape.

## 1.2.2 - 2026-09-11

- sessions-adapter-uniform earlier introduced a `?provider=<clerk|keycloak|oauth2>` query switch and a `<meta data-observed-provider="X">` marker inside `[data-surface="sessions"]`; that pass compared normalised subtrees to a reference for byte equality but the fixture served the same hard-coded rows regardless of provider, so the check was self-consistent rather than adapter-derived (superseded by 1.2.3 above). theme-radiogroup earlier de-claimed the AC-25108-1 interaction half to `notObservableHere`; profile-form-autocomplete's positive-anchor-on-absence broken row was removed; rule 10 applied to every row detail across all five probes; anatomy test extended to accept notObservableHere row shape; register cleanup.


## 1.2.1 - 2026-09-11

- Added a criterion-e probe pack (`contributions/probes/`) covering 5 properties the fixture engine at `packages/rcf-lite/test/fixtures/probe-pack-application-account-settings/server.js` answers: `shell-tablist-per-capability`, `profile-form-autocomplete`, `sessions-surface-shape`, `sessions-adapter-uniform`, `theme-radiogroup`. Every response now carries an `x-fixture-request-id` header; probes record the id, the HTTP status and a body excerpt as positive evidence per rule 7d. Fixture README declares every env var the pack reads. Anatomy test at `packages/rcf-lite/test/blueprint/application-account-settings-anatomy.test.js` pins the new pack files and asserts each result carries one of the four 7d evidence shapes.


## 1.2.0 (2026-09-10)

### Added

- REQ-009: custom-auth-provides-* runtime clauses covering the four boolean elicits with a per-token clause on the applied capability union.
- Vendor citations on AC-25101-1 (APG tabs), AC-25102-3 (WCAG 1.3.5), AC-25105-2 (APG dialog) and AC-25108-2 (APG radio).

### Changed

- ADR-2604.decision references `blueprint.json.elicits[id=reauth-window].options` (never|5|15|60) via ownerRef.
- TAC-2604.tradeoffs references the manifest's `reauth-window` default (`15`) via ownerRef; `sessionRecord` shape references the session-verifier owner (`TAC-1003-security-auth-clerk-session-verifier.interfaces.sessionInventory`) via ownerRef.
- REQ-003.deliveredBy retargeted to `TAC-2603.interfaces.renderSecuritySurface`.
- REQ-006.deliveredBy retargeted to `TAC-2601.responsibilities.renderThemeSurface` (new responsibility carrying the theme-persistence clauses).

## 1.1.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.1.0 (2026-09-10, hardening pass)

### Added

- REQ-007 (reauth-window option coverage) and US-25111: never, 5, 15 and 60 each carry a defined runtime clause tied to the applied auth providers session inventory (owner TAC-1003-security-auth-clerk-session-verifier interfaces.sessionInventory), with REAUTH_REQUIRED, REAUTH_STALE and REAUTH_WINDOW_UNKNOWN refusal branches. Closes review finding [application-account-settings] F-1.
- Failure-path acceptance criteria on US-25101 (unauthenticated /account routes to the forbidden state with sign-in link and no profile data), US-25105 (inventory read failure, terminate write failure, current-session protection). Closes findings F-2 and F-3.

### Changed

- sessionInventory prose corrected across README (provider table row and companion paragraph), blueprint.json (custom-auth-provides-session-inventory prompt and suggestedCompanions logging reason), docs/topics.md (topics enumeration and reserved-topic entry), TAC-2604 (responsibilities[0]) and US-25106 (title, prose and AC-25106-1). observability-logging 1.3.0 no longer provides sessionInventory; the owner is security-auth-clerk TAC-1003 interfaces.sessionInventory and equivalent TACs on other auth blueprints. requiresAppliedCapabilities remains [principalDirectory]. Closes routed finding F-5 from the review.
- Every REQ now carries a deliveredBy link into TAC-2601, TAC-2603 or TAC-2604.
- Every AC on every user story now carries an explicit disposition (fixed or template); ACs that observe a session-inventory row carry ownerRef into TAC-1003.
- TAC-2601 responsibilities extended with renderProfileSurface, renderPreferencesSurface and renderCorrelationId; TAC-2604 extended with reauthWindowGate and sessionInventoryConsumer.
- Review fix pass (2026-09-10): elicit-token coverage tightened on REQ-003 to name `self-service`, `hosted-link-out` and `hosted-embed` literally alongside the branch prose; principalDirectory named literally in REQ-001; template ACs on US-25104, US-25108 and US-25101 carry an `Applying agent sets: <elicit-id>.` clause; anatomy test name at TC-056-shelf-doc-consistency renamed to say observability-logging drops sessionInventory; README register scrubbed (no operator names). Closes review-fix-pass findings F-1, F-2, O-1.

## 1.0.0 (visual round, spec 2026-09-06 section 5.4)

- First shipped version. Introduces the account-settings shell (ARIA APG tabs, WCAG 2.4.6 landmark), the profile surface (WCAG 1.3.5 autocomplete tokens, aria-live save-status), the security surface (self-service branch and hosted-UI branch through ADR-2602's elicited security-surface-shape), the sessions surface (ARIA APG dialog-modal terminate flow, aria-live session-terminated announcement, current-session cannot terminate itself), the notification-preferences surface (per-category silence, per-channel opt-in) and the theme surface (light/dark/system radiogroup persisted per ADR-2603's elicited theme-persistence).
- Declares `requiresAppliedCapabilities: [principalDirectory]` with `refusalMessageId: application-account-settings-bare-spa` and `allowSkipFlag: allow-no-auth-yet`. The refusal template ships in this PR's mechanism minor at `packages/rcf-lite/src/blueprint/capabilities.js` (`buildRefusalMessage`). The Q3 gate (a project declaring neither `credentialSelfService` nor `hostedIdentityUi`) is enforced through the shell's tab-suppression rule (AC-25101-1 probed by the pack), the mechanism's silent gating of the `security-surface-shape` elicit (its `when` predicate refuses), and the surface-side hosted-UI bridge TAC-2603 refusal (documented mechanism-reach gap under AC-25110-1).
- Ships four capability-gated custom-auth elicits (`custom-auth-provides-principal-directory`, `custom-auth-provides-credential-self-service`, `custom-auth-provides-session-inventory`, `custom-auth-provides-hosted-identity-ui`) that let a project ship its own auth surface without a shelf `security-auth-*` blueprint.
- Ships four regular elicits (`security-surface-shape`, `hosted-identity-url`, `theme-persistence`, `reauth-window`) whose `when` predicates gate on the applied capability set.
- Ships a Playwright probe pack under `probe-packs/application-account-settings.pack.mjs` with five checks anchored to `AC-25101-1` (shell tabs mirror caps), `AC-25102-1` (profile autocomplete tokens), `AC-25105-1` (security branch matches applied + elicit), `AC-25106-1` (sessions rows and dialog-modal) and `AC-25108-1` (theme radiogroup and persistence). Every check gates via `readAppliedCapabilities(projectRoot)`; an absent capability records `verdict: skipped` per spec section 3.3.
- Ships a dependency-free sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-account-settings/` realising the five conditional surfaces honestly plus four break switches (`?break=leak-tab`, `?break=no-autocomplete`, `?break=no-dialog`, `?break=no-persist`) driving the negative runs.
- Composes on `application-empty-error-states` for the forbidden and empty-history states; no bespoke access-denied UI is invented here.
- Rides with the auth blueprints minor bumps (`security-auth-clerk` 1.3.0, `security-auth-keycloak` 1.2.0, `security-auth-oauth2` 1.2.0, `security-auth-magic-link` 1.2.0 doc-only) and the `observability-logging` 1.2.0 minor bump (declares `sessionInventory` as the logging-projection provider), extending the section 6a capability table with `credentialSelfService`, `sessionInventory` and `hostedIdentityUi`.
