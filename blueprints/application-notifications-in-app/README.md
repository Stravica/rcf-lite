# Notifications in-app blueprint (v1.0.0)

Vendor-neutral in-app-notifications contract for a rcf-lite application. Ships the live-region preseeding discipline (polite and assertive wrappers present in the DOM before any notification fires per the WAI-ARIA 1.2 normative reference), the transient toast contract with priority-to-role mapping (info to polite/status, error to assertive/alert per WCAG 4.1.3 and the ARIA APG alert pattern), the WCAG 2.2.1 six-second toast timeout floor with operator-elicited overrides above the floor, the notification centre inbox with a thirty-day retention window and a per-item acknowledge round-trip enumerated by `data-notification-id`, the per-user preferences UI with category silence and sibling-channel digest delegation, and the delivery-attempt log write path. Ships a Playwright probe pack under `probe-packs/application-notifications-in-app.pack.mjs` whose three checks are the runtime gate the delivery-ci-workflows runner drives (visual round spec 2026-09-04, section 5.4). No new global topics; suggests the `logging` and `errorHandling` companions. Fourth blueprint on the shelf that ships a Playwright probe pack under the T-0 runner extension.

## Apply

```
rcf define blueprint add <path-to>/blueprints/application-notifications-in-app
```

Applies namespaced contributions into the project tree and records `manifest.blueprints[]`. Consumes the `logging` and `errorHandling` companions when they resolve to an applied provider or a registered library; falls back to the shelf providers otherwise.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version 1.0.0, category `application`, `suggestedCompanions: [{ logging }, { errorHandling }]`, `providesRoles` absent (leaf blueprint), 19 contributions in the 20xxx US band and 21xx ADR/TAC block |
| Doc set | `contributions/` | 5 REQs, 8 USs, 3 TACs, 3 ADRs, schema-valid and namespaced |
| Probe pack | `probe-packs/application-notifications-in-app.pack.mjs` | Three browser-verify checks anchored to blueprint AC ids: `AC-20101-1` live-region preseeding on every declared route (wrappers present AND empty at load); `AC-20102-1` transient toast contract with priority-to-role mapping and timeout measured against the ADR-2102 floor via `data-shown-at`/`data-dismissed-at`; `AC-20103-1` centre acknowledge round-trip enumerated by `data-notification-id` |
| Guide | `guide/application-notifications-in-app.md` | Operator-facing: when to reach, when not, mechanism-reach gaps |
| Coordination vocabulary | `docs/topics.md` | Shelf id band registry update; no new global topics claimed; the family-prefix reservation row |

## What it contributes, and what it deliberately does not

