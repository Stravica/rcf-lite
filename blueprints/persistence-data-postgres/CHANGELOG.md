# Changelog


## 1.1.6 - 2026-09-11

Round-7 closure follow-through: the probe owns its skip and the anatomy invokes every probe unconditionally. The persistence-data-postgres anatomy test now removes the outer POSTGRES_HOST gate, invokes each probe directly, and validates whatever comes back: a skip row for exact one-variable shape, or a counting row against the strict AND-witness rule with a NON-EMPTY STRING identifier under an engine-minted id key (booleans, numbers, arrays and objects never qualify) and a derived-value witness. The limitation-token check now sweeps every `AC-[A-Za-z0-9-]+` token so an invented token alongside a real one is refused. Anatomy pin bumped to 1.1.6.

- fix: identifier predicate on the anatomy STRICT_ID_KEYS check is string-only and non-empty; booleans, numbers, arrays and objects never satisfy an engine-minted id key.
- fix: limitation-token regex broadened to `AC-[A-Za-z0-9-]+` so every AC token is checked for membership in the shipped user-story AC set.
- prose: the pass-8 changelog paragraph refers to the endpoint-host default without naming the retired literal; supporting prose keeps the ruling terminology.
- prose: fixture README no longer names the retired endpoint-host literal on the "How to run" line.


## 1.1.5 - 2026-09-11

Endpoint-host discipline follow-through and honest CRUD-row anchoring on the facade-round-trip probe (maintainer rulings 2026-09-11). The fixture helper `connectionUrlFromEnv` in `packages/rcf-lite/test/fixtures/infra-postgres/src/store.mjs` no longer carries a literal endpoint-host default: when `POSTGRES_HOST` is unset the helper throws a typed `MissingPostgresHostError` and each consumer probe returns the exact one-variable `accountBoundSkipped` row rather than reaching a hard-coded endpoint. The endpoint-host literal on the recovery-restore-round-trip probe's restore-container connection string is replaced by `process.env.POSTGRES_HOST`, matching the docker host the restore container publishes its port on. The fixture README declares the new behaviour and stops claiming the pack is entirely locally hosted. Anatomy pin bumped to 1.1.5.

- fix: facade-round-trip row 2 (the CRUD round-trip) is now `conformanceOnly` against AC-27101-1 - the AC states pool opening and the facadeReady event, which row 1 observes; the CRUD observation cites AC-27101-1 as the nearest shipped AC and names the unobserved clause ("a facadeReady event fires on the injected event sink carrying the database name"). Row 1 stays anchored to AC-27101-1 and remains the source of the pool-opening / facadeReady evidence.
- fix: every probe that calls `connectionUrlFromEnv` declares `POSTGRES_HOST` on its `DECLARED_ENV` list and converts `MissingPostgresHostError` into the exact one-variable `accountBoundSkipped` row per authoring-standard section 7d. The anatomy asserts the honest skip shape in the unset path and validates each row against the strict AND-witness rule in the set path.
- fix: recovery-restore-round-trip's restore-container URL uses `process.env.POSTGRES_HOST`; no literal endpoint host remains in the shipped probe pack or fixture code.
- fix: migration-apply row 1 and row 3 each carry `appliedFilesList` as their strict id witness alongside the `applied` derived witness. Pool-posture-smoke and transaction-atomicity add `databaseName` (captured from `store.ready()`) so every counting row satisfies the strict AND-witness rule when POSTGRES_HOST is set.



Strict-anatomy rewrite of the 7d witness rules. The anatomy test now REQUIRES an AC-id-membership check on every limitation string and every notObservableHere.ac (must exist in the shipped user-story set), REQUIRES both an id-shape witness AND a derived-value witness on every non-declaimed row (strict AND, never OR), invokes every probe directly and validates each returned row in-memory, and requires accountBoundSkipped rows to name exactly one env var declared on the probe DECLARED_ENV list. Anatomy pin bumped to 1.1.4. Probes minimally enriched so every counting row carries BOTH witness shapes.

