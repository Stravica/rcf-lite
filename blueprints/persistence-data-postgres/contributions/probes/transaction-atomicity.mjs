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
 * Cleans up: TRUNCATE users on exit; closes the pool. A teardown
 * failure emits its own row (authoring-standard rule 5).
 */

import { createStore, connectionUrlFromEnv, MissingPostgresHostError } from '../../../../packages/rcf-lite/test/fixtures/infra-postgres/src/store.mjs';

const AC = 'Given the transaction helper wrapping a callback that';

export const DECLARED_ENV = Object.freeze([
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'SIMULATE_CONSTRAINT_VIOLATION',
]);

function skipRow(variable) {
  return {
    anchorAcId: null,
    verdict: 'pass',
    detail: `${AC} - accountBound: skipped (${variable} unset)`,
    accountBoundSkipped: true,
    reason: `${variable} unset`,
    evidence: { skip: true, reason: `${variable} unset`, envDeclared: [...DECLARED_ENV] },
  };
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
  const events = [];
  const store = await createStore({
    connectionUrl: url,
    onEvent: (e) => events.push(e),
  });
  const results = [];
  let databaseName = null;
  try {
    databaseName = await store.ready();
    const pool = store.getPool();
    await pool.query('CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await pool.query('TRUNCATE users');
    const email = 'transaction-atomicity@rcf.test';
    let caught = null;
    try {
      await store.withTransaction(async (tx) => {
        await tx.query('INSERT INTO users(name, email) VALUES ($1, $2)', ['first-user', email]);
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
        ? `${AC} - withTransaction re-threw underlying error code=${caught.code}`
        : `${AC} - withTransaction did not throw on the constraint violation`,
      evidence: { databaseName, thrownErrorCode: caught && caught.code, thrownMessage: caught && caught.message },
    });
    const rolledBackEvent = events.find((e) => e.event === 'transactionRolledBack');
    const indexIsOne = rolledBackEvent && rolledBackEvent.statementIndex === 1;
    results.push({
      anchorAcId: 'AC-27104-1',
      verdict: indexIsOne ? 'pass' : 'fail',
      detail: rolledBackEvent
        ? `${AC} - transactionRolledBack fired with statementIndex=${rolledBackEvent.statementIndex} code=${rolledBackEvent.code}`
        : `${AC} - transactionRolledBack did not fire; events=${events.map((e) => e.event).join(',')}`,
      evidence: { databaseName, transactionRolledBackEvent: rolledBackEvent || null, allEvents: events, rolledBackTimestamp: rolledBackEvent ? new Date(rolledBackEvent.ts).toISOString() : null, rolledBackVerificationOk: !!rolledBackEvent && rolledBackEvent.statementIndex === 1 },
    });
    const count = await store.countUsers();
    const noRowsPersist = count === 0;
    results.push({
      anchorAcId: 'AC-27104-1',
      verdict: noRowsPersist ? 'pass' : 'fail',
      detail: noRowsPersist
        ? `${AC} - users table empty after rollback (no partial commit landed)`
        : `${AC} - users table carries ${count} row(s) after rollback (partial commit leaked)`,
      evidence: { databaseName, postRollbackUserCount: count, postRollbackVerificationOk: count === 0 },
    });
  } finally {
    const teardown = [];
    try {
      await store.getPool().query('TRUNCATE users');
      teardown.push({ step: 'TRUNCATE users on close', ok: true });
    } catch (err) {
      teardown.push({ step: 'TRUNCATE users on close', ok: false, error: err && err.message });
    }
    try {
      await store.close();
      teardown.push({ step: 'close pool', ok: true });
    } catch (err) {
      teardown.push({ step: 'close pool', ok: false, error: err && err.message });
    }
    const failed = teardown.filter((t) => !t.ok);
    if (failed.length > 0) {
      results.push({
        anchorReqId: 'persistence-data-postgres-REQ-004',
        verdict: 'fail',
        detail: `The facade exposes a transaction helper - teardown FAILED: ${failed.map((t) => `${t.step} -> ${t.error}`).join('; ')}`,
        evidence: { teardown },
      });
    }
  }
  return { results };
}
