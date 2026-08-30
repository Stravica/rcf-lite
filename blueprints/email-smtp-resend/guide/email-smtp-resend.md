# Email SMTP Resend blueprint guide

## What it is

A Resend-backed mail adapter that fills the magic-link blueprint's `TAC-504-security-auth-magic-link-email-delivery-adapter` slot as a shipped default. The blueprint contributes the WHAT of a Resend integration: the send-contract shape the auth code calls, the SMTP transport that satisfies it, the four-class error taxonomy the adapter normalises provider responses into, the bounded jittered retry posture on transient classes, the webhook signature verification for Resend delivery events, the replay defence against stale timestamps and duplicate event ids, and the boundary discipline that keeps the SMTP client library confined to one module and every credential sourced from a configured reference.

Concretely, the blueprint ships six requirements, six user stories (fifteen acceptance criteria), two architecture components, and two architecture decision records. Both ADRs are scope-local (ADR-401 on transport choice, ADR-402 on retry-and-backoff posture); no `scope: global` ADR ships from this blueprint.

## What it is not

Not the magic-link auth flow. Those routes live on the magic-link blueprint; this blueprint is the adapter the routes call. Apply the magic-link blueprint separately and compose the two.

Not the mail-adapter interface itself. The interface is owned by the magic-link blueprint's `TAC-504`; this blueprint's job is to satisfy it with a shipped default. A sibling `email-smtp-<othervendor>` blueprint would satisfy the same interface with a different vendor default.

Not an SMTP client library. Any SMTP-speaking Node client the project already carries or picks up works; the adapter injects the client at boot and treats it as a project-supplied binding. The blueprint declares no runtime dependency on a specific SMTP package.

Not a mail-templating engine. The adapter takes `textBody` and `htmlBody` as pre-composed strings; how the auth flow (or any other caller) composes them is not this blueprint's concern.

Not a domain-verification workflow. Sender-domain setup is a provider-owned operation the operator completes against Resend's own docs; the blueprint gates on the unverified-sender refusal class at runtime (AC-4102-1) and points the operator at Resend's docs (`assets/resend-verification-pointer.md`).

Not a compliance layer. Regulatory requirements (double-opt-in, unsubscribe surfaces, retention of consent records) live outside this blueprint; a project subject to them handles them separately.

Not the Resend HTTP API. ADR-401 chooses the SMTP endpoint as the default transport; a project that wants the API path supersedes ADR-401 with a project-level ADR and swaps the adapter's internal client without changing the interface the auth routes call.

## When to reach for it

Reach for the email-smtp-resend blueprint when:

- The project composed the magic-link auth blueprint and needs a real mail transport to fill the `TAC-504` slot; the operator has an account with Resend or intends to open one.
- The project ships one or a few outbound mail flows (sign-in links, transactional notifications) and does not need a full transactional-email vendor SDK.
- The team is comfortable with SMTP as the transport shape and wants an adapter close enough to generic SMTP that a follow-up vendor blueprint (`email-smtp-ses`, `email-smtp-postmark`, whichever the estate mints later) can sibling cleanly.
- Boundary hygiene matters: the SMTP client library must be imported from exactly one module, and no SMTP credential can be committed to the repo or embedded in adapter source.
- The Resend delivery webhook is a trust boundary the project needs verified (signature check, replay defence) rather than an assumed-trusted stream.

## When it does not fit

Do not reach for the email-smtp-resend blueprint when:

- The project has an established mail vendor that is not Resend and no reason to change. Author a project-local adapter (or a sibling `email-smtp-<othervendor>` blueprint if the vendor is one the estate would benefit from) rather than adopting Resend just to have a shipped default.
- The project needs per-send provider metadata Resend's SMTP path does not surface (custom tags, native idempotency keys, structured JSON error prose, per-message analytics keying). Supersede ADR-401 with a project-level ADR selecting the Resend HTTP API and swap the adapter's internal client.
- The project is a public reference or a demo where no real mail transport should ever be reached and every send lands on a stub. Apply the blueprint anyway if the AC set matters, but wire the stub adapter (`assets/stub-adapter.md`) in production and let the deployment's own configuration refuse the real adapter.
- The mail volume or the delivery-analytics surface has requirements a mail service provider (Sendgrid, Mailgun, SES with an established sender reputation) covers better than Resend at the tier the project runs at. Choose the appropriate vendor and either compose a sibling blueprint if one exists or author a project-local adapter.
- The project has no Node runtime that can hold an SMTP connection long enough to submit (a strictly serverless surface with sub-second execution budgets and no keep-alive path). Consider the Resend HTTP API supersede for that shape, and note that this blueprint's retry cap of 8000ms is already close to the edge of serverless-friendly budgets.

