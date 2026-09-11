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
    const facadeReadyEvent = facadeReadyFired ? events.find((e) => e.event === 'facadeReady') : null;
    results.push({
      anchorAcId: 'AC-27101-1',
      verdict: facadeReadyFired && facadeReadyDbName === 'rcf_test' ? 'pass' : 'fail',
      detail: facadeReadyFired
        ? `On process boot, the facade opens a pg.Pool - facadeReady fired with databaseName=${facadeReadyDbName}`
        : 'On process boot, the facade opens a pg.Pool - facadeReady did not fire before first query',
      evidence: { facadeReadyEvent, allEvents: events },
    });
    const id = await store.createUser('probe-facade-round-trip', 'facade-round-trip@rcf.test');
    const row = await store.getUserById(id);
    const roundTripPass = row && row.id === id && row.name === 'probe-facade-round-trip';
    results.push({
      anchorAcId: 'AC-27101-1',
      verdict: roundTripPass ? 'pass' : 'fail',
      detail: roundTripPass
        ? `On process boot, the facade opens a pg.Pool - round-trip put id=${id} and got name=${row.name}`
        : `On process boot, the facade opens a pg.Pool - round-trip failed: id=${id}, row=${JSON.stringify(row)}`,
      evidence: { insertedId: id, retrievedRow: row },
    });
  } finally {
    // Teardown - record every step so a failure surfaces as a row and
    // fails the aggregate per Addendum rule 5.
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
        anchorReqId: 'persistence-data-postgres-REQ-001',
        verdict: 'fail',
        detail: `The facade module is the sole reader - teardown FAILED: ${failed.map((t) => `${t.step} -> ${t.error}`).join('; ')}`,
        evidence: { teardown },
      });
    }
  }
  return results;
}
