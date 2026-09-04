# The REST API blueprint: an operator's guide

This guide is for the human running the project, not the coding agent. It explains what applying this blueprint buys you, when it is the wrong tool, and what still needs your judgement afterwards.

## What this blueprint is

A specification package for a REST service: single deployable, versioned wire contract, no UI in scope. Applying it (`rcf define blueprint add <path>`) merges 50 namespaced documents into your RCF tree: 16 requirements, 20 user stories carrying 117 acceptance criteria, 6 architectural components, and 8 decision records. It also ships reference assets: an OpenAPI 3.1 skeleton with the probe endpoints, error envelope, pagination envelope, and rate-limit shapes pre-populated; a middleware-slot reference for the four auth classes; sample request-response pairs per verb class; and neutral sample resources.

The point, in one sentence: the operational and contractual floor of your API becomes part of the specification, so the same build cycle that verifies your features also verifies that the service is documented, observable, probeable, secured, and honest about errors.

## What it deliberately is not

- It is not code. No framework choice, no middleware implementation, no test files. Your working agent implements tests from the ACs the same way it does for your own stories, and writes the service in whatever stack the project chose. (Adherence is expressed as ACs, decision 5 of the design brief.)
- It is not your product spec. It says every endpoint declares an auth class and every error wears the envelope; it cannot know what your resources are. Elicitation still happens; this package is the floor under it.
- It does not ship FBS work items. Build tasks are derived in the host project at creation time, where the project's own constraints, sequencing, and existing work apply. The blueprint contributes the WHAT (REQ/US/AC/TAC/ADR); your project derives the HOW.

## When to reach for it

Any project whose primary surface is an HTTP API meant to be consumed by clients you do not control end to end: a backend for an SPA, a service in a fleet, a public API. Compose it freely with the application-spa blueprint; that composition is the intended shape for a product with both tiers.

## When it does not fit

- GraphQL or RPC-first services: the resource-modelling, pagination, and filtering requirements assume REST semantics; the observability, probe, and security categories transfer, but you would be opting out of half the doc set. Wait for (or ask for) a blueprint of that shape instead.
- Serverless function collections without a shared pipeline: the middleware-ordering architecture assumes one deployable with one request path. The per-category requirements still read well as a checklist, but the TAC structure will not map.
- Pure internal batch or worker processes with no HTTP surface: only the migrations, logging, and security categories would apply; a worker blueprint is the right home.

## What a good outcome looks like

Attack the finished service from the outside and try to catch it lying: fetch /docs and call an endpoint straight from the spec, send garbage JSON, reuse an idempotency key with a different body, hammer a public endpoint past its limit, kill the database and watch the resolved readiness path tell the truth while the resolved liveness path stays up, grep the logs for the bearer token you just used. A build that honours this doc set answers every one of those correctly. That is the measure: what an integrating client and an on-call engineer get out of the box.

## Your decisions that remain open

1. Resources. The blueprint's conventions bind to the resource inventory your project declares during elicitation; the widgets resource in the assets is anatomy, not product.
2. The four global decisions. Error envelope, auth model, API versioning, and logging shape ship as accepted defaults. Disagree by superseding with a project-level ADR, not by editing the blueprint's files.
3. Composition conflicts. Adding this blueprint alongside the application-spa blueprint surfaces deliberate conflicts on `errorEnvelope` and `authModel`. That is the mechanism working: resolve each with one project-level decision (RFC 7807 end to end; one credential transport mapped onto the four classes).
4. Class defaults and budgets. The four auth classes are fixed; their rate limits, the idempotency TTL, the pagination limits, and the readiness check set are project configuration the ACs require you to declare honestly.
5. Exposure policy for /docs and /openapi.* in production: always-on, authenticated, or off. The ACs require the policy stated; they do not pick it for you.

## Cost honesty

This doc set makes an API slower to declare done, on purpose: 117 criteria is the price of "no endpoint ships undocumented, unmeasured, or unguarded". If you are prototyping a throwaway integration, that price is wrong; skip the blueprint rather than opting out of half of it. If other people's code will call this service, the price is the product.

## Composing with observability-probe-endpoints and observability-essentials (v2.0.0)

From v2.0.0 this blueprint no longer binds literal probe path strings. The three probe surfaces (liveness, readiness, startup) are served at the RESOLVED paths supplied by either the composed observability-probe-endpoints blueprint (Kubernetes profile default `/live`, `/ready`, and, when enabled, `/startup`; `loadBalancer` profile default `/health`) or by project configuration under `probeInterface.paths` in the essentials-alone case. The auth-middleware installer consumes exactly the exempt path set that observability-probe-endpoints emits via TAC-1501 `getExemptPathSet` (or the exact set derived from `probeInterface.paths` in the essentials-alone case); adjacent routes never fall under the same exemption. The generated OpenAPI document names each probe surface and its resolved path at documentation-generation time. The three-way composition invariants live in `packages/rcf-lite/test/blueprint/probe-path-alignment.test.js`.
