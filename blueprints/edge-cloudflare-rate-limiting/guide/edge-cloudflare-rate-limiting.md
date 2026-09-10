# edge-cloudflare-rate-limiting guide

Round 6 T-6 of the Cloudflare-first blueprint line. Ships zone-level rate limiting as an edge gate in front of Worker handlers. The rule set is a local manifest the applying project commits, and an operator applies it to the live Cloudflare zone through either a wrangler command flow or the Cloudflare dashboard flow, both walked below.

## Manifest

The applying project holds its rate-limit rule set as one JSON file per rule under the elicited `rate-limit-rules-dir` (default `cloudflare/rate-limits/`) per ADR-3703. Every file matches the shipped JSON Schema (`contributions/schemas/rate-limit-rule.schema.json`, draft-07) and carries the seven Cloudflare WAF rate-limiting rules documented fields per `https://developers.cloudflare.com/waf/rate-limiting-rules/`.

Example (`cloudflare/rate-limits/public-api-per-ip.json`):

```
{
  "id": "public-api-per-ip",
  "expression": "(http.request.uri.path matches \"^/api/\")",
  "threshold": 60,
  "period": 60,
  "characteristics": ["ip.src", "cf.colo.id"],
  "action": "block",
  "duration": 60,
  "description": "Per-IP-per-colo throttle on /api/*; the (N+1)th request in 60s is blocked for 60s."
}
```

The zone id is elicited (`rate-limit-zone-id`) and stored through the applied `secretsManagement` companion; a manifest file never inlines a zone id or an API token.

## Management surface

The blueprint ships no committed script that writes rules to the live zone. The operator applies each rule through one of two documented flows, or both. The elicited `rate-limit-management-surface` value records the choice.

### wrangler flow

The wrangler flow uses the Cloudflare API through a hand-run command sequence. The steps for one rule are:

1. Set `CLOUDFLARE_API_TOKEN` (and `CLOUDFLARE_ACCOUNT_ID` for the account scope) in the operator's environment. Store both through the applied `secretsManagement` companion; never commit them to the git tree.
2. Load the elicited zone id: `export CF_ZONE_ID=$(cat rcf/blueprints/edge-cloudflare-rate-limiting.applied.json | jq -r .elicits.rateLimitZoneId)` or read it from the applied vault seam.
3. Fetch the existing rate-limiting ruleset id for the zone via the wrangler-installed API-fetch helper: `wrangler api curl "/zones/${CF_ZONE_ID}/rulesets?phase=http_ratelimit" --method GET` and note the `id` on the returned ruleset (create one if none exists per the vendor doc).
4. For each rule file, `POST` the rule shape to the ruleset's `/rules` endpoint. The rule body is built from the manifest file by mapping each field one-to-one: `expression`, `action`, and a `ratelimit` object carrying `characteristics`, `period`, `requests_per_period` (from `threshold`), and `mitigation_timeout` (from `duration`).
5. Verify by listing the ruleset again and confirming every manifest rule appears with the expected fields.

The vendor doc `https://developers.cloudflare.com/waf/rate-limiting-rules/` names the endpoint shape verbatim; the wrangler flow is a hand-run reproduction of that shape.

### Cloudflare dashboard flow

The dashboard flow applies each rule through the Cloudflare zone dashboard. The steps for one rule are:

1. Open the target zone in the Cloudflare dashboard.
2. Navigate to Security -> WAF -> Rate limiting rules.
3. Click Create rule; give the rule the manifest file's `id` as the operator-facing name.
4. In When incoming requests match, set the Custom filter expression to the manifest `expression` (Edit expression toggle to paste raw).
5. In Then take action, set the action to the manifest `action` (Block, Managed challenge, JS challenge or Log). Set the Duration to the manifest `duration` in seconds.
6. In With the following properties, set the counting period to the manifest `period` seconds, the requests per period to the manifest `threshold`, and the characteristics to the manifest `characteristics` array (each string mapped to the dashboard's Same request property selectors).
7. Save the rule. Repeat for every file in the manifest directory.

Both flows produce the same shape on the live zone; the operator picks the flow that fits the project's operating discipline. The elicited `rate-limit-management-surface` records which flow the operator committed to at apply time.

## Composition with security-auth-magic-link

Per ADR-3702, when both `edge-cloudflare-rate-limiting` and `security-auth-magic-link` apply on the same project, the zone-level rate rule layers OVER the per-email application rule. The two rules operate on different characteristic sets and are additive:

| Rule | Characteristic set | Where it runs |
| --- | --- | --- |
| Zone rule (this blueprint) | IP-per-URL (e.g. `ip.src` + `http.request.uri.path`) | Cloudflare edge, before any origin Worker code |
| Application rule (magic-link) | per-email per-minute | Origin Worker mint-surface handler |

Copy-paste example (applying both blueprints in the same project):

```
rcf define blueprint add ./blueprints/edge-cloudflare-rate-limiting \
  --answer rate-limit-rules-dir=cloudflare/rate-limits \
  --answer rate-limit-zone-id=<vault-ref> \
  --answer rate-limit-management-surface=both \
  --answer rate-limit-drift-audit-cadence=daily

rcf define blueprint add ./blueprints/security-auth-magic-link \
  --answer magic-link-mint-rate-limit=5perMinute
```

The applied recorder records both blueprints so the operator sees the two-rule shape at apply time.

## Drift audit

The blueprint ships a scheduled drift-audit runner realisation in the `cf-edge` fixture at `packages/rcf-lite/test/fixtures/cf-edge/src/drift-audit-runner.mjs`. The runner exports `createDriftAuditRunner({env, eventSink, fetch, clock, cadence, manifestLoader})` per TAC-3703 and fetches the live rules on the elicited zone via `https://api.cloudflare.com/client/v4/zones/{zone_id}/rulesets`, diffs field-by-field against the local manifest, and constructs one drift-audit record per mismatched rule with the metadata-only shape `{ruleId, outcome, timestamp, diff}` (no `clientIpHash` on the drift record; drift is manifest-vs-live divergence, not a request event). The separate request-event record class emitted by the applied guard on a real client request carries `{ruleId, clientIpHash, outcome, timestamp}`. No record carries a full client IP, a request body or a user agent (event-secrecy discipline per REQ-005 and AC-36107-1).

The elicited `rate-limit-drift-audit-cadence` per ADR-3704 picks `off` (runner not wired), `daily` (24-hour cadence, `recommendedDefault`), or `hourly`.

## Runtime observable and CI

Per spec section 3.1 and ruling 6, the runtime observable for `AC-rateLimiting-overThresholdBlocks` (US-36103/AC-36103-1) is the real-account burst probe. In CI without `CI_HAS_CLOUDFLARE_ACCOUNT` and `CF_RATE_LIMIT_URL`, the probe records `accountBoundSkipped: true` and aggregates to `pass`; this IS the accepted CI verdict. The three local probes (manifest presence, manifest schema validate, event secrecy) always run and always gate the ship.