- fix: facade-round-trip row 0 now carries `databaseName` and `poolReadyOk` alongside the `facadeReadyEvent` id witness.
- fix: migration-apply row 1 now carries `appliedFilesList` alongside the `migrationsAppliedEvent` id witness.
- fix: pool-posture-smoke row now carries `poolPostureStatus` and `poolConfigurationMetadata` alongside the `checkedOut`/`elapsedMs` derived witnesses.
- fix: recovery-restore-round-trip checksum row now carries `checksumMatchStatus` alongside the `srcChecksumMd5`/`dstChecksumMd5` derived witnesses.
- fix: transaction-atomicity row 1 carries `rolledBackTimestamp` and `rolledBackVerificationOk` alongside `transactionRolledBackEvent`; row 2 carries `postRollbackVerificationOk` alongside `postRollbackUserCount`.
- register: neutral wording on the 1.0.0 entry (no capability change).

## 1.1.3 - 2026-09-11

Positive-evidence conformance pass on the probe pack (authoring standard section 7d). The recovery-restore-round-trip probe reads `POSTGRES_SOURCE_CONTAINER`, `POSTGRES_RESTORE_CONTAINER` and `POSTGRES_RESTORE_PORT` from env so a runner on a non-default docker-compose container name or port can execute it without patching probe source. The infra-postgres fixture README gains a Declared env vars table naming every environment variable a probe or the fixture reads (POSTGRES_* connection quintet, the three container/port overrides, SIMULATE_MIGRATION_FAILURE, SIMULATE_CONSTRAINT_VIOLATION); an off-table read is refused at gate. Anatomy pin extended to include the Declared env vars section. All six probes execute against a locally-hosted postgres:17-alpine, with the recovery probe standing up and tearing down its own throwaway restore container.

