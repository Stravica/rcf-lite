# application-api-rest blueprint (v2.0.0)

The second content blueprint on the rcf-build-lite blueprint mechanism (design brief v2, ratified; Phase 3 of the blueprint programme). Scope: a REST service, single deployable, versioned wire contract, no UI in scope. Composes with the application-spa blueprint by design, including two deliberate scope:global conflicts.

## Apply

```
rcf define blueprint add <path-to>/blueprints/application-api-rest
```

Phase 1 resolves local path sources only; registry and git-ref resolution is a mechanism follow-up. Apply is idempotent; `rcf define blueprint list` shows the applied entry; `rcf define blueprint remove application-api-rest` cleanly removes an unreferenced application.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version, and the 50 contributions with scope/topic on the four global ADRs |
| Doc set | `contributions/` | 16 REQs, 20 USs (117 ACs), 6 TACs, 8 ADRs, all schema-valid against rcf-schemas 0.4.4 and namespaced (`application-api-rest-REQ-001` prefix family; `ADR-301-application-api-rest-error-envelope` suffix family) |
| OpenAPI skeleton | `assets/openapi/openapi-skeleton.yaml` | The anatomy the generated spec must exhibit: probe endpoints, problem-details schema, pagination envelope, 429 shape, x-auth-class extension, idempotency-key declaration |
| Auth-class reference | `assets/middleware/auth-classes.md` | Behaviour contracts for the four middleware slots (public, user, admin, service) |
| Sample pairs | `assets/samples/request-response-pairs.md` | Request-response realisations per verb class, error shapes, and probe shapes |
| Sample data | `assets/sample-data/sample-resources.json` | Neutral resources for fixtures and documentation examples |
| Guide | `guide/application-api-rest.md` | Operator-facing: when to use it, when not, what stays your call |
| Coordination vocabulary | `docs/topics.md` | The global-topic strings this blueprint contributes, id number bands, and expectations for future composing blueprints |

The doc set is contributions (copied into the project tree by `rcf define blueprint add`); the guide, assets, and docs are package-resident references. Guide rendering into `rcf/knowledge/docs/blueprint-guides/` and asset ingestion are mechanism follow-ups; until they land, the working agent reads them from the applied blueprint's source path recorded in `manifest.blueprints[].source`.

## What it contributes, and what it deliberately does not

Contributed kinds: REQ, US (with inline ACs), TAC, ADR. Adherence is expressed as ACs; the blueprint ships no test files (ratified decision 5) and no code.

No FBS contributions, as a matter of principle (ratified policy 2026-08-19): FBSs are the work of the implementing agent, not the blueprint; project constraints have to be applied at the time of creation. The blueprint contributes the WHAT; the implementing agent derives the HOW-tasks (FBS) in the host project, where the ACs contributed here get picked up by the project's own build sequencing.

## The four global decisions

ADR-301 errorEnvelope, ADR-302 authModel, ADR-303 apiVersioning, ADR-304 logging ship `scope: global`. The first two reuse the application-spa vocabulary's exact topic strings on purpose: applying this blueprint alongside the application-spa blueprint surfaces two deliberate conflicts (`errorEnvelope`, `authModel`) for operator resolution, which is the composition mechanism doing its job. `apiVersioning` and `logging` are minted here and were pre-cleared as unclaimed in the application-spa vocabulary. See `docs/topics.md` for exact strings, expected resolutions, and the AC id band allocation (application-api-rest owns 2101-2899).

## Quality bar

OpenAPI 3.1 generated from source with three-axis drift validation in the build; three k8s probes with specified schemas, security-auth-magic-link and log-noise exclusions, and documented failure modes; four auth classes enforced in middleware with x-auth-class contract validation; RFC 7807 on every failure path including pre-routing ones; cursor pagination with write-stability; strict unknown-parameter rejection; idempotency-key replay semantics with declared TTL; per-class rate limits with honest Retry-After; structured JSON logs, RED metrics, and OpenTelemetry spans off one shared request context; forward-only migrations with named reverts and a live /v1/_meta report; secrets never logged, PII redacted by stated policy, TLS outside development, CORS deny-by-default. Every bar is carried by ACs in the doc set, not by this README.

## Breaking change in v2.0.0 (2026-09-04)

This blueprint no longer binds literal probe path strings. The three probe surfaces (liveness, readiness, startup) are served at the RESOLVED paths supplied by either the composed observability-probe-endpoints blueprint (Kubernetes profile default `/live`, `/ready`, and, when enabled, `/startup`; loadBalancer profile default `/health`) or by project configuration under `probeInterface.paths` in the essentials-alone case. REQ-006, US-2108 (all eight ACs), TAC-306, and US-2103 (versioning-exemption AC) were reshaped. Spec: `projects/rcf-lite-wsd/specs/rcf-lite-probe-path-alignment-spec-2026-09-04.md` section 5. Migration: project FBSes and TCs that bind literal `/healthz/live`, `/healthz/ready`, or `/healthz/startup` strings become one edit each to bind the resolved path set; `rcf audit coverage --strict` catches project-side TCs that still hold the literal strings after re-apply. See CHANGELOG.md.
