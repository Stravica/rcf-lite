# security-auth-clerk CHANGELOG

## 1.4.0 (hardening pass B2, spec 2026-09-09 section 5.4.2)

- Adds `REQ-010` and `US-9112` for the `sessionInventory` capability contract (list, revoke-one, revoke-all-except-current, unauthenticated refusal, unknown-session refusal, one structured audit event per operation) and extends `TAC-1003` with the `sessionInventory` interface. Adds `REQ-011` (verification and inventory audit surface with a fixed field allow-list and prefix boundary). Reconciles the Principal shape in `REQ-001` to the four-field record already asserted by the ACs and TAC-1004. Adds `deliveredBy` on every `must` requirement and `disposition: fixed` on every existing acceptance criterion; adds `ownerRef` on ACs that observe the `sessionInventory` interface. Names the `principalDirectory`, `roleModel`, and `hostedIdentityUi` capabilities on the requirements that already carry their runtime clauses. Hardening pass B2 (criteria a, b, c on the 2026-09-09 programme).
- Review fix pass (PR #188 findings): softens `US-9112` `AC-1` to reference the `TAC-1003-security-auth-clerk-session-verifier.interfaces.sessionInventory` `SessionRow` shape rather than restating its fields (clerk owns the shape, and the reference form keeps every consumer AC single-owner).

## 1.3.0 (visual round T-4, spec 2026-09-06 section 5.4.2, Baz Q2 default)

- Declares `capabilities: [principalDirectory, roleModel, sessionInventory, hostedIdentityUi]` on `blueprint.json`. Additive per section 6 of `blueprint-authoring.md` (an additive optional field with no global-topic change is a minor bump). Consumed at apply time by the visual round T-4 `application-account-settings` blueprint to gate the sessions surface (probe pack check `AC-25106-1`) and the security surface hosted-UI branch (`AC-25105-1`). Clerk exposes an inventory of active sessions with device labels and a terminate action, and hosts identity screens (sign-in, sign-up, account, security) that a link-out or embed can consume.

## 1.2.0 (visual round T-5, spec 2026-09-04 section 5.5.2, Baz Q2 default)

- Declares `capabilities: [principalDirectory, roleModel]` on `blueprint.json`. No other change. The new field is additive per section 6 of `blueprint-authoring.md` (an additive optional field with no global-topic change is a minor bump), and it is consumed by the visual round T-5 `application-admin-console` blueprint at apply time to gate surfaces on what the applied identity blueprint actually provides.
