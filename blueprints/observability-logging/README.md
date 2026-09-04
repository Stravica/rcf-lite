# Logging blueprint (v1.0.0)

Structured single-line JSON emission for a rcf-lite project. General enterprise practice, no vendor lock-in. Ships the shelf-canonical `logging` global topic on `ADR-1601-observability-logging-line-shape` (transferred from `application-api-rest-ADR-304`, retained there as superseded history). Provides the `logging` role for the companion-suggestion mechanism.

## Apply

```
rcf define blueprint add <path-to>/blueprints/observability-logging
```

Applies namespaced contributions into the project tree and records `manifest.blueprints[]`. Apply is idempotent; `rcf define blueprint list` shows the applied entry; `rcf define blueprint remove observability-logging` cleanly removes an unreferenced application.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version 1.0.0, category `observability`, `providesRoles: ["logging"]`, and the 19 contributions with scope/topic on `ADR-1601` |
| Doc set | `contributions/` | 5 REQs, 8 USs (13 ACs), 2 TACs, 4 ADRs, schema-valid and namespaced (`observability-logging-REQ-001` prefix family; `ADR-1601-observability-logging-line-shape` suffix family) |
| Log line sample | `assets/samples/log-line.json` | Exact JSON shape of one emitted line carrying the shared minimum field set |
| Guide | `guide/observability-logging.md` | Operator-facing: when to use it, when not, what stays your call, mechanism-reach gaps |
| Coordination vocabulary | `docs/topics.md` | The `logging` global-topic string this blueprint claims, plus the shelf-wide id band registry update |

The doc set is contributions (copied into the project tree by `rcf define blueprint add`); the guide, assets and docs are package-resident references.

## What it contributes, and what it deliberately does not

Contributed kinds: REQ, US (with inline ACs), TAC, ADR. Adherence is expressed as ACs; the blueprint ships no test files (ratified decision 5) and no code.

Deliberately not contributed: a specific log-shipping transport (Elastic Common Schema over Logstash, Loki push endpoints, Datadog agent, Splunk HEC); a rotation policy for on-disk log files (the shipped emission target is stdout, and the surrounding platform owns the pipe); a metrics-export surface (out of scope, sits with the metrics-store companion when the shelf ships one); a distributed-tracing surface (spans, propagation, sampling; out of scope for v1). The choice of ECS library (Elastic's, `pino-elastic-common-schema`, a project-authored shim) stays project-side; the blueprint names the ECS-neutral field set the AC binds to.

## The one global decision

`ADR-1601-observability-logging-line-shape` ships `scope: global` on topic `logging`. This is the project's structured emission contract: one JSON object per line to stdout with the shared minimum field set (message, level, timestamp, correlationId, environment, serviceName, serviceVersion). A composing blueprint that holds a different opinion (structured multi-line, per-service special format, non-JSON) conflicts here by design; the operator resolves at project level with `rcf define blueprint supersede logging --incoming <source>`.

See `docs/topics.md` for the exact string, the expected resolutions, and the AC id band allocation (observability-logging owns 15101-15899, ADR/TAC suffix block 16xx).

## Quality bar

One JSON object per line on stdout carrying the shared minimum field set; serialisation failures caught at the boundary with a stderr notice and no service crash; correlation identifier accepted from an inbound header (default `X-Correlation-Id`, elicited alternative), propagated onto every log line, reflected on outbound requests, `null` when no ambient context; PII fields redacted at the emission boundary by named category (recommended defaults: credential, pii.email, pii.name, pii.address, token, bearer; elicited additions); operator-elicited minimum level per environment filtered per line; environment, serviceName and serviceVersion supplied at boot and stamped on every line; an in-memory capture mode for hermetic tests. Every bar is carried by ACs in the doc set, not by this README.

## Known mechanism-reach gaps

- **Call-site coverage.** The blueprint cannot prove every log-emitting call site uses the factory. A rogue `console.log` from any code path bypasses the boundary and lands unstructured text on stdout. Turning the discipline into a runtime-observable AC either becomes document-observable ("the source contains no `console.log`") or requires a project-side gate the blueprint does not ship. Named here rather than smuggled in as a v1 requirement. Promotion signal: a lint-rule contribution in a future rcf-lite blueprint or in the `delivery-ci-workflows` blueprint's shipped ruleset. Project-side workaround: a grep gate as a project-authored TC bound to `AC-15101-1` that walks the source tree for bare `console.` calls outside a whitelist.
- **Text-level redaction.** ADR-1603 redacts at field-name granularity. A payload string that concatenates an email into the `message` field carries the email through the emission. Field-name redaction is fast and predictable; text-level redaction is expensive and prone to false positives. Project-side workaround: wrap the log call sites in a project-authored redaction pass; long-term, a future companion blueprint may claim a text-level `logRedaction` topic.
