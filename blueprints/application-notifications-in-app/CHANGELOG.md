# application-notifications-in-app CHANGELOG

## 1.2.4 - 2026-09-11

- Shared `aggregate()` no longer promotes warn rows to pass: any row with verdict warn (including honest de-claim rows) lifts the aggregate to warn; a probe whose rows are all warn aggregates to warn, not pass. Shared teardown propagates a SIGKILL failure through the returned kill() promise instead of swallowing it. centre-acknowledge AC-20103-1 row de-claimed to `conformanceOnly:true` with `verdict:'warn'` and a `limitation` naming the browser-only clause (control activation and DOM `data-acknowledged` mutation are not observed by a Node HTTP probe). toast-contract row keeps `notObservableHere:true` + `verdict:'warn'`; live-region-preseeding stays as a positive-observation row that fails under `?break=preseed`. Anatomy test extended with a negative-variant assertion that the shipped preseed break switch drives the live-region-preseeding aggregate to fail.

## 1.2.3 - 2026-09-11

- toast-contract `notObservableHere` row for AC-20102-1 now emits `verdict:'warn'` (previously `pass`); the aggregate correctly reports amber for the browser-only halves of AC-20102-1 (role mapping, elapsed timeout and focus-pause behaviour on `data-shown-at`/`data-dismissed-at`) rather than a false pass. Anatomy test extended to (a) enumerate the shipped AC/REQ id set from `contributions/user-stories/*.json` and refuse any row whose `anchorAcId` or `notObservableAcId` is not in that set, and (b) accept the conformance-only row shape (null anchor + non-empty `limitation`).

## 1.2.2 - 2026-09-11

- Probes rewritten to observe declared AC properties instead of static constants. live-region-preseeding now enumerates elements by `[data-live-region]` and asserts polite (aria-live="polite", empty) and assertive (role="alert", empty) semantics per AC-20101-1; positive-anchor-on-absence broken-variant row removed. toast-contract row de-claimed to notObservableHere for AC-20102-1 (role mapping, elapsed timeout and focus pausing are client-JS-driven and only observable in a browser); the static timeout-floor constant-echo row is dropped. centre-acknowledge broken-variant shortcut row removed; the positive centre-acknowledge row keeps derived evidence (acknowledgedAt flips null to ISO plus the server-side request log entry). Rule 10 applied to every row detail. Anatomy test extended to accept the notObservableHere row shape (non-empty reason + non-empty anchorAcId) alongside evidence-object and honest-skip. Register cleanup.


## 1.2.1 - 2026-09-11

- Added a criterion-e probe pack (`contributions/probes/`) covering 3 properties the fixture engine at `packages/rcf-lite/test/fixtures/probe-pack-application-notifications-in-app/server.js` answers: `live-region-preseeding`, `toast-contract`, `centre-acknowledge-round-trip`. Every response now carries an `x-fixture-request-id` header; probes record the id, the HTTP status and a body excerpt as positive evidence per rule 7d. Fixture README declares every env var the pack reads. Anatomy test at `packages/rcf-lite/test/blueprint/application-notifications-in-app-anatomy.test.js` pins the new pack files and asserts each result carries one of the four 7d evidence shapes.


## 1.2.0 (2026-09-10)

### Added

- Five elicits (`timeout`, `retention`, `categories`, `route`, `page-size`) declared on blueprint.json; REQ-006 binds one runtime clause per apply-time answer family.
- New AC-20105-4 refuses apply with `LOGGING_COMPANION_MISSING` when no logging companion is applied.

### Changed

- `TAC-2102.interfaces.deliveryRowShape` owns the row schema (`deliveryTs`, `priority`, `category`, `outcome`, `correlationId`); AC-20105-1, AC-20105-3 and REQ-005 reference the owner via ownerRef.
- REQ-001.deliveredBy retargeted to `TAC-2101.interfaces.renderLiveRegions`.
- REQ-004.deliveredBy retargeted to `TAC-2103.interfaces.renderPreferences`.
- REQ-005.deliveredBy retargeted to `TAC-2102.writeDeliveryRow`.
- AC-20102-3 and AC-20102-4 descriptions carry the W3C URL inline alongside the existing vendorCitation object.

