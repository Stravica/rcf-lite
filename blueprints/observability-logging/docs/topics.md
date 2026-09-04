# observability-logging: coordination vocabulary

## Global topics

| Topic | Owning ADR | Meaning | Composition note |
|---|---|---|---|
| `logging` | `ADR-1601-observability-logging-line-shape` | Structured single-line JSON emission contract with the shared minimum field set. | Shelf-canonical claim from v1.0.0. A composing blueprint that ships a different logging contract (structured multi-line, per-service special format, non-JSON) conflicts by design; the operator resolves at project level via `rcf define blueprint supersede logging --incoming <source>`. A library-registered logging provider (wsd-logging, acme-log-emit) is preferred over this shelf provider by the companion-suggestion mechanism. |

## Deliberately unclaimed topics

- `logRedaction` (text-level redaction of the `message` string). Named here so a future companion blueprint can claim it cleanly; this blueprint's redaction is field-name granularity per ADR-1603.
- `logTransport` (the transport downstream of stdout). Owned by the surrounding platform; a future blueprint may claim it if the shelf ever ships one.
- `logMetricsBridge` (emitting log-derived metrics). Named here so a future `metrics-store` companion can claim it cleanly.

## Shelf id band and suffix block

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
| observability-logging | 15101-15899 | 16xx | shipped v1.0.0 | `logging` |

The shelf-wide band registry lives in `packages/rcf-lite/docs/blueprint-authoring.md` section 5.
