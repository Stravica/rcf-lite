# auth blueprint coordination vocabulary

This file is the auth half of the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | auth contribution | Origin | Composition note |
|---|---|---|---|
| `authModel` | ADR-501-auth-magic-link-model | Reused verbatim from the SPA vocabulary and the REST vocabulary | DELIBERATE pairing: SPA contributes ADR-205-spa-auth-model (client half: cookie-based session, 401-redirect posture), REST contributes ADR-302-rest-auth-model (server half: four declared auth classes). Applying any two of the three on one project surfaces the pairing for operator resolution. Expected resolution: one project-level ADR that fixes the credential shape (this blueprint's opaque cookie session), maps it onto the server's auth classes if REST is applied, and specifies the client half's session-expiry posture if SPA is applied |

The auth blueprint claims only one global topic. Every other contribution is scope-local (the four operational ADRs, ADR-502 through ADR-505, do not contribute global topics; a composing blueprint that holds an opinion on token secrecy, anti-enumeration budgets, session lifecycle, or rate limits authors its own project-level ADR if it wants to override).

Rules for new topics (inherited from the SPA and REST vocabularies, restated as law): lower camel case, one concept per topic, no version suffixes. A topic names the decision area, not the chosen answer. Do not mint variants of existing strings (`sessionAuth`, `magicLink`, `sessionModel` are all wrong when `authModel` already exists; `operatorPanel` is claimed by the hello-panel walkthrough exemplar and is not free).

## Id number bands (registry bootstrap)

AC ids (and therefore US numeric ids, which anchor them) are NOT namespaced by the 0.4.4 schema grammar; the band allocation IS the AC-collision enforcement mechanism. Composing blueprints take a fresh band rather than proposing namespaced AC ids. Band allocation is ratified policy (2026-08-19); this table is the shared registry-bootstrap replicated across every shipped and forthcoming blueprint's `docs/topics.md` until a mechanism-side central registry lands (v1.1 candidate).

| Blueprint | US band | ADR/TAC suffix block | Status |
|---|---|---|---|
| spa | 1101-1899 | 2xx | shipped v1.0.0 |
| rest | 2101-2899 | 3xx | shipped v1.0.0 |
| auth (this package) | 3101-3899 | 5xx | shipped v1.0.0 (US 3101-3111, ADR-501 to ADR-505, TAC-501 to TAC-505) |
| hello-panel (walkthrough exemplar) | 4101-4899 | 4xx | doc-reserved; teaching exemplar in `packages/rcf-lite/docs/blueprint-authoring-walkthrough.md`, not shipped as a blueprint directory |
| persistence | 5101-5899 | 6xx | reserved for the next blueprint |
| ci-pipeline | 6101-6899 | 7xx | reserved for the next blueprint |
| observability | 7101-7899 | 8xx | reserved for the next blueprint |

US 3101-3111 sit at the LOW end of the 3101-3899 band on purpose. A project-side story that mechanically derives from `auth-REQ-011` into the number `3111` would collide against auth-US-3111 in this package; the band leaves headroom at the HIGH end (US 3181-3899) so a project's own stories anchored to auth REQs can allocate without conflict.

## Shared expectations for future composing blueprints

- Reuse `authModel` exactly as spelled here when your blueprint holds an opinion on the project's authentication model; contribute your own scope:global ADR on that string and let composition surface the pairing. An OIDC-flavoured auth blueprint (see the auth blueprint's guide, section 'when it does not fit') will conflict here by design.
- This blueprint's decision states the passwordless-magic-link half plus the opaque cookie-session transport. Compose compatible client and server halves, or expect the operator to supersede with one project-level auth-model ADR.
- Global topics that plausibly belong to a future blueprint and are NOT claimed by any shipped blueprint: `messageSerialisation` and `deliverySemantics` (a message-consumer blueprint's natural globals), `caching` (unclaimed by SPA, REST, and auth). Define any of these in your own package's topics doc, in this file's format, and consider whether the band-registry table above needs your slug added.
