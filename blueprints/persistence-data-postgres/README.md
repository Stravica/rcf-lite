# persistence-data-postgres

Postgres as the project's primary durable relational store on a server-tier deployment (Node process, container, non-Workers serverless), accessed through a store facade module that is the sole reader of the `pg` client. Numbered forward-only `.sql` migrations, prepared-statement discipline, transactional atomicity, and a two-path recovery model (scheduled `pg_dump` plus vendor point-in-time recovery). ORM-neutral: a project drops Kysely or Drizzle inside the facade without moving any AC.

## What this blueprint gives you

- **A store facade** (TAC-2801) that is the sole importer of `pg` in your source tree, opens a `pg.Pool` on boot, and exposes typed named domain verbs. Emits `facadeReady` on the first successful ready-check.
- **A migration runner** (TAC-2802) that applies numbered forward-only `.sql` files one file per transaction against a `schema_version` bookkeeping table.
- **A transaction helper** (TAC-2803) wrapping `BEGIN` and `COMMIT` around a callback with `ROLLBACK` on any error and a `transactionRolledBack` event carrying the failing statement's zero-based index.
- **A scheduled export runner** (TAC-2804) driving `pg_dump` via `child_process.execFile` and emitting `backupExported` on completion.
- **Six Node-only probes** proving every runtime observable against a real `postgres:17-alpine` container.

## The seven REQs

| REQ | What it commits |
|---|---|
| REQ-001 | Facade module is the sole reader of `pg`; opens on boot; emits `facadeReady`. |
| REQ-002 | Numbered forward-only `.sql` migrations applied one file one transaction; `schema_version` bookkeeping. |
| REQ-003 | Prepared-statement discipline: every `pg.query` first argument a static string literal with `$N` parameters. |
| REQ-004 | Transactional atomicity via a helper wrapping `BEGIN` and `COMMIT`; `ROLLBACK` on error with `transactionRolledBack` event. |
| REQ-005 | Two-path recovery: scheduled `pg_dump` PLUS vendor point-in-time recovery, both required, both elicited. |
| REQ-006 | Connection-pool posture per deploy target: long-lived on Node, request-scoped on container. |
| REQ-007 | Optional advisory-lock helper elicited default `off`; session or transaction level per the Postgres explicit-locking reference. |

## The four TACs

- **TAC-2801 facade**: the Postgres store facade module.
- **TAC-2802 migration runner**: applies `.sql` files one file one transaction; tracks `schema_version`.
- **TAC-2803 transaction helper**: `BEGIN` / `COMMIT` wrapper with rollback and statement-index event.
- **TAC-2804 recovery runner**: scheduled `pg_dump` runner with `backupExported` event.

## The five ADRs

- **ADR-2801 driver** (scope: global, topic `persistenceStore`): pg (node-postgres) as the shipped v1.0.0 driver; opaque driver reference at the facade boundary so the round-6 Hyperdrive v1.1.0 adapter slots in without a facade re-shape. Standards trace clause: node-postgres parameterised-queries contract at https://node-postgres.com/features/queries.
- **ADR-2802 migration shape** (scope: global, topic `migrationDiscipline`): numbered forward-only `.sql` files; one file one transaction; migration runner tool elicited.
- **ADR-2803 runner mode**: `atBoot` (long-lived Node default) or `ciStep` (Workers-adjacent default); elicited.
- **ADR-2804 recovery**: two-path recovery, both required, cadence elicited.
- **ADR-2805 pool posture**: long-lived on Node, request-scoped on container, delegated to Hyperdrive on Workers-adjacent (v1.1.0). See https://www.postgresql.org/docs/current/explicit-locking.html for the session-vs-transaction advisory-lock semantics REQ-007's optional helper uses.

## Elicited parameters

