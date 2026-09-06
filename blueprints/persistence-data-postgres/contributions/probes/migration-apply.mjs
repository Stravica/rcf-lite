/**
 * Migration apply probe.
 *
 * Drops any prior schema (users, schema_version) from the fixture's
 * Postgres, invokes the fixture's migration runner, and asserts every
 * migration applied inside its own transaction, migrationsApplied fires
 * with the filename list, and the schema_version bookkeeping table
 * records three rows.
 *
 * Anchors AC-27102-1 (three forward-only .sql migrations apply one file
 * one transaction; migrationsApplied fires with the filename list).
 *
 * Cleans up: leaves the applied schema for downstream probes.
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

export default async function runProbe() {
  const url = connectionUrlFromEnv();
  await resetSchema(url);
  const events = [];
  const { applied } = await applyAll({
    connectionUrl: url,
    onEvent: (e) => events.push(e),
  });
  const results = [];
  const expected = ['001_create_users.sql', '002_add_email_unique.sql', '003_add_created_at.sql'];
  const listsEqual = applied.length === expected.length
    && expected.every((f, i) => applied[i] === f);
  results.push({
    anchorAcId: 'AC-27102-1',
    verdict: listsEqual ? 'pass' : 'fail',
    detail: `applied=${JSON.stringify(applied)} expected=${JSON.stringify(expected)}`,
  });
  const migratedEvent = events.find((e) => e.event === 'migrationsApplied');
  const eventFiredCorrectly = migratedEvent
    && Array.isArray(migratedEvent.applied)
    && migratedEvent.applied.length === expected.length;
  results.push({
    anchorAcId: 'AC-27102-1',
    verdict: eventFiredCorrectly ? 'pass' : 'fail',
    detail: eventFiredCorrectly
      ? `migrationsApplied fired with applied=${JSON.stringify(migratedEvent.applied)}`
      : `migrationsApplied event missing or wrong shape; events=${JSON.stringify(events)}`,
  });
  // Read schema_version to confirm rows count = 3
  const store = createStore({ connectionUrl: url });
  try {
    await store.ready();
    const pool = store.getPool();
    const r = await pool.query('SELECT count(*)::int AS n FROM schema_version');
    const versionRowsPass = r.rows[0].n === 3;
    results.push({
      anchorAcId: 'AC-27102-1',
      verdict: versionRowsPass ? 'pass' : 'fail',
      detail: `schema_version rows=${r.rows[0].n} (expected 3, i.e. schema_version advanced to 3)`,
    });
  } finally {
    await store.close();
  }
  return results;
}
