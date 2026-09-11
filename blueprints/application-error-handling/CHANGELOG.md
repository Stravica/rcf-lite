# application-error-handling CHANGELOG

## 1.0.6 (criterion-e closure follow-up, 2026-09-11)

- Second closure follow-up on the criterion-e pack:
  - Anatomy test hardened to Addendum 3 rule 14; header refreshed from v1.0.0 to v1.0.6.
  - Process-boundary probe (AC-16101-1) now spawns the fixture as a child process, POSTs /crash-process to induce an uncaught exception, and records the child's OS exit code from process.on('exit'), replacing the fixture-authored didExit field (Addendum 3 rule 12).
  - Companion factory (REQ-004): fixture accepts a companion-factory injection via startServer({ companion }); the probe asserts the companion is invoked and observes emissions independently.
  - Cause records now nest a full six-field ADR-1701 record inside cause[] rather than {message,category}; record-shape probe walks the nested cause list.
  - notObservableHereResult helper added.

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
