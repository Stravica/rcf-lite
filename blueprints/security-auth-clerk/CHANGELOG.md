# security-auth-clerk CHANGELOG

## 1.3.0 (visual round T-4, spec 2026-09-06 section 5.4.2, Baz Q2 default)

- Declares `capabilities: [principalDirectory, roleModel, sessionInventory, hostedIdentityUi]` on `blueprint.json`. Additive per section 6 of `blueprint-authoring.md` (an additive optional field with no global-topic change is a minor bump). Consumed at apply time by the visual round T-4 `application-account-settings` blueprint to gate the sessions surface (probe pack check `AC-25106-1`) and the security surface hosted-UI branch (`AC-25105-1`). Clerk exposes an inventory of active sessions with device labels and a terminate action, and hosts identity screens (sign-in, sign-up, account, security) that a link-out or embed can consume.

## 1.2.0 (visual round T-5, spec 2026-09-04 section 5.5.2, Baz Q2 default)

- Declares `capabilities: [principalDirectory, roleModel]` on `blueprint.json`. No other change. The new field is additive per section 6 of `blueprint-authoring.md` (an additive optional field with no global-topic change is a minor bump), and it is consumed by the visual round T-5 `application-admin-console` blueprint at apply time to gate surfaces on what the applied identity blueprint actually provides.