An earlier design pass considered leading with the Resend HTTP API as the default. The SMTP endpoint won because a generic SMTP adapter shape ports cleanly to a sibling vendor and because the SMTP client library footprint is smaller and more stable than the HTTP-plus-vendor-JSON-shape footprint the API path implies. The API path remains the reference supersede for projects that need the richer per-send metadata.

## What a good outcome looks like

A project applies the magic-link blueprint, applies this blueprint, wires the adapter reference into the auth routes at composition time, sources `RESEND_SMTP_USER`, `RESEND_SMTP_PASSWORD`, `RESEND_FROM_ADDRESS`, and `RESEND_WEBHOOK_SIGNING_SECRET` through the project's secret resolver (the shipped `security-secrets-management` client, a project-authored resolver, or an environment shim), completes Resend's sender-domain verification, and lands on a deployed application where:

- The magic-link mint step calls the adapter and observes `{ ok: true, providerStatus: 202, providerMessageId: '<vendor-id>', error: null }` on the successful path; exactly one SMTP submission goes out per call.
- An unverified-sender configuration surfaces immediately as `{ ok: false, error: 'RESEND_SENDER_UNVERIFIED: ...' }`; no recipient identity appears on any log line the adapter emits or on any error string it returns.
- A rate-limit refusal converts to a bounded delay (jittered exponential backoff, default 2 retries, cap 8000ms per attempt) rather than a retry storm; the caller sees one adapter return.
- The webhook route accepts only signature-passing requests; a mismatched signature returns HTTP 401 with an empty body and emits a `webhookVerificationFailed` audit event; a stale-timestamp request is refused with `webhookReplayStale`; a duplicate delivery id inside the tolerance window is acknowledged HTTP 200 without re-invoking the downstream handler and emits `webhookReplayDuplicate`.
- A source-tree import-graph scan of the deployed application finds the SMTP client library imported from exactly one module (the adapter); a source-scan of the adapter finds no literal for the SMTP credential, the from-address, or the signing secret.

## Operator decisions that remain open after apply

- Transport choice (SMTP default at ADR-401, or a superseding project-level ADR selecting the Resend HTTP API). Blueprint owns the interface; project owns the transport.
- SMTP client library selection (whichever Node SMTP-speaking library the project already carries or picks up). Blueprint owns the adapter shape; project owns the client.
- Event-id store realisation (in-memory LRU for a single-process deployment, or a shared store for a horizontally-scaled deployment). Blueprint fixes the put-if-absent-with-expiry interface; project owns the store.
- Retry budget and jitter cap (defaults 2 retries and 8000ms respectively, both project-configurable via numeric references). Blueprint owns the posture; project owns the numbers.
- Tolerance window for webhook timestamps (default 300 seconds, project-configurable via a numeric reference). Blueprint owns the semantics; project owns the number.
- Webhook route path and mounting point (the blueprint fixes the verifier's shape; the route path lives on the project's own HTTP layer).
- Secret-reference resolver (the shipped `security-secrets-management` client, a project-authored resolver, or an environment shim). Blueprint owns the boundary; project owns the resolver.
- Sender-domain verification (Resend-owned operation the operator completes before running the happy-path AC). Blueprint gates on the refusal class at runtime; project owns the verification.
- Stub adapter usage in test environments (record-only test double shape-compatible with the real adapter). Blueprint ships the shape; project owns the wiring and the deployment-side refusal of the stub in production.

## Cost-honesty paragraph

Shipping this doc set costs the project the following. Every send now runs through one adapter module, which is a small friction on ad-hoc scripts that would otherwise reach a mail library directly; the discipline is intentional and pays off on the day someone needs to change transport or add per-vendor observability. The webhook route is a stateful component (the event-id store) the project maintains; wiring it to a shared store on a horizontally-scaled deployment is a project cost the blueprint does not carry. The retry budget bounds worst-case adapter latency around 20 seconds on the transient classes; a project running behind a tighter SLA lowers the cap and accepts the trade against a higher rate of surfaced transient failures. The four-class error taxonomy means every consumer branches on the class code rather than parsing provider prose; the class table lives in the adapter and needs an update when the provider changes reply-code phrasing, which is a real (small) maintenance cost. The blueprint says nothing about templating, about sender reputation management, about analytics fan-out, about regulatory compliance, or about mail-list management; a project that needs any of those spends its own build cycles on them and this blueprint does not save it any work there. The default SMTP transport is a deliberate trade against the Resend HTTP API's richer per-send metadata; a project that needs that metadata pays the supersede-and-swap cost, which the ADR-401 alternatives block sizes explicitly.
