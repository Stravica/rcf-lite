# Error-handling blueprint (v1.0.0)

Transport-agnostic error-handling contract for a rcf-lite application. General enterprise practice, no vendor lock-in. Mints the `errorHandling` global topic on `ADR-1701-application-error-handling-record-shape` (distinct from `errorEnvelope`, which stays with application-api-rest as the REST wire shape). Provides the `errorHandling` role for the companion-suggestion mechanism. Suggests the `logging` companion so emission threads through the applied logging factory.

## Apply

```
rcf define blueprint add <path-to>/blueprints/application-error-handling
```

Applies namespaced contributions into the project tree and records `manifest.blueprints[]`.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version 1.0.0, category `application`, `providesRoles: ["errorHandling"]`, `suggestedCompanions: [{role: "logging", ...}]`, and the 16 contributions with scope/topic on `ADR-1701` |
| Doc set | `contributions/` | 4 REQs, 7 USs (9 ACs), 2 TACs, 3 ADRs, schema-valid and namespaced |
| Record schema | `assets/schemas/error-record.schema.json` | JSON Schema for the internal record shape |
| Guide | `guide/application-error-handling.md` | Operator-facing: when to reach, when not, mechanism-reach gaps |
| Coordination vocabulary | `docs/topics.md` | The `errorHandling` global topic distinct from `errorEnvelope`, the shelf-wide id band registry update |

## What it contributes, and what it deliberately does not

Contributed: REQ, US (with inline ACs), TAC, ADR. Adherence is expressed as ACs; the blueprint ships no test files.

Deliberately not contributed: a transport wire envelope (application-api-rest owns REST via `errorEnvelope`; a future gRPC or message-consumer blueprint claims its own); a retry policy implementation (the record carries category; the applying platform's retry surface reads it); a substitute for the logging companion's own field-level redaction (the record's context field is redacted through the applied logging companion's redaction boundary, per AC-16104-1).

## The one global decision

`ADR-1701-application-error-handling-record-shape` ships `scope: global` on topic `errorHandling`. This is the project's internal error record shape (six fields: code, category, message, correlationId, cause, context). A composing blueprint that wants a different internal record shape conflicts here by design. `errorHandling` is distinct from `errorEnvelope` (owned by application-api-rest for REST); the internal record is one project decision above every transport-specific wire envelope.

See `docs/topics.md` for the exact strings, the distinction from `errorEnvelope`, and the AC id band allocation (16101-16899, ADR/TAC suffix block 17xx).

## Quality bar

Process-level uncaught-exception boundary and framework-level pipeline boundary both registered; every record constructed through TAC-1702's factory with code and category required; context redacted at construction time using the applied logging companion's redaction categories; cause chain preserved across nested wrappings; classification vocabulary transient / permanent / unknown (elicited additions per project); transport response mapping delegated through the substitutable transportWriter interface (ADR-1703); emission routed through the applied logging companion factory with a documented stderr fallback when no companion is applied. Every bar is carried by ACs in the doc set.

## Known mechanism-reach gaps

- **Boundary coverage.** The blueprint cannot prove every code path routes through the boundary; a bare `console.error` or a `process.exit` from any code path bypasses the boundary. Project-side workaround: a grep gate as a project-authored TC bound to `AC-16106-1`.
- **Classification integrity.** The vocabulary is enforced at the factory (code + category required), but the correctness of the category the caller chose is not machine-checkable. A caller who classifies every failure as `unknown` still passes the shape gate; the blueprint's guide names the diagnostic pattern.
