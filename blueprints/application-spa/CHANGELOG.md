# application-spa CHANGELOG

## 1.5.11 - 2026-09-11

- Adds a contributions/probes pack meeting rule 7d: each probe drives a real HTTP round trip against the dependency-free sample-app fixture at packages/rcf-lite/test/fixtures/probe-pack-application-spa/ and records the fixture-echoed x-fixture-request-id, response status, a distinctive body excerpt, the varied input and the derived output on every result row.
- Probes: route-inventory-published, shell-nav-present, designed-empty-state.
- Route-inventory probe injects two independent route sets into startServer({ routes }); reads /__routes and /__mounted for each; asserts both endpoints follow the injected input verbatim; asserts declared paths respond 200 and out-of-inventory paths return 404. Route inventory completeness is derived from probe-controlled input, not from fixture self-agreement.
- Fixture README declares every env var the probes read (PORT, PROBE_PORT in the reserved 47300-47399 range). No account-bound branch: the engine is a local fixture.
- Empty results now fail with detail "no checks ran"; anatomy test asserts each result carries evidence with a non-empty x-fixture-request-id AND a body excerpt or derived value, or an honest notObservableHere / accountBoundSkipped row carrying a shipped AC id; status zero never counts; {} is rejected as a populated derived value.
- notObservableHere rows anchor nothing else (no anchorAcId, no anchorReqId); conformanceOnly rows carry a limitation naming the specific AC id and the property not observed.
- Anatomy test pin bumped to 1.5.11 (probe modules, run-*.mjs wrappers, probe-utils.mjs helper, anchorReqId cross-check against contributed REQs, fixture env-var declaration).


## 1.5.6 - 2026-09-10

Findings closed: F-3, F-4, F-5, F-6, F-7, F-8, F-9. Template-AC fill-in clauses on AC-1101-1, AC-1102-3, AC-1106-2, AC-1114-1 and AC-1131-3 now enumerate the specific applying-project substitutions (route inventory location, secondary-navigation toggle and breakpoint, semantic-token file and added keys, journey inventory and per-step states, UI-bearing routes and strict-CSP header set) in place of the generic "project-specific bindings, routes, thresholds, budgets, and names" phrasing. Register cleanup on the AC-1131-3 description (partial-acceptance defect described without prior-review internal identifiers) and on README shipped prose (removed prior-review internal identifiers, the numbered ratified-decision reference, and the dated ratified-policy reference).


## 1.5.5 - 2026-09-10

Dimension-d single-definition-ownership cleanup on REQ-009: REQ description now references the deep-link return-to behaviour owned on `TAC-201-application-spa-app-shell.responsibilities[5]` rather than restating it; `deliveredBy.field` re-pointed at `responsibilities[5]` (was generic `responsibilities`). Corrected the 1.5.4 changelog line that recorded the obsolete `responsibilities[0]` ownerRef for AC-1135-2 to `responsibilities[5]`. REQ-009 patch-bumped. Chain-consistency lint clean.

## 1.5.4 - 2026-09-10

Dimension-b acceptance-criteria-sufficiency cleanup on US-1134 and US-1135: each story previously shipped a single AC. AC-1134-2 added to bind the icon-adherence probe refusal path on inline-SVG or unknown-alias violations against the primary-navigation slot (ownerRef TAC-208.interfaces.runIconAdherenceProbe). AC-1135-2 added to bind the signed-in and post-sign-out deep-link preservation and return-to flow on the app shell (ownerRef TAC-201.responsibilities[5]). Chain-consistency lint clean.

## 1.5.3 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.5.2 (application-core completion pass, 2026-09-09)

- Donor hand-sweep on all 197 ACs: flipped 19 additional ACs from fixed to template where the assertion carries a project-set literal (per-project section inventories, viewport table widths, journey-inventory checkpoints and events, per-route empty-state text, cache-invalidation entry sets, canonical URL shapes cache keys derive from, offline telemetry buffer bound N, per-route payload budgets, external-dependency inventory, deferral-record path and metadata, core-flow definitions, plus the two review-fix-pass flips on AC-1111-5 tablist activation mode and AC-1116-2 journey preservation set). Each flipped AC carries an Applying agent sets: <specific values> clause. Final split: 173 fixed / 24 template.
- Register-and-citation sweep 2026-09-10: vendorCitation added to AC-1126-4 (WCAG 2.5.8 target-size-minimum) and AC-1126-7 (WCAG 2.2 recommendation); the completion sweep flipped AC-1111-5 and AC-1116-2 to template with Applying agent sets clauses; internal work-item ids stripped from README v1.2.0 and v1.3.0 changelog paragraphs, from TAC-209 responsibility and tradeoffs, from TAC-210 and TAC-211 purpose, and from AC-1131-3 (the class defect is named without the internal id); spa guide counts corrected to 76 documents / 35 user stories / 197 acceptance criteria.

## 1.5.1 (application-core hardening, 2026-09-09)

- Hardening cleanup: chain-consistency lint clean; added deliveredBy to every REQ pointing at a TAC responsibility or interface, added ownerRef and disposition to every AC per section 7b, closed case drifts on `content-security-policy` in REQ-018, AC-1125-1 and AC-1131-1 to match the owner spelling on TAC-209.
- Added AC-1123-6 (telemetry buffer overflow with drop-oldest and drop-count observability on reconnect) covering the 2026-09-08 review finding F-1 on TAC-206.responsibilities[3], and AC-1107-6 (theme persistence failure: visible session-only theme, aria-live unsaved announcement, no persisted preference) covering F-2 on TAC-202.responsibilities[2].
