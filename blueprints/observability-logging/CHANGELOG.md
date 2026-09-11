# observability-logging CHANGELOG

## 1.3.2 - 2026-09-11

Adds a contributions/probes/ pack (line-shape-and-fields, correlation-id-flow, redaction-boundary) with a fixture-side logger factory under packages/rcf-lite/test/fixtures/probe-pack-observability-logging/. Probes emit through the real factory, capture stdout / stderr on the injected sinks, assert the seven-field minimum set, BigInt fold, reserved-key collision, correlationId ambient flow via AsyncLocalStorage, and PII redaction category strings on the emitted line. No account gate.
Fix pass on this patch: correlation-id-flow: the fixture now derives a per-request sequence and a SHA-256 hash of id + ":" + sequence; the probe recomputes the hash and asserts equality (fixture no longer copies the inbound id into three places). redaction-boundary re-anchors top-level default categories to AC-15103-1, the nested pii.* payload to AC-15103-4 and the negative-control note to AC-15103-3. Every detail line starts with the first eight words of the anchored AC text.



Fix pass (2026-09-11, criterion e closure): correlation-id-flow rewritten to drive an HTTP transport in the fixture; the probe VARIES the inbound correlation-id header per request and observes the derived output (the log line's correlationId and the response's echoed header) - assertion is on values the fixture propagates, not on constants both sides authored. redaction-boundary now uses register-clean placeholder values; DECLARED_ENV asserted.

## 1.3.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.3.0 (hardening pass, 2026-09-09)

- Removes `sessionInventory` from `capabilities[]`. The section 7c backing requirement never landed on this blueprint: a logging surface does not own or deliver a session-listing surface. The applied `security-auth-clerk` blueprint owns `sessionInventory` through `TAC-1003-security-auth-clerk-session-verifier.interfaces.sessionInventory` (being defined on the security branch tonight); a project that runs Clerk continues to gate the account-settings sessions surface via that capability, unchanged. Shelf-wide grep of `requiresAppliedCapabilities` names no consumer that requires `sessionInventory` from this blueprint; the soft consumer (`application-account-settings` probe pack check `AC-25106-1` via `readAppliedCapabilities`) reads the union across applied blueprints and is unaffected. Removal is reasoned per section 7c, not a downgrade of the semantic surface.
- Adds `elicits[]` with four apply-time answers: `correlation-header-name` (string, default X-Correlation-Id; ADR-1602), `minimum-log-level` (enum trace/debug/info/warn/error/fatal, default info; ADR-1604), `redaction-categories-additions` (string, default blank; ADR-1603) and `boot-identity-fields` (string, JSON object with environment/serviceName/serviceVersion; REQ-005). Every option value is backed by a must-priority REQ description (section 7c criterion a). Closes the family-pass F-2 finding.
- Adds `ADR-1605-observability-logging-serialisation-refusal`: BigInt values fold to their decimal string form on the emitted line; circular references and function references are dropped with one stderr notice naming the offending dotted path. Closes the family-pass F-4 chain-contradiction specimen (TAC-1601 internalStructure previously described a BigInt fold while REQ-001 / AC-15101-2 described a drop). TAC-1601 internalStructure and responsibility 4 are rewritten to reference ADR-1605; the F-4 outcome split is separately observable at AC-15101-2 (drop for circular/function) and AC-15101-3 (BigInt fold).
- Adds `REQ-006` and `US-15109` naming the `auditLog` capability explicitly: the audit-log stream carries actor, target, before, after and correlationId on the shared minimum field set the consumer (application-admin-console AC-21105-1) reads. Backs the `auditLog` token per section 7c.
- Grows `US-15101` from 2 ACs to 5 ACs: adds AC-15101-3 (BigInt fold oracle), AC-15101-4 (reserved-name collision refusal), AC-15101-5 (ISO-8601 timestamp millisecond oracle). Every existing and new AC on the story carries `disposition`; ACs observing a specific TAC surface carry `ownerRef`.
- Adds `deliveredBy` to every REQ: REQ-001/002/003/005 point at TAC-1601 or TAC-1602 interfaces the responsibility genuinely carries; REQ-004 delivered by ADR-1604. Closes 5 pass-2 lint findings; per-blueprint `rcf define blueprint lint-consistency` reports zero on pass 1 and pass 2.
- Review fix pass (F-9): adds section 7a coverage-note descriptions to US-15106 and US-15108 recording the guide-and-TAC trace outcome (no additional mechanism-specific failure paths named beyond the two ACs each story already binds).
- Register scan fix (customer-facing register): neutralises historical CHANGELOG entries (1.1.0 and 1.2.0) so shipped content carries no internal author names.

## 1.2.0 (visual round, spec 2026-09-06 section 5.4.2, operator Q2 default)

- Declares `capabilities: [auditLog, sessionInventory]` on `blueprint.json`. The `sessionInventory` addition ships the logging-as-session-inventory projection: a project may configure the logger session-emission channel as the source the account-settings sessions surface reads (device labels from the User-Agent header, last-active from the last event emitted per session, terminate as an operator write into the same channel). Additive per section 6 of `blueprint-authoring.md`. Consumed at apply time by the visual round `application-account-settings` blueprint. A project that does not run the logger as a session store leaves the surface capability supplied by the applied auth blueprint alone; the account-settings blueprint reads the union.

## 1.1.0 (visual round, spec 2026-09-04 section 5.5.2, operator Q2 default)

- Declares `capabilities: [auditLog]` on `blueprint.json`. No other change. The new field is additive per section 6 of `blueprint-authoring.md` (an additive optional field with no global-topic change is a minor bump). Keeps a single grammar for capability declaration: consumer blueprints read the union of declared `capabilities[]` on applied blueprints, never the `providesRoles[]` -> capability inference. This is the ratified rule (one grammar, no role-to-capability inference); the section 6a table previously noted `auditLog` as "implicit through the `logging` role" and now names `observability-logging` as the explicit shelf provider. Consumed at apply time by the visual round `application-admin-console` blueprint to gate the audit-log surface (probe pack check `AC-21105-1`).
