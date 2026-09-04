# application-error-handling: coordination vocabulary

## Global topics

| Topic | Owning ADR | Meaning | Composition note |
|---|---|---|---|
| `errorHandling` | `ADR-1701-application-error-handling-record-shape` | Internal error record shape: code, category, message, correlationId, cause chain, redacted context. Minted here at v1.0.0. | Transport-agnostic. Composing blueprints that want a different internal record shape conflict by design; the operator resolves at project level. A library-registered errorHandling provider (wsd-error-handling, acme-error-shape) is preferred over this shelf provider by the companion-suggestion mechanism. |

## Distinction from `errorEnvelope`

`errorEnvelope` stays with `application-api-rest` and governs the REST wire body (RFC 7807-style, plus code/correlationId fields). `errorHandling` (this blueprint) governs the internal record shape one project decision above every transport-specific envelope. A future transport blueprint (gRPC, message consumer) claims its OWN transport-specific errorEnvelope-family topic and reads records from this blueprint's factory through the substitutable `transportWriter` interface (TAC-1701).

## Deliberately unclaimed topics

- `retryPolicy` (the runtime schedule and back-off behaviour). Owned by the applying platform; a future blueprint may claim it.
- `errorTelemetry` (aggregated error rate metrics, alerting rules). Belongs to a future metrics or alerting companion when the shelf ships one.

## Shelf id band and suffix block

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
| application-error-handling | 16101-16899 | 17xx | shipped v1.0.0 | `errorHandling` |

The shelf-wide band registry lives in `packages/rcf-lite/docs/blueprint-authoring.md` section 5.
