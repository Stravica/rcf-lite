# edge-cloudflare-rate-limiting

Zone-level rate limiting as an edge gate in front of Worker handlers, configured through a local manifest the applying project commits and applies to the live Cloudflare zone via a documented wrangler or dashboard flow. Ships v1.0.0 of the round-6 T-6 track per `projects/blueprint-library/specs/cloudflare-round-6-spec-2026-09-06.md` section 5.6.

- **Category:** `edge`.
- **Capability provided:** `edgeRateLimit`.
- **Global topic minted:** `edgeThrottleContract` (ADR-3701, scope global).
- **Suggested companions:** `logging`, `errorHandling`, `secretsManagement`.

## The five REQs

| Id | What it commits |
| --- | --- |
| REQ-001 | Local rules manifest: one JSON file per rule under the elicited `rate-limit-rules-dir` (default `cloudflare/rate-limits/`) carries the seven documented fields. |
| REQ-002 | Operator-facing management surface: a documented wrangler or Cloudflare-dashboard flow the operator runs to apply the manifest to the live zone. No committed script. |
| REQ-003 | Over-threshold behaviour: over the rule limit within the period, the (N+1)th and subsequent requests within the elicited duration return 429 with `Retry-After` and `Cf-Ray`; the origin never sees them. |
| REQ-004 | Drift audit: an opt-in scheduled runner reads live zone rules via the Cloudflare API and diffs against the local manifest, constructing metadata-only records per REQ-005 event-secrecy. |
| REQ-005 | Composition with `security-auth-magic-link`: the zone rule sits OVER the per-email application rule per ADR-3702 layering. |

## Elicited parameters

- `rate-limit-rules-dir` (default `cloudflare/rate-limits`): where the applying project commits manifest files.
- `rate-limit-zone-id` (default empty): the Cloudflare zone id the rules apply to. Never inlined in a manifest file; stored via the applied `secretsManagement` companion.
- `rate-limit-management-surface` (default `both`): `wrangler`, `dashboard`, or `both`. Records the operator's flow choice; the guide walks both.
- `rate-limit-drift-audit-cadence` (default `daily`): `off`, `daily`, `hourly`. Per ADR-3704.

## Manifest shape (TAC-3701)

The shipped JSON Schema at `contributions/schemas/rate-limit-rule.schema.json` (draft-07) names the seven required fields per `https://developers.cloudflare.com/waf/rate-limiting-rules/`:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Stable operator-facing rule id (kebab-case). Used as `ruleId` in drift-audit records. |
| `expression` | string | Cloudflare WAF rules-language expression scoping the rule. |
| `threshold` | integer >=1 | Requests permitted per period on the characteristic set. |
| `period` | integer >=1 | Window in seconds the threshold applies over. |
| `characteristics` | string[] (non-empty) | Characteristic strings the rule keys on (e.g. `ip.src`, `cf.colo.id`). |
| `action` | enum | `block`, `challenge`, `log`, `managed_challenge`. |
| `duration` | integer >=1 | Block window in seconds the (N+1)th and subsequent requests are refused for. |

`additionalProperties: false`; a `description` field is optional.

## Probes

Four Node-only probes under `contributions/probes/`; three run in CI, one is account-bound and skips per ruling 6.

| Probe | Anchor AC | `accountBound` | What it drives |
| --- | --- | --- | --- |
| `manifest-presence.mjs` | AC-36101-1 (also AC-36108-1 under `SIMULATE_MANIFEST_MISSING=true`) | false | Reads `cf-edge/cloudflare/rate-limits/`, asserts every file parses, carries the seven required fields and holds no plaintext secret. |
| `manifest-schema-validate.mjs` | AC-36106-1 | false | Validates every manifest file against the shipped JSON Schema. Under `SIMULATE_SCHEMA_INVALID=true` writes a scratch file missing `threshold` and fails. |
| `event-secrecy.mjs` | AC-36107-1 | false | Drives the shipped drift-audit runner realisation with a synthetic manifest and a fake fetch; asserts every drift record carries only `{ruleId, clientIpHash, outcome, timestamp, diff}`. Under `SIMULATE_EVENT_LEAK_IP=true` the runner injects a full IP and the probe fails. |
| `real-account-burst-and-429.mjs` | AC-36103-1 | true | Fires an in-process burst against `CF_RATE_LIMIT_URL` under `CI_HAS_CLOUDFLARE_ACCOUNT=true` and asserts the (N+1)th and subsequent responses return 429 with `Retry-After` and `Cf-Ray`. Without either env var records `accountBoundSkipped: true` and aggregates to `pass` per spec section 3.5 and ruling 6. |

### Ruling 6 restated

Spec section 1, verbatim: "If the rate-limiting real-account burst probe is not CI-feasible, ship with the local manifest AC and mark the burst check account-bound skipped." Without `CI_HAS_CLOUDFLARE_ACCOUNT` the CI verdict for `real-account-burst-and-429` is `accountBoundSkipped: true` and this IS the accepted verdict; the aggregate flips to `pass`. The local manifest ACs (AC-36101-1, AC-36106-1, AC-36107-1) always run and always gate the ship.

## Composition with `security-auth-magic-link` (ADR-3702)

When both blueprints apply, the zone-level rate rule (characteristic set: IP-per-URL) sits at the CF edge and refuses the (N+1)th request for the elicited duration before it reaches the origin; the `security-auth-magic-link` per-email application rate limiter (characteristic set: per-email per-minute) continues to run on requests that pass the edge gate at the mint-surface. The two rules operate on different characteristic sets and are additive, not overlapping. See the guide for a copy-paste example.

## Standards trace

- ADR-3701: `Cloudflare WAF rate-limiting rules documented shape` (`https://developers.cloudflare.com/waf/rate-limiting-rules/`).
- ADR-3702, ADR-3703, ADR-3704: `generic enterprise practice`.

## Vendor citations

- Cloudflare WAF rate-limiting rules: `https://developers.cloudflare.com/waf/rate-limiting-rules/` (documents `expression`, `threshold`, `period`, `characteristics`, `action`, `duration`; fetched 200 on 2026-09-07 for the round-6 T-6 ship).

## Known mechanism-reach gaps

- The over-threshold observable (AC-36103-1) is only proven at the runtime seam with a real Cloudflare account. In CI without `CI_HAS_CLOUDFLARE_ACCOUNT` the probe records `accountBoundSkipped: true` per ruling 6; the local manifest and event-secrecy ACs cover source-observable correctness.
