# infra-postgres fixture

Sample-app fixture for the `persistence-data-postgres` blueprint (round-5 spec section 3.6, section 5.5). Boots `postgres:17-alpine` in a container, applies three toy forward-only migrations, exposes a facade over the `pg` client, and hosts induced-failure switches the six shipped probes drive against.

## Boot the Postgres container

Docker (the shipped, verified path):

```sh
docker compose up -d postgres
```

Podman (equivalent incantation; not verified in this pass, provided per authoring standard):

```sh
podman-compose up -d postgres
```

Or plain Podman without podman-compose:

```sh
podman run -d --name infra-postgres-fixture \
  -e POSTGRES_USER=rcf \
  -e POSTGRES_PASSWORD=rcf-dev-only \
  -e POSTGRES_DB=rcf_test \
  -p 5432:5432 \
  --health-cmd 'pg_isready -U rcf -d rcf_test' \
  postgres:17-alpine
```

If port 5432 is already bound on the host, override via `POSTGRES_PORT=15432 docker compose up -d postgres`.

Port 4200 is the repository default reserved for the local workspace server; never bind it. This fixture uses 5432 by default.

## Apply migrations

```sh
node src/migrate.mjs
```

Expected output: JSON on stdout with the three applied filenames and exit 0.

## Two-line gate-reviewer boot

```sh
docker compose up -d postgres && sleep 3 && node src/migrate.mjs
node ../../../../../blueprints/persistence-data-postgres/contributions/probes/run-facade-round-trip.mjs
```

The first line brings up the container, waits for the health-check, and applies migrations. The second line runs the first probe; the remaining five probe shims live alongside it and follow the same shape.

## Induced-failure switches

Two switches simulate the failure modes the negative-run probes exercise:

- `SIMULATE_MIGRATION_FAILURE=true` (drives the second migration file body to invalid SQL): the migration runner rolls back the second file's transaction and exits non-zero with the failing filename in stderr; the `migration-apply` probe asserts the failure surface.
- `SIMULATE_CONSTRAINT_VIOLATION=true` (drives the transaction-atomicity probe's second INSERT to a duplicate email): the transaction rolls back on the UNIQUE constraint and the `transactionRolledBack` event fires with `statementIndex: 1`; the `transaction-atomicity` probe asserts the rollback.

## What ships

- `docker-compose.yml`: postgres:17-alpine service with `pg_isready` health-check, `POSTGRES_PORT` override.
- `migrations/`: three forward-only `.sql` files (`001_create_users.sql`, `002_add_email_unique.sql`, `003_add_created_at.sql`).
- `src/store.mjs`: the facade over `pg` per TAC-2801, sole reader of the driver, exposes named domain verbs and the transaction helper.
- `src/migrate.mjs`: the migration runner per TAC-2802, one file one transaction, honours the induced-failure switch.
- `src/recovery.mjs`: the scheduled export runner per TAC-2804, drives `pg_dump` via `child_process.execFile`, atomically renames.
- `package.json`: `pg` as a runtime dependency (the blueprint's shipped default driver on ADR-2801).

## Cleanup

```sh
docker compose down -v
```

Removes the container and the named volume so a fresh boot re-applies migrations from schema_version 0.

## Declared env vars

Every environment variable this fixture or any probe it hosts reads is declared here. A probe that reads any variable not on this table fails the positive-evidence gate row when the anatomy scans it (authoring standard section 7d). `POSTGRES_HOST` is a required declared variable with no literal default in fixture code: when it is unset `connectionUrlFromEnv` throws `MissingPostgresHostError` and each probe records the exact one-variable `accountBoundSkipped` row rather than trying to reach a hard-coded endpoint. To run the probes against the local `postgres:17-alpine` container from `docker compose up -d postgres`, set `POSTGRES_HOST` explicitly (to the reachable host or docker-compose host name) before invoking the probe or the anatomy test.

| Env var | Purpose | Consumed by |
|---|---|---|
| `POSTGRES_HOST` | Connection host. Required declared variable; no literal default. When unset `connectionUrlFromEnv` throws `MissingPostgresHostError` and every consumer probe returns the exact one-variable `accountBoundSkipped` row. | `src/store.mjs` (via `connectionUrlFromEnv`) |
| `POSTGRES_PORT` | Connection port (default `5432`; docker-compose accepts the same var to override the host-side bind). | `src/store.mjs`, `docker-compose.yml` |
| `POSTGRES_USER` | Connection user (default `rcf`). | `src/store.mjs` |
| `POSTGRES_PASSWORD` | Connection password (fixture-only default; a project overrides via env). | `src/store.mjs` |
| `POSTGRES_DB` | Connection database (default `rcf_test`). | `src/store.mjs` |
| `POSTGRES_SOURCE_CONTAINER` | Docker container name of the source postgres for the recovery-restore-round-trip probe's `pg_dump` exec (default `infra-postgres-postgres-1`; a CI runner or positive-evidence run overrides to the actual container name in use). | `blueprints/persistence-data-postgres/contributions/probes/recovery-restore-round-trip.mjs` |
| `POSTGRES_RESTORE_CONTAINER` | Docker container name the recovery-restore-round-trip probe uses for its throwaway restore container (default `infra-postgres-restore`). | same probe |
| `POSTGRES_RESTORE_PORT` | Host port the recovery-restore-round-trip probe binds the throwaway restore container to (default `55432`; a positive-evidence run picks a port from its family's range to avoid parallel-run collisions). | same probe |
| `SIMULATE_MIGRATION_FAILURE` | Induced-failure switch: drives the migration runner's second migration to invalid SQL so the negative-run assertion (rollback + failing filename in stderr) fires. | `src/migrate.mjs`, `migration-apply` probe |
| `SIMULATE_CONSTRAINT_VIOLATION` | Induced-failure switch: forces the transaction-atomicity probe's second INSERT to violate the UNIQUE constraint so `transactionRolledBack` fires with `statementIndex: 1`. | `src/store.mjs`, `transaction-atomicity` probe |

Only `POSTGRES_HOST` gates an `accountBoundSkipped` branch (the fixture rule: no literal endpoint host default in fixture code). When set, every probe in this pack runs against a locally-hosted `postgres:17-alpine` engine and produces positive evidence (row ids, transaction ids, event payloads, `pg_dump` byte counts, row-count and md5 checksum equality between source and restored databases, `.query` call-site tallies) rather than an `accountBoundSkipped` record. When unset, each probe emits exactly one `accountBoundSkipped` row naming `POSTGRES_HOST` and returns without touching the driver.
