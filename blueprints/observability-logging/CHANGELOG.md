# Changelog

## 1.3.7 - 2026-09-11

Identifier-pairing rule tightened to equality. `line-shape-and-fields` now records each AC-15101-1/-3/-4 row's supplied correlation id under `suppliedInput` (with the parsed log-line object under `line`) so the row can be verified as `line.correlationId === suppliedInput`; the AC-15101-1 row also carries the observedEmissions list its detail already names. `correlation-id-flow` AC-15102-1 header-absent row records the fixture-minted UUID as an engine-minted `requestId` (with `absentSuppliedInput: true` for readability) instead of a `<no-header>` sentinel that could not equal the echoed value.

## 1.3.6 - 2026-09-11

redaction-boundary probe now emits one payload per recommended-default category (credential, token, bearer, pii.email, pii.name, pii.address) inside its own runWithCorrelation(randomUUID(), ...) so each row records a per-emission correlation id paired to the emitted line's correlationId; every one of the six mandatory categories AC-15103-1 names is now anchored to AC-15103-1 with derived redacted value AND payload-unmutated observation. The AC-15103-4-shaped row is emitted in its own correlation context and records the supplied/emitted correlationId pair alongside userId preservation and pii.email redaction. Anatomy helper strict-evidence contract tightened: bare `suppliedInput`, `headerName`, `workflowName`, `line.correlationId`, `observed[].supplied` and `observedRoundTrips[].supplied` no longer satisfy the identifier half on their own; each must be paired with the engine's echo of that value (echoedHeader, derivedResponseHeader, a returned resource id, or a log-line correlationId equal to the value the probe supplied).


## 1.3.5 - 2026-09-11

redaction-boundary probe now wraps each emission in runWithCorrelation(randomUUID(), ...) so every AC-15103-1 row and the AC-15103-4-shaped row carry a real per-emission correlation id as the identifier alongside the derived redacted value; the run-notes claim about redaction-boundary correlation ids is now true to the recorded rows. correlation-id-flow AC-15102-3 row (bare emission with correlationId=null by design) is de-claimed to conformanceOnly, since a bare emission carries no engine-returned identifier.

## 1.3.4 - 2026-09-11

line-shape-and-fields probe now wraps every emission (per-level, BigInt, reserved-key-collision) in runWithCorrelation(randomUUID(), ...) so each emitted log line carries a real correlation id; the AC-15101-1/-3/-4 rows record the parsed line object plus a correlationIdEchoed identifier and a bodyExcerpt derived value.

# observability-logging CHANGELOG

## 1.3.3 - 2026-09-11

Adds a contributions/probes/ pack (line-shape-and-fields, correlation-id-flow, redaction-boundary) with a fixture-side logger factory and HTTP transport under packages/rcf-lite/test/fixtures/probe-pack-observability-logging/. Probes run against the fixture on Node 24. No account gate.

