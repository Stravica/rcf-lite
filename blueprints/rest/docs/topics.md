# REST blueprint coordination vocabulary

This file is the REST half of the cross-blueprint contract; the SPA blueprint's `blueprints/spa/docs/topics.md` defines the format and the founding vocabulary. The conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | REST contribution | Origin | Composition note |
|---|---|---|---|
| `errorEnvelope` | ADR-301-rest-error-envelope | Reused verbatim from the SPA vocabulary | DELIBERATE pairing: SPA contributes ADR-204-spa-error-envelope on this topic. Applying both blueprints to one project surfaces the conflict for operator resolution. Expected resolution: one project-level ADR adopting RFC 7807 end to end, superseding both halves |
| `authModel` | ADR-302-rest-auth-model | Reused verbatim from the SPA vocabulary | DELIBERATE pairing with SPA's ADR-205-spa-auth-model (cookie-based sessions, client half). Expected resolution: one project-level ADR fixing the credential transport and mapping the client session model onto the four server classes |
| `apiVersioning` | ADR-303-rest-api-versioning | Minted here; pre-cleared as unclaimed in the SPA vocabulary | The one versioning strategy for the project's wire contract. Any blueprint contributing a versioned API surface must join or supersede this decision |
| `logging` | ADR-304-rest-logging | Minted here; pre-cleared as unclaimed in the SPA vocabulary | The project's primary logging shape. Any blueprint contributing log-emitting server components conflicts here by design |

Rules for new topics (inherited from the SPA vocabulary, restated as law): lower camel case, one concept per topic, no version suffixes. A topic names the decision area, not the chosen answer. Do not mint variants of existing strings (`errorShape`, `auth`, `apiVersion`, `logShape` are all wrong).

## Id number bands

Band allocation is ratified policy (2026-08-19); the band IS the AC-collision enforcement mechanism, since AC ids are not namespaced by the 0.4.4 grammar. Composing blueprints take a fresh band rather than proposing namespaced AC ids.

| Band | Owner |
|---|---|
| 001-999 | Project-authored docs |
| 1101-1899 | SPA blueprint (US 1101-1128, ACs AC-1101-x to AC-1128-x) |
| 2101-2899 | REST blueprint (this package: US 2101-2120, ACs AC-2101-x to AC-2120-x) |
| 3101-3899 | Reserved for the next blueprint |

Suffix-family ids (ADR, TAC): SPA numbers in the 2xx range, this package takes 3xx (ADR-301 to ADR-308, TAC-301 to TAC-306); the next blueprint should take 4xx.

## Shared expectations for future composing blueprints

- Reuse `errorEnvelope`, `authModel`, `apiVersioning`, and `logging` exactly as spelled here when your blueprint holds an opinion on those decision areas; contribute your own scope:global ADR on the same string and let composition surface the pairing.
- This blueprint's decisions state the server-side halves: RFC 7807 produced at the pipeline's error boundary, four auth classes enforced in middleware, path-versioned contract, JSON-line logs. Compose compatible client or worker halves, or expect the operator to supersede with project-level decisions.
- Global topics that plausibly belong to a future blueprint and are NOT claimed here: `messageSerialisation` and `deliverySemantics` (a message-consumer blueprint's natural globals), `caching` (unclaimed by both SPA and REST; claim it if your blueprint owns the caching story). Define any of these in your own package's topics doc, in this file's format.
