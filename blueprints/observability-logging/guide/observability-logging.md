# Guide: observability-logging (v1.0.0)

## What it is

A shipped, org-neutral logging contract for a rcf-lite project. Every log emission lands as one JSON object per line on stdout with a shared field set the applying operator's ingestion pipeline can consume without a per-service parser. Correlation identifiers propagate through the request-scoped context and reflect on outbound requests. A field-name redaction boundary keeps PII out of emitted lines by rule, not by hope. The operator elicits the correlation header name, the redaction category additions and the minimum level per environment at apply.

## What it deliberately is not

- Not a log transport. The blueprint ships to stdout; the applying platform pipes it into whatever ingestion service the operator chose. Elastic Common Schema, Loki, Datadog and Splunk all consume one JSON object per line without a per-blueprint adapter.
- Not a metrics or tracing surface. Metrics belong to a future `metrics-store` companion; tracing belongs to a distributed-tracing companion. This blueprint contributes neither.
- Not a text-level PII scrubber. Redaction is field-name granularity per ADR-1603; a PII value concatenated into the `message` string is not caught.

## When to reach for it

- Any project that has not yet applied a logging companion. Applying this blueprint gives a working structured emission surface without registering a library.
- Any project whose applied service blueprints (application-api-rest, application-spa) declare `suggestedCompanions: ["logging"]` and no more specific library provides the role.

## When it does not fit

- A project standing on an organisation with a shipped logging library (`wsd-logging`, `acme-log-emit`) that provides the `logging` role. Register the library and the companion-suggestion mechanism resolves to the library's provider over this shelf fallback.
- A project that needs multi-line stack trace emission for a legacy consumer. This blueprint ships single-line JSON only; a project-level `logging` topic supersede lets the project author a different contract.

## What a good outcome looks like

- One JSON object per line on stdout, correlation identifier threaded across services, PII fields redacted at the boundary, level filter honoured per environment, in-memory capture mode used in tests. `rcf define validate` clean; log ingestion pipeline queries partition cleanly by environment, serviceName and serviceVersion.

## The operator decisions that remain open

- **The inbound correlation header name** (ADR-1602). Recommended default `X-Correlation-Id`; elicited alternative per project. Set the value the surrounding platform's proxy or client tooling already stamps.
- **The redaction categories additions** (ADR-1603). Recommended defaults cover the six common cases; a project with a domain-specific field (ssn, iban, jwt) adds it at apply.
- **The minimum log level per environment** (ADR-1604). Recommended vocabulary is trace / debug / info / warn / error / fatal; elicited minimum per environment. Production is typically info; development is typically debug or trace.
- **The log transport downstream of stdout.** Out of scope for this blueprint; the surrounding platform's pipe wires ingestion.

## Cost-honesty

Applying this blueprint adds five REQs, eight USs, two TACs and four ADRs to the project's chain. The runtime cost is one factory per boot plus one redaction pass per emission. There is no runtime dependency added to the project's `package.json`; the factory is authored against the applying project's own runtime. The main hidden cost is the discipline of routing every emission through the factory: the guide's `Known mechanism-reach gaps` section names the class and the project-side workarounds.
