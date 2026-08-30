# Persistence blueprint guide

## What it is

A default durable-store floor for small greenfield rcf-lite projects. The blueprint contributes the WHAT of a persistence pattern: how the store gets opened, how the schema evolves, how migrations apply, how a mid-migration crash is handled, how the store event log looks, how the boundary between the domain and the engine is drawn, and how backups are taken. The default engine is a single SQLite file in WAL mode; Postgres is a documented future variant behind the same facade.

Concretely, the blueprint ships eleven requirements, eleven user stories (twenty-five acceptance criteria), four architecture components, and five architecture decision records. Two ADRs are `scope: global` on the topics `persistenceStore` (the engine choice) and `migrationDiscipline` (the forward-only refuse-newer-at-open posture); the other three are scope-local operational ADRs (event secrecy, store-boundary discipline, backup model) that a composing blueprint does not conflict with by default.

## What it is not

Not a domain schema. The tables the project's own entities live in are project-authored, on top of the migration catalog the project maintains. The blueprint governs the store facade and the migration discipline; the domain shape is the project's own responsibility.

Not an ORM. There is no query builder, no active-record layer, no framework-shaped abstraction between the facade's named verbs and the engine binding. Projects that want an ORM wire it inside the facade's implementation and preserve the outward verb surface.

Not a Postgres blueprint. A future `persistence-postgres` blueprint (see 'when it does not fit') will contribute a Postgres-flavoured store TAC and an ADR on `persistenceStore` that deliberately conflicts with this one; until then, projects that need Postgres supersede ADR-601 with a project-level ADR.

Not a logical dump story. Backups are file-level engine-native snapshots. Cross-engine migration and portable dumps are out of scope; projects that need them layer a dump runner beside the file-level backup runner.

Not a connection pool. The facade holds one handle for the process lifetime. Projects that select an engine that benefits from a pool (Postgres) wire it inside the facade and preserve the outward interface.

Not a replication story. Cross-region replication and hot standbys are engine-native decisions a project makes on top of the file-level backup story; the blueprint's backup runner does not orchestrate them.

## When to reach for it

Reach for the persistence-data-sqlite blueprint when:

- The project is a small greenfield rcf-lite deployment (single deployable, one small team, one host or a small container fleet, no ops team standing by).
- The domain has a natural relational shape (bounded set of entities with well-defined relationships) that SQL expresses cleanly.
- Zero-infrastructure persistence is a feature (no database server to run, no connection pool to size, no network round trip between the process and the store).
- The scale envelope is single-writer (concurrent writers negotiate through the same process, not across processes on different hosts) and the working set fits on the same host the process runs on.
- The recovery story that fits is 'copy the file to safe storage, point a compatible build at the copy'; downtime-free file-level backup is the primary recovery path.

## When it does not fit

Do not reach for the persistence-data-sqlite blueprint when:

- Multi-writer scale across hosts, hot standby replication, or cross-region durability are project requirements. A `persistence-postgres` blueprint (unshipped at v1.0.0, promotion signal: the third project asks for it) will own this. Until then, a project with these needs supersedes ADR-601 with a project-level ADR selecting the alternate engine and rewrites the migration catalog into the alternate dialect. The store facade contract, the migration runner contract, and the backup runner contract are preserved.
- The working set is genuinely too large for a single host to hold with reasonable performance (tens of gigabytes of hot data, hundreds of writes per second sustained). At that scale the single-writer envelope becomes an operator experience problem, and Postgres (or the engine ADR-601 promotes) is the more defensible shape.
- The domain shape is genuinely non-relational (opaque blob storage, event streams, time-series with a fixed retention model). A different blueprint (a KV-store blueprint, an event-sourced blueprint, a time-series blueprint) owns those shapes; supersede with a project-level ADR and skip this blueprint.
- The project has a hard requirement for a portable schema-agnostic dump as the primary backup (compliance mandate, cross-engine restore drill). File-level backup is the primary recovery path in ADR-605; projects that need the logical dump layer it on top, or supersede ADR-605 with a project-level ADR.
- The deploy target does not have a persistent filesystem the SQLite file can live on (ephemeral containers with no volume mount, serverless functions). The blueprint assumes a stable path the file survives at across deploys; a project without that assumption picks a different engine.

