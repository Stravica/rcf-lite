# Changelog

## 1.1.0 - 2026-09-09

Adds the elicits block (connection-url, migrations-directory, migration-runner-tool, runner-mode, pool-size, idle-timeout-ms, connection-timeout-ms, recovery-destination, recovery-cadence, pitr-provider, advisory-lock-helper) that the REQs and guide were already describing in prose; each option is named in the description of the must-priority REQ that governs its runtime clause. Adds a runtime clause naming the relationalStore applied capability on REQ-001. Adds deliveredBy on REQ-003, REQ-005 and REQ-007. Adds ownerRef on AC-27104-1 (withTransaction). Adds disposition to every AC.

# persistence-data-postgres changelog

## 1.0.0 - 2026-09-06

Initial release. Contract for Postgres as the project's primary durable relational store on a server-tier deployment (Node process, container, non-Workers serverless), accessed through a store facade module that is the sole reader of the `pg` client. Landed via the infra round 5 spec (ratified 2026-09-06) as track T-1.

- 26 contributions: 7 REQs on facade / migrations / prepared statements / transactions / recovery / pool posture / advisory-lock helper; 10 USs at 27101-27110; 4 TACs (2801 facade, 2802 migration runner, 2803 transaction helper, 2804 recovery runner); 5 ADRs (2801 driver with scope global on `persistenceStore`, 2802 migration shape with scope global on `migrationDiscipline`, 2803 runner mode, 2804 recovery, 2805 connection-pool posture).
- Six Node-only probes under `contributions/probes/` proven against a live `postgres:17-alpine` container: `facade-round-trip`, `migration-apply`, `prepared-statement-scan`, `transaction-atomicity`, `recovery-restore-round-trip`, `pool-posture-smoke`. None account-bound; Postgres is local-first per Baz decision 8.
- Sample-app fixture at `packages/rcf-lite/test/fixtures/infra-postgres/` boots `postgres:17-alpine` via docker compose, applies three toy forward-only `.sql` migrations, exposes the facade over `pg`, and hosts `SIMULATE_MIGRATION_FAILURE` and `SIMULATE_CONSTRAINT_VIOLATION` switches for the negative-run probe paths.
- Declares `capabilities: ["relationalStore"]`, `suggestedCompanions: [{role: "logging"}, {role: "errorHandling"}]`, `providesRoles` absent, `requiresAppliedCapabilities` absent.
- Reserves the round-6 Hyperdrive v1.1.0 adapter slot at ADR-2801 by keeping the driver reference opaque at the facade boundary.
- Advisory-lock helper (REQ-007) ships in v1.0.0 as elicited with default `off` per the ratified Q1 answer on infra round 5 spec section 10.
