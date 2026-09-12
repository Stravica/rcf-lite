# application-notifications-in-app CHANGELOG

## 1.2.8 - 2026-09-12

- Fixture centre now carries the active query-scoped break switch into the served acknowledge form action: `/notifications-centre?break=ack` renders each per-item form with `action="/actions/acknowledge-notification?notification-id=<id>&break=ack"`, so a JS-off native form submission originating from a broken centre reaches the same broken handler branch as the API and cannot escape the `ack` refusal. Fixture README lists `POST /actions/acknowledge-notification` alongside the JSON API in the routes table and states both refuse under `?break=ack` (or `PROBE_BREAK=ack`), and the `?break=ack` row in the query-switch table now names both HTTP 502 error codes (`ACKNOWLEDGE_ROUND_TRIP_REFUSED` on the JSON API, `ACKNOWLEDGE_FORM_REFUSED` on the form action). The `/actions/acknowledge-notification` route comment corrected: with JS off the native form submission POSTs to the form action, with JS on the client script intercepts the click, calls `preventDefault` on the form, and drives the JSON API instead (previous wording claimed JS-on activation POSTs to the form route). centre-acknowledge-round-trip probe wording ("next principal load"), row detail ("next principal load"), and the 1.2.7 CHANGELOG line ("next principal load") now say "next served load of the centre" - the fixture has no notification-principal key so calling an ordinary refetch a principal load misdescribed the observation.

## 1.2.7 - 2026-09-12

