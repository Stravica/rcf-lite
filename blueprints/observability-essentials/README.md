# Observability blueprint (v1.0.0)

The fifth content blueprint on the rcf-build-lite blueprint mechanism (design brief v2, ratified; Phase 5 of the blueprint programme). Scope: two HTTP health probes (liveness /healthz answering strictly on in-process state, readiness /readyz aggregating over an explicit boot-time-declared dependency set with strict-any-fail semantics), a public status page rendering a declared component list plus stable-fielded incident notices, and a durable notification-outcome sink recording every attempt's outcome for later query by recipient and window. Targeted at small greenfield rcf-lite projects. Historical uptime charts, metrics export, and distributed tracing are documented future variants; the v1.0.0 blueprint ships the current-state contract only.

## Apply

```
rcf define blueprint add <path-to>/blueprints/observability-essentials
```

Phase 1 resolves local path sources only; registry and git-ref resolution is a mechanism follow-up. Apply is idempotent; `rcf define blueprint list` shows the applied entry; `rcf define blueprint remove observability-essentials` cleanly removes an unreferenced application.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version, and the 29 contributions with scope/topic on the three global ADRs |
| Doc set | `contributions/` | 10 REQs, 10 USs (30 ACs), 4 TACs, 5 ADRs, all schema-valid against rcf-schemas 0.4.5 and namespaced (`observability-essentials-REQ-001` prefix family; `ADR-801-observability-essentials-health-probes` suffix family) |
| Probe body sample | `assets/probe-samples/liveness-body.json` | Exact shape of the liveness probe response body at v1.0.0 |
| Readiness body sample | `assets/probe-samples/readiness-body.json` | Exact shape of the readiness probe response body with the checks object |
| Status page sample | `assets/status-page-samples/status-page-with-notice.html` | Illustrative rendered HTML with two components and one active incident notice, showing the machine-readable data attributes |
| Status page empty sample | `assets/status-page-samples/status-page-clean.html` | Illustrative rendered HTML with no active notice, showing the emptyState marker |
| Guide | `guide/observability-essentials.md` | Operator-facing: when to use it, when not, what stays your call, and the promotion signal for the future metrics and tracing variants |
| Coordination vocabulary | `docs/topics.md` | The three global-topic strings this blueprint contributes, the shared id band registry (application-spa, application-api-rest, security-auth-magic-link, hello-panel, persistence-data-sqlite, ci-pipeline, observability-essentials) |

The doc set is contributions (copied into the project tree by `rcf define blueprint add`); the guide, assets, and docs are package-resident references. Guide rendering into `rcf/knowledge/docs/blueprint-guides/` and asset ingestion are mechanism follow-ups; until they land, the working agent reads them from the applied blueprint's source path recorded in `manifest.blueprints[].source`.

## What it contributes, and what it deliberately does not

Contributed kinds: REQ, US (with inline ACs), TAC, ADR. Adherence is expressed as ACs; the blueprint ships no test files (ratified decision 5) and no code.

No FBS contributions, as a matter of principle (ratified policy 2026-08-19): FBSs are the work of the implementing agent, not the blueprint; project constraints have to be applied at the time of creation. The blueprint contributes the WHAT (the liveness probe contract, the readiness probe contract with its dependency-set declaration and cached-state evaluator, the public status page contract with its declared component list and stable notice fields, the notification outcome sink contract with its recordOutcome and queryByRecipient verbs); the implementing agent derives the HOW-tasks (FBS) in the host project, where the ACs contributed here get picked up by the project's own build sequencing.

