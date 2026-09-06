# observability-logging CHANGELOG

## 1.2.0 (visual round T-4, spec 2026-09-06 section 5.4.2, Baz Q2 default)

- Declares `capabilities: [auditLog, sessionInventory]` on `blueprint.json`. The `sessionInventory` addition ships the logging-as-session-inventory projection: a project may configure the logger session-emission channel as the source the account-settings sessions surface reads (device labels from the User-Agent header, last-active from the last event emitted per session, terminate as an operator write into the same channel). Additive per section 6 of `blueprint-authoring.md`. Consumed at apply time by the visual round T-4 `application-account-settings` blueprint. A project that does not run the logger as a session store leaves the surface capability supplied by the applied auth blueprint alone; the account-settings blueprint reads the union.

## 1.1.0 (visual round T-5, spec 2026-09-04 section 5.5.2, Baz Q2 default)

- Declares `capabilities: [auditLog]` on `blueprint.json`. No other change. The new field is additive per section 6 of `blueprint-authoring.md` (an additive optional field with no global-topic change is a minor bump). Keeps a single grammar for capability declaration: consumer blueprints read the union of declared `capabilities[]` on applied blueprints, never the `providesRoles[]` -> capability inference. This is the ratified rule (one grammar, no role-to-capability inference); the section 6a table previously noted `auditLog` as "implicit through the `logging` role" and now names `observability-logging` as the explicit shelf provider. Consumed at apply time by the visual round T-5 `application-admin-console` blueprint to gate the audit-log surface (probe pack check `AC-21105-1`).
