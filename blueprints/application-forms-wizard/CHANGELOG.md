# application-forms-wizard CHANGELOG

## 1.2.2 (criterion-e closure follow-ups, 2026-09-11)

- Follow-up closure fixes to the criterion-e pack (Codex closure 2026-09-11):
  - AC anchoring: every result row carries anchorAcId (fell back to anchorReqId per Addendum rule 1 only where no AC states the property; noted per row).
  - Constant-echo removed: probes now vary inputs and assert derived outputs (Addendum rule 2). Sort compares against a JS-side comparator over the returned rows; search asserts row-content narrowing; SPA inventory is crawled per path.
  - Fixture request-id: probe-side monkey-patch removed; every fixture now stamps x-fixture-request-id from its own request pipeline.
  - Teardown errors surface (Addendum rule 5): close() rejects on the underlying error.
  - Anatomy strengthened to pin the four 7d evidence shapes per row.
  - Register: passive voice on the empty-results comment (no first-person plural).
- Fixture: ?blurred=1 and ?corrected=1 timing markers plus a POST /validate endpoint drive AC-24102-1 blur/submit-failure/change/rebuild derivations. x-fixture-request-id stamped natively.

## 1.2.1 (criterion-e positive-evidence probes, 2026-09-11)

- Adds a contributions/probes pack that meets rule 7d: real HTTP round trips against the dependency-free sample-app fixture at packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard/. Each probe records the fixture-echoed x-fixture-request-id header, response status and a distinctive body excerpt as evidence.
- Probes: task-list-surface, step-page-shape, draft-persistence-round-trip.
- No account-bound branch: the engine is a local fixture, so no CI_HAS_* gate is invented. Fixture README declares every env var the probes read (PORT, PROBE_PORT in the reserved 47300-47399 range).
- 7d addendum 2026-09-11 applied: probe-utils.aggregate([]) now returns fail with detail no checks ran (rule 3); anatomy test asserts each result carries one of the four 7d evidence shapes (rule 6); probe-vs-fixture symmetry avoided (rule 2); AC anchors ride on the anchorReqId when no AC states the property (rule 1).
- Anatomy test extended to pin the pack shape (probe modules, run-*.mjs wrappers, probe-utils.mjs helper, anchorReqId cross-check against contributed REQs, fixture env-var declaration).


## 1.2.0 (2026-09-10)

### Added

- Five elicits (`step-manifest`, `navigation`, `step-indicator`, `draft-transport`, `validation-policy`) declared on blueprint.json; REQ-006 binds one runtime clause per apply-time answer family.
- Vendor citations on AC-24101-1 (GOV.UK task-list) and AC-24103-1 (ARIA aria-invalid).

### Changed

- AC-24106-2 references `ADR-2503.decision` via ownerRef (`task-list` / `aria-progressbar-only` / `breadcrumb`).
- REQ-002.deliveredBy retargeted to `TAC-2502.responsibilities.validationTimingGate` (new responsibility carrying the on-blur / on-change / on-submit clauses).
- REQ-003.deliveredBy retargeted to `TAC-2502.interfaces.renderSummary`.
- REQ-004.deliveredBy retargeted to `TAC-2501.responsibilities.renderSummaryReview` (new responsibility).
- AC-24101-1 references `TAC-2501.interfaces.statesEnum` via ownerRef; drops the four-value restatement.

## 1.1.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.1.0 (2026-09-10, hardening pass)

### Added

- Failure-path acceptance criteria on US-24101 (STEP_STATE_UNKNOWN refusal, Cannot start yet blocker announcement), US-24102 (error summary field bindings, throwing validator surface), US-24103 (submit refusal focus and summary link focus contract), US-24104 (summary submit failure preserves answers), US-24105 (server-side POST failure with unsaved banner, localStorage denial with fallback, hydrate failure), US-24106 (step-indicator apply refusal for values outside the closed set), US-24107 (in-progress list read failure with cache, cross-principal draft refusal), US-24108 (fallback empty message when application-empty-error-states not applied). Closes review finding F-1.
- Vendor citations on the GOV.UK task-list-pages and error-summary acceptance criteria (verified 2026-09-10).

### Changed

- Every REQ now carries a deliveredBy link into TAC-2501 (task-list), TAC-2502 (error-summary) or TAC-2503 (draft-store).
- Every AC on every user story now carries an explicit disposition (fixed or template).

## 1.0.0 (visual round, spec 2026-09-06)

- First ratified version of the shelf's forms-wizard blueprint. Five REQs (task-list contract with the closed GOV.UK vocabulary Cannot start yet, Not started, In progress, Completed and an ARIA progressbar wrapper; per-step validation timing with on-blur before first submit then on-change after first failure and a full pass on submit reusing SPA forms-engine TAC-205; error-summary contract with a top-of-page summary, skip links, aria-invalid on the field, aria-describedby to the field-level message and focus moved to the summary heading; summary-review contract with a summary-list per step, Change links per row and answer retention on save; save-and-return contract with a server-side draft table or a client-side local buffer with a sync tick, refuses to ship if neither is wired), eight USs 24101 to 24108 binding one runtime-observable AC per contract plus three cross-cutting cases (linear-vs-free navigation, in-progress list, no-in-progress empty state delegated to application-empty-error-states), three TACs 2501 to 2503 (task-list shell, error-summary contract, draft store), three ADRs 2501 to 2503 (navigation posture linear default with elicited free branch, save-and-return transport with no recommendedDefault so the abandoned-draft loss class does not ship silently, step-indicator shape with task-list default and elicited ARIA progressbar-only or breadcrumb). No new global topics.
- Ships `probe-packs/application-forms-wizard.pack.mjs`: four surface-observable browser-verify checks anchored one per core contract (`AC-24101-1` task-list, `AC-24103-1` error-summary, `AC-24104-1` summary-review, `AC-24105-1` save-and-return). Every URL is composed by the `withUrl(runtimeUrl, path)` helper per the round 3 fix train; no bare string concatenation. The pack-level `appliesTo` predicate references BOTH `tacIds` (TAC-2501) AND `route` (the operator-configured wizard-route glob).
- Ships a dependency-free sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard/` with a Node HTTP server realising the four wizard surfaces honestly (`/task-list`, `/step/<n>`, `/summary`, `/in-progress`), both save-and-return transports on their query branches (`?draft-store=server` default posting to `/drafts`, `?draft-store=local` writing to `localStorage` with a sync tick), and four break switches (`?break=task-list-vocab`, `?break=no-summary`, `?break=no-retain`, `?break=no-draft`) driving the negative runs from a single boot. The fixture ships its own README naming PORT, every `?step=`, `?draft-store=`, `?nav=`, `?seed=`, `?refused=`, `?preseed=`, `?edit=`, every `?break=`, the manual boot line and the two-line gate-reviewer boot.
- Declares `suggestedCompanions` `logging` (every step transition, validation failure and save-and-return event writes one request-scoped log line with the correlation identifier and the step slug) and `errorHandling` (the error-summary contract constructs an internal error record per failed field through the applied error-handling factory). Does NOT declare `providesRoles` (leaf blueprint per spec). Does NOT declare `capabilities` and does NOT declare `requiresAppliedCapabilities` (no auth required).
- Consumes `application-empty-error-states` for the no-in-progress empty state on the /in-progress list surface; the wizard's TAC-2503 delegates the zero-drafts case to the sibling's empty-list state and reads `[data-surface="empty-list"]` with a `[data-recovery="create"]` control from the sibling. `application-account-settings` will consume this blueprint for its multi-part account setup flow and the summary-review confirm-before-save gate.
