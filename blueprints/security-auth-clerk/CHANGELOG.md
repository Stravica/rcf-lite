# security-auth-clerk CHANGELOG

## 1.5.4 - 2026-09-11

- Criterion-e probe pack fix pass: every conformance-only result row now records `anchorAcId: null` alongside a `limitation` that opens with a shipped AC id from the blueprint's user stories (`AC-9110-1` on the principal-directory smoke, `AC-9112-3` and `AC-9112-4` on the sign-in-token mint and revoke rows, dedicated `AC-9112-1` and `AC-9112-5` notObservableHere rows on the session-inventory probe). Detail strings on de-claimed rows describe only what was observed at the surface the probe drove (Clerk Backend API for the two live probes; the fixture URL validator or role adapter for the local ones) and no longer claim REQ-008 or any AC as observed end to end. Anatomy helper tightened: conformance-only rows must satisfy `anchorAcId === null`, limitations must open with an `AC-<n>-<n>` id (REQ-prefixed anchors are refused), and pre-delete presence is no longer counted as an absence observation on the inventory-diff shape. Probe comments and CHANGELOG prose reworded to drop lane/review labels.

## 1.5.3 - 2026-09-11

- Every AC/REQ anchor on the criterion-e probe pack is de-claimed to `conformanceOnly` with a limitation naming the shipped AC that is observable only in the integration harness follow-up. Live evidence on the two `real-account-*` probes (Clerk Backend API principal-directory smoke, sign-in-token mint+revoke lifecycle) is preserved on the rows; the anchor drops to null and the limitation says why. `hosted-identity-ui-config` and `role-model-adapter` rows keep their fixture-adapter observations under the same shape.

## 1.5.2 - 2026-09-11

