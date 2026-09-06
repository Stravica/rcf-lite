# security-auth-keycloak CHANGELOG

## 1.2.0 (visual round T-4, spec 2026-09-06 section 5.4.2, Baz Q2 default)

- Declares `capabilities: [principalDirectory, roleModel, credentialSelfService, sessionInventory]` on `blueprint.json`. Additive per section 6 of `blueprint-authoring.md`. Consumed at apply time by the visual round T-4 `application-account-settings` blueprint to gate the security surface self-service branch (probe pack check `AC-25105-1`) and the sessions surface (`AC-25106-1`). Keycloak ships a credential self-service surface (password change, MFA management, email change) that a project can bring in-place and it exposes an active-session inventory a terminate action can act on. Keycloak does NOT declare `hostedIdentityUi` because its hosted-UI is realm-scoped and Keycloak deployments typically brand it in place, so the account-settings blueprint does not treat Keycloak as a hosted-UI provider.

## 1.1.0 (visual round T-5, spec 2026-09-04 section 5.5.2, Baz Q2 default)

- Declares `capabilities: [principalDirectory, roleModel]` on `blueprint.json`. No other change. The new field is additive per section 6 of `blueprint-authoring.md` (an additive optional field with no global-topic change is a minor bump), and it is consumed by the visual round T-5 `application-admin-console` blueprint at apply time to gate surfaces on what the applied identity blueprint actually provides.
