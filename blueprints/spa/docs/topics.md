# SPA blueprint coordination vocabulary

This file is the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one (the REST blueprint first) must reuse these exact strings and respect these bands.

## Global ADR topics (exact strings)

| Topic string | SPA contribution | Meaning | Composition note |
|---|---|---|---|
| `clientRouting` | ADR-201-spa-routing | How URLs map to client surfaces | Owned by the client tier; a second client-tier blueprint on one project conflicts here by design |
| `theming` | ADR-202-spa-theming | The one theming mechanism for the project | Any blueprint contributing themable UI must join or supersede this decision |
| `clientState` | ADR-203-spa-client-state | Client cache and state regime | Client-tier owned |
| `errorEnvelope` | ADR-204-spa-error-envelope | The wire error shape | The REST blueprint contributes its own scope:global ADR on this exact topic; `rcf blueprint add rest` after spa (or vice versa) surfaces a DELIBERATE conflict for operator resolution. Expected resolution: one project-level ADR adopting RFC 7807 end to end, superseding both |
| `authModel` | ADR-205-spa-auth-model | The project authentication model | Same deliberate pairing with the REST blueprint's auth-classes decision; resolve with one project-level ADR |

Rules for new topics: lower camel case, one concept per topic, no version suffixes. A topic names the decision area, not the chosen answer.

## Id number bands

AC ids (and therefore US numeric ids, which anchor them) are NOT namespaced by the 0.4.4 schema grammar; only the band allocation prevents cross-blueprint AC collisions. Band allocation is approved policy (Baz, 2026-08-19):

| Band | Owner |
|---|---|
| 001-999 | Project-authored docs (the scaffold seeds US-101 / AC-101-x) |
| 1101-1899 | SPA blueprint (this package: US 1101-1128, ACs AC-1101-x to AC-1128-x) |
| 2101-2899 | Reserved for the REST blueprint |
| 3101-3899 | Reserved for the next blueprint |

Suffix-family ids (ADR, TAC) are string-distinct once slug-suffixed, but this package also numbers them in the 2xx range (ADR-201 to ADR-209, TAC-201 to TAC-206) for legibility; the REST blueprint should take 3xx.

## Shared expectations for the REST blueprint

- Reuse `errorEnvelope` and `authModel` exactly as spelled above; do not mint `errorShape`, `auth`, or variants.
- The SPA data layer consumes RFC 7807 problem details (ADR-204) and cookie-based sessions (ADR-205); the REST blueprint's corresponding decisions should state their client-facing halves in terms compatible with these or expect the operator to supersede both.
- New global topics likely needed by REST and not claimed here: `apiVersioning`, `logging`. They are unclaimed by SPA and free to define, in this file's format, in the REST package.