Deliberately not contributed: historical uptime charts and rolling reliability numbers on the status page (out of scope at v1.0.0; see 'Known mechanism-reach gaps' below and the guide 'when it does not fit'); a metrics-export surface (Prometheus scrape endpoints, StatsD emission, OpenTelemetry metrics); a distributed-tracing surface (span emission, propagation, sampling); a log-shipping surface (the application-api-rest blueprint's `logging` topic already governs the wire-log shape; this blueprint neither extends nor conflicts with it); an authenticated operator dashboard for granular internal state (the operator gets granular state through the readiness probe body and through project-authored authenticated surfaces, not through this blueprint); the durable substrate for the notification outcome sink (project-owned; the persistence-data-sqlite blueprint is the natural compose partner). An operator-panel-style authenticated drift surface is deliberately outside this blueprint's scope: `operatorPanel` is claimed by the hello-panel walkthrough exemplar and this blueprint does not overlap it.

## The three global decisions

ADR-801-observability-essentials-health-probes ships `scope: global` on topic `healthProbes`. This is the project's HTTP health endpoint contract: two probes on the request-traffic listener, stable JSON body shape, semantic split of liveness vs readiness. A composing blueprint that holds a different endpoint contract (a single /health endpoint, gRPC health protocol, probes on a separate admin port) conflicts here by design.

ADR-802-observability-essentials-readiness-semantics ships `scope: global` on topic `readinessSemantics`. This is the project's readiness aggregation rule and declaration scope: strict-any-fail over an explicit boot-time-declared dependency set, evaluated against per-dep cached state populated by a background evaluator. A composing blueprint that holds a different opinion (quorum aggregation, write-path-only readiness, graceful-degradation model) conflicts here by design.

ADR-803-observability-essentials-status-page-contract ships `scope: global` on topic `statusPageContract`. This is the project's public status surface: declared component list with a fixed operational/degraded/outage/maintenance state enum, plus stable-fielded incident notices with a fixed info/warning/critical severity enum. A composing blueprint that wants a different public contract (a JSON /status.json endpoint, historical uptime cells as v1 requirement, webhook-posted notices) conflicts here by design.

See `docs/topics.md` for the exact strings, the expected resolutions, the delineation from the hello-panel walkthrough's `operatorPanel` topic (which governs the authenticated operator drift surface, not the public status surface), the delineation from the application-api-rest blueprint's `logging` topic, and the AC id band allocation (observability-essentials owns 7101-7899).

## Quality bar

Two HTTP health probes on the request-traffic listener with stable paths and a stable JSON body shape; liveness answers strictly on in-process event-loop responsiveness with zero network egress from the handler; readiness answers strict-any-fail over an explicit boot-time-declared dependency set with cached per-dep state maintained by a background evaluator on its own cadence; readiness never blocks on a synchronous downstream network call from inside the probe handler; a public status page with no auth gate, a declared component list rendered in declared order, a fixed state enum, stable-fielded incident notices, no internal identifiers, no raw metric values, no readiness dependency names on the public surface; a durable notification outcome sink where every attempt records exactly one outcome record with a stable field set and a fixed outcome enum including suppressed as first-class; a queryable-by-recipient-and-window read surface on the sink returning empty rather than error on no match. Every bar is carried by ACs in the doc set, not by this README.

## Known mechanism-reach gaps

- **Historical uptime chart on the status page.** Not shipped at v1.0.0. The status page contract (ADR-803) commits to declared components with current state plus incident notices; a rolling window of per-component uptime numbers would require a metrics store the blueprint does not own and a retention window the blueprint should not decide unilaterally. Turning it into a runtime-observable AC ('the chart renders the last 30 days at 1-day granularity') either becomes document-observable ('a chart element is present') or depends on an unowned subsystem. Recorded here rather than smuggled in as a v1 requirement. Promotion signal: a shipped `metrics-store` blueprint (or the persistence-data-sqlite blueprint's event log fed forward) that a metrics-backed `statusPageContract` v1.1 can build on. Project-side workaround until then: a project that wants a history chart authors it on top of the declared component vocabulary using a project-owned metrics substrate.
- **Notification outcome grep gate.** ADR-805 requires every notification-attempting code path to invoke `recordOutcome` exactly once before returning. The blueprint states the invariant as an AC (AC-7106-1); the mechanism does not compel a project's source tree to only call the transport through the sink. The practical enforcement is a project-side grep gate ('every call to the notification transport is preceded by recordOutcome for that notificationId'), which the blueprint does not ship. A project that skips the gate produces the silent-notification defect the blueprint exists to prevent, and no build-cycle gate refuses the FBS. Promotion signal: a lint-rule or CI-gate contribution in a future rcf-lite blueprint or in the ci-pipeline blueprint's shipped ruleset. Project-side workaround: author the grep gate as a project-authored TC bound to AC-7106-1.
