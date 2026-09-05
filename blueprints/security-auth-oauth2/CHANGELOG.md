# security-auth-oauth2 CHANGELOG

## 1.1.0 (visual round T-5, spec 2026-09-04 section 5.5.2, Baz Q2 default)

- Declares `capabilities: [principalDirectory, roleModel]` on `blueprint.json`. No other change. The new field is additive per section 6 of `blueprint-authoring.md` (an additive optional field with no global-topic change is a minor bump), and it is consumed by the visual round T-5 `application-admin-console` blueprint at apply time to gate surfaces on what the applied identity blueprint actually provides.
