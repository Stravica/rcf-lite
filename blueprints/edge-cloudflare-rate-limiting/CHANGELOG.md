# edge-cloudflare-rate-limiting changelog

## 1.1.0 - 2026-09-09

Hardening pass B3 edge (criterion a REQ-layer backing; criterion b AC-set sufficiency; criterion c chain consistency lint-zero on pass 1 and pass 2).

- Added failure-path ACs to US-36103 (origin-not-executed AC-36103-2 closes F-1: 429 refuses before origin), US-36104 (AC-36104-2 fake-clock cadence assertion closes F-2; AC-36104-3..7 close F-5 drift-runner failure paths for missing zone id, API auth, throttled, malformed and timeout).
- Split the drift-audit record shape from the runtime request-event record shape: drift records carry `{ruleId, outcome, timestamp, diff}` (no `clientIpHash`, no client on the API path); request-event records carry `{ruleId, clientIpHash, outcome, timestamp}` with a hashed prefix. REQ-004, TAC-3703 responsibilities, AC-36104-1 and AC-36107-1 all now use these exact shapes (closes specimen F-3).
- Clarified TAC-3701 and REQ-001 that the manifest schema has seven required fields plus one optional `description` field (aligns TAC with the shipped schema; closes specimen F-4).
- Every REQ now carries `deliveredBy`; every AC carries `disposition`; ACs referencing owner-owned literals carry `ownerRef`.
- Chain-consistency lint reports 0 findings on both passes.
- Review fix pass (2026-09-09): finished the split of the drift-audit record shape from the request-event shape by rewriting the TAC-3703 purpose second sentence and the guide's `## Drift audit` section to state the drift record as `{ruleId, outcome, timestamp, diff}` and the request-event record as `{ruleId, clientIpHash, outcome, timestamp}` (closes F-2); the README event-secrecy row assertion now names both shapes. Split every bundled single-AC story on a per-failure-path basis: US-36106 (canonical-pass + SIMULATE_SCHEMA_INVALID-fail), US-36107 (canonical-shape + SIMULATE_EVENT_LEAK_IP-fail), US-36108 (canonical-pass + SIMULATE_MANIFEST_MISSING-fail); each new AC carries a concrete oracle (probe verdict + named field) and an `ownerRef`. Re-judged disposition per AC: mechanism-invariant refusal reasons, record-shape keys and probe verdicts stay `fixed`; US-36101 AC-36101-1 and US-36103 AC-36103-1/-2 re-marked `template` naming the values the applying agent sets (the rate-limit-rules-dir path, per-rule id/expression/threshold/period/characteristics/action/duration, the elicited rate-limit-zone-id, and CF_RATE_LIMIT_URL for the account-bound probe). Genuinely single-mechanism stories (US-36101, US-36102, US-36105) carry the section-7a note inside the story `description` field, not in a schema-illegal new field.


## 1.0.0 (round 6 T-6, 2026-09-07)

- First shipped version. Zone-level rate limiting as an edge gate in front of Worker handlers per the ratified `cloudflare-round-6-spec-2026-09-06.md` section 5.6.
- Five REQs, eight USs, three TACs, four ADRs. Twenty contributions total.
- Ships the local rate-limit rules manifest schema (draft-07), the operator-facing management surface guide with both wrangler and dashboard flows, the drift-audit runner realisation on the `cf-edge` fixture and the composition ADR with `security-auth-magic-link`.
- Mints capability `edgeRateLimit` and global topic `edgeThrottleContract` (ADR-3701, scope global).
- Four Node-only probes: `manifest-presence`, `manifest-schema-validate`, `event-secrecy`, `real-account-burst-and-429`. The last carries `accountBound: true` and records `accountBoundSkipped: true` in CI without `CI_HAS_CLOUDFLARE_ACCOUNT` per spec section 3.5 and ruling 6.
- `cf-edge` fixture extended additively: `cloudflare/rate-limits/example.json`, `cloudflare/rate-limits/api-writes.json`, `src/drift-audit-runner.mjs`, three induced-failure switches (`SIMULATE_MANIFEST_MISSING`, `SIMULATE_SCHEMA_INVALID`, `SIMULATE_EVENT_LEAK_IP`).