Contributed: REQ, US (with inline ACs), TAC, ADR, plus one shipped probe pack. Adherence is expressed as ACs; the blueprint ships no notifications-framework source and no test files (the probe pack drives the real browser against the applying project's own runtime).

Deliberately not contributed: any transport (email, push, webhook). The in-app slug is the discriminator per Baz decision 2026-09-04: "we might support more types of notifications - be clear in the name what these ones are". Sibling channel blueprints ship their own transport contracts under the reserved `application-notifications-` family prefix.

## Family-prefix reservation

The `application-notifications-` prefix is reserved for the sibling in-app-adjacent channels the shelf will grow into:

- `application-notifications-email`: server-to-user notifications through the applied `email-smtp-resend` companion (or a paired email provider). Owns the email-transport dedupe semantics and the delivery-attempt log rows for the email channel.
- `application-notifications-push`: Web Push and platform APN/FCM notifications. Owns the subscription lifecycle and the platform-token store.
- `application-notifications-webhook`: outbound HTTP notifications to operator-configured endpoints. Owns the delivery-retry semantics and the endpoint registry.

The reservation is doc-only in v1.0.0 (per spec Q3 default): the family prefix is named in this README and in every shipped blueprint's `docs/topics.md` shelf band registry as a reserved-slot row. No sibling channel ships in this round. Any future PR that proposes a name outside the family (`application-alerts-email`, `application-messages-push`) reads against this reservation and stops at author-side review.

Digest opt-in on the preferences UI is elicited on the sibling channel, not here: the preferences UI carries a disabled section per sibling channel that is not yet applied, labelled `data-preference-status="sibling not applied"`. When the sibling ships and the applying project applies it, that sibling's own blueprint reads the operator's preference state and drives the digest transport.

## Quality bar

Every route the applying project ships renders with both live-region wrappers preseeded in the DOM before any notification fires (`[aria-live="polite"] [data-live-region="polite"]` and `[role="alert"] [data-live-region="assertive"]`), both empty at page load. Every toast writes into exactly one wrapper based on its priority (info to polite as `role="status"`, error to assertive as `role="alert"`) and records `data-shown-at` and `data-dismissed-at` timestamps a probe can measure the timeout against without sleeping in the pack. Every toast timeout is at or above the WCAG 2.2.1 six-second floor. The notification centre lists notifications inside the ADR-2103 retention window, every item enumerated by `data-notification-id`, every acknowledge control Tab-reachable and round-tripping to `POST /api/notifications/acknowledge` with the DOM updating on the response.

## Known mechanism-reach gaps

Every runtime-observable AC that is not bound to a pack check appears here individually per the T-1 gate discipline (`blueprint-authoring-checklist.md` section 6.g): categories are not enough. The pack has three checks; every other runtime-observable AC on this blueprint is a mechanism-reach gap named below.

- **AC-20101-2 live-region factory identity stable across route changes**. The pack asserts the wrappers are preseeded on every declared route (AC-20101-1); it does not assert the two wrappers are the same DOM nodes across route changes (a factory that recreates the wrappers on route change passes AC-20101-1 but fails AC-20101-2). A v1.1 minor bump could persist a `data-live-region-id` on each wrapper and assert identity across a `browser.click` on a nav link.
- **AC-20102-2 toast factory library-scope shape**. The pack drives the runtime toast surface (AC-20102-1); the library-scope AC on the factory's own signature is a project-side review concern.
- **AC-20103-2 centre factory reads through the delivery-log endpoint**. The pack drives the item enumeration and the acknowledge round-trip (AC-20103-1); the library-scope AC on the factory's own delivery-log read is a project-side review concern.
- **AC-20104-1 preferences category silence**. The preferences surface renders per-category toggles but the pack does not itself activate a silence toggle and assert the round-trip today. A v1.1 minor bump could add a preferences-round-trip check paralleling AC-20103-1.
- **AC-20104-2 sibling-channel digest section disabled when no sibling applied**. The fixture renders the disabled sections and the pack could inspect them, but the AC's real bite is when a sibling channel ships and the disabled state must lift; this class stays a v1.1 minor bump candidate for when the first sibling ships.
- **AC-20105-1 delivery-log endpoint shape**. The pack does not enumerate every row on the log (the delivery-log's persistence is delegated to the applied `logging` companion). A v1.1 minor bump could add a log-shape probe that reads `/api/delivery-log`, asserts the row shape and confirms append-only order.
- **AC-20105-2 delivery-log writes through the applied logging companion factory**. The pack does not inspect the companion's factory today. A v1.1 minor bump could add a companion-boundary check reading a marker the applying project stamps on companion-authored rows.
- **AC-20106-1 page load with backlog does not saturate the polite queue**. The pack does not itself count polite-queue emissions at load. A v1.1 minor bump could add a MutationObserver-based check that counts inserts into the polite wrapper during the first render tick.
- **AC-20107-1 background event indistinguishable from operator-driven event**. The pack fires the operator-driven variant (AC-20102-1); a background-event dispatch through `POST /__emit` on the fixture would exercise the same code path and reach the same DOM shape.
- **AC-20108-1 disjoint content between wrappers**. The pack asserts the disjoint-content rule at the moment it inspects the wrappers, not continuously across the toast lifetime. TAC-2101 notes name this residual; a v1.1 minor bump could add a MutationObserver-based check.
- **AC-2101-6 family-prefix reservation is documented on the shelf**. This is a doc-observable AC (the reservation paragraph exists in this README and the shelf registry rows). Not runtime-observable; not a mechanism-reach gap in the same sense but named for completeness.

## Elicited parameters (ADR-2101 through ADR-2103 and REQ notes)

The applying project elicits these at apply; the declarative ADR shape (`elicited: true`) records the intent on the manifest. The runner has no apply-time elicitation phase today (w-2026-09-04-dave-022, built in T-5); accept the declarative shape and gather the operator's answers by hand during the apply pass.

- **Toast timeout floor** (ADR-2102): six seconds baseline per WCAG 2.2.1; operator elicits an override above the floor (twelve seconds, thirty seconds); the elicited value lands on `manifest.blueprints[application-notifications-in-app].appliedParameters.toastTimeoutSeconds`. A value below six is refused at apply.
- **Notification categories** (REQ-004): the operator's category list (payment, security, product, and any project-specific categories). The preferences UI renders one section per elicited category.
- **Centre retention window** (ADR-2103): thirty days by default; operator elicits an override. Below one day refused at apply.
- **Notification centre route path** (REQ-003 note): `/notifications-centre` by default; operator elicits an override for a bespoke route.
- **Digest transports** (REQ-004 note): elicited on the sibling channel blueprint at its apply, not here. This blueprint ships the preferences UI's disabled sibling section only.

## Standards trace

WCAG 4.1.3 Status Messages on the live-region contract (REQ-001, ADR-2101). ARIA APG alert pattern on the assertive slot (ADR-2101). WCAG 2.2.1 Timing Adjustable on the toast timeout floor (ADR-2102). WAI-ARIA 1.2 live regions normative reference (Sara Soueidan's guidance is the shipped project-side citation on the preseeding contract; the standards trace holds against the WAI-ARIA specification directly). `standardsTraceClause` on each ADR carries the primary clause or pattern id.

## Consumers and dependencies

- Consumes the applied `logging` companion (or the shelf provider `observability-logging`) for the delivery-attempt log write path (REQ-005, TAC-2102) and every acknowledge round-trip record. A project without a `logging` companion applied sees the delivery-log endpoint returning an empty rows array, which fails project-side review.
- Consumes the applied `errorHandling` companion (or the shelf provider `application-error-handling`) for the assertive-slot alert's internal error record when an acknowledge round-trip fails at the server.
- Reserves the `application-notifications-` family prefix for sibling channel blueprints (see above).
- Reuses the T-3 pack-browser `resize(width, height)` seam only for future minor bumps; v1.0.0 does not exercise breakpoint reflow in the pack.
