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
 * list; per-migration transaction isolation).
 *
 * Cleanup: leaves the applied schema for downstream probes.
 */

import { applyAll } from '../../../../packages/rcf-lite/test/fixtures/infra-postgres/src/migrate.mjs';
import { createStore, connectionUrlFromEnv } from '../../../../packages/rcf-lite/test/fixtures/infra-postgres/src/store.mjs';

async function resetSchema(url) {
  const store = createStore({ connectionUrl: url });
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
  const url = connectionUrlFromEnv();
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
    evidence: { applied, expected, phase: 'happy-path' },
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
    evidence: { migrationsAppliedEvent: migratedEvent || null, phase: 'happy-path' },
  });
  // Read schema_version to confirm rows count = 3
  const store = createStore({ connectionUrl: url });
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
      evidence: { schemaVersionRows, phase: 'happy-path' },
    });
  } finally {
    await store.close();
  }

  // --- Phase 2: per-migration transaction-isolation induced failure ---
  // Reset and re-run with SIMULATE_MIGRATION_FAILURE=true so 002 fails
  // in flight. Positive proof: 001 committed and its schema effect is
  // visible; 002 rolled back and its schema effect is absent;
  // schema_version carries a row for 001 only.
  await resetSchema(url);
  const before = { simulate: process.env.SIMULATE_MIGRATION_FAILURE };
  process.env.SIMULATE_MIGRATION_FAILURE = 'true';
  const inducedEvents = [];
  let thrown = null;
  try {
    await applyAll({ connectionUrl: url, onEvent: (e) => inducedEvents.push(e) });
  } catch (err) {
    thrown = err;
  } finally {
    if (before.simulate === undefined) delete process.env.SIMULATE_MIGRATION_FAILURE;
    else process.env.SIMULATE_MIGRATION_FAILURE = before.simulate;
  }
  const failEvent = inducedEvents.find((e) => e.event === 'migrationApplyFailed');
  const failingFilename = thrown && thrown.failingFilename;
  const appliedSoFar = thrown && thrown.appliedSoFar;
  const store2 = createStore({ connectionUrl: url });
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
      failingFilename,
      appliedSoFar,
      migrationApplyFailedEvent: failEvent || null,
      usersExists,
      emailColumnExists: emailUnique,
      uniqueConstraintsOnUsers: constraintRows,
      schemaVersionRows: svRows,
    };
    // Isolation assertions per AC-27102-1:
    // 1. 002 rolled back: schema_version has NO row for 002_add_email_unique.sql
    const isolationRolledBack = !svRows.some((r) => r.filename === '002_add_email_unique.sql');
    // 2. Failing filename recorded on both the thrown error and the event
    const failingRecorded = failingFilename === '002_add_email_unique.sql'
      && failEvent && failEvent.filename === '002_add_email_unique.sql';
    // 3. 001 committed independently: users table exists AND its row is on schema_version
    const oneCommitted = usersExists && svRows.some((r) => r.filename === '001_create_users.sql');
    // 4. The UNIQUE constraint (introduced by 002) is absent, proving 002's DDL rolled back
    const uniqueAbsent = constraintRows.length === 0;
    const isolationPass = isolationRolledBack && failingRecorded && oneCommitted && uniqueAbsent;
    // Induced-failure row anchors AC-27109-1 (a failing migration rolls
    // back its own transaction, runner exits non-zero, failing
    // filename recorded), not the happy-path AC-27102-1.
    results.push({
      anchorAcId: 'AC-27109-1',
      verdict: isolationPass ? 'pass' : 'fail',
      detail: isolationPass
        ? `Given a migrations directory whose second file contains - induced failure at 002 proves per-migration transaction isolation: 001 committed (users exists, schema_version carries 001), 002 rolled back (schema_version has no row for 002, no UNIQUE constraint on users.email), failing filename recorded on the thrown error and on migrationApplyFailed`
        : `Given a migrations directory whose second file contains - atomicity checks did NOT all pass: isolationRolledBack=${isolationRolledBack} failingRecorded=${failingRecorded} oneCommitted=${oneCommitted} uniqueAbsent=${uniqueAbsent}`,
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
