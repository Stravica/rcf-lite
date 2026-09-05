# Guide: application-notifications-in-app (v1.0.0)

## What it is

A shipped, vendor-neutral in-app-notifications contract for a rcf-lite application. Ships the live-region preseeding discipline (TAC-2101), the transient-toast contract with the priority-to-role mapping (ADR-2101) and the WCAG 2.2.1 six-second timeout floor (ADR-2102), the notification-centre inbox with the ADR-2103 retention window and the per-item acknowledge round-trip (TAC-2102), the per-user preferences UI with category silence and sibling-channel delegation (TAC-2103), and the delivery-attempt log write path (REQ-005, TAC-2102). Ships a Playwright probe pack that gates ship on the three runtime-observable surfaces the shelf assures: both live-region wrappers are preseeded on every declared route before any notification fires, every toast maps priority to the correct wrapper and role with an announcement measured against the six-second floor, and every centre acknowledge control round-trips to the server with the DOM updating on the response.

## What it deliberately is not

- Not a notifications transport. The in-app slug is the discriminator; sibling channel blueprints under the reserved `application-notifications-` family prefix ship their own transports. This blueprint ships no email, no Web Push, no webhook.
- Not a notifications store. The delivery-attempt log's persistence layer is the applied `logging` companion's; this blueprint owns the row shape and delegates the write path.
- Not a preferences store. The preferences UI records intent on the surface (category silence, digest opt-in); the store where those preferences persist is the applying project's, and each sibling channel blueprint reads its own share of the intent.

## When to reach for it

- Any shipped rcf-lite application whose operators need transient toasts, a durable notification centre and per-user category silence. Web SaaS applications, admin consoles, dashboards with alerting.
- Projects that want the WCAG 4.1.3 status-message discipline and the WCAG 2.2.1 timeout floor enforced at ship without hand-authoring the live-region contract.
- Projects that expect to add sibling channels (email digest, Web Push, webhooks) later: the family-prefix reservation and the preferences UI's sibling-delegation shape land the discipline early.

## When it does not fit

- Server-to-server notifications with no operator surface. If nobody reads the notification on a screen, this blueprint's contract is expensive noise; use a logging blueprint alone.
- A project whose notifications are single-channel and channel-first (an SMS-only alert product) where the in-app slot is not the primary surface. The sibling channel blueprint is the fit; the in-app blueprint composes later if the surface grows.
- Highly bespoke chat-like surfaces (a support-inbox blueprint, a workflow-review inbox) where the accessibility contract differs from the WCAG 4.1.3 status-message discipline. Supersede this blueprint with a project-authored REQ naming the residual, or apply a different chat-oriented blueprint.

## What a good outcome looks like

Every route the applying project ships preseeds both live-region wrappers in the DOM at page load; no announcement race is possible. Every toast writes into exactly one wrapper based on its priority (info to polite as `role="status"`, error to assertive as `role="alert"`) and stays visible for six seconds unless dismissed; the reader hears an interruption exactly when the application asserts one. The notification centre lists notifications within the retention window with every item Tab-reachable and every acknowledge round-tripping to the server. The preferences UI carries per-category silence toggles and clearly labels any sibling channel that is not yet applied. The shipped probe pack runs green on the delivery-ci-workflows gate.

## The operator decisions that remain open

- **Toast timeout floor** (ADR-2102). Six seconds by default; operator elicits a longer dwell time if the surface has a very high notification volume.
- **Notification categories** (REQ-004). Payment, security and product are the shipped default categories on the fixture; the operator elicits their own category list at apply.
- **Centre retention window** (ADR-2103). Thirty days by default; operator elicits a longer or shorter window at apply.
- **Notification centre route path** (REQ-003 note). `/notifications-centre` by default; operator elicits an override for a bespoke route.
- **Sibling channels applied** (REQ-004 note). Which of `-email`, `-push`, `-webhook` (or a project-authored sibling) is applied on the project; discovered, not elicited, from the manifest.

## Common gotchas

- The two live-region wrappers must be preseeded before the first notification. A lazy-mount defect is silent at the DOM (the wrapper appears "eventually") but loses the first announcement at the assistive-technology layer. The pack refuses ship on this shape.
- The priority-to-role mapping is fixed at v1.0.0 (info to polite/status, error to assertive/alert). A third priority (`warning`) is a v1.1 minor bump because it changes the role vocabulary; free-form priorities are refused at project-side review.
- The toast timeout floor is a floor, not a ceiling. Six seconds is the default; an operator-elicited value above the floor is honoured (thirty seconds), a value below the floor is refused at apply. The pack measures the actual elapsed time against the shell root's declared floor and against the six-second baseline; both must clear.
- The centre enumerates items by `data-notification-id`, per the T-3 gate discipline. A centre implementation that uses only `role="listitem"` on the children (without a per-element id attribute) passes the accessibility contract but does not let the pack enumerate individual items reliably; ship both.
- The family-prefix reservation is documented; naming a future notifications blueprint outside the family (`application-alerts-email`) reads against the reservation and stops at author-side review.

## Cost honesty

Shipping this blueprint costs the project a design pass on the notification categories and retention window, and a build pass on the live-region factory and the centre inbox surface. It buys the WCAG 4.1.3 and WCAG 2.2.1 disciplines enforced at ship, the ARIA APG alert pattern on the assertive slot, the centre inbox with the acknowledge round-trip, the preferences UI with sibling delegation, and the family-prefix reservation that survives when the shelf grows a second notifications channel. The gate reviewer verifies the pack runs green against the sample-app fixture and reviews the applying project's own notifications surfaces against the ADR set.