## 1.1.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.1.0 (2026-09-10, hardening pass)

### Added

- Failure-path acceptance criteria on US-20101 (live-region wrappers pre-seeded before any state-driven mount), US-20102 (sub-6s timeout apply refusal with TOAST_TIMEOUT_TOO_SHORT, focused-toast pause per WCAG 2.2.1), US-20103 (non-2xx acknowledgement error toast with unchanged data-acknowledged, paginated fetch failure), US-20104 (failed preference write error toast with toggle rollback, idempotency of retried writes), US-20105 (delivery-row incomplete refusal), US-20106 (page-load backlog failure with cached-row banner), US-20107 (invalid toast payload refusal), US-20108 (invalid priority drop). Closes review findings F-1, F-2 and F-3.
- Vendor citations on the WCAG 2.2.1 Timing Adjustable and status-messages acceptance criteria (verified 2026-09-10).

### Changed

- Every REQ now carries a deliveredBy link into TAC-2101 (live-region), TAC-2102 (centre) or TAC-2103 (preferences).
- Every AC on every user story now carries an explicit disposition (fixed or template); ACs that observe writeDeliveryRow, renderLiveRegions, renderToast or renderCentre carry ownerRef into the owning TAC field.
- Review fix pass (2026-09-10): README, TAC-2103 and REQ-004 register scrubbed (no operator names or work-item ids). Closes review-fix-pass findings O-2, O-3.

## 1.0.0 (visual round, spec 2026-09-04)

- First ratified version of the shelf's application-notifications-in-app blueprint. Five REQs (live-region preseeding on every declared route; transient toast contract with priority-to-role mapping, one-shot announcement and timeout floor; notification centre inbox with retention and acknowledge round-trip; per-user preferences UI with category silence and sibling delegation; delivery-attempt log with operator-readable rows), eight USs binding runtime-observable ACs plus three cross-cutting cases (page load with backlog, background event, disjoint-content contract), three TACs (live-region wrappers with the toast factory; centre inbox with retention and acknowledge round-trip; preferences UI with sibling delegation), three ADRs (priority-to-role mapping polite/status vs assertive/alert per WCAG 4.1.3 and the ARIA APG alert pattern; six-second toast timeout floor per WCAG 2.2.1 with elicited overrides above the floor; thirty-day centre retention window with elicited overrides). No new global topics.
- Reserves the `application-notifications-` family prefix for the sibling channel blueprints the shelf will grow into (`-email`, `-push`, `-webhook`) as a doc-only reservation on the blueprint README and every applying blueprint's `docs/topics.md` shelf band registry per the 2026-09-04 shelf decision to make the transport type explicit in the blueprint name.
- Ships `probe-packs/application-notifications-in-app.pack.mjs`: three browser-verify checks anchored to blueprint AC ids, every check carrying a description field per spec section 9. `AC-20101-1` live-region preseeded on every declared route (wrappers present AND empty at load, enumerated by `[data-live-region]`). `AC-20102-1` transient toast contract with priority-to-role mapping and timeout measured against the ADR-2102 six-second floor via `data-shown-at`/`data-dismissed-at` timestamps (no six-second sleep in the pack; bounded polling). `AC-20103-1` centre acknowledge round-trip enumerated by `data-notification-id` (per-element attribute per gate discipline), reconciled through both `window.__notificationFetches` and the server-side request log. Fourth blueprint on the shelf that ships a Playwright probe pack under the runner extension.
- Ships a sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-notifications-in-app/` (dependency-free Node HTTP server) so the pack can be probed at the shelf's own gate; the fixture is the golden the gate reviewer drives, with `?break=preseed`, `?break=role`, `?break=timeout` and `?break=ack` query switches for the negative runs. Three routes (`/`, `/notifications-centre`, `/notifications-preferences`); every route preseeds both live-region wrappers.
- Suggests the `logging` and `errorHandling` companions with the ratified spec's reasons. `providesRoles` absent, leaf blueprint per the loader contract (an empty array is refused, an omitted field marks the blueprint as a leaf).
