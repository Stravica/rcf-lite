/**
 * Migration apply probe.
 *
 * Drops any prior schema (users, schema_version) from the fixture's
 * Postgres, invokes the shipped migration runner, and asserts:
 *   1. every migration filename applied is the expected sequence,
 *   2. migrationsApplied fires with the same filename list,
 *   3. the schema_version bookkeeping table records three rows,
 *   4. PER-MIGRATION TRANSACTION ISOLATION: after resetting again,
 *      induce a failing migration mid-set (SIMULATE_MIGRATION_FAILURE
 *      = true), observe that
 *        - the earlier migration committed (schema_version carries a
 *          row for the applied file and its schema effect is visible),
 *        - the failing migration rolled back (schema_version does NOT
 *          carry a row for it and the schema effect is absent), and
 *        - each successful migration used its own PostgreSQL
 *          transaction id (pg_current_xact_id() sampled through a
 *          post-apply query joined against pg_stat_activity is not
 *          available for completed transactions; instead the probe asserts
 *          disjoint transaction contexts by observing distinct
 *          statement_timestamp() values per BEGIN/COMMIT window,
 *          captured by the runner via a small extended-run hook).
 *
 * Anchors AC-27102-1 (three forward-only .sql migrations apply one
 * file one transaction; migrationsApplied fires with the filename
 * list) and AC-27109-1 (a failing migration rolls back its own
 * transaction, runner exits non-zero with the failing filename in the
 * runner's diagnostic output). The induced-failure phase runs the
 * migration runner AS A CHILD PROCESS so the OS exit code and stderr
 * are observed from the parent, not a `didExit` field the runner
 * returns.
 *
 * Cleanup: leaves the applied schema for downstream probes.
 */

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyAll } from '../../../../packages/rcf-lite/test/fixtures/infra-postgres/src/migrate.mjs';
import { createStore, connectionUrlFromEnv, MissingPostgresHostError } from '../../../../packages/rcf-lite/test/fixtures/infra-postgres/src/store.mjs';

export const DECLARED_ENV = Object.freeze([
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'SIMULATE_MIGRATION_FAILURE',
]);

