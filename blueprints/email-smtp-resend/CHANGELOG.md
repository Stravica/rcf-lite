# email-smtp-resend CHANGELOG


## 1.1.1 - 2026-09-10

Dimension-d single-definition-ownership cleanup on REQ-001: REQ description now references the send-adapter interface signature and outcome shape owned on TAC-401.interfaces.send rather than restating the send arguments and outcome fields. Chain-consistency lint zero on pass 1 and pass 2.

## 1.1.0 (hardening pass B4, 2026-09-09)

- Adds `elicits[]` with six apply-time answers: `smtp-host-ref`, `smtp-username-ref`, `smtp-password-ref`, `verified-sender-ref` (string placeholder references the send adapter resolves at boot per REQ-002), `webhook-signing-secret-ref` (string placeholder reference the WEBHOOK VERIFIER resolves per REQ-005 - owned by TAC-402, not TAC-401), `replay-tolerance-ms` (string milliseconds, default 300000; REQ-006).
- Adds `deliveredBy` to every REQ (REQ-001/003/004 -> TAC-401 interfaces; REQ-002 -> TAC-401.interfaces.secretResolver; REQ-005 -> TAC-402.interfaces.verify; REQ-006 -> TAC-402.interfaces.eventIdStore). Closes 3 pass-2 lint findings.
- Closes F-3 chain-contradiction specimen (webhook secret ownership): AC-4106-2 rewritten to name only the three SMTP references plus the verified-sender-address (owned by TAC-401.responsibilities[8]); AC-4106-3 added asserting the webhook signing secret is resolved by TAC-402 and does not appear in the send adapter's source.
- Closes F-1 (transport class retry not asserted): adds AC-4103-4 (transient transport failure ECONNRESET succeeds on retry with the returned envelope id) and AC-4103-5 (exhausted retry -> RESEND_TRANSPORT_ERROR naming the class and attempt count).
- Closes F-2 (backoff delay range not asserted): adds AC-4103-6 with a deterministic jitter source and clock, asserting scheduled delay under exponential full-jitter caps within [0, 250] for the first retry at the ADR-402 baseline; no delay negative, no delay above the 8000ms cap.
- Closes F-4 (TTL expiry not asserted): adds AC-4105-3 asserting the eventIdStore `putIfAbsentWithExpiry` receives expiryMs equal to the configured replay tolerance window; a re-post inside the window is refused as duplicate, a re-post after the window expires is accepted.
- Re-sweeps every existing AC's `disposition` per section 7b: ACs referencing placeholder references and the tolerance window flipped to `template` with `templateFillIns`; the remaining ACs stay `fixed`.
- Review fix pass (F-4): adds `secretResolver` interface entry to TAC-402 (mirrors the TAC-401 shape) naming the boot-time secret-reference resolver the webhook verifier consumes; corrects TAC-402.responsibilities[5] cross-reference from AC-4106-2 to AC-4106-3 (the F-3 closure split webhook-secret ownership off from the SMTP-secrets AC and the responsibility trailer still cited the older AC); updates AC-4106-3.ownerRef from `TAC-402.interfaces.verify` to `TAC-402.interfaces.secretResolver` so the ownership pointer names the actual secret-resolution interface.
