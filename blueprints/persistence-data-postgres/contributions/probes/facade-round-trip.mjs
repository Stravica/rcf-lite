/**
 * Facade round-trip probe.
 *
 * Opens the fixture's facade against a running postgres:17-alpine
 * container, drives a put-and-get through the named domain verbs,
 * asserts facadeReady fires on the injected event sink and the
 * round-trip returns the row written.
 *
 * Anchors AC-27101-1 (facade opens on boot and facadeReady fires with
 * the database name). The CRUD round-trip row is `conformanceOnly`
 * against AC-27101-1: its clause "a facadeReady event fires on the
 * injected event sink carrying the database name" is not observed on
 * that row (row 1 observes it on its own); the CRUD observation
 * records the named-domain-verb round-trip evidence and cites
 * AC-27101-1 as the nearest shipped AC (no shipped AC states the
 * end-to-end CRUD round-trip through the facade).
 *
 * POSTGRES_HOST is a required declared variable (maintainer ruling
 * 2026-09-11): when it is unset the probe returns the exact
 * one-variable accountBoundSkipped row rather than throwing.
 *
 * Cleans up: TRUNCATE users on exit; closes the pool.
 */

import { createStore, connectionUrlFromEnv, MissingPostgresHostError } from '../../../../packages/rcf-lite/test/fixtures/infra-postgres/src/store.mjs';

export const DECLARED_ENV = Object.freeze([
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
]);

function skipRow(variable) {
  return {
    anchorAcId: null,
    verdict: 'pass',
    detail: `On process boot, the facade opens a pg.Pool - accountBound: skipped (${variable} unset)`,
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
  try {
    await store.ready();
    // Ensure a clean users table for this probe run
    const pool = store.getPool();
    await pool.query('CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await pool.query('TRUNCATE users');
    const facadeReadyFired = events.some((e) => e.event === 'facadeReady');
    const facadeReadyDbName = facadeReadyFired ? events.find((e) => e.event === 'facadeReady').databaseName : null;
    const facadeReadyEvent = facadeReadyFired ? events.find((e) => e.event === 'facadeReady') : null;
    const pidR = await pool.query('SELECT pg_backend_pid() AS pid, txid_current() AS txid');
    const backendPid = String(pidR.rows[0].pid);
    const transactionId = String(pidR.rows[0].txid);
    results.push({
      anchorAcId: 'AC-27101-1',
      verdict: facadeReadyFired && facadeReadyDbName === 'rcf_test' ? 'pass' : 'fail',
      detail: facadeReadyFired
        ? `On process boot, the facade opens a pg.Pool - facadeReady fired with databaseName=${facadeReadyDbName}`
        : 'On process boot, the facade opens a pg.Pool - facadeReady did not fire before first query',
      evidence: { backendPid, transactionId, facadeReadyEvent, allEvents: events, databaseName: facadeReadyDbName, poolReadyOk: !!facadeReadyEvent },
    });
    const id = await store.createUser('probe-facade-round-trip', 'facade-round-trip@rcf.test');
    const row = await store.getUserById(id);
    const roundTripPass = row && row.id === id && row.name === 'probe-facade-round-trip';
    // AC-27101-1 states pool opening + facadeReady firing with the
    // database name; no shipped AC states the end-to-end CRUD
    // round-trip through the facade. This row is conformanceOnly
    // against AC-27101-1 with the unobserved clause named.
    results.push({
      anchorAcId: null,
      verdict: roundTripPass ? 'pass' : 'fail',
      conformanceOnly: true,
      limitation: 'AC-27101-1: the clause "a facadeReady event fires on the injected event sink carrying the database name" is not observed on this row (row 1 observes it); this row records the CRUD round-trip through the facade\'s named domain verbs (createUser, getUserById) as positive evidence for the named-domain-verb clause only.',
      detail: roundTripPass
        ? `CRUD round-trip through named domain verbs - put id=${id} and got name=${row.name}`
        : `CRUD round-trip through named domain verbs - failed: id=${id}, row=${JSON.stringify(row)}`,
      evidence: { insertedId: id, retrievedRow: row },
    });
  } finally {
    // Teardown - record every step so a failure surfaces as a row and
    // fails the aggregate per authoring-standard rule 5.
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
  return { results };
}
