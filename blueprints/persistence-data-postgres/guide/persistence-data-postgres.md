# persistence-data-postgres guide

## What this blueprint gets you

Postgres as your project's primary durable relational store on any server-tier deployment (a long-lived Node process, a container platform, a non-Workers serverless target). The store facade is the sole reader of the `pg` (node-postgres) client in your source tree; consumer code calls named domain verbs on the facade and never touches `pg` directly. Schema evolution is numbered forward-only `.sql` files applied one file per transaction; a `schema_version` bookkeeping table is the single source of truth on what has been applied. Multi-statement writes with atomicity go through a transaction helper that wraps `BEGIN` and `COMMIT` around a callback and rolls back on any error. Recovery is two-path: a scheduled `pg_dump` artefact plus the deploy target's own point-in-time recovery. The v1.0.0 facade holds the driver reference opaque at the ADR-2801 boundary so the round-6 Hyperdrive v1.1.0 adapter slots in as an additive minor without a facade re-shape.

## Apply this blueprint

```sh
rcf define blueprint add persistence-data-postgres
```

On a fresh project this applies cleanly. On a project that already applied `persistence-data-sqlite` or `persistence-data-d1`, `rcf define blueprint add persistence-data-postgres` surfaces a DELIBERATE conflict on the `persistenceStore` and `migrationDiscipline` global-ADR topics. Resolve with one project-level ADR per topic; the operator picks the engine end to end.

## Facade shape

```js
import { createStore } from './store.mjs';

const store = createStore({
  connectionUrl: process.env.DATABASE_URL,
  onEvent: (evt) => logger.info(evt),
  poolConfig: { max: 10 },
});

await store.ready();
const id = await store.createUser('alice', 'alice@example.com');
const row = await store.getUserById(id);
```

The facade opens a `pg.Pool` against the elicited connection URL and emits `facadeReady` exactly once on the first successful ready-check. Every `.query` call passes a static string literal as its first argument with parameters as `$1, $2, ... $N` per the node-postgres parameterised-queries contract at https://node-postgres.com/features/queries. Consumers destructure the verbs they need at their top level and hold the facade reference for the process lifetime (or, on a request-scoped container platform, for the request lifetime).

## Migrations

Numbered forward-only `.sql` files under an elicited `migrations/` directory. Each filename begins with a monotonic integer (`001_...`, `002_...`, `003_...`); the file body is engine-native SQL. The in-tree runner (TAC-2802) applies each file inside its own transaction and records the applied filename in `schema_version`.

```sh
node src/migrate.mjs
```

Which runner tool the project reaches for is elicited on ADR-2802 (bespoke Node runner is the shipped default; `node-pg-migrate`, `sqitch`, and `flyway` are named alternatives). Every runner honours the same discipline: numbered forward-only files, one file one transaction, a `schema_version` bookkeeping row per applied file.

Runner mode is elicited on ADR-2803:

- `atBoot` (default for long-lived Node): the facade invokes the runner on process start before opening the first query.
- `ciStep` (default for Workers-adjacent or request-scoped container targets): the CI pipeline invokes the runner as a deploy step against the target's own connection before the artefact promotes.

## Transactions

```js
await store.withTransaction(async (tx) => {
  await tx.query('INSERT INTO orders(user_id, total) VALUES ($1, $2)', [userId, total]);
  await tx.query('INSERT INTO order_lines(order_id, sku, qty) VALUES ($1, $2, $3)', [orderId, sku, qty]);
});
```

The helper wraps `BEGIN` and `COMMIT` around the callback. If any statement throws, the helper issues `ROLLBACK`, fires `transactionRolledBack` with the failing statement's zero-based index and the pg error code, and re-throws the underlying error. No partial commit lands on the shipped database.

## Recovery

Two paths, both required:

```js
import { exportDatabase, recoveryDrill } from './recovery.mjs';

const { artefactPath, completedAt } = await exportDatabase({
  connectionUrl: process.env.DATABASE_URL,
  destination: process.env.BACKUP_DESTINATION,
  onEvent: (evt) => logger.info(evt),
});
```

