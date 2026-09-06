# security-auth-oauth2 CHANGELOG

## 1.2.0 (visual round T-4, spec 2026-09-06 section 5.4.2, Baz Q2 default)

- Declares `capabilities: [principalDirectory, roleModel, credentialSelfService, sessionInventory, hostedIdentityUi]` on `blueprint.json`. Additive per section 6 of `blueprint-authoring.md`. Consumed at apply time by the visual round T-4 `application-account-settings` blueprint to gate the security surface across both self-service and hosted-link-out branches (`AC-25105-1`) and the sessions surface (`AC-25106-1`). The three added capabilities are provider-conditional per spec section 5.4.2 vendor variation note: an OAuth2 provider (Auth0, Cognito, Azure AD, Okta) that ships a hosted account portal supplies `hostedIdentityUi`; a provider that exposes an account-management endpoint supplies `credentialSelfService`; a provider that exposes a session inventory endpoint supplies `sessionInventory`. A project on an OAuth2 provider without one of these surfaces sets the corresponding capability to false via a project-scoped ADR override; the account-settings blueprint suppresses the surface accordingly.

## 1.1.0 (visual round T-5, spec 2026-09-04 section 5.5.2, Baz Q2 default)

- Declares `capabilities: [principalDirectory, roleModel]` on `blueprint.json`. No other change. The new field is additive per section 6 of `blueprint-authoring.md` (an additive optional field with no global-topic change is a minor bump), and it is consumed by the visual round T-5 `application-admin-console` blueprint at apply time to gate surfaces on what the applied identity blueprint actually provides.
