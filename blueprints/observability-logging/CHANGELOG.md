# observability-logging CHANGELOG

## 1.1.0 (visual round T-5, spec 2026-09-04 section 5.5.2, Baz Q2 default)

- Declares `capabilities: [auditLog]` on `blueprint.json`. No other change. The new field is additive per section 6 of `blueprint-authoring.md` (an additive optional field with no global-topic change is a minor bump). Keeps a single grammar for capability declaration: consumer blueprints read the union of declared `capabilities[]` on applied blueprints, never the `providesRoles[]` -> capability inference. This is the ratified rule (one grammar, no role-to-capability inference); the section 6a table previously noted `auditLog` as "implicit through the `logging` role" and now names `observability-logging` as the explicit shelf provider. Consumed at apply time by the visual round T-5 `application-admin-console` blueprint to gate the audit-log surface (probe pack check `AC-21105-1`).