- centre-acknowledge-round-trip AC-20103-1 positive row now observes activation causality through a served progressive-enhancement form action, not a bare API call. Fixture centre wraps each acknowledge button in `<form method="post" action="/actions/acknowledge-notification">` with the notification-id in a hidden input; a new server route accepts the form-encoded submission, flips the delivery-log `acknowledgedAt`, records both an `acknowledge-server` and an `acknowledge-form` entry on `/__requests`, and returns 200 with the applied `acknowledgedAt`; the JS-on client script now calls `preventDefault()` on the button click so only one POST fires per activation (the JSON API path stays for SPA parity). The probe fetches `/notifications-centre`, verifies the form + hidden input for the picked id, SUBMITS the served form action (content-type `application/x-www-form-urlencoded`), verifies the delivery-log flip and the request-log counts, and refetches `/notifications-centre` to observe `data-acknowledged="true"` on the same article on the next served load of the centre (proof that the served control's activation causes the acknowledged state, not just that a hand-crafted API POST does). The companion null-anchored conformance row now narrows to the browser-only same-page in-place DOM mutation the client script performs after fetch resolves (the pack browser check owns that). Fixture `?break=ack` refuses the form action too (`ACKNOWLEDGE_FORM_REFUSED`, HTTP 502) as well as the JSON API, so the anatomy negative-variant assertion continues to drive the probe to fail under `PROBE_BREAK=ack` on both paths.

## 1.2.6 - 2026-09-12

- centre-acknowledge-round-trip upgraded from a null-anchored conformance-only row into TWO rows: a POSITIVE row anchored to AC-20103-1 observing the surface enumeration (per-item `[data-notification-id]` wrappers, matching per-item acknowledge and mark-read controls, exactly one mark-all-read control) AND the server-side round-trip (POST `/api/notifications/acknowledge` returns 200 with the echoed `notificationId`, the delivery-log `acknowledgedAt` for the row flips from null to an ISO timestamp, `/__requests` records exactly one `acknowledge-server` entry), plus a companion CONFORMANCE-ONLY row (null anchor, `limitation` naming AC-20103-1) for the browser-only DOM `data-acknowledged="true"` flip after the fetch resolves. Fixture `?break=ack` extended to also refuse the server-side POST with HTTP 502 `ACKNOWLEDGE_ROUND_TRIP_REFUSED`, so the anatomy negative-variant map now drives the centre-acknowledge probe to fail under `PROBE_BREAK=ack` (added to `brokenExpectations`). Toast-contract row split so AC-20102-1 (browser-only priority-to-role mapping, one-shot announcement, elapsed timeout on `data-shown-at`/`data-dismissed-at`) remains `notObservableHere` without any focus-pause language (that clause is AC-20102-4), and a second null-anchored conformance row names AC-20102-4 in the `limitation` for the focus-pause + dismissal-removal properties (browser-only and unimplemented in the fixture); both rows now carry an evidence object from the fixture shell reachability fetch so the rule-7d shape and the evidence tally accept them. Positive-evidence row shape tightened in the anatomy helper: a positive row now requires a non-empty engine-returned `requestId` AND (a non-empty `bodyExcerpt` OR a non-empty `derived` object); a `{derived:{}}` alone or a `requestId` alone no longer counts, with two new negative-case tests covering the empty-derived and id-only patterns.

## 1.2.5 - 2026-09-12

- Rule-7d shape fix on the centre-acknowledge row: the AC-20103-1 de-claim now carries `anchorAcId: null` and names AC-20103-1 in the `limitation` field per the shipped shape (a `conformanceOnly:true` row must not simultaneously claim an anchor). Fixture README env-var manifest now declares `PROBE_BREAK` (the fixture reads it as an alternate to a per-request `?break=`) and the probe-utils `DECLARED_ENV` list mirrors the addition. Anatomy shape check tightened to reject an anchored `conformanceOnly` row (a positive evidence field no longer bypasses the null-anchor + limitation contract); a new negative-case test constructs an anchored `conformanceOnly` row and asserts the shape helper throws. Product-term usage of "round trip" / "round-trip" (request/response cycle in AC-20103-1 and in the `centre-acknowledge-round-trip` module name) stays as shipped.

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

## 1.1.0 (2026-09-10)

### Added

- Failure-path acceptance criteria on US-20101 (live-region wrappers pre-seeded before any state-driven mount), US-20102 (sub-6s timeout apply refusal with TOAST_TIMEOUT_TOO_SHORT, focused-toast pause per WCAG 2.2.1), US-20103 (non-2xx acknowledgement error toast with unchanged data-acknowledged, paginated fetch failure), US-20104 (failed preference write error toast with toggle rollback, idempotency of retried writes), US-20105 (delivery-row incomplete refusal), US-20106 (page-load backlog failure with cached-row banner), US-20107 (invalid toast payload refusal), US-20108 (invalid priority drop).
- Vendor citations on the WCAG 2.2.1 Timing Adjustable and status-messages acceptance criteria (verified 2026-09-10).

### Changed

- Every REQ now carries a deliveredBy link into TAC-2101 (live-region), TAC-2102 (centre) or TAC-2103 (preferences).
- Every AC on every user story now carries an explicit disposition (fixed or template); ACs that observe writeDeliveryRow, renderLiveRegions, renderToast or renderCentre carry ownerRef into the owning TAC field.

## 1.0.0 (visual round, spec 2026-09-04)

- Initial shipped version of the shelf's application-notifications-in-app blueprint. Five REQs (live-region preseeding on every declared route; transient toast contract with priority-to-role mapping, one-shot announcement and timeout floor; notification centre inbox with retention and acknowledge round-trip; per-user preferences UI with category silence and sibling delegation; delivery-attempt log with operator-readable rows), eight USs binding runtime-observable ACs plus three cross-cutting cases (page load with backlog, background event, disjoint-content contract), three TACs (live-region wrappers with the toast factory; centre inbox with retention and acknowledge round-trip; preferences UI with sibling delegation), three ADRs (priority-to-role mapping polite/status vs assertive/alert per WCAG 4.1.3 and the ARIA APG alert pattern; six-second toast timeout floor per WCAG 2.2.1 with elicited overrides above the floor; thirty-day centre retention window with elicited overrides). No new global topics.
- Reserves the `application-notifications-` family prefix for the sibling channel blueprints the shelf will grow into (`-email`, `-push`, `-webhook`) as a doc-only reservation on the blueprint README and every applying blueprint's `docs/topics.md` shelf band registry per the 2026-09-04 shelf decision to make the transport type explicit in the blueprint name.
- Ships `probe-packs/application-notifications-in-app.pack.mjs`: three browser-verify checks anchored to blueprint AC ids, every check carrying a description field per spec section 9. `AC-20101-1` live-region preseeded on every declared route (wrappers present AND empty at load, enumerated by `[data-live-region]`). `AC-20102-1` transient toast contract with priority-to-role mapping and timeout measured against the ADR-2102 six-second floor via `data-shown-at`/`data-dismissed-at` timestamps (no six-second sleep in the pack; bounded polling). `AC-20103-1` centre acknowledge round-trip enumerated by `data-notification-id` (per-element attribute per gate discipline), reconciled through both `window.__notificationFetches` and the server-side request log. Fourth blueprint on the shelf that ships a Playwright probe pack under the runner extension.
- Ships a sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-notifications-in-app/` (dependency-free Node HTTP server) so the pack can be probed at the shelf's own gate; the fixture is the golden the gate reviewer drives, with `?break=preseed`, `?break=role`, `?break=timeout` and `?break=ack` query switches for the negative runs. Three routes (`/`, `/notifications-centre`, `/notifications-preferences`); every route preseeds both live-region wrappers.
- Suggests the `logging` and `errorHandling` companions with the shipped spec's reasons. `providesRoles` absent, leaf blueprint per the loader contract (an empty array is refused, an omitted field marks the blueprint as a leaf).
