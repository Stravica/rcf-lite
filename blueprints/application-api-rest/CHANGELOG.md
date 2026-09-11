# application-api-rest CHANGELOG

## 2.1.6 (criterion-e positive-evidence probes, 2026-09-11)

- Adds a contributions/probes pack that meets rule 7d: real HTTP round trips against the dependency-free sample-app fixture at packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/. Each probe records the fixture-echoed x-fixture-request-id header, response status and a distinctive body excerpt as evidence.
- Probes: cursor-pagination-round-trip, health-probes-distinct, problem-details-on-error, request-id-echoed.
- No account-bound branch: the engine is a local fixture, so no CI_HAS_* gate is invented. Fixture README declares every env var the probes read (PORT, PROBE_PORT in the reserved 47300-47399 range).
- 7d addendum 2026-09-11 applied: probe-utils.aggregate([]) now returns fail with detail no checks ran (rule 3); anatomy test asserts each result carries one of the four 7d evidence shapes (rule 6); probe-vs-fixture symmetry avoided (rule 2); AC anchors ride on the anchorReqId when no AC states the property (rule 1).
- Anatomy test extended to pin the pack shape (probe modules, run-*.mjs wrappers, probe-utils.mjs helper, anchorReqId cross-check against contributed REQs, fixture env-var declaration).


## 2.1.5 - 2026-09-10

Findings closed: F-2, F-3, F-4, F-5, F-6, F-7, F-8. Template-AC fill-in clauses on AC-2102-2, AC-2104-6, AC-2106-4, AC-2108-4, AC-2112-1, AC-2118-3 and AC-2119-5 now enumerate the specific applying-project substitutions (declared property-name casing, documentation-exposure policy per environment, operation-to-auth-class mapping onto the four classes fixed on REQ-005, resolved startup-probe path, idempotency-key verb-and-class combinations, deploy documentation location and order, verification-pipeline definition) in place of the generic phrasing. TAC-303-application-api-rest-contract-surface patch-bumped to 1.0.2: responsibilities[2] now names `x-idempotency-key` (`required` or `forbidden`) explicitly and references AC-2112-1.


## 2.1.4 - 2026-09-10

Dimension-d single-definition-ownership cleanup on REQ-013: REQ description now references the request-id header owned on TAC-301.responsibilities[0] rather than restating the header literal. Chain-consistency lint zero on pass 1 and pass 2.

## 2.1.3 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 2.1.2 (application-core completion pass, 2026-09-09)

- Donor hand-sweep on all 118 ACs: flipped 24 additional ACs from fixed to template where the assertion carries a project-set literal (deprecation dates, per-endpoint auth-class binding, downstream dependency sets on readiness, resolved probe paths, declared page-size and maximum limits, filter parameter and sortable-key sets, key-required operation set, de-duplication TTL, per-class rate-limit values and window durations, per-endpoint rate-limit overrides, log-level per class, histogram bucket boundaries, per-endpoint CORS overrides, PII-redaction policy). Each flipped AC carries an Applying agent sets: <specific values> clause. Final split: 87 fixed / 31 template.
- Adds vendorCitation to seven ACs whose assertions rest on RFC wire shapes: AC-2102-3 cites RFC 3339 (Date and Time on the Internet: Timestamps); AC-2111-1 through AC-2111-6 cite RFC 7807 (Problem Details for HTTP APIs). Both citation URLs point at datatracker.ietf.org and carry verifiedOn 2026-09-09 (fetched via WebFetch during this pass).

## 2.1.1 (application-core hardening, 2026-09-09)

- hardening pass: chain-consistency lint zero (pass1 + pass2); added deliveredBy to every REQ, added ownerRef and disposition to every AC per section 7b, closed case drifts on `content-type` and `idempotency-key` in REQ-002, REQ-010, AC-2102-4, AC-2102-5, AC-2112-1, AC-2112-2 and ADR-306 to match the owner spellings on TAC-301.
- Added AC-2108-9 (readiness deadline: aggregate 503 naming the failed check id and the configured deadline while liveness continues at 200) covering the 2026-09-08 review finding F-1 on TAC-306.interfaces[0] (readiness check registry).