- Added a criterion-e probe pack (`contributions/probes/`) covering the four declared capabilities: `role-model-adapter` (roleModel; local), `hosted-identity-ui-config` (hostedIdentityUi; local, https-only refusal), `real-account-principal-directory-round-trip` (principalDirectory; live against Clerk Backend API, creates a scratch principal, reads back, list-diff, deletes), and `real-account-session-inventory` (sessionInventory; live against the Clerk sign-in-token surface). Fixture at `packages/rcf-lite/test/fixtures/security-auth-clerk/` declares every env var the pack reads (`CI_HAS_CLERK_ACCOUNT`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_API_BASE_URL`, `GITHUB_RUN_ID`); anatomy test at `packages/rcf-lite/test/blueprint/security-auth-clerk-anatomy.test.js` pins pack shape, fixture manifest completeness and the account-bound skip contract.
- Iteration on the probe pack landed the Clerk-gate distinction between unset and set-but-not-`true` for both live probes; `aggregate([])` and null-result normalisation now report `detail: 'no checks ran'` exactly. The slug reads AMBER on criterion e until the integration-harness follow-up lifts the AC-level rows.

## 1.5.1

- Adds `vendorCitation` on `AC-9108-1` (`{ url, verifiedOn }` pointing at the Clerk sign-up-and-sign-in-options guide) and on `AC-9109-2` (pointing at the Clerk system-limits page): closes F-4 and F-5. Both ACs rest on Clerk-documented facts; the citations record the exact page and the ISO-8601 verification date so a reviewer can retrace the fact without following prose leads.
- Closure fix pass (F-6): rewrites the `README.md` shelf-latest line in neutral customer-facing voice with no spec-provenance label.
- Owner rule on `signInStrategy`: repoints `REQ-005.description` to reference `TAC-1001-security-auth-clerk-middleware.interfaces.config` as the owner of the record shape; `AC-9108-1` keeps the literal `{ primary: string, alternates: string[] }` as an oracle and gains an `ownerRef` at the same field.

## 1.5.0

- Extends `REQ-001.description` with a one-line runtime clause naming the `hostedIdentityUi` capability verbatim (Clerk-hosted sign-in, sign-up, MFA, and account-management surfaces; no project route renders a credential-input control of its own). Adds `AC-9102-3` to `US-9102` binding a fixed source-tree-scan observation against `TAC-1001-security-auth-clerk-middleware` `responsibilities.signInStrategy`. Adds `US-9113` binding `REQ-011` (audit surface) with four ACs covering the success, refusal, retry and boundary paths of the verification and sessionInventory audit-event contract, each `ownerRef` pointing at `TAC-1003-security-auth-clerk-session-verifier` `responsibilities.audit`. Rewrites `REQ-003.description` to reference `TAC-1001-security-auth-clerk-middleware` `responsibilities.verify` rather than restate the `{ authenticated, principal?, reason? }` shape verbatim, and moves the REQ's `deliveredBy` from the shape ADR to the owning TAC.
- Closure fixes: repoints `REQ-001.deliveredBy` from `TAC-1004-security-auth-clerk-claims-mapper.responsibilities.reduceClaims` to `TAC-1001-security-auth-clerk-middleware.responsibilities.signInStrategy`, the responsibility that carries the `hostedIdentityUi` mount behaviour (the field `AC-9102-3` observes); strengthens the TAC-1001 `signInStrategy` responsibility text to name the `hostedIdentityUi` capability verbatim. Tightens `AC-9113-1` and `AC-9113-2` to name each event by its (`operation`, `outcome`) tuple and binds the refusal case to `reasonClass=expired` for an expired `__session` cookie input (dropping the example set). Adds `AC-9113-5` (permission: unauthenticated `sessionInventory.revoke` refused with `reasonClass=unauthenticated`, no side effect) and `AC-9113-6` (idempotency: two verifications of the same valid cookie emit two events, count is one per verify call). Adds a 7a inline note in the story's `description` documenting the credential and permission scenario-class mapping.

## 1.4.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.4.0 (hardening pass, spec 2026-09-09 section 5.4.2)

- Adds `REQ-010` and `US-9112` for the `sessionInventory` capability contract (list, revoke-one, revoke-all-except-current, unauthenticated refusal, unknown-session refusal, one structured audit event per operation) and extends `TAC-1003` with the `sessionInventory` interface. Adds `REQ-011` (verification and inventory audit surface with a fixed field allow-list and prefix boundary). Reconciles the Principal shape in `REQ-001` to the four-field record already asserted by the ACs and TAC-1004. Adds `deliveredBy` on every `must` requirement and `disposition: fixed` on every existing acceptance criterion; adds `ownerRef` on ACs that observe the `sessionInventory` interface. Names the `principalDirectory`, `roleModel`, and `hostedIdentityUi` capabilities on the requirements that already carry their runtime clauses. hardening pass (criteria a, b, c on the 2026-09-09 programme).
- Review fix pass (PR #188 findings): softens `US-9112` `AC-1` to reference the `TAC-1003-security-auth-clerk-session-verifier.interfaces.sessionInventory` `SessionRow` shape rather than restating its fields (clerk owns the shape, and the reference form keeps every consumer AC single-owner).

## 1.3.0 (visual round, spec 2026-09-06 section 5.4.2, operator Q2 default)

- Declares `capabilities: [principalDirectory, roleModel, sessionInventory, hostedIdentityUi]` on `blueprint.json`. Additive per section 6 of `blueprint-authoring.md` (an additive optional field with no global-topic change is a minor bump). Consumed at apply time by the visual round `application-account-settings` blueprint to gate the sessions surface (probe pack check `AC-25106-1`) and the security surface hosted-UI branch (`AC-25105-1`). Clerk exposes an inventory of active sessions with device labels and a terminate action, and hosts identity screens (sign-in, sign-up, account, security) that a link-out or embed can consume.

## 1.2.0 (visual round, spec 2026-09-04 section 5.5.2, operator Q2 default)

- Declares `capabilities: [principalDirectory, roleModel]` on `blueprint.json`. No other change. The new field is additive per section 6 of `blueprint-authoring.md` (an additive optional field with no global-topic change is a minor bump), and it is consumed by the visual round `application-admin-console` blueprint at apply time to gate surfaces on what the applied identity blueprint actually provides.
