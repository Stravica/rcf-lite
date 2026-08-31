# Persistence data D1 blueprint guide

## What it is

A default durable-store floor for small greenfield rcf-lite projects deployed on Cloudflare Workers. The blueprint contributes the WHAT of a Workers-tier persistence pattern: how the D1 binding is read, how the store facade wraps it, how schema evolves through wrangler-owned numbered migrations, how the deploy pipeline gates the Worker on the apply succeeding first, how the prepared-statement discipline closes the SQL-injection surface by construction, how multi-statement atomicity is expressed through batch, how the store event log looks, and how recovery is available on two paths (Time Travel in the vendor and portable export off the vendor). The default engine is one Cloudflare D1 database; other engines behind the same facade contract on supersede.

Concretely, the blueprint ships seven requirements, seven user stories (twenty acceptance criteria), four architecture components, and five architecture decision records. Two ADRs are `scope: global` on the topics `persistenceStore` (the engine choice) and `migrationDiscipline` (the wrangler-owned deploy-gated posture); the other three are scope-local operational ADRs (event secrecy, module boundary, recovery model) that a composing blueprint does not conflict with by default.

## What it is not

Not a domain schema. The tables the project's own entities live in are project-authored, on top of the migration directory the project maintains. The blueprint governs the store facade contract and the migration discipline; the domain shape is the project's own responsibility.

Not an ORM. There is no query builder, no active-record layer, no framework-shaped abstraction between the facade's named verbs and the D1 prepared-statement surface. Projects that want an ORM (Drizzle, Kysely) wire it inside the facade's implementation and preserve the outward verb surface; the prepared-statement discipline (static SQL literals only) survives the ORM choice because most ORMs emit static SQL from typed queries at build time.

Not a Worker deploy blueprint. The deploy-gate TAC assumes a `wrangler deploy` step exists on the CI surface; a companion `deploy-cloudflare-workers` blueprint (round-2 sibling, unshipped at v1.0.0) is the natural owner of that surface. Until it ships, projects wire their own `wrangler deploy` step and the deploy-gate contract binds against it.

Not a secrets-management blueprint. The CI credential that runs `wrangler d1 migrations apply` and `wrangler deploy` (the `CLOUDFLARE_API_TOKEN`, or the OAuth-scoped credential the vendor issues) is a secret whose storage and rotation posture the `security-secrets-management` blueprint governs. This blueprint references the credential by role, not by name or storage path.

Not a CI-pipeline blueprint. The deploy-gate TAC contributes the requirement that `wrangler d1 migrations apply` orders strictly before `wrangler deploy` and the deploy job refuses on apply failure; the CI file that implements that ordering is the concern of the `delivery-ci-workflows` blueprint or the project's own CI-authoring practice.

Not a logical-dump story beyond the vendor's export. Backups are `wrangler d1 export` artifacts; cross-engine migration and portable dumps beyond D1's own `.sql` export are out of scope. Projects that need a schema-agnostic dump layer a project-authored dump runner beside the file-level runner.

Not a connection pool. The D1 binding is request-scoped; the facade holds no long-lived engine handle. Projects that need connection pooling have picked the wrong engine tier; supersede ADR-1401.

Not a replication or failover story. D1's read-replica surface (accessed via `withSession`) targets read scaling, not failover. Projects that need failover semantics supersede ADR-1401 with an alternate engine that provides them.

## When to reach for it

Reach for the persistence-data-d1 blueprint when:

