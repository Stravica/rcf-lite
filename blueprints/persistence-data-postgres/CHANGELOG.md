# Changelog

## 1.1.3 - 2026-09-11

Positive-evidence rule (authoring standard section 7d) conformance pass on the probe pack, plus a live-engine run under the infra-data hardening dispatch (criterion e). The recovery-restore-round-trip probe now reads `POSTGRES_SOURCE_CONTAINER`, `POSTGRES_RESTORE_CONTAINER` and `POSTGRES_RESTORE_PORT` from env so a hardening dispatch on a non-default docker-compose container name or port can run it without patching the probe. The infra-postgres fixture README gains a Declared env vars table naming every environment variable a probe or the fixture reads (POSTGRES_* connection quintet, the three container/port overrides, SIMULATE_MIGRATION_FAILURE, SIMULATE_CONSTRAINT_VIOLATION), so a probe that reads any variable off the table is refused at the reviewer gate. Anatomy test extended to pin the Declared env vars section on the README. All six probes run for real against a locally-hosted postgres:17-alpine with the recovery probe standing up and tearing down its own restore container.

- fix: recovery-restore-round-trip now drives the shipped `exportDatabase` runner (`src/recovery.mjs`) via a `runPgDump` callback so the `backupExported` event fires and is asserted, closing the "bypasses shipped recovery runner" finding. Every teardown step (source TRUNCATE, source pool close, restore `docker rm -f -v`, `docker inspect` absence check, artefact directory `rm -rf`) is recorded on the report with per-step exit status; a teardown FAIL fails the verdict.
- fix: migration-apply now proves per-migration transaction isolation by inducing a mid-set failure with `SIMULATE_MIGRATION_FAILURE=true` and asserting 001 committed (schema_version carries it and the users table exists) while 002 rolled back (schema_version does not carry it and the `UNIQUE` constraint added by 002 is absent) with the failing filename recorded on both the thrown error and the `migrationApplyFailed` event.
- fix: prepared-statement-scan flips to a POSITIVE per-call-site assertion (every recorded `.query` first argument is a static string literal or expression-free template literal; the extracted literal is inspected and only `$N` positional placeholders are counted); the report carries the per-site preview + placeholder list as evidence, not the absence of one bad signature.
- fix: every result row on every probe carries its own `evidence` object; the shared `aggregate([])` helper returns `fail` with `no checks ran` instead of the previous default-pass on an empty results array.


## 1.1.2 - 2026-09-10

Dimension-d single-definition-ownership cleanup on REQ-004: REQ description now references the transaction-helper interface owned on TAC-2803.interfaces.withTransaction rather than restating the driver control literals for begin, commit and rollback. Chain-consistency lint zero on pass 1 and pass 2.

## 1.1.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.1.0 - 2026-09-09

Adds the elicits block (connection-url, migrations-directory, migration-runner-tool, runner-mode, pool-size, idle-timeout-ms, connection-timeout-ms, recovery-destination, recovery-cadence, pitr-provider, advisory-lock-helper) that the REQs and guide were already describing in prose; each option is named in the description of the must-priority REQ that governs its runtime clause. Adds a runtime clause naming the relationalStore applied capability on REQ-001. Adds deliveredBy on REQ-003, REQ-005 and REQ-007. Adds ownerRef on AC-27104-1 (withTransaction). Adds disposition to every AC.

# persistence-data-postgres changelog

## 1.0.0 - 2026-09-06

Initial release. Contract for Postgres as the project's primary durable relational store on a server-tier deployment (Node process, container, non-Workers serverless), accessed through a store facade module that is the sole reader of the `pg` client. Landed via the infra round 5 spec (ratified 2026-09-06).

- 26 contributions: 7 REQs on facade / migrations / prepared statements / transactions / recovery / pool posture / advisory-lock helper; 10 USs at 27101-27110; 4 TACs (2801 facade, 2802 migration runner, 2803 transaction helper, 2804 recovery runner); 5 ADRs (2801 driver with scope global on `persistenceStore`, 2802 migration shape with scope global on `migrationDiscipline`, 2803 runner mode, 2804 recovery, 2805 connection-pool posture).
- Six Node-only probes under `contributions/probes/` proven against a live `postgres:17-alpine` container: `facade-round-trip`, `migration-apply`, `prepared-statement-scan`, `transaction-atomicity`, `recovery-restore-round-trip`, `pool-posture-smoke`. None account-bound; Postgres is local-first per maintainer decision.
- Sample-app fixture at `packages/rcf-lite/test/fixtures/infra-postgres/` boots `postgres:17-alpine` via docker compose, applies three toy forward-only `.sql` migrations, exposes the facade over `pg`, and hosts `SIMULATE_MIGRATION_FAILURE` and `SIMULATE_CONSTRAINT_VIOLATION` switches for the negative-run probe paths.
- Declares `capabilities: ["relationalStore"]`, `suggestedCompanions: [{role: "logging"}, {role: "errorHandling"}]`, `providesRoles` absent, `requiresAppliedCapabilities` absent.
- Reserves the round-6 Hyperdrive v1.1.0 adapter slot at ADR-2801 by keeping the driver reference opaque at the facade boundary.
- Advisory-lock helper (REQ-007) ships in v1.0.0 as elicited with default `off` per the ratified Q1 answer on infra round 5 spec section 10.

Review-fix (2026-09-09): Adds eleven option-binding ACs to close section 7c on the elicits catalogue - migration-runner-tool (AC-27102-4/5/6/7), runner-mode (AC-27102-8/9), recovery-cadence (AC-27105-3/4/5), pitr-provider (AC-27110-3/4). Adds deliveredBy on REQ-001, REQ-002, REQ-004 (three of seven mandatory REQs).
