# application-api-rest CHANGELOG

## 2.1.10 - 2026-09-11

- Adds a contributions/probes pack meeting rule 7d: each probe drives a real HTTP round trip against the dependency-free sample-app fixture at packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/ and records the fixture-echoed x-fixture-request-id, response status, a distinctive body excerpt, the varied input and the derived output on every result row.
- Probes: cursor-pagination-round-trip, problem-details-on-error, health-probes-distinct, request-id-echoed.
- Cursor probe varies limits and derives forward/backward traversal from server-side cursor state (opaque UUID keys over a CURSOR_MAP, not positional JSON); malformed cursor and over-limit rows produce 400 with problem-details bodies anchored on AC-2109-3 and AC-2109-5.
- Liveness returns 200 with zero dependency checks and readiness reports checked dependencies (matches AC-2108-1).
- Detail texts open with the first eight words of the AC or REQ text they observe, then " - " and the derived observation.
- Anatomy test pin bumped to 2.1.10; strict evidence predicate; notObservableHere.ac resolves against a shipped AC id.


## 2.1.5 - 2026-09-10

Template-AC fill-in clauses on AC-2102-2, AC-2104-6, AC-2106-4, AC-2108-4, AC-2112-1, AC-2118-3 and AC-2119-5 now enumerate the specific applying-project substitutions (declared property-name casing, documentation-exposure policy per environment, operation-to-auth-class mapping onto the four classes fixed on REQ-005, resolved startup-probe path, idempotency-key verb-and-class combinations, deploy documentation location and order, verification-pipeline definition) in place of the earlier generic phrasing, so applying projects have precise values to fill in. TAC-303-application-api-rest-contract-surface patch-bumped to 1.0.2: responsibilities[2] now names `x-idempotency-key` (`required` or `forbidden`) explicitly and references AC-2112-1.


## 2.1.4 - 2026-09-10

Dimension-d single-definition-ownership cleanup on REQ-013: REQ description now references the request-id header owned on TAC-301.responsibilities[0] rather than restating the header literal. Chain-consistency lint clean.

## 2.1.3 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 2.1.2 (application-core completion pass, 2026-09-09)

- Donor hand-sweep on all 118 ACs: flipped 24 additional ACs from fixed to template where the assertion carries a project-set literal (deprecation dates, per-endpoint auth-class binding, downstream dependency sets on readiness, resolved probe paths, declared page-size and maximum limits, filter parameter and sortable-key sets, key-required operation set, de-duplication TTL, per-class rate-limit values and window durations, per-endpoint rate-limit overrides, log-level per class, histogram bucket boundaries, per-endpoint CORS overrides, PII-redaction policy). Each flipped AC carries an Applying agent sets: <specific values> clause. Final split: 87 fixed / 31 template.
- Adds vendorCitation to seven ACs whose assertions rest on RFC wire shapes: AC-2102-3 cites RFC 3339 (Date and Time on the Internet: Timestamps); AC-2111-1 through AC-2111-6 cite RFC 7807 (Problem Details for HTTP APIs). Both citation URLs point at datatracker.ietf.org and carry verifiedOn 2026-09-09 (fetched via WebFetch during this pass).

## 2.1.1 (application-core hardening, 2026-09-09)

- Hardening cleanup: chain-consistency lint clean; added deliveredBy to every REQ, added ownerRef and disposition to every AC per section 7b, closed case drifts on `content-type` and `idempotency-key` in REQ-002, REQ-010, AC-2102-4, AC-2102-5, AC-2112-1, AC-2112-2 and ADR-306 to match the owner spellings on TAC-301.
- Added AC-2108-9 (readiness deadline: aggregate 503 naming the failed check id and the configured deadline while liveness continues at 200) on TAC-306.interfaces[0] (readiness check registry), so applying projects have an explicit acceptance criterion for the readiness-deadline path.
