# application-api-rest CHANGELOG

## 2.1.1 (B6a application core hardening, 2026-09-09)

- B6a hardening pass: chain-consistency lint zero (pass1 + pass2); added deliveredBy to every REQ, added ownerRef and disposition to every AC per section 7b, closed case drifts on `content-type` and `idempotency-key` in REQ-002, REQ-010, AC-2102-4, AC-2102-5, AC-2112-1, AC-2112-2 and ADR-306 to match the owner spellings on TAC-301.
- Added AC-2108-9 (readiness deadline: aggregate 503 naming the failed check id and the configured deadline while liveness continues at 200) covering the 2026-09-08 review finding F-1 on TAC-306.interfaces[0] (readiness check registry).


