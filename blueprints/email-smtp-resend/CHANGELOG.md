# Changelog

## 1.1.7 - 2026-09-11

unverified-sender-refusal AC-4102-1 and AC-4102-2 rows are de-claimed to conformanceOnly. The refusal is driven by the local catch-all SMTP fixture (fixture-as-engine) and carries no Resend-returned message id, so the identifier half of the strict-evidence contract is not satisfied here. The live real-account-resend-send row (AC-4101-2) is unchanged.

## 1.1.6 - 2026-09-11

unverified-sender-refusal AC-4102-1 verdict now requires the complete refusal outcome shape owned on TAC-401.interfaces.send: providerStatus a valid positive integer AND providerMessageId===null AND thrownMessage===null, alongside the RESEND_SENDER_UNVERIFIED class prefix.

# email-smtp-resend CHANGELOG

## 1.1.5 - 2026-09-11

Adds a contributions/probes/ pack (smtp-round-trip, unverified-sender-refusal, real-account-resend-send) with a fixture-side send adapter (realises TAC-401.interfaces.send), a catch-all SMTP provider seam and a Resend REST provider seam under packages/rcf-lite/test/fixtures/probe-pack-email-smtp-resend/. Probes run against the fixture on Node 24 and against real Resend on the account-bound branch (CI_HAS_RESEND_ACCOUNT gate + RESEND_API_KEY, one variable per skip row).

Anchoring: unverified-sender-refusal anchors AC-4102-1 (adapter classifies the fixture's 550 5.7.1 refusal to a RESEND_SENDER_UNVERIFIED-prefixed error string) and AC-4102-2 (recipient, subject, body do not appear on the returned error string, on any emitted log line, or on any thrown exception; server accepted zero messages on the unverified path). real-account-resend-send anchors AC-4101-2; the row verdict requires ok=true, error=null, a non-empty providerMessageId AND providerStatus to be an integer in the accepted 200-299 range. smtp-round-trip de-claims (conformanceOnly, anchorAcId=null) with the limitation naming AC-4101-3: the row observes a local catch-all SMTP dispatch via a helper, not a call through the adapter and not the Resend endpoint. probe-utils normalisation and thrown-error rows carry an evidence object; the fallback anchorAcId is null.

## 1.1.3 - 2026-09-10

Ownership-sweep follow-up for REQ-001: removed the send-signature and outcome-field restatements from `AC-4101-2` (description and then-clause), `AC-4102-1` (description and then-clause), and the guide's "What a good outcome looks like" bullets; each surface now references the outcome record owned on `TAC-401-email-smtp-resend-send-adapter.interfaces.send` and, where relevant, the classification owned on `responsibilities[3]`. US-4101 and US-4102 patch-bumped. Chain-consistency lint zero on pass 1 and pass 2. Residues cleared: the AC-4101-2 and AC-4102-1 when-clauses now reference the send interface owned on `TAC-401-email-smtp-resend-send-adapter.interfaces.send` instead of restating the `adapter.send(...)` signature.

## 1.1.2 - 2026-09-10

Dimension-d single-definition-ownership cleanup on REQ-001: REQ description now references the send-adapter interface signature and outcome shape owned on TAC-401.interfaces.send rather than restating the send arguments and outcome fields. Chain-consistency lint zero on pass 1 and pass 2.

## 1.1.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.1.0 (2026-09-09)

- Adds `elicits[]` with six apply-time answers: `smtp-host-ref`, `smtp-username-ref`, `smtp-password-ref`, `verified-sender-ref` (string placeholder references the send adapter resolves at boot per REQ-002), `webhook-signing-secret-ref` (string placeholder reference the WEBHOOK VERIFIER resolves per REQ-005 - owned by TAC-402, not TAC-401), `replay-tolerance-ms` (string milliseconds, default 300000; REQ-006).
- Adds `deliveredBy` to every REQ (REQ-001/003/004 -> TAC-401 interfaces; REQ-002 -> TAC-401.interfaces.secretResolver; REQ-005 -> TAC-402.interfaces.verify; REQ-006 -> TAC-402.interfaces.eventIdStore).
- Fix (chain-contradiction specimen (webhook secret ownership)): AC-4106-2 rewritten to name only the three SMTP references plus the verified-sender-address (owned by TAC-401.responsibilities[8]); AC-4106-3 added asserting the webhook signing secret is resolved by TAC-402 and does not appear in the send adapter's source.
- The transport class retry not asserted gap is fixed: adds AC-4103-4 (transient transport failure ECONNRESET succeeds on retry with the returned envelope id) and AC-4103-5 (exhausted retry -> RESEND_TRANSPORT_ERROR naming the class and attempt count).
- The backoff delay range not asserted gap is fixed: adds AC-4103-6 with a deterministic jitter source and clock, asserting scheduled delay under exponential full-jitter caps within [0, 250] for the first retry at the ADR-402 baseline; no delay negative, no delay above the 8000ms cap.
- The TTL expiry not asserted gap is fixed: adds AC-4105-3 asserting the eventIdStore `putIfAbsentWithExpiry` receives expiryMs equal to the configured replay tolerance window; a re-post inside the window is refused as duplicate, a re-post after the window expires is accepted.
- Re-sweeps every existing AC's `disposition` per section 7b: ACs referencing placeholder references and the tolerance window flipped to `template` with `templateFillIns`; the remaining ACs stay `fixed`.
- adds `secretResolver` interface entry to TAC-402 (mirrors the TAC-401 shape) naming the boot-time secret-reference resolver the webhook verifier consumes; corrects TAC-402.responsibilities[5] cross-reference from AC-4106-2 to AC-4106-3 (the earlier split of webhook-secret ownership off from the SMTP-secrets AC left the responsibility trailer citing the older AC); updates AC-4106-3.ownerRef from `TAC-402.interfaces.verify` to `TAC-402.interfaces.secretResolver` so the ownership pointer names the actual secret-resolution interface.
