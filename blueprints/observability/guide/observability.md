# Observability blueprint guide

## What it is

A default observability floor for small greenfield rcf-lite projects. The blueprint contributes the WHAT of an observability pattern: how the process advertises liveness to its orchestrator, how it advertises readiness to its load balancer, how external readers see the current state of the service on a public status page, and how the project records the outcome of every notification it attempts. The default endpoint shape is HTTP with a stable JSON body; metrics export, distributed tracing, and log shipping are documented future variants behind their own future blueprints.

Concretely, the blueprint ships ten requirements, ten user stories (thirty acceptance criteria), four architecture components, and five architecture decision records. Three ADRs are `scope: global` on the topics `healthProbes` (the two-endpoint HTTP JSON contract), `readinessSemantics` (strict-any-fail over an explicit boot-time-declared dependency set with cached per-dep state), and `statusPageContract` (the declared component list, the fixed state enum, and the stable notice fields on the public status page); the other two are scope-local operational ADRs (probe secrecy, notification outcome model) that a composing blueprint does not conflict with by default.

## What it is not

Not a metrics-export surface. There is no Prometheus scrape endpoint, no StatsD emission, no OpenTelemetry metrics contract. Projects that need metrics wire them in project-side or wait for a future `metrics-export` blueprint that composes alongside this one.

Not a distributed-tracing surface. There is no span emission contract, no propagation rules, no sampling policy. A future `tracing` blueprint composes alongside this one; until then, projects that need distributed tracing supersede with a project-level ADR or add a project-authored tracing surface.

Not a log-shipping surface. The REST blueprint's `logging` topic governs the wire-log shape of the HTTP tier; this blueprint does not extend or conflict with that. Notification outcome records are a durable record surface, not a log.

Not an authenticated operator dashboard. The readiness probe body exposes granular per-dependency state for operator consumption, but a rich UI for internal state (per-endpoint metrics, per-request tracing, live event streams) is out of scope; projects that need it author it on top of the readiness surface and their own authenticated dashboards.

