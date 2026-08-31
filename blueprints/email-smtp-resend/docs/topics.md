# email-smtp-resend blueprint coordination vocabulary

This file is the email-smtp-resend half of the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must respect these bands; email-smtp-resend contributes no scope:global ADR topics of its own.

## Global ADR topics this blueprint contributes (exact strings)

None. The Resend send adapter and the delivery-webhook verifier are project-local capabilities that fill the magic-link blueprint's `TAC-504-security-auth-magic-link-email-delivery-adapter` slot and the parallel delivery-event verification slot; they are not a cross-project vocabulary. Both ADRs shipped by the blueprint (ADR-401 on transport choice, ADR-402 on retry-and-backoff posture) are scope-local. A project holding a different opinion on either supersedes with a project-level ADR without conflicting on any global topic string.

The neutrality rule (round-2 amendment) applies: `email-smtp-resend` ships alone in round 2 without a paired second-vendor blueprint minting alongside it. A sibling `email-smtp-<othervendor>` blueprint would inherit the same shape (SMTP transport, four-class error taxonomy, retry-and-backoff posture, webhook signature verification, replay defence) and would also ship no globals; the shared mail-adapter contract lives inside the magic-link blueprint's `TAC-504` and is a suffix-family ADR concern (`authModel` global at the magic-link blueprint) not an email-blueprint concern.

## Id number bands (registry bootstrap)

AC ids (and therefore US numeric ids, which anchor them) are NOT namespaced by the 0.4.4 schema grammar; the band allocation IS the AC-collision enforcement mechanism. Composing blueprints take a fresh band rather than proposing namespaced AC ids. Band allocation is ratified policy (2026-08-19); this table is the shared registry-bootstrap replicated across every shipped and forthcoming blueprint's `docs/topics.md` until a mechanism-side central registry lands.

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
| spa (to be renamed application-spa) | 1101-1899 | 2xx | shipped v1.0.0 | `clientRouting`, `theming`, `clientState`, `errorEnvelope`, `authModel` |
| rest (to be renamed application-api-rest) | 2101-2899 | 3xx | shipped v1.0.0 | `errorEnvelope`, `authModel`, `apiVersioning`, `logging` |
| auth (to be renamed security-auth-magic-link) | 3101-3899 | 5xx | shipped v1.0.0 | `authModel` |
| email-smtp-resend (this package) | 4101-4899 | 4xx | shipped v1.0.0 (US 4101-4106, ADR-401 and ADR-402, TAC-401 and TAC-402) | none |
| persistence (to be renamed persistence-data-sqlite) | 5101-5899 | 6xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| ci-pipeline (folds into a v2 CI workflow set) | 6101-6899 | 7xx | shipped v1.0.0 | `ciGates`, `strictCoverageGate` |
| observability (to be renamed observability-essentials) | 7101-7899 | 8xx | shipped v1.0.0 | `healthProbes`, `readinessSemantics`, `statusPageContract` |
| security-secrets-management | 8101-8899 | 9xx | shipped v1.0.0 | `secretsSource` |

US 4101-4106 sit at the LOW end of the 4101-4899 band on purpose. A project-side story that mechanically derives from an email-smtp-resend REQ id into the number `4106` (leading `4` + sequence `106`) would collide against email-smtp-resend-US-4106 in this package; the band leaves headroom at the HIGH end (US 4181-4899) so a project's own stories anchored to email-smtp-resend REQs can allocate without conflict. The watchpost run4 lesson applies here too.

## Shared expectations for future composing blueprints

- The mail-adapter contract itself is owned by the magic-link blueprint's `TAC-504-security-auth-magic-link-email-delivery-adapter`, not by this blueprint. A sibling `email-smtp-<othervendor>` blueprint that plugs into the same slot inherits the four-class error taxonomy (`RESEND_*` codes generalise to a `<VENDOR>_*` prefix on the sibling; the class semantics stay the same), the retry-and-backoff posture (ADR-402 is a supersede target), and the webhook signature-and-replay discipline (the header names, the algorithm identifier, and the tolerance window remain configuration references; the vendor's specifics live on the sibling's own `docs/topics.md`).
- Global topics that plausibly belong to a future blueprint and are NOT claimed by any shipped blueprint: `messageSerialisation` and `deliverySemantics` (a message-consumer blueprint's natural globals), `caching` (unclaimed by every shipped blueprint), `metricsExport` and `tracingProtocol` (natural globals for a metrics or tracing blueprint), `emailWebhookContract` (unclaimed; a project intending to fan email-delivery events into a shared bus would benefit from a global here, but this blueprint deliberately does not mint it in v1). Define any of these in your own package's topics doc, in this file's format, and consider whether the band-registry table above needs your slug added.

## Rename awareness

Cross-references in this blueprint's prose use the target-state slugs from the ratified renames pass: `security-auth-magic-link` (for the shipped `auth` blueprint), `persistence-data-sqlite`, `observability-essentials`, `application-spa`, `application-api-rest`. If the rename PR has not yet merged when this blueprint ships, a rebase against the rename PR is required before merge; the cross-references above stay valid at the target state.
