# observability-essentials CHANGELOG


## 2.1.1 - 2026-09-10

Dimension-d single-definition-ownership cleanup on REQ-007: REQ description now references the JSON media-type header owned on TAC-801.responsibilities[1] rather than restating the header literal. Chain-consistency lint zero on pass 1 and pass 2.

## 2.1.0 (hardening pass B4, 2026-09-09)

- Adds `elicits[]` with four apply-time answers: `liveness-probe-path` (string, default /live; REQ-001), `readiness-probe-path` (string, default /ready; REQ-002), `declared-dependency-set` (string, comma-separated; REQ-003), and `notification-outcome-substrate` (enum sqlite/postgres/custom, default sqlite; REQ-006). Every option value is backed by a must-priority REQ description (section 7c criterion a).
- Adds `deliveredBy` to every REQ (REQ-001/002/003/007/010 -> TAC-801/TAC-802 interface names; REQ-004/005 -> TAC-803; REQ-006 -> TAC-804; REQ-008 -> ADR-804; REQ-009 -> ADR-803). Closes 8 pass-2 lint findings; per-blueprint lint reports zero on pass 1 and pass 2.
- Closes F-4 chain-contradiction specimen: AC-7107-3 previously compared v1.0.0 to future v1.x while the blueprint is v2. Rewrites the AC as a v2-baseline snapshot compatibility check against `blueprints/observability-essentials/assets/probe-samples/probe-response-baseline.v2.json` with stable-coded PROBE_BODY_SHAPE_DRIFT on rename or removal.
- Closes F-1 (liveness self-check failure without AC coverage): adds AC-7101-5 asserting a response-capable in-process self-check predicate answers HTTP 503 with content-length 0 on fail and returns to 200 on pass; the AC is `template` because the predicate itself is project-owned.
- Closes F-2 (boot-refuse ACs for dependency declaration): adds AC-7103-4 (deps missing -> READINESS_DEPS_MISSING), AC-7103-5 (duplicate name -> READINESS_DEPS_DUPLICATE, template on the declared set), AC-7103-6 (blank/malformed name -> READINESS_DEPS_MALFORMED).
- Closes F-3 (durable outcome sink): adds AC-7106-4 asserting outcome records survive a sink restart (template on the elicited notification-outcome-substrate) and AC-7106-5 asserting a failed write signals NOTIFICATION_OUTCOME_WRITE_FAILED to the caller and does not fabricate a success record.
- Re-sweeps every existing AC's `disposition` per section 7b: ACs marked `template` (those whose text references elicited paths, project-declared dependencies, or the elicited substrate) with `templateFillIns` naming which values the applying agent sets; the remaining ACs stay `fixed`.
- Review fix pass (F-2/F-3): adds `probeBodyShapeCompatibility` interface entry to TAC-802 that owns the cross-probe response body shape contract and names `PROBE_BODY_SHAPE_DRIFT`; updates AC-7107-3.ownerRef from ADR-803.decision.probeBodyShape (which the decision text did not carry) to TAC-802.interfaces.probeBodyShapeCompatibility; moves the v2 baseline snapshot from `packages/rcf-lite/test/blueprint/` to `blueprints/observability-essentials/assets/probe-samples/probe-response-baseline.v2.json` so its placement matches its documentation-fixture nature (no suite test read it in the previous location).
- Review fix pass (F-7): extends REQ-006 description with a runtime clause per substrate option (`sqlite`, `postgres`, `custom`), literally named and each backed as the accepted values the notification-outcome-substrate elicit resolves at boot (AC-7106-4 exercises the restart path across substrates; AC-7106-5 exercises the failed-write path).