Connection URL (opaque, from `security-secrets-management` when applied; project-config file otherwise); migrations directory (default `./migrations/`); runner mode (`atBoot` or `ciStep`); scheduled export destination and cadence; PITR window and retention; ORM inside the facade (`none`, `kysely`, `drizzle`, or the project's own module); expose transaction helper (`always`, `neverOutsideFacade`); advisory-lock helper (`off`, `session`, `transaction`); pool posture (`longLivedNode`, `requestScopedContainer`, `hyperdriveManaged` reserved for v1.1.0); pool sizing overrides.

## Companions

- **logging**: every migration apply, every scheduled export completion, and every transaction rollback writes a request-scoped log line; a logging companion supplies the factory.
- **errorHandling**: a migration failure, a constraint violation, or a pool exhaustion constructs an internal error record; an error-handling companion supplies the record factory and the boundary.

## Composition and conflicts

Composes on `security-secrets-management` for the connection URL when applied. Conflicts by design on `persistenceStore` and `migrationDiscipline` with `persistence-data-sqlite` and `persistence-data-d1`; the operator resolves via one project-level ADR per topic.

## The six probes

Each probe is a Node module under `contributions/probes/` exporting the round-5 spec section 3.2 verdict envelope, with a matching `run-<probe-name>.mjs` shim that drives the probe against the sample-app fixture and writes the per-blueprint report at `.rcf/reports/blueprints/persistence-data-postgres/<probe-name>.json`.

| Probe | Anchor AC | What it proves |
|---|---|---|
| `facade-round-trip` | AC-27101-1 | Facade opens, `facadeReady` fires with database name, put and get round-trips |
| `migration-apply` | AC-27102-1 | Three `.sql` files apply one file one transaction; `migrationsApplied` fires; `schema_version` advances |
| `prepared-statement-scan` | AC-27103-1 | Source-tree scan asserts every `.query(...)` first argument is a static string |
| `transaction-atomicity` | AC-27104-1 | Constraint violation rolls back; `transactionRolledBack` fires with statementIndex 1; no row persists |
| `recovery-restore-round-trip` | AC-27105-1 | `pg_dump` artefact primes a fresh Postgres; row-count and checksum equality |
| `pool-posture-smoke` | AC-27106-1 | Two facades at pool size 5 handle twenty concurrent queries with no timeout |

None of the six probes carries `accountBound: true`; Postgres is local-first per infra round 5 spec Baz decision 8.

## How to run the probes locally

```sh
cd packages/rcf-lite/test/fixtures/infra-postgres
docker compose up -d postgres
sleep 3
node ../../../../blueprints/persistence-data-postgres/contributions/probes/run-facade-round-trip.mjs
node ../../../../blueprints/persistence-data-postgres/contributions/probes/run-migration-apply.mjs
node ../../../../blueprints/persistence-data-postgres/contributions/probes/run-prepared-statement-scan.mjs
node ../../../../blueprints/persistence-data-postgres/contributions/probes/run-transaction-atomicity.mjs
node ../../../../blueprints/persistence-data-postgres/contributions/probes/run-recovery-restore-round-trip.mjs
node ../../../../blueprints/persistence-data-postgres/contributions/probes/run-pool-posture-smoke.mjs
docker compose down -v
```

Each shim exits 0 on aggregate pass and 1 otherwise; every report file carries `aggregateVerdict pass` on the canonical fixture state.

## Reserved round-6 Hyperdrive adapter slot

`persistence-data-postgres` v1.1.0 (round 6) adds a `driver: "hyperdrive"` option under ADR-2801, wrapping the same facade contract with the Cloudflare Hyperdrive connection pool and query cache per https://developers.cloudflare.com/hyperdrive/. The v1.0.0 facade holds the driver reference opaque at the facade boundary (`import pg from 'pg'` lives inside the facade; the round-6 minor swaps that import), so no outward AC moves.

## Known mechanism-reach gaps

- **Prepared-statement discipline (REQ-003)** is enforced by a build-time AST scan; a project author who bypasses the facade for a project-side raw `pg.query` call site outside the facade directory is not caught by this probe. Mitigation: the facade sole-reader AC on REQ-001 pins the discipline at author-side review; the prepared-statement-scan probe walks only the facade directory by design.
- **Advisory-lock semantics (REQ-007)** is elicited off by default per the ratified Q1 answer. When enabled, session-level locks survive rolled-back transactions per https://www.postgresql.org/docs/current/explicit-locking.html; use `transaction` for the common case and pick `session` only when cross-transaction locking is the intent.
- **Pool posture per deploy target (REQ-006)** ships defaults matching pg's own; the `pool-posture-smoke` probe drives twenty concurrent queries at pool size 5 and does not impose a sizing formula. Operators sizing for their workload override via the elicited pool-config fields.

## Standards trace

- node-postgres parameterised-queries contract: https://node-postgres.com/features/queries.
- Postgres advisory locks (for REQ-007's optional helper): https://www.postgresql.org/docs/current/explicit-locking.html.
- Postgres MVCC transaction semantics: implicit in the transaction-helper probe; ADR-2803's decision cites the Postgres transaction reference without a URL requirement (the vendor doc is stable).
- CI service container shape: https://docs.github.com/en/actions/using-containerized-services/about-service-containers.
- Cloudflare Hyperdrive (reserved v1.1.0 adapter slot): https://developers.cloudflare.com/hyperdrive/.