Scheduled `pg_dump` runs on your project's cadence (an elicited cron string, a systemd timer spec, or off for CI-only invocation); the runner writes the artefact via `child_process.execFile` and emits `backupExported` on completion. The deploy target's own point-in-time recovery is enabled with an elicited retention window; on a managed cluster, the window is the cluster's PITR setting; on a self-managed cluster, the WAL-archive retention.

Run a periodic recovery drill (US-27110):

```js
const { count, checksum } = await recoveryDrill({
  sourceUrl: process.env.DATABASE_URL,
  destination: process.env.BACKUP_DESTINATION,
  onEvent: (evt) => logger.info(evt),
});
```

The drill primes a fresh Postgres from the artefact and compares row-count and checksum on a fixture table on both databases; a mismatch signals artefact-shape drift before an incident forces a live restore.

## Pool posture per deploy target

Elicited on ADR-2805:

- `longLivedNode` (default): long-lived `pg.Pool` for the process lifetime; shipped defaults pool size 10, `idleTimeoutMillis 30000`, `connectionTimeoutMillis 5000`.
- `requestScopedContainer`: a pool sized to the request budget, disposed at request end; shipped defaults pool size 2, `idleTimeoutMillis 5000`, `connectionTimeoutMillis 3000`.
- `hyperdriveManaged` (reserved for the round-6 v1.1.0 adapter): inherits Hyperdrive's own pool settings and holds no Node-side pool.

Every default is overridable by the operator via elicited pool-config fields at apply time.

## Advisory-lock helper (optional)

Elicited on REQ-007 default `off`. When enabled to `session` or `transaction`, the facade exposes `withAdvisoryLock(key, callback)` that acquires and releases a session-level (via `pg_advisory_lock` / `pg_advisory_unlock`) or transaction-level (via `pg_advisory_xact_lock`; released automatically at COMMIT or ROLLBACK) lock per https://www.postgresql.org/docs/current/explicit-locking.html.

Session-level locks survive rolled-back transactions; use `transaction` for the common case and pick `session` only when cross-transaction locking is the intent.

## CI seam (GitHub Actions service containers)

Add a `services:` block declaring `postgres:17-alpine` to your workflow. Per https://docs.github.com/en/actions/using-containerized-services/about-service-containers, the runner exposes the service either at the label hostname (for container-hosted jobs) or at the mapped port (for host-runner jobs); both patterns are supported.

Container-hosted job (hostname exposure):

```yaml
jobs:
  postgres-integration:
    runs-on: ubuntu-latest
    container: node:24
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: rcf
          POSTGRES_PASSWORD: rcf-dev-only
          POSTGRES_DB: rcf_test
        options: >-
          --health-cmd "pg_isready -U rcf -d rcf_test"
          --health-interval 2s
          --health-timeout 3s
          --health-retries 20
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: node src/migrate.mjs
        env:
          DATABASE_URL: postgres://rcf:rcf-dev-only@postgres:5432/rcf_test
```

Host-runner job (port mapping):

```yaml
jobs:
  postgres-integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: rcf
          POSTGRES_PASSWORD: rcf-dev-only
          POSTGRES_DB: rcf_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U rcf -d rcf_test"
          --health-interval 2s
          --health-timeout 3s
          --health-retries 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: pnpm install --frozen-lockfile
      - run: node src/migrate.mjs
        env:
          DATABASE_URL: postgres://rcf:rcf-dev-only@localhost:5432/rcf_test
```

Adding this seam is the applying project's concern per `delivery-ci-workflows` v2.2.0. The `delivery-ci-workflows` blueprint's alternate-provider four-point mapping (job trigger, Node setup, entry-point invocation, artefact upload) covers non-GHA CI targets against the same `postgres:17-alpine` image.

## What this blueprint does not do

- It does not choose an ORM. Kysely, Drizzle, Prisma, or your team's own module sits inside the facade at operator choice; the outward interface stays orm-neutral.
- It does not build the Hyperdrive adapter. That is a round-6 v1.1.0 additive minor; the v1.0.0 facade holds the driver reference opaque at ADR-2801 so the minor slots in without a facade re-shape.
- It does not schedule the recovery runner. Cadence is elicited (a project-side cron string, a systemd timer, or off for CI-only); a project-side scheduler invokes `exportDatabase`.
- It does not choose a migration tool. Numbered forward-only `.sql` files with one file one transaction is the discipline; the tool is elicited.
