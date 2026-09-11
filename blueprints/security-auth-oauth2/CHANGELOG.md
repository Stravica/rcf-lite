# security-auth-oauth2 CHANGELOG

## 1.3.6 - 2026-09-11

- Criterion-e probe pack refinement: every conformance-only result row now records `anchorAcId: null` alongside a `limitation` that opens with a shipped AC id from the blueprint's user stories (the PKCE length-band row moves from `REQ-002` to `AC-10101-1`). The retained live-branch anchor on `real-account-authorisation-code-flow` (`AC-10110-2`) is unchanged and honest-skips on `CI_HAS_OAUTH2_PROVIDER`; when skipped the row records `engine: oauth2-provider`, not `engine: skip:...`. Detail strings on de-claimed rows describe only what was observed at the fixture-mock surface and no longer claim REQ-002 or an AC as observed end to end. The `real-account-authorisation-code-flow` source header now states plainly that its credential-present branch returns a `NOT IMPLEMENTED` failure record (no live commercial IdP is wired in this estate) rather than describing a real-provider round trip. The anatomy helper enforces conformance-only rows to satisfy `anchorAcId === null`, requires limitations to open with an `AC-<n>-<n>` id that resolves to a shipped acceptance criterion on the blueprint's user stories (REQ-prefixed anchors are refused and fabricated ids are rejected), and does not count pre-delete presence as an absence observation on the inventory-diff shape.

## 1.3.5 - 2026-09-11

- Every conformance-only anchor on the criterion-e probe pack is de-claimed to `conformanceOnly` with a limitation naming the shipped AC that is observable only in the integration harness follow-up; the retained live-branch anchor on `real-account-authorisation-code-flow` (`AC-10110-2`) is preserved and honest-skips on `CI_HAS_OAUTH2_PROVIDER`. The mock authorisation server keeps real consumed-code state; `/callback-check` reads that record and callers now observe `preExchange` from the mock's request-order records instead of asserting it as a constant. Fixture README and mock header comment describe the mock as a fixture, not a local engine, and `X-Mock-Request-Id` as a diagnostic side channel rather than a rule 7d shape.

## 1.3.4 - 2026-09-11

- Added a criterion-e probe pack (`contributions/probes/`) covering the six declared capabilities via five probes: `pkce-challenge-shape` and `authorisation-code-flow-shape` (authorisationCodeFlow via a local mock RFC 6749 + RFC 7636 server on ports 47400-47449), `provider-adapter-shape` (principalDirectory + credentialSelfService), `session-bridge-shape` (sessionInventory + hostedIdentityUi), and `real-account-authorisation-code-flow` (LIVE; honest-skips on `CI_HAS_OAUTH2_PROVIDER` since this estate has no live commercial IdP). Fixture at `packages/rcf-lite/test/fixtures/security-auth-oauth2/` declares every env var the pack reads; anatomy test at `packages/rcf-lite/test/blueprint/security-auth-oauth2-anatomy.test.js` pins pack shape, fixture manifest completeness and the account-bound skip contract.
- Iteration on the probe pack labelled every local-mock row `engine: fixture`, adjusted `authorisation-code-flow-shape` so the callback-refusal row observes a consumed authorisation code before any second `/token` request, and settled `aggregate([])` / null-result normalisation to `detail: 'no checks ran'` exactly. `real-account-authorisation-code-flow` honest-skips on `CI_HAS_OAUTH2_PROVIDER`; when skipped the record's `engine.kind` remains `oauth2-provider`. Slug reads AMBER on criterion e.

## 1.3.3

- Closure fix pass (F-4): rewrites the `README.md` shelf-latest line in neutral customer-facing voice with no spec-provenance label.

## 1.3.2

- Adds `AC-10111-2` to `US-10111` binding a fixed refusal path on the owning mechanism (`TAC-1102-security-auth-oauth2-provider-adapter` `responsibilities.validate`); the boot-time validator refuses a provider-config record missing any REQ-002-mandated field with a stable-coded error class and no server process is left listening. Rewrites `AC-10114-1.description` to reference the local `TAC-1103-security-auth-oauth2-session-bridge` `responsibilities.sessionInventory` (the interface shape remains owned by `TAC-1003-security-auth-clerk-session-verifier` `interfaces.sessionInventory` and is referenced by that owner id) and moves the sibling ACs' `ownerRef` to the same local owner. Rewrites `REQ-011.description` to reference `TAC-1103-security-auth-oauth2-session-bridge` `interfaces.enrichPrincipal` rather than restate the `enrichPrincipal(principal)` signature verbatim.

## 1.3.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.3.0 (hardening pass, spec 2026-09-09 section 5.4.2)

- Adds `REQ-011`/`US-10112` (roleModel: provider-record `roleSources[]`, malformed-claim refusal, enrichPrincipal hook), `REQ-012`/`US-10113` (credentialSelfService: provider-record `accountUrl`, boot-time validation, `getCredentialSelfServiceUrl` helper), `REQ-013`/`US-10114` (sessionInventory: list, revoke-one, revoke-all-except-current, unauthenticated refusal, unknown-session refusal). Extends `TAC-1102` with the `accountUrl` validation responsibility and `TAC-1103` with the roles-population and sessionInventory responsibilities. Adds `deliveredBy` on every `must` requirement and `disposition` on every existing acceptance criterion; adds `ownerRef` on ACs that observe the shared `sessionInventory` interface at owner id `TAC-1003-security-auth-clerk-session-verifier`. Names the `principalDirectory` and `hostedIdentityUi` capabilities on the requirements that carry their runtime clauses. Fixes the pass-1 `OAuth2-only` casing drift on `REQ-008` against `TAC-1102`'s canonical `oauth2-only`. hardening pass (criteria a, b, c on the 2026-09-09 programme).
- Review fix pass (PR #188 findings): adds `authorisationCodeFlow` to `capabilities[]` and names the token verbatim in `REQ-001` with story references (`US-10101` plus refusal siblings), so a machine-readable composition token backs the flow that keycloak now gates on; rewrites `US-10114` `AC-1` to reference the `TAC-1003-security-auth-clerk-session-verifier.interfaces.sessionInventory` `SessionRow` shape rather than restating its fields.

## 1.2.0 (visual round, spec 2026-09-06 section 5.4.2, operator Q2 default)

- Declares `capabilities: [principalDirectory, roleModel, credentialSelfService, sessionInventory, hostedIdentityUi]` on `blueprint.json`. Additive per section 6 of `blueprint-authoring.md`. Consumed at apply time by the visual round `application-account-settings` blueprint to gate the security surface across both self-service and hosted-link-out branches (`AC-25105-1`) and the sessions surface (`AC-25106-1`). The three added capabilities are provider-conditional per spec section 5.4.2 vendor variation note: an OAuth2 provider (Auth0, Cognito, Azure AD, Okta) that ships a hosted account portal supplies `hostedIdentityUi`; a provider that exposes an account-management endpoint supplies `credentialSelfService`; a provider that exposes a session inventory endpoint supplies `sessionInventory`. A project on an OAuth2 provider without one of these surfaces sets the corresponding capability to false via a project-scoped ADR override; the account-settings blueprint suppresses the surface accordingly.

## 1.1.0 (visual round, spec 2026-09-04 section 5.5.2, operator Q2 default)

- Declares `capabilities: [principalDirectory, roleModel]` on `blueprint.json`. No other change. The new field is additive per section 6 of `blueprint-authoring.md` (an additive optional field with no global-topic change is a minor bump), and it is consumed by the visual round `application-admin-console` blueprint at apply time to gate surfaces on what the applied identity blueprint actually provides.
