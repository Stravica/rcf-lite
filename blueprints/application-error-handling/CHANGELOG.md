# application-error-handling CHANGELOG

## 1.0.5 (criterion-e closure follow-ups, 2026-09-11)

- Follow-up fixes to the criterion-e pack (external review, 2026-09-11):
  - AC anchoring: every result row carries anchorAcId (fell back to anchorReqId per Addendum rule 1 only where no AC states the property; noted per row).
  - Constant-echo removed: probes now vary inputs and assert derived outputs (Addendum rule 2). Sort compares against a JS-side comparator over the returned rows; search asserts row-content narrowing; SPA inventory is crawled per path.
  - Fixture request-id: probe-side monkey-patch removed; every fixture now stamps x-fixture-request-id from its own request pipeline.
  - Teardown errors surface (Addendum rule 5): close() rejects on the underlying error.
  - Anatomy strengthened to pin the four 7d evidence shapes per row.
  - Register: passive voice on the empty-results comment (no first-person plural).
- Fixture: record shape switched to the exact ADR-1701 six fields (code, category, message, correlationId, cause, context). Category vocabulary switched to the ADR-1702 defaults (transient, permanent, unknown); unelicited tokens refused at construction per AC-16105-4. Framework boundary at /throw-handler proves stack/path/URL scrubbing per AC-16102-2; process boundary at /crash-process reports didExit=1 per AC-16101-1.

## 1.0.4 (criterion-e positive-evidence probes, 2026-09-11)

- Adds a contributions/probes pack that meets rule 7d: real HTTP round trips against the dependency-free sample-app fixture at packages/rcf-lite/test/fixtures/probe-pack-application-error-handling/. Each probe records the fixture-echoed x-fixture-request-id header, response status and a distinctive body excerpt as evidence.
- Probes: two-boundaries-registered, record-shape-adr-1701, category-vocabulary.
- No account-bound branch: the engine is a local fixture, so no CI_HAS_* gate is invented. Fixture README declares every env var the probes read (PORT, PROBE_PORT in the reserved 47300-47399 range).
- 7d addendum 2026-09-11 applied: probe-utils.aggregate([]) now returns fail with detail no checks ran (rule 3); anatomy test asserts each result carries one of the four 7d evidence shapes (rule 6); probe-vs-fixture symmetry avoided (rule 2); AC anchors ride on the anchorReqId when no AC states the property (rule 1).
- Anatomy test extended to pin the pack shape (probe modules, run-*.mjs wrappers, probe-utils.mjs helper, anchorReqId cross-check against contributed REQs, fixture env-var declaration).


## 1.0.3 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.0.2 (application-core completion pass, 2026-09-09)

- Adds top-level elicits[] block on blueprint.json declaring the one apply-time answer (classification-additions); backed by REQ-003 naming the transient/permanent/unknown defaults and the elicited-additions grammar per section 7c.
- Adds refusal-path ACs to US-16102 (stack-and-path scrubbing, non-Error throw defaults, mid-stream exception connection close), US-16104 (non-object context refusal, nested-and-array redaction, circular context handling), US-16105 (permanent no-Retry-After, unknown mapped as permanent, elicited-category retry contract), US-16106 (no-companion fallback stderr JSON single line, direct console.error passthrough, companion factory throw fallback), US-16107 (null-injection refusal, stub invocation contract, transportWriter throw recovery). US-16101 and US-16103 also extended with clean-shutdown preservation, browser-runtime path, double-throw handling, deep cause chain, cause-context redaction and null-vs-undefined cause discipline. Every story now at the 7a floor (4-5 ACs per story, 30 ACs total).

## 1.0.1 (application-core hardening, 2026-09-09)

- hardening pass: chain-consistency lint zero (pass1 + pass2); added deliveredBy to every REQ, added ownerRef and disposition to every AC per section 7b, closed `boundaryFor` and `transportWriter` restatements on AC-16107-1 via ownerRef back to TAC-1701.
- Added AC-16101-2 (unhandled promise rejection: one record under the `unknown` category, process terminates with exit code 1) covering the 2026-09-08 review finding F-1 on TAC-1701.responsibilities[0].