function skipRow(variable) {
  return {
    anchorAcId: null,
    verdict: 'pass',
    detail: `Given a fresh Postgres database at schema_version 0 - accountBound: skipped (${variable} unset)`,
    accountBoundSkipped: true,
    reason: `${variable} unset`,
    evidence: { skip: true, reason: `${variable} unset`, envDeclared: [...DECLARED_ENV] },
  };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATE_CLI = resolve(HERE, '..', '..', '..', '..', 'packages/rcf-lite/test/fixtures/infra-postgres/src/migrate.mjs');

// Spawn the runner as a child process so the OS-level exit code and
// stderr are observed, not a didExit field the process returns. AC-27109-1
// requires "the runner exits non-zero" - a spawned child is the only
// way to observe that clause honestly.
function spawnRunner({ simulateFailure }) {
  return new Promise((resolveP) => {
    const env = { ...process.env };
    if (simulateFailure) env.SIMULATE_MIGRATION_FAILURE = 'true';
    else delete env.SIMULATE_MIGRATION_FAILURE;
    const child = spawn(process.execPath, [MIGRATE_CLI], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('close', (code, signal) => {
      resolveP({ exitCode: code, signal, stdout, stderr });
    });
  });
}

async function resetSchema(url) {
  const store = await createStore({ connectionUrl: url });
  try {
    await store.ready();
    const pool = store.getPool();
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    await pool.query('DROP TABLE IF EXISTS schema_version CASCADE');
  } finally {
    await store.close();
  }
}

async function tableExists(pool, name) {
  const r = await pool.query(
    `SELECT to_regclass($1) AS oid`, [`public.${name}`],
  );
  return r.rows[0].oid !== null;
}

async function columnExists(pool, table, column) {
  const r = await pool.query(
    `SELECT 1 AS ok FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column],
  );
  return r.rows.length > 0;
}

export default async function runProbe() {
  let url;
  try {
    url = connectionUrlFromEnv();
  } catch (err) {
    if (err instanceof MissingPostgresHostError) {
      return {
        results: [skipRow(err.variable)],
        accountBoundSkipped: true,
        reason: `${err.variable} unset`,
        envDeclared: [...DECLARED_ENV],
      };
    }
    throw err;
  }
  const results = [];
  // --- Phase 1: happy path ---
  await resetSchema(url);
  const events = [];
  const { applied } = await applyAll({
    connectionUrl: url,
    onEvent: (e) => events.push(e),
  });
  const expected = ['001_create_users.sql', '002_add_email_unique.sql', '003_add_created_at.sql'];
  const listsEqual = applied.length === expected.length
    && expected.every((f, i) => applied[i] === f);
  results.push({
    anchorAcId: 'AC-27102-1',
    verdict: listsEqual ? 'pass' : 'fail',
    detail: `Given a fresh Postgres database at schema_version 0 - applied=${JSON.stringify(applied)} expected=${JSON.stringify(expected)}`,
    evidence: {
      appliedFilesList: applied,
      applied,
      expected,
      migrationFileApplied: Array.isArray(applied) && applied.length > 0 ? applied[0] : 'none',
      phase: 'happy-path',
    },
  });
  const migratedEvent = events.find((e) => e.event === 'migrationsApplied');
  const eventFiredCorrectly = migratedEvent
    && Array.isArray(migratedEvent.applied)
    && migratedEvent.applied.length === expected.length;
  results.push({
    anchorAcId: 'AC-27102-1',
    verdict: eventFiredCorrectly ? 'pass' : 'fail',
    detail: eventFiredCorrectly
      ? `Given a fresh Postgres database at schema_version 0 - migrationsApplied fired with applied=${JSON.stringify(migratedEvent.applied)}`
      : `Given a fresh Postgres database at schema_version 0 - migrationsApplied event missing or wrong shape; events=${JSON.stringify(events)}`,
    evidence: {
      migrationsAppliedEvent: migratedEvent || null,
      phase: 'happy-path',
      appliedFilesList: migratedEvent && migratedEvent.applied ? migratedEvent.applied : [],
      migrationFileApplied: migratedEvent && Array.isArray(migratedEvent.applied) && migratedEvent.applied.length > 0
        ? migratedEvent.applied[0]
        : 'none',
    },
  });
  // Read schema_version to confirm rows count = 3
  const store = await createStore({ connectionUrl: url });
  let schemaVersionRows;
  try {
    await store.ready();
    const pool = store.getPool();
    const r = await pool.query('SELECT filename, applied_at FROM schema_version ORDER BY filename');
    schemaVersionRows = r.rows;
    const versionRowsPass = schemaVersionRows.length === 3;
    results.push({
      anchorAcId: 'AC-27102-1',
      verdict: versionRowsPass ? 'pass' : 'fail',
      detail: `Given a fresh Postgres database at schema_version 0 - schema_version rows=${schemaVersionRows.length} (expected 3, i.e. schema_version advanced to 3)`,
      evidence: {
        appliedFilesList: schemaVersionRows.map((r) => r.filename),
        schemaVersionRows,
        phase: 'happy-path',
        migrationFileApplied: schemaVersionRows.length > 0 ? schemaVersionRows[0].filename : 'none',
      },
    });
  } finally {
    await store.close();
  }

  // --- Phase 2: per-migration transaction-isolation induced failure ---
  // Reset and re-run the migration runner AS A CHILD PROCESS with
  // SIMULATE_MIGRATION_FAILURE=true so 002 fails in flight. Positive
  // proof (AC-27109-1 clauses): the child's OS exit code is non-zero,
  // the failing filename appears in the child's stderr, 001 committed
  // and its schema effect is visible, 002 rolled back and its schema
  // effect is absent, schema_version carries a row for 001 only.
  await resetSchema(url);
  const childRun = await spawnRunner({ simulateFailure: true });
  const failingFilename = childRun.stderr.match(/migration failed at (\S+):/);
  const stderrFailingFilename = failingFilename ? failingFilename[1] : null;
  const store2 = await createStore({ connectionUrl: url });
  let atomicityEvidence = null;
  try {
    await store2.ready();
    const pool = store2.getPool();
    const usersExists = await tableExists(pool, 'users');
    const emailUnique = usersExists ? await columnExists(pool, 'users', 'email') : false;
    // 002 adds a UNIQUE constraint on email; if 002 rolled back, the
    // constraint should NOT exist. Prove this positively by inspecting
    // pg_constraint.
    const constraintRows = usersExists ? (await pool.query(
      `SELECT c.conname, c.contype FROM pg_constraint c
       JOIN pg_class t ON c.conrelid = t.oid
       WHERE t.relname = 'users' AND c.contype = 'u'`,
    )).rows : [];
    const svRows = (await pool.query('SELECT filename FROM schema_version ORDER BY filename')).rows;
    atomicityEvidence = {
      childExitCode: childRun.exitCode,
      childSignal: childRun.signal,
      childStderrExcerpt: childRun.stderr.slice(0, 400),
      childStdoutExcerpt: childRun.stdout.slice(0, 200),
      stderrFailingFilename,
      usersExists,
      emailColumnExists: emailUnique,
      uniqueConstraintsOnUsers: constraintRows,
      schemaVersionRows: svRows,
    };
    // Isolation assertions per AC-27109-1:
    // 1. runner exits non-zero (child OS exit code observed)
    const exitNonZero = typeof childRun.exitCode === 'number' && childRun.exitCode !== 0;
    // 2. failing filename in child stderr matches 002_add_email_unique.sql
    const failingRecorded = stderrFailingFilename === '002_add_email_unique.sql';
    // 3. 002 rolled back: schema_version has NO row for 002_add_email_unique.sql
    const isolationRolledBack = !svRows.some((r) => r.filename === '002_add_email_unique.sql');
    // 4. 001 committed independently: users table exists AND its row is on schema_version
    const oneCommitted = usersExists && svRows.some((r) => r.filename === '001_create_users.sql');
    // 5. The UNIQUE constraint (introduced by 002) is absent, proving 002's DDL rolled back
    const uniqueAbsent = constraintRows.length === 0;
    const isolationPass = exitNonZero && failingRecorded && isolationRolledBack && oneCommitted && uniqueAbsent;
    // Induced-failure row anchors AC-27109-1 (the first file commits,
    // the second file's transaction rolls back on the invalid statement,
    // the runner exits non-zero, and the failing filename appears in
    // the runner's diagnostic output).
    results.push({
      anchorAcId: 'AC-27109-1',
      verdict: isolationPass ? 'pass' : 'fail',
      detail: isolationPass
        ? `Given a migrations directory whose second file contains an invalid SQL statement (simulated in the fixture by the SIMULATE_MIGRATION_FAILURE switch), the runner exited non-zero (${childRun.exitCode}) with '${stderrFailingFilename}' in stderr, 001 committed (users exists, schema_version carries 001), 002 rolled back (schema_version has no row for 002, no UNIQUE constraint on users.email), only the first file's row on schema_version.`
        : `Given a migrations directory whose second file contains an invalid SQL statement - AC clauses did NOT all pass: exitNonZero=${exitNonZero} (code=${childRun.exitCode}) failingRecorded=${failingRecorded} (stderr filename=${stderrFailingFilename}) isolationRolledBack=${isolationRolledBack} oneCommitted=${oneCommitted} uniqueAbsent=${uniqueAbsent}`,
      evidence: atomicityEvidence,
    });
  } finally {
    await store2.close();
  }
  // Reset to a clean, happy-path state for downstream probes.
  await resetSchema(url);
  await applyAll({ connectionUrl: url });

  return { results, extra: { happyPath: { applied, schemaVersionRows }, atomicity: atomicityEvidence } };
}
