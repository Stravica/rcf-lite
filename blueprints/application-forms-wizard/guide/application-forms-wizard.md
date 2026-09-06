# application-forms-wizard: operator guide

## When to reach for it

Your project ships a workflow whose completion spans two or more surfaces the operator moves between with save points in between: a signup or onboarding flow, a checkout, an account setup, a compliance-heavy submission, an application review. You want the GOV.UK-vocabulary task-list up front (Cannot start yet, Not started, In progress, Completed) so the operator sees where they are at a glance, the per-step validation timing on-blur then on-change so the messages behave predictably, the top-of-page error summary with skip links so a screen-reader user hears the failures in order, the summary review with row-level change and answer retention so the operator can revise before submit, and the save-and-return draft store so a closed tab or a lost network does not force them to start again.

## The four contracts

- **Task-list contract (REQ-001).** Every step is enumerated with a state from the closed vocabulary. The ARIA progressbar wrapper carries the completion count.
- **Validation timing (REQ-002).** On-blur before first submit, on-change after first failure, full pass on submit. Delegates to the SPA blueprint's forms-engine TAC-205.
- **Error-summary contract (REQ-003).** Top-of-page summary, skip links per failed field, aria-invalid on the field, focus to summary heading on submit failure.
- **Summary-review contract (REQ-004).** Summary-list rows per step, Change link per row, answer retention on save.
- **Save-and-return contract (REQ-005).** Server-side draft table or client-side local buffer with a per-write sync tick. The pack refuses to ship if neither is wired.

## When NOT to reach for it

Your workflow is a single-page form the operator fills in one go with no cross-step dependencies. A wizard shell adds mechanism without payoff; a single-step submit with the same forms-engine and the same error-summary reads better.

Your workflow is a linear questionnaire where every step is optional and the operator can jump anywhere at any time. Consider the free-navigation branch (ADR-2501) or an alternative surface that does not enumerate completion states.

Your workflow ships without any draft store because every submission is single-session (a payment authorisation with a strict short expiry, say). The blueprint refuses to apply without a transport; either wire one or pick a different surface.

## What stays your call

- The step manifest (elicited at apply time). The blueprint ships an example three-step manifest on the fixture; your project supplies its own.
- The step-indicator shape (task-list, ARIA progressbar-only, breadcrumb; ADR-2503).
- The linear-vs-free navigation posture (ADR-2501). The default is linear.
- The save-and-return transport (server-draft-table, client-local-buffer; ADR-2502). No default is committed.
- The visual design of each surface. The blueprint contributes WHAT surfaces under WHAT condition; the palette, spacing and typography are your design system's call.
- The per-field validation rules (which fields are required, format constraints). The blueprint contributes the timing rule and the summary shape; the field-level rules are your project's call, wired through the SPA forms-engine.

## What a good outcome looks like

The pack fires on every FBS whose surface renders a wizard task-list or a wizard step, and every check returns `pass` on the honest render and `fail` on the corresponding break switch. Your operator walks the task-list, sees the completion states in order, blur-triggers validation without being interrupted mid-typing, and on submit failure lands on the error summary with the failed fields in order. On summary review the operator revises one answer without losing the rest and submits with confidence. On network loss or a closed tab the draft persists and the operator picks up where they left off.

## Mechanism-reach gaps

The blueprint README lists the runtime-observable ACs the pack does NOT bind directly. Every gap is a candidate for a v1.1.0 minor bump extending the pack. Combine with `application-spa` to inherit the forms-engine and the field-component library, and with `application-empty-error-states` for the no-in-progress empty case.

## Promotion signals

- A wizard state past the four closed strings recurs across three or more consumer wizards (a Skipped or Locked state, say). Candidate: a v1.1.0 minor bump extending REQ-001's state enum.
- The save-and-return contract wants a shared sync engine across a persistence blueprint and this UI blueprint. Candidate: a dedicated `application-draft-sync` blueprint absorbing the transport.
- The step-indicator enum wants a per-step count element outside the task-list. Candidate: a v1.1.0 minor bump extending ADR-2503's shape enum.

## Costs to be honest about

A three-step wizard is a couple of days of project-side wiring per framework even after adopting the TACs. The pack is Playwright-first, so a project without a running dev server at gate time cannot fire it. The save-and-return contract's server branch needs a persistence adapter; the local branch needs a serialisation shape agreed with the forms-engine and a per-project namespacing rule for shared devices.
