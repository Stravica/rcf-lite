/**
 * Transaction atomicity probe.
 *
 * Opens the fixture facade's transaction helper against the running
 * postgres:17-alpine container, issues two INSERTs where the second
 * violates the UNIQUE constraint on email, asserts:
 *   - the transaction rolls back
 *   - transactionRolledBack event fires with statementIndex 1
 *   - the first row does not persist after rollback
 *
 * Anchors AC-27104-1.
 *
 * Cleans up: TRUNCATE users on exit; closes the pool.
 */

import { createStore, connectionUrlFromEnv } from '../../../../packages/rcf-lite/test/fixtures/infra-postgres/src/store.mjs';

export default async function runProbe() {
  const events = [];
  const store = createStore({
    connectionUrl: connectionUrlFromEnv(),
    onEvent: (e) => events.push(e),
  });
  const results = [];
  try {
    await store.ready();
    const pool = store.getPool();
    // Ensure schema and empty state
    await pool.query('CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await pool.query('TRUNCATE users');

    const email = 'transaction-atomicity@rcf.test';
    let caught = null;
    try {
      await store.withTransaction(async (tx) => {
        await tx.query('INSERT INTO users(name, email) VALUES ($1, $2)', ['first-user', email]);
        // Same email violates UNIQUE constraint on the second insert
        await tx.query('INSERT INTO users(name, email) VALUES ($1, $2)', ['second-user', email]);
      });
    } catch (err) {
      caught = err;
    }

    const errorThrown = caught !== null;
    results.push({
      anchorAcId: 'AC-27104-1',
      verdict: errorThrown ? 'pass' : 'fail',
      detail: errorThrown
        ? `withTransaction re-threw underlying error code=${caught.code}`
        : 'withTransaction did not throw on the constraint violation',
      evidence: { thrownErrorCode: caught && caught.code, thrownMessage: caught && caught.message },
    });

    const rolledBackEvent = events.find((e) => e.event === 'transactionRolledBack');
    const indexIsOne = rolledBackEvent && rolledBackEvent.statementIndex === 1;
    results.push({
      anchorAcId: 'AC-27104-1',
      verdict: indexIsOne ? 'pass' : 'fail',
      detail: rolledBackEvent
        ? `transactionRolledBack fired with statementIndex=${rolledBackEvent.statementIndex} code=${rolledBackEvent.code}`
        : `transactionRolledBack did not fire; events=${JSON.stringify(events)}`,
      evidence: { transactionRolledBackEvent: rolledBackEvent || null, allEvents: events },
    });

    const count = await store.countUsers();
    const noRowsPersist = count === 0;
    results.push({
      anchorAcId: 'AC-27104-1',
      verdict: noRowsPersist ? 'pass' : 'fail',
      detail: noRowsPersist
        ? 'users table empty after rollback (no partial commit landed)'
        : `users table carries ${count} row(s) after rollback (partial commit leaked)`,
      evidence: { postRollbackUserCount: count },
    });
  } finally {
    try {
      await store.getPool().query('TRUNCATE users');
    } catch { /* ignore */ }
    await store.close();
  }
  return results;
}
