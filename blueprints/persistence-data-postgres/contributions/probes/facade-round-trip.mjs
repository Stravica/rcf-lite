/**
 * Facade round-trip probe.
 *
 * Opens the fixture's facade against a running postgres:17-alpine
 * container, drives a put-and-get through the named domain verbs,
 * asserts facadeReady fires on the injected event sink and the
 * round-trip returns the row written.
 *
 * Anchors AC-27101-1 (facade opens on boot and facadeReady fires with
 * the database name).
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
    // Ensure a clean users table for this probe run
    const pool = store.getPool();
    await pool.query('CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await pool.query('TRUNCATE users');
    const facadeReadyFired = events.some((e) => e.event === 'facadeReady');
    const facadeReadyDbName = facadeReadyFired ? events.find((e) => e.event === 'facadeReady').databaseName : null;
    results.push({
      anchorAcId: 'AC-27101-1',
      verdict: facadeReadyFired && facadeReadyDbName === 'rcf_test' ? 'pass' : 'fail',
      detail: facadeReadyFired
        ? `facadeReady fired with databaseName=${facadeReadyDbName}`
        : 'facadeReady did not fire before first query',
    });
    const id = await store.createUser('probe-facade-round-trip', 'facade-round-trip@rcf.test');
    const row = await store.getUserById(id);
    const roundTripPass = row && row.id === id && row.name === 'probe-facade-round-trip';
    results.push({
      anchorAcId: 'AC-27101-1',
      verdict: roundTripPass ? 'pass' : 'fail',
      detail: roundTripPass
        ? `round-trip put id=${id} and got name=${row.name}`
        : `round-trip failed: id=${id}, row=${JSON.stringify(row)}`,
    });
  } finally {
    try {
      await store.getPool().query('TRUNCATE users');
    } catch { /* ignore */ }
    await store.close();
  }
  return results;
}