Anchoring: line-shape-and-fields anchors AC-15101-1/3/4 (seven-field minimum with per-field non-empty-string type checks and ISO-8601 timestamp; BigInt folded to a decimal string; reserved-key collision safety). correlation-id-flow anchors AC-15102-1 with BOTH the header-present clause (three varied inbound ids echoed on the response header, response body and emitted log line with a fixture-computed sequence and hash the probe recomputes locally) AND the header-absent clause (fixture mints a v4 UUID, response body carries mintedFromAbsent=true and the correlationId, the emitted line matches); also anchors AC-15102-3 (bare emission with no ambient context carries correlationId=null). The monotonic-sequence row de-claims with the limitation naming AC-15102-1. redaction-boundary anchors AC-15103-1 (top-level recommended-default category folded with `[REDACTED:<category>]` AND the caller's original payload object unmutated after log.info returns) and AC-15103-4 (the { user: { id, pii: { email } } } shape with user.id preserved and user.pii.email redacted, plus caller unmutated). The nested top-level pii row and the bare `note` row de-claim with limitations naming AC-15103-4 and AC-15103-3 respectively. probe-utils normalisation and thrown-error rows carry an evidence object; the fallback anchorAcId is null.

## 1.3.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.3.0 (2026-09-09)

- Removes `sessionInventory` from `capabilities[]`. The section 7c backing requirement never landed on this blueprint: a logging surface does not own or deliver a session-listing surface. The applied `security-auth-clerk` blueprint owns `sessionInventory` through `TAC-1003-security-auth-clerk-session-verifier.interfaces.sessionInventory` (being defined on the security branch tonight); a project that runs Clerk continues to gate the account-settings sessions surface via that capability, unchanged. Shelf-wide grep of `requiresAppliedCapabilities` names no consumer that requires `sessionInventory` from this blueprint; the soft consumer (`application-account-settings` probe pack check `AC-25106-1` via `readAppliedCapabilities`) reads the union across applied blueprints and is unaffected. Removal is reasoned per section 7c, not a downgrade of the semantic surface.
- Adds `elicits[]` with four apply-time answers: `correlation-header-name` (string, default X-Correlation-Id; ADR-1602), `minimum-log-level` (enum trace/debug/info/warn/error/fatal, default info; ADR-1604), `redaction-categories-additions` (string, default blank; ADR-1603) and `boot-identity-fields` (string, JSON object with environment/serviceName/serviceVersion; REQ-005). Every option value is backed by a must-priority REQ description (section 7c criterion a).
- Adds `ADR-1605-observability-logging-serialisation-refusal`: BigInt values fold to their decimal string form on the emitted line; circular references and function references are dropped with one stderr notice naming the offending dotted path. Closes the family-pass F-4 chain-contradiction specimen (TAC-1601 internalStructure previously described a BigInt fold while REQ-001 / AC-15101-2 described a drop). TAC-1601 internalStructure and responsibility 4 are rewritten to reference ADR-1605; the F-4 outcome split is separately observable at AC-15101-2 (drop for circular/function) and AC-15101-3 (BigInt fold).
- Adds `REQ-006` and `US-15109` naming the `auditLog` capability explicitly: the audit-log stream carries actor, target, before, after and correlationId on the shared minimum field set the consumer (application-admin-console AC-21105-1) reads. Backs the `auditLog` token per section 7c.
- Grows `US-15101` from 2 ACs to 5 ACs: adds AC-15101-3 (BigInt fold oracle), AC-15101-4 (reserved-name collision refusal), AC-15101-5 (ISO-8601 timestamp millisecond oracle). Every existing and new AC on the story carries `disposition`; ACs observing a specific TAC surface carry `ownerRef`.
- Adds `deliveredBy` to every REQ: REQ-001/002/003/005 point at TAC-1601 or TAC-1602 interfaces the responsibility genuinely carries; REQ-004 delivered by ADR-1604. Closes 5 pass-2 lint findings; per-blueprint `rcf define blueprint lint-consistency` reports zero on pass 1 and pass 2.
- adds section 7a coverage-note descriptions to US-15106 and US-15108 recording the guide-and-TAC trace outcome (no additional mechanism-specific failure paths named beyond the two ACs each story already binds).
- Register scan fix (customer-facing register): neutralises historical CHANGELOG entries (1.1.0 and 1.2.0) so shipped content carries no internal author names.

## 1.2.0 (visual round, spec 2026-09-06 section 5.4.2, operator Q2 default)

- Declares `capabilities: [auditLog, sessionInventory]` on `blueprint.json`. The `sessionInventory` addition ships the logging-as-session-inventory projection: a project may configure the logger session-emission channel as the source the account-settings sessions surface reads (device labels from the User-Agent header, last-active from the last event emitted per session, terminate as an operator write into the same channel). Additive per section 6 of `blueprint-authoring.md`. Consumed at apply time by the visual round `application-account-settings` blueprint. A project that does not run the logger as a session store leaves the surface capability supplied by the applied auth blueprint alone; the account-settings blueprint reads the union.

## 1.1.0 (visual round, spec 2026-09-04 section 5.5.2, operator Q2 default)

- Declares `capabilities: [auditLog]` on `blueprint.json`. No other change. The new field is additive per section 6 of `blueprint-authoring.md` (an additive optional field with no global-topic change is a minor bump). Keeps a single grammar for capability declaration: consumer blueprints read the union of declared `capabilities[]` on applied blueprints, never the `providesRoles[]` -> capability inference. This is the shipped rule (one grammar, no role-to-capability inference); the section 6a table previously noted `auditLog` as "implicit through the `logging` role" and now names `observability-logging` as the explicit shelf provider. Consumed at apply time by the `application-admin-console` blueprint to gate the audit-log surface (probe pack check `AC-21105-1`).