- fix: recovery-restore-round-trip drives the shipped `exportDatabase` runner (`src/recovery.mjs`) via a `runPgDump` callback so `backupExported` fires and is asserted, closing the "bypasses shipped recovery runner" finding. Every teardown step (source TRUNCATE, source pool close, restore `docker rm -f -v`, `docker inspect` absence check, artefact directory removal) is recorded on the report with per-step exit status; a teardown FAIL fails the verdict.
- fix: recovery-restore-round-trip pre-run cleanup positively asserts the intended pre-state (destination directory absent after removal, restore container absent after `docker inspect`); an inspect error the probe does not recognise fails the row instead of being treated as success. The teardown row is conformance-only (`anchorAcId: null`, `limitation` names AC-27105-1 by full text and states that AC-27105-1's rowset property does not state scratch-resource teardown).
- fix: migration-apply anchors the induced-failure row to AC-27109-1 by spawning the shipped migration runner AS A CHILD PROCESS (`node packages/rcf-lite/test/fixtures/infra-postgres/src/migrate.mjs`) with `SIMULATE_MIGRATION_FAILURE=true`. The child's OS exit code (`childExitCode`), its stderr (which carries `migration failed at 002_add_email_unique.sql: <pg error>`), and the parent's post-run DB inspection (001 committed with users + schema_version row; 002 rolled back with no UNIQUE constraint and no schema_version row) are all on the same row so AC-27109-1's process-exit clause is observed at process level, not from a field the runner returns.
- fix: prepared-statement-scan drops the AST-walk claim (fixture declares no JS parser dependency and adding one is out of scope for this patch bump). Row 1 is conformance-only (`anchorAcId: null`, `limitation` names AC-27103-1 by full text and states that the row's per-call-site tokeniser inventory is not the AST walk the AC requires); the row records positive per-call-site observations under the facade dir (per-site `firstArgKind`, extracted literal preview, `$N` placeholder list, and per-site notes on the two known-safe wrapper patterns). Row 2 is `notObservableHere: { ac: 'AC-27103-1', reason: <parser-scope limitation, not account-bound> }` (the previous `accountBoundSkipped` shape was the wrong disposition - fixture-scope parser gap, not an unset account variable).
- fix: pool-posture-smoke observes the peak concurrent in-use count on each pool at the time of maximum contention (via the shipped pool's `totalCount` / `idleCount` deltas sampled during the checked-out-N-tasks race); the row records `observedPeakInUse` and asserts it equals the configured `max`. The prior row that asserted only the configured `max` is dropped.
- fix: every result row on every probe carries its own `evidence` object; the shared `aggregate([])` helper returns `fail` with `no checks ran` instead of the previous default-pass on an empty results array.

## 1.1.2 - 2026-09-10

Dimension-d single-definition-ownership cleanup on REQ-004: REQ description now references the transaction-helper interface owned on TAC-2803.interfaces.withTransaction rather than restating the driver control literals for begin, commit and rollback. Chain-consistency lint zero on pass 1 and pass 2.

## 1.1.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.1.0 - 2026-09-09

Adds the elicits block (connection-url, migrations-directory, migration-runner-tool, runner-mode, pool-size, idle-timeout-ms, connection-timeout-ms, recovery-destination, recovery-cadence, pitr-provider, advisory-lock-helper) that the REQs and guide were already describing in prose; each option is named in the description of the must-priority REQ that governs its runtime clause. Adds a runtime clause naming the relationalStore applied capability on REQ-001. Adds deliveredBy on REQ-003, REQ-005 and REQ-007. Adds ownerRef on AC-27104-1 (withTransaction). Adds disposition to every AC.

# persistence-data-postgres changelog

## 1.0.0 - 2026-09-06

Initial release. Contract for Postgres as the project's primary durable relational store on a server-tier deployment (Node process, container, non-Workers serverless), accessed through a store facade module that is the sole reader of the `pg` client. Landed via the infra spec (ratified 2026-09-06).

- 26 contributions: 7 REQs on facade / migrations / prepared statements / transactions / recovery / pool posture / advisory-lock helper; 10 USs at 27101-27110; 4 TACs (2801 facade, 2802 migration runner, 2803 transaction helper, 2804 recovery runner); 5 ADRs (2801 driver with scope global on `persistenceStore`, 2802 migration shape with scope global on `migrationDiscipline`, 2803 runner mode, 2804 recovery, 2805 connection-pool posture).
- Six Node-only probes under `contributions/probes/` proven against a live `postgres:17-alpine` container: `facade-round-trip`, `migration-apply`, `prepared-statement-scan`, `transaction-atomicity`, `recovery-restore-round-trip`, `pool-posture-smoke`. None account-bound; Postgres is local-first per maintainer decision.
- Sample-app fixture at `packages/rcf-lite/test/fixtures/infra-postgres/` boots `postgres:17-alpine` via docker compose, applies three toy forward-only `.sql` migrations, exposes the facade over `pg`, and hosts `SIMULATE_MIGRATION_FAILURE` and `SIMULATE_CONSTRAINT_VIOLATION` switches for the negative-run probe paths.
- Declares `capabilities: ["relationalStore"]`, `suggestedCompanions: [{role: "logging"}, {role: "errorHandling"}]`, `providesRoles` absent, `requiresAppliedCapabilities` absent.
- Reserves the round-6 Hyperdrive v1.1.0 adapter slot at ADR-2801 by keeping the driver reference opaque at the facade boundary.
- Advisory-lock helper (REQ-007) ships in v1.0.0 as elicited with default `off` per the ratified Q1 answer on infra spec section 10.

Review-fix (2026-09-09): Adds eleven option-binding ACs to close section 7c on the elicits catalogue - migration-runner-tool (AC-27102-4/5/6/7), runner-mode (AC-27102-8/9), recovery-cadence (AC-27105-3/4/5), pitr-provider (AC-27110-3/4). Adds deliveredBy on REQ-001, REQ-002, REQ-004 (three of seven mandatory REQs).
