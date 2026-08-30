# Email SMTP Resend blueprint (v1.0.0)

The ninth content blueprint on the rcf-build-lite blueprint mechanism. Scope: a Resend-backed mail-adapter that fills the magic-link blueprint's `TAC-504-security-auth-magic-link-email-delivery-adapter` slot as a shipped default. Transport is Resend's SMTP submission endpoint (keeps the adapter close to a generic SMTP shape a follow-up `email-smtp-<othervendor>` blueprint can sibling cleanly). Vendor default is Resend; the mail-adapter contract itself lives on the magic-link blueprint and remains vendor-neutral. Ships two TACs (send adapter, delivery-webhook verifier), no scope:global ADRs.

## Apply

```
rcf define blueprint add <path-to>/blueprints/email-smtp-resend
```

Phase 1 resolves local path sources only; registry and git-ref resolution is a mechanism follow-up. Apply is idempotent; `rcf define blueprint list` shows the applied entry grouped under the `email` category; `rcf define blueprint remove email-smtp-resend` cleanly removes an unreferenced application.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version, category `email`, and 16 contributions (all scope-local) |
| Doc set | `contributions/` | 6 REQs, 6 USs (15 ACs), 2 TACs, 2 ADRs, all schema-valid and namespaced (`email-smtp-resend-REQ-001` prefix family; `TAC-401-email-smtp-resend-send-adapter` suffix family) |
| Stub adapter reference | `assets/stub-adapter.md` | Record-only test double shape-compatible with the real adapter and with the magic-link blueprint's `TAC-504` interface |
| From-address rotation pattern | `assets/from-address-rotation-pattern.md` | Generic reference-per-surface routing shape for projects that ship several product surfaces from several verified domains; placeholder values only |
| Resend verification pointer | `assets/resend-verification-pointer.md` | Public-docs pointer for Resend's sender-domain verification workflow; no embedded checklist |
| Guide | `guide/email-smtp-resend.md` | Operator-facing: when to use it, when not, what stays your call, the promotion signals for an API-transport supersede and a sibling vendor blueprint |
| Coordination vocabulary | `docs/topics.md` | The id band this blueprint owns (US 4101-4899, ADR/TAC 4xx), the shared id-band registry across the shipped set, and the reason this blueprint contributes zero scope:global topics |

The doc set is contributions (copied into the project tree by `rcf define blueprint add`); the guide, assets, and docs are package-resident references. Guide rendering into `rcf/knowledge/docs/blueprint-guides/` and asset ingestion are mechanism follow-ups; until they land, the working agent reads them from the applied blueprint's source path recorded in `manifest.blueprints[].source`.

## What it contributes, and what it deliberately does not

Contributed kinds: REQ, US (with inline ACs), TAC, ADR. Adherence is expressed as ACs; the blueprint ships no test files (ratified decision 5) and no code.

No FBS contributions, as a matter of principle (ratified policy 2026-08-19): FBSes are the work of the implementing agent, not the blueprint; project constraints have to be applied at the time of creation. The blueprint contributes the WHAT (the send-contract shape, the SMTP transport choice, the four-class error taxonomy, the retry-and-backoff posture, the webhook signature verification, the replay defence, the boundary discipline on the SMTP client library and the secret references); the implementing agent derives the HOW-tasks (FBS) in the host project, where the ACs contributed here get picked up by the project's own build sequencing.

Deliberately not contributed: the magic-link blueprint's auth routes themselves (they live on the magic-link blueprint; this blueprint is an ADAPTER only); the mail-adapter interface as a global topic (the interface belongs to the magic-link blueprint's `TAC-504`, not to this blueprint); an SMTP client library or an HTTP client library (project picks from what it already carries; the adapter injects the client at boot); a specific YAML or JSON schema library; a Secrets Manager client (composable with the shipped `security-secrets-management` blueprint or with a project-authored secret-reference resolver of the same shape); a shared event bus for delivery events (the verifier hands parsed events to a downstream handler the project realises; where those events go beyond the handler is a project concern); regulatory or compliance workflow (double-opt-in surfaces, unsubscribe UI, retention of consent records live outside this blueprint's scope); the Resend HTTP API path (project supersedes ADR-401 and swaps the adapter's internal client if the API path is preferred, without changing the interface the auth routes call).

## The zero-global-topic story

This blueprint contributes no `scope: "global"` ADR topics on purpose. The mail-adapter contract is owned upstream on the magic-link blueprint's `TAC-504`; the transport choice and the retry posture are project-local decisions a project can supersede with a project-level ADR without cross-blueprint conflict. Neither is a shared vocabulary a composing blueprint needs to conflict with by string equality. See `docs/topics.md` for the exact reasoning, the id-band allocation (US 4101-4899, ADR/TAC suffix block 4xx), and the shared-registry table.

## Quality bar

One `send({ to, subject, textBody, htmlBody })` method as the sole auth-facing surface; the fixed outcome shape `{ ok, providerStatus, providerMessageId, error }` on every call; exactly one SMTP submission per adapter call on the successful path; four-class error taxonomy (`RESEND_RATE_LIMITED`, `RESEND_SENDER_UNVERIFIED`, `RESEND_RECIPIENT_REJECTED`, `RESEND_TRANSPORT_ERROR`) surfaced on the `error` field with no recipient identity leaked; bounded jittered retry on transient classes and immediate return on terminal classes; webhook signature verification against the configured signing secret with constant-time comparison; HTTP 401 empty-body refusal on mismatch with a `webhookVerificationFailed` audit; stale-timestamp refusal against the configured tolerance window with a `webhookReplayStale` audit; duplicate-event-id refusal against a bounded event-id store with a `webhookReplayDuplicate` audit and HTTP 200 acknowledgement; the SMTP client library imported from exactly one module (the adapter); no literal SMTP credential, sender address, or signing secret in adapter source. Every bar is carried by ACs in the doc set, not by this README.

## Known mechanism-reach gaps

None at v1.0.0. Every AC on every story is bound to at least one TAC that the host project must realise, and every AC's `then` clause is runtime-observable in the deployed application (SMTP submission counters for send-side ACs, byte-scan for recipient-identity suppression, HTTP status and audit-sink observation for webhook ACs, source-tree import-graph scan for the SMTP-client boundary property, source-scan for the no-literal-credential property). The mechanism-reach principle from the authoring standard section 7 is satisfied at ship: a project that applies this blueprint and does not realise a TAC leaves an unresolved `tacIds` reference on the story that `rcf define validate` and `rcf audit coverage` refuse. The one operational surface a project must own on its own is the SMTP client library selection and the event-id store choice (an in-memory LRU for a single-process deployment, a shared store for a horizontally-scaled deployment); each is stated as a TAC interface, not as a smuggled runtime probe. The one AC whose runtime observability depends on operator readiness is AC-4101-2 (the happy-path successful send), which requires a verified sender domain with the provider; the AC is scoped to a running project whose configuration passes verification, and the `assets/resend-verification-pointer.md` pointer names where the operator completes that work.