The design brief `w-2026-07-28-029` originally scoped store-selection separately from the persistence-data-sqlite blueprint. The persistence-data-sqlite blueprint at v1.0.0 does not include a Postgres engine variant because the rcf-lite blueprint mechanism (Phase 1) has no variant/profile selector: two engine TACs contributed together are both applied, and both leave dangling tacIds references if only one is realised. Shipping SQLite-first with Postgres as a documented promotion path mirrors the security-auth-magic-link blueprint's keycloak-local deferral (see the auth guide) and keeps v1.0.0 shippable. A future `persistence-postgres` blueprint plus a mechanism-side variant concept (v1.1 candidate) is the natural evolution.

## What a good outcome looks like

A project applies the persistence-data-sqlite blueprint on a fresh tree, wires its own domain migration entries into the catalog (starting at version 1), realises the four TACs in project-authored FBSes, and lands on a deployed application where:

- The boot sequence opens the store once through the facade; the opened event fires with the configured store path; the schemaVersion read returns the catalog's max version.
- A schema change ships as a new numbered entry in the catalog; the next deploy's boot fires a migrated event whose applied array contains exactly the new version; consumer code reads through the facade at the new schema.
- A SIGKILL of the process while a write is in flight leaves the store openable on the next boot, with committed writes intact and the in-flight transaction rolled back; the opened event fires cleanly, no corruption error surfaces.
- A rollback to an older build against a store the newer build wrote fails at boot with a stable-coded refuse-newer error naming both versions; the operator diagnoses in one step (the older build cannot run against the newer store) and redeploys the newer build.
- A backup runs on a cron against the live store; the backupCheckpoint event fires on the sink with the artifact path and the completion timestamp; a fresh process opens the artifact and reads the rows committed at or before the completion timestamp.
- The auth event log, the wire-request log, and every other domain log surface holds no store-lifecycle records; the store's event log holds no domain-row values.

## Operator decisions that remain open after apply

- Engine choice (SQLite default, Postgres or KV-store or event-sourced by superseding ADR-601). Blueprint owns the facade contract on both sides of the boundary; project owns the engine.
- Migration catalog layout (one file or one file per migration, under the schema-samples reference). Blueprint owns the shape; project owns the layout choice at whatever history size feels comfortable.
- Store path or connection string (the configuration input to the open entry point). Blueprint owns the entry point signature; project owns the deployed value and how it is supplied (env var, config file, container volume).
- Domain schema (every table beyond the schemaVersion bookkeeping table). Blueprint owns the migration discipline; project owns the tables.
- Backup schedule and destination (cron cadence, artifact path template, retention). Blueprint owns the backup runner and its event; project owns when and where.
- Restore drill cadence (a backup you have not restored is a hope, not a backup). Blueprint owns the artifact shape; project owns proving it works.
- Log sink implementation (where opened / migrated / backupCheckpoint / closed events go). Blueprint owns the event shape and the metadata-only discipline; project owns the shipper.
- Facade verb catalogue (the named CRUD verbs the domain needs). Blueprint owns the boundary discipline (named verbs, no raw-query passthrough); project owns the verbs.

## Cost-honesty paragraph

Shipping this doc set costs the project the following. Every boot pays the migration runner's cost (a single SELECT against the bookkeeping table on a routine boot; the full migration cost on a schema evolution boot). Every facade verb is a project-authored function; the boundary discipline means new query shapes are a two-file edit (facade plus consumer) instead of a scattered raw SQL fragment. Every schema change is a numbered entry the project must not edit after shipping (a shipped migration is a fact of production; a correction is a new migration). The refuse-newer property makes rollback deploys fail at boot rather than silently; that safety comes at the cost of ops running the older build against the older data (or accepting that a data-shape change is one-way). File-level backup is fast and cheap but engine-native; a project that needs a portable dump layers it on top and keeps both in sync. The store's event log is deliberately minimal; a project that needs richer per-operation events (row-level audit trail, hot-path timing) authors those on top of the facade's verbs, not inside the store event sink.
