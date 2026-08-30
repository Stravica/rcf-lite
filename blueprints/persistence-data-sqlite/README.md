# Persistence blueprint (v1.0.0)

The fourth content blueprint on the rcf-build-lite blueprint mechanism (design brief v2, ratified; Phase 4 of the blueprint programme). Scope: single-file SQLite as the default durable store with a forward-only numbered migration catalog applied atomically at open, a store facade that is the sole boundary between the domain and the engine, a structured lifecycle event log, and a downtime-free file-level backup runner. Targeted at small greenfield rcf-lite projects. Postgres is a documented future variant behind the same facade; the v1.0.0 blueprint ships SQLite only.

## Apply

```
rcf define blueprint add <path-to>/blueprints/persistence-data-sqlite
```

Phase 1 resolves local path sources only; registry and git-ref resolution is a mechanism follow-up. Apply is idempotent; `rcf define blueprint list` shows the applied entry; `rcf define blueprint remove persistence-data-sqlite` cleanly removes an unreferenced application.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version, and the 31 contributions with scope/topic on the two global ADRs |
| Doc set | `contributions/` | 11 REQs, 11 USs (25 ACs), 4 TACs, 5 ADRs, all schema-valid against rcf-schemas 0.4.5 and namespaced (`persistence-data-sqlite-REQ-001` prefix family; `ADR-601-persistence-data-sqlite-store-model` suffix family) |
| Migration shape sample | `assets/schema-samples/migration-shape.md` | The exact shape of a migration catalog entry (version, description, statements) with a worked example |
| Catalog layout sample | `assets/schema-samples/catalog-file-layout.md` | Two layouts the catalog module can take (one file, one file per migration) with a pick guide |
| SQLite backup procedure | `assets/backup-procedures/sqlite-file-copy.md` | The downtime-free file-copy procedure under WAL, with the online-backup and checkpoint-then-copy paths |
| WAL checkpoint note | `assets/backup-procedures/hot-checkpoint-note.md` | Why a checkpoint before a bare cp works, and when the online-backup API is the safer path |
| Guide | `guide/persistence-data-sqlite.md` | Operator-facing: when to use it, when not, what stays your call, and the promotion signal for the future Postgres variant |
| Coordination vocabulary | `docs/topics.md` | The two global-topic strings this blueprint contributes, the shared id band registry (application-spa, application-api-rest, security-auth-magic-link, hello-panel, persistence-data-sqlite, ci-pipeline, observability-essentials) |

The doc set is contributions (copied into the project tree by `rcf define blueprint add`); the guide, assets, and docs are package-resident references. Guide rendering into `rcf/knowledge/docs/blueprint-guides/` and asset ingestion are mechanism follow-ups; until they land, the working agent reads them from the applied blueprint's source path recorded in `manifest.blueprints[].source`.

## What it contributes, and what it deliberately does not

Contributed kinds: REQ, US (with inline ACs), TAC, ADR. Adherence is expressed as ACs; the blueprint ships no test files (ratified decision 5) and no code.

No FBS contributions, as a matter of principle (ratified policy 2026-08-19): FBSs are the work of the implementing agent, not the blueprint; project constraints have to be applied at the time of creation. The blueprint contributes the WHAT (the store facade contract, the migration runner contract, the migration catalog shape, the backup runner contract, the event log discipline); the implementing agent derives the HOW-tasks (FBS) in the host project, where the ACs contributed here get picked up by the project's own build sequencing.

Deliberately not contributed: the domain schema (the tables the project's own entities live in are project-authored, not blueprint-authored; the blueprint governs the store facade and the migration discipline, not the domain shape); ORMs, query builders, and any framework-shaped abstraction above the named CRUD verbs (the facade is a project-authored surface; how it internally implements its verbs is not blueprint-owned); a Postgres engine TAC (deferred; see ADR-601's alternatives and the guide 'when it does not fit'); logical schema-aware dumps (out of scope; see ADR-605's alternatives); connection pooling (an implementation detail of the facade when a project selects an engine that benefits from it, not a blueprint contribution).

## The two global decisions

ADR-601-persistence-data-sqlite-store-model ships `scope: global` on topic `persistenceStore`. This is the project's primary durable store engine choice: single SQLite file, WAL mode, one entry point through the facade. A composing blueprint that holds a different engine opinion (a Postgres-first blueprint, a KV-store blueprint, an event-sourced blueprint) conflicts here by design and expects a project-level ADR resolution.

ADR-602-persistence-data-sqlite-migration-discipline ships `scope: global` on topic `migrationDiscipline`. This is the project's schema-evolution posture: forward-only numbered migrations, atomic per-migration, refuse-newer-than-build at open. A composing blueprint that holds an opinion on migration discipline (event-sourced projections, bidirectional migrations, tenant-per-schema) conflicts here by design.

See `docs/topics.md` for the exact strings, the expected resolutions, the delineation from the application-api-rest blueprint's `logging` topic (which governs the wire-log shape, not the store-event log shape), and the AC id band allocation (persistence-data-sqlite owns 5101-5899).

## Quality bar

Single durable store opened via one boot-time entry point that runs migrations before returning; numbered forward-only migration catalog committed in-tree with a monotonic version integer per entry; refuse-newer-than-build at open with a stable error code naming both versions and no writes on that path; atomic per-migration transactions covering statements and the version bookkeeping row together; kill-9 tolerant durability posture (WAL plus synchronous commit floor under SQLite; engine-native equivalent otherwise) set at open by the facade; structured event log at four defined moments (opened, migrated, backupCheckpoint, closed) with metadata-only fields; store facade as the sole importer of the engine binding, exposing named domain verbs with no raw-query passthrough on the public surface; downtime-free file-level backup emitting a checkpoint event with artifact path and completion timestamp; migration-failed error naming the failing version and preserving the previous version on disk; no domain-row values on the event sink; idempotent no-op open when the store is already at target version. Every bar is carried by ACs in the doc set, not by this README.

## Known mechanism-reach gaps

None at v1.0.0. Every AC on every story is bound to at least one TAC that the host project must realise, and every AC's `then` clause is runtime-observable in the deployed application (event-log record inspection, store-artifact snapshot comparison, engine-native introspection queries through the facade, source-tree import-graph queries for the boundary properties). The mechanism-reach principle from the authoring standard section 7 is satisfied at ship: a project that applies this blueprint and does not realise a TAC leaves an unresolved `tacIds` reference on the story that `rcf define validate` and `rcf audit coverage` refuse. The one operational responsibility a project must own on its own is the engine choice itself, if it supersedes ADR-601 with a project-level ADR; that responsibility is stated as an ADR alternative (see ADR-601 and the guide 'when it does not fit'), not as a smuggled runtime probe.
