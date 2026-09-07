# edge-cloudflare-rate-limiting changelog

## 1.0.0 (round 6 T-6, 2026-09-07)

- First shipped version. Zone-level rate limiting as an edge gate in front of Worker handlers per the ratified `cloudflare-round-6-spec-2026-09-06.md` section 5.6.
- Five REQs, eight USs, three TACs, four ADRs. Twenty contributions total.
- Ships the local rate-limit rules manifest schema (draft-07), the operator-facing management surface guide with both wrangler and dashboard flows, the drift-audit runner realisation on the `cf-edge` fixture and the composition ADR with `security-auth-magic-link`.
- Mints capability `edgeRateLimit` and global topic `edgeThrottleContract` (ADR-3701, scope global).
- Four Node-only probes: `manifest-presence`, `manifest-schema-validate`, `event-secrecy`, `real-account-burst-and-429`. The last carries `accountBound: true` and records `accountBoundSkipped: true` in CI without `CI_HAS_CLOUDFLARE_ACCOUNT` per spec section 3.5 and ruling 6.
- `cf-edge` fixture extended additively: `cloudflare/rate-limits/example.json`, `cloudflare/rate-limits/api-writes.json`, `src/drift-audit-runner.mjs`, three induced-failure switches (`SIMULATE_MANIFEST_MISSING`, `SIMULATE_SCHEMA_INVALID`, `SIMULATE_EVENT_LEAK_IP`).