Not a historical uptime chart on the status page. The public status page renders current state only at v1.0.0 (see the README's Known mechanism-reach gaps). Projects that need historical uptime cells layer them on top of a project-owned metrics substrate; a future `metrics-store` blueprint or persistence-event-log-fed variant lifts this into an AC at v1.1.

Not an operator drift-detection panel. The hello-panel walkthrough exemplar's `operatorPanel` topic (authenticated persistent operator status panel above the main content) is deliberately distinct from this blueprint's `statusPageContract`; the two surfaces have different audiences (operator vs external reader) and different vocabularies. A project that wants both applies both blueprints and lets them compose.

## When to reach for it

Reach for the observability blueprint when:

- The project is a small greenfield rcf-lite deployment (single deployable, one small team, one host or a small container fleet, no ops team standing by).
- The deploy target runs under an orchestrator that consumes HTTP health probes (Kubernetes, systemd with sd_notify or an http-check add-on, a container platform with an equivalent probe contract).
- The service has external readers (customers, partners, anonymous visitors) who need a canonical answer to 'is this up right now' without opening a support ticket.
- The project sends notifications (email, SMS, push, webhook) to human recipients and needs to answer 'did the customer get it' from a queryable record rather than by hunting a provider dashboard.
- The observability posture is 'start with the two-endpoint HTTP contract plus a public status page, layer metrics and tracing in later'; the blueprint's contract survives that layering, because the probe endpoints are the orchestrator's floor and everything else composes above them.

## When it does not fit

Do not reach for the observability blueprint when:

- The orchestrator does not consume HTTP probes and cannot be reconfigured to (a proprietary orchestration substrate with a fixed non-HTTP health contract, a gRPC-first application on a gRPC-only mesh). A project with these needs supersedes ADR-801 with a project-level ADR selecting the orchestrator's native probe surface; the readiness semantics (ADR-802) and the status page contract (ADR-803) are transport-agnostic and carry over.
- The service has no external readers and no public status contract is needed (an internal-only tool consumed only by authenticated operators). A project with these needs applies the blueprint with the status page path unrouted or supersedes ADR-803 with a project-level ADR declining the public surface. The probes stay useful.
- The service sends no notifications (a read-only API, a batch-only pipeline). A project with these needs applies the blueprint without wiring TAC-804 into any code path; the notification outcome sink is dormant.
- The observability posture is metrics-first or tracing-first (a project that has already committed to OpenTelemetry end-to-end and does not want a lightweight two-probe HTTP floor on top). A project with these needs supersedes the health probe ADR with a project-level ADR mapping to the OpenTelemetry contract; the notification outcome sink and the public status page contract stay useful.
- The project needs multi-region status roll-up on the public page (per-region component state, per-region incident notices). Out of scope at v1.0.0; a future `multi-region-status` blueprint composes alongside this one, or a project supersedes ADR-803 with a project-level ADR extending the component vocabulary to include region.

The design brief `w-2026-07-28-029` originally scoped observability as one of the five stock blueprint categories for the ergonomics ship gate. The observability blueprint at v1.0.0 does not include metrics export or distributed tracing because both are separate decision areas with their own contract surfaces (metrics-export names the wire format for a scrape or push; tracing names the propagation and sampling policy); folding them into one blueprint would produce a package with four global topics that a project has to resolve piecewise. Shipping the two-endpoint HTTP contract plus the public status page plus the notification outcome sink is the shape that fits the mechanism today; a future `metrics-export` blueprint plus a future `tracing` blueprint is the natural evolution.

## What a good outcome looks like

A project applies the observability blueprint on a fresh tree, declares its readiness dependency set (payments-provider, primary-store, sms-gateway) in configuration, declares its public component list (Payments, Notifications, Data) in configuration, wires TAC-801 through TAC-804 into project-authored FBSes, and lands on a deployed application where:

- The orchestrator hits /healthz on the request-traffic listener every N seconds; every hit gets 200 with the JSON body inside a millisecond budget; a stuck process is restarted within N seconds of wedging.
- The load balancer hits /readyz on the request-traffic listener every N seconds; a healthy replica gets 200 and stays in rotation, a replica whose declared payments-provider dependency has gone offline gets 503 and is pulled from rotation without restart. The replica comes back to rotation when the dependency's cached state returns to pass.
- An external customer visits /status without a login, sees the three declared components (Payments: operational, Notifications: degraded, Data: operational) with the current state enum values as data attributes, sees the active incident notice above the component list with its title, body, severity, startedAt and componentIds fields, and does not see any hostname, replica id, database identifier, queue name, internal URL, build hash, request count, latency number, error rate, queue depth, or readiness dependency name anywhere on the page.
- Every notification the application attempts records exactly one outcome record on the durable sink with the notificationId, channel, recipient, outcome, attemptedAt, and (on failure) errorCode fields; the operator queries the sink by recipient identifier and time window and gets the outcome records that match; a recipient with no attempts in the window returns an empty result set.
- A downstream partial outage (a payments-provider that has gone slow) turns the readiness cached state for that dependency to fail; readiness probes return 503 within the readiness evaluation budget; liveness probes continue to return 200 within the tighter liveness budget; the load balancer pulls the affected replicas from rotation; the orchestrator does not restart them; the payments-provider recovers, the background evaluator refreshes the cached state to pass, readiness returns 200, and the replicas re-enter rotation without human intervention.

## Operator decisions that remain open after apply

- The liveness path, the readiness path, and the status page path defaults are /healthz, /readyz, and /status; the project overrides them at boot for compliance with a particular orchestrator convention or platform mandate.
- The readiness dependency set (which downstream deps a failure of makes this replica unfit to serve). Blueprint owns the strict-any-fail semantics and the declaration shape; project owns the concrete dep list.
- The public component list on the status page (name and order). Blueprint owns the vocabulary shape and the state enum; project owns the components themselves and the mapping from internal dep state to public component state.
- The active incident notice authoring workflow (how the operator posts a notice, where the notice store lives, who has permission to post). Blueprint owns the notice field set and the render contract; project owns the write path.
- The background dep-health evaluator cadence and per-dep evaluation budget. Blueprint owns the pattern (cached state, background evaluator, per-dep budget); project owns the concrete cadence and per-dep budget values.
- The notification outcome sink substrate (composing with persistence: a facade verb on that store; standalone: a project-authored durable writer). Blueprint owns the record shape and the enums; project owns the substrate.
- The auth-exempt list (the three paths the blueprint declares; the project decides whether any additional paths should be exempt or whether the exempt list should be stricter).
- Whether to publish the readiness probe path (and its body) to third-party monitoring integrations. Blueprint owns the body shape stability guarantee; project owns the publish decision.

## Cost-honesty paragraph

Shipping this doc set costs the project the following. Every request path pays two probe endpoints on the same listener as request traffic; both handlers are trivial but still consume a small share of the router's dispatch cost. The background dep-health evaluator runs on its own cadence for the process lifetime; a project with N declared dependencies pays N per-dep evaluations per cadence, and each evaluation is a project-authored function that can spend as much time as it likes inside its own budget. The public status page is a first-class HTTP surface the project owns forever: renaming a declared component is a public-contract change; adding a new component is a public-contract change; the fixed state enum and fixed notice severity enum are commitments. The notification outcome sink adds a durable write per notification attempt; a project that sends millions of notifications a day pays proportionately, and the durable substrate has to handle the write rate. The three auth-exempt paths are a security invariant the project maintains across every auth middleware refactor. In return, the project gets: a restart signal decoupled from downstream health, a rotation signal that names which dep failed, a public surface that answers 'is this up' without human involvement, and an answer to 'did the customer get the notification' that is a query not an escalation.
