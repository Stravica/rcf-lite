# application-api-rest blueprint coordination vocabulary

This file is the application-api-rest half of the cross-blueprint contract; the application-spa blueprint's `blueprints/application-spa/docs/topics.md` defines the format and the founding vocabulary. The conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | application-api-rest contribution | Origin | Composition note |
|---|---|---|---|
| `errorEnvelope` | ADR-301-application-api-rest-error-envelope | Reused verbatim from the application-spa vocabulary | DELIBERATE pairing: application-spa contributes ADR-204-application-spa-error-envelope on this topic. Applying both blueprints to one project surfaces the conflict for operator resolution. Expected resolution: one project-level ADR adopting RFC 7807 end to end, superseding both halves |
| `authModel` | ADR-302-application-api-rest-auth-model | Reused verbatim from the application-spa vocabulary | DELIBERATE pairing with SPA's ADR-205-application-spa-auth-model (cookie-based sessions, client half). Expected resolution: one project-level ADR fixing the credential transport and mapping the client session model onto the four server classes |
| `apiVersioning` | ADR-303-application-api-rest-api-versioning | Minted here; pre-cleared as unclaimed in the application-spa vocabulary | The one versioning strategy for the project's wire contract. Any blueprint contributing a versioned API surface must join or supersede this decision |
| `logging` | ADR-304-application-api-rest-logging | Minted here; pre-cleared as unclaimed in the application-spa vocabulary | The project's primary logging shape. Any blueprint contributing log-emitting server components conflicts here by design |

Rules for new topics (inherited from the application-spa vocabulary, restated as law): lower camel case, one concept per topic, no version suffixes. A topic names the decision area, not the chosen answer. Do not mint variants of existing strings (`errorShape`, `auth`, `apiVersion`, `logShape` are all wrong).

## Id number bands

Band allocation is ratified policy (2026-08-19); the band IS the AC-collision enforcement mechanism, since AC ids are not namespaced by the 0.4.4 grammar. Composing blueprints take a fresh band rather than proposing namespaced AC ids.

| Band | Owner |
|---|---|
| 001-999 | Project-authored docs |
| 1101-1899 | application-spa blueprint (US 1101-1128, ACs AC-1101-x to AC-1128-x) |
| 2101-2899 | application-api-rest blueprint (this package: US 2101-2120, ACs AC-2101-x to AC-2120-x) |
| 3101-3899 | Reserved for the next blueprint |

Suffix-family ids (ADR, TAC): SPA numbers in the 2xx range, this package takes 3xx (ADR-301 to ADR-308, TAC-301 to TAC-306); the next blueprint should take 4xx.

## Shared expectations for future composing blueprints

- Reuse `errorEnvelope`, `authModel`, `apiVersioning`, and `logging` exactly as spelled here when your blueprint holds an opinion on those decision areas; contribute your own scope:global ADR on the same string and let composition surface the pairing.
- This blueprint's decisions state the server-side halves: RFC 7807 produced at the pipeline's error boundary, four auth classes enforced in middleware, path-versioned contract, JSON-line logs. Compose compatible client or worker halves, or expect the operator to supersede with project-level decisions.
- Global topics that plausibly belong to a future blueprint and are NOT claimed here: `messageSerialisation` and `deliverySemantics` (a message-consumer blueprint's natural globals), `caching` (unclaimed by both application-spa and application-api-rest; claim it if your blueprint owns the caching story). Define any of these in your own package's topics doc, in this file's format.