- The project is a small greenfield rcf-lite deployment on Cloudflare Workers (one deployable, one small team, no ops team standing by, the project's deploy target IS the Workers edge substrate).
- The domain has a natural relational shape (bounded set of entities with well-defined relationships) that SQL expresses cleanly.
- Zero-infrastructure persistence at the vendor tier is a feature (no database server to run, no connection pool to size, no network hop outside the vendor's edge substrate on the request path).
- The steady-state working set fits inside D1's currently published per-database ceiling on the project's plan tier (a currently-published upper bound of 10 GB per D1 database on the Paid plan; 500 MB on the Free plan) and the per-Worker-invocation query count fits inside the plan's limit (currently 1000 on Paid, 50 on Free).
- The recovery model that fits is 'rewind in place within the vendor recovery window, or reload from a portable off-vendor export artifact for anything longer'; Time Travel is the primary fast path.
- The migration story that fits is 'wrangler CLI applies numbered `.sql` files, gated by the deploy pipeline, no boot-time runner'; the project accepts that a schema-behind-the-code state is closed at CI time, not at request time.

## When it does not fit

Do not reach for the persistence-data-d1 blueprint when:

- The deploy target is not Cloudflare Workers. D1 is only accessible through the Workers runtime; a project deployed on a Node server, a container platform, or a non-Workers serverless surface picks a different engine. The sibling persistence-data-sqlite blueprint (single-file SQLite for a Node-tier deployment) is the natural pair; a project that needs Postgres supersedes ADR-1401 with a project-level ADR.
- Multi-writer scale across regions, hot standby replication, or true failover are project requirements. D1's read-replica surface is a read-scaling primitive, not a failover primitive; a project that needs failover supersedes ADR-1401 with an alternate engine that provides them.
- The working set is genuinely too large for the currently published per-database D1 ceiling on the project's plan tier. At that scale a project's options are to shard across multiple D1 databases (a shape the blueprint does not prescribe), or to supersede ADR-1401 with a Postgres or equivalent engine that lifts the ceiling.
- The domain shape is genuinely non-relational (opaque blob storage, event streams, time-series with a fixed retention model). A different blueprint (a KV-store blueprint, an event-sourced blueprint, a time-series blueprint) owns those shapes; supersede with a project-level ADR and skip this blueprint.
- The project has a hard requirement for a boot-time migration runner discipline (a service that reads the schema version at start and applies pending migrations before serving). Reach for the persistence-data-sqlite blueprint instead; its `migrationDiscipline` topic is exactly that shape. The two blueprints deliberately conflict on `migrationDiscipline` on this exact difference.
- The project has a hard requirement to run the same store engine locally in the developer's process (a small tool that ships with an embedded store, a CLI that reads from the store without a Workers runtime). D1 is only fully realised inside a Workers runtime; `wrangler dev` provides a local D1 for development, but a project whose primary consumer is not a Worker picks a different engine.

The blueprint round-2 ratification scoped persistence-data-d1 as the vendor sibling of persistence-data-sqlite on the shelf. The two blueprints ship the same two global topics on purpose (`persistenceStore` and `migrationDiscipline`) with different vendor answers. Composing both on one project surfaces the pairing as two `globalAdrTopic` conflicts the operator resolves; the expected shape is one project-level ADR per topic that fixes the tier reasoning. A project that mixes D1 for one deployable and single-file SQLite for another deployable does so through separate project-level ADR rulings, not through mixing both blueprints on one project.

## What a good outcome looks like

A project applies the persistence-data-d1 blueprint on a fresh tree, wires its own domain migration files into the wrangler-configured directory (starting at file number 0001), realises the four TACs in project-authored FBSes, wires the CI job with `wrangler d1 migrations apply` ordered strictly before `wrangler deploy`, and lands on a deployed Worker where:

- The first Worker request per isolate imports the facade, reads the D1 binding once from `env`, and serves the request; the facadeReady event fires exactly once per isolate with the binding and environment names.
- A schema change ships as a new numbered `.sql` file under the wrangler-configured directory; the next deploy's CI job applies the file to the target D1 database, the deploy proceeds, the migrationsApplied event fires with the applied filename, and consumer code reads through the facade at the new schema shape.
- An accidental drop is a one-command Time Travel restore inside the plan's recovery window; the timeTravelRestored event fires with the restore timestamp; a fresh Worker request reads the pre-drop state.
- A scheduled export runs on a cron against the live database; the backupExported event fires on the sink with the artifact path and the completion timestamp; a fresh D1 database primed from that artifact reads the rows committed at or before the export completion timestamp.
- A rollback to an older Worker build against a database whose migration set is ahead of the older build's expectations serves cleanly, because the older Worker's SQL literals target a schema shape that is a prefix of the current schema; the vendor's SQLite semantics let the older SELECTs and INSERTs ignore columns added in later migrations.
- The auth event log, the wire-request log, and every other domain log surface holds no store-lifecycle records; the store's event log holds no domain-row values, and a queryFailed event carries the domain-verb name plus the D1 error code, never the failed statement's parameter values.

## Operator decisions that remain open after apply

- Engine choice (D1 default, single-file SQLite for non-Workers deployables, or Postgres or KV-store by superseding ADR-1401 with a project-level ADR). Blueprint owns the facade contract on both sides of the boundary; project owns the engine.
- Migration file naming pattern (wrangler default numbered form, or an ORM-compatible pattern set on `migrations_pattern`). Blueprint owns the shape; project owns the pattern at the ORM alignment cost the project accepts.
- Binding name and database identifier (the wrangler config values). Blueprint owns the read shape (one binding, one facade); project owns the deployed values and how they are supplied per environment.
- Domain schema (every table the domain requires). Blueprint owns the migration discipline; project owns the tables.
- Export schedule and destination (cron cadence, artifact path template, retention, R2 bucket or repository asset choice). Blueprint owns the export runner and its event; project owns when and where.
- Restore drill cadence (a backup you have not restored is a hope, not a backup). Blueprint owns the artifact shape and the Time Travel restore command; project owns proving both work.
- Log sink implementation (where facadeReady, migrationsApplied, backupExported, timeTravelRestored, queryFailed events go). Blueprint owns the event shape and the metadata-only discipline; project owns the shipper.
- CI pipeline choice (GitHub Actions, GitLab CI, whatever). Blueprint owns the ordering contract on the migrations-apply-before-deploy sequence; project owns the CI tool that implements it.
- Facade verb catalogue (the named CRUD verbs the domain needs). Blueprint owns the boundary discipline (named verbs, prepared statements, batch atomicity, no raw-query passthrough); project owns the verbs.
- Secrets storage for the CI credential (`CLOUDFLARE_API_TOKEN` and any deploy-specific secret). Blueprint references the credential by role; the security-secrets-management blueprint owns storage and rotation.

## Cost-honesty paragraph

Shipping this doc set costs the project the following. Every deploy pipeline pays the migrations-apply latency (one wrangler invocation, one round trip to the D1 API) before the Worker deploy runs. Every facade verb is a project-authored function; the boundary discipline means new query shapes are a two-file edit (facade plus consumer) instead of a scattered raw SQL fragment. Every schema change is a numbered `.sql` file the project must not edit after shipping (a shipped migration is a fact of production; a correction is a new numbered file, applied on top). The deploy-gate ordering property makes a failed apply a red CI job rather than a customer-visible 5xx; that safety comes at the cost of a slower deploy loop on any migration change (the apply runs before the deploy; on rollback the operator ships the older code with a migration set that is a prefix, and the older SQL literals ignore added columns per SQLite semantics). Time Travel is the vendor's built-in fast path but bounded by the plan window (currently 30 days on Paid, 7 days on Free); a project whose compliance model demands longer retention runs the export step on a schedule and holds the artifacts off-vendor. The export path is slow enough that the vendor's own guidance warns it blocks other database requests for the duration; schedule it in low-traffic windows. The store's event log is deliberately minimal; a project that needs richer per-operation events (row-level audit trail, hot-path timing) authors those on top of the facade's verbs, not inside the store event sink. The prepared-statement discipline closes the SQL-injection surface by construction, at the cost that consumers who want to hand-roll a new query shape have to add a named verb to the facade instead of reaching into the binding directly.
