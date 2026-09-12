/**
 * Pool posture smoke probe.
 *
 * Opens two facade instances against the same postgres:17-alpine
 * container each configured at pool size 5, checks out twenty
 * concurrent SELECT queries across the two facades, asserts all
 * twenty return with no timeout inside the shipped
 * connectionTimeoutMillis budget AND the OBSERVED maximum concurrent
 * in-use count on each pool is <= configured max at any sample.
 *
 * The observed peak is sampled at ~5ms intervals while the query
 * promises are in flight; each sample computes `totalCount -
 * idleCount` on the shipped pg.Pool. Configured `.options.max` is
 * recorded on the evidence bag alongside the observed peak, but the
 * assertion is on the OBSERVED peak (per AC-27106-1).
 *
 * Anchors AC-27106-1.
 *
 * Cleans up: closes both pools; a close failure is recorded on the
 * teardown row and fails the aggregate.
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
    detail: `Given two facade instances opened concurrently against the - accountBound: skipped (${variable} unset)`,
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
  const storeA = await createStore({ connectionUrl: url, poolConfig: { max: 5 } });
  const storeB = await createStore({ connectionUrl: url, poolConfig: { max: 5 } });
  const results = [];
  const teardown = [];
  let databaseName = null;
  try {
    const [dbA] = await Promise.all([storeA.ready(), storeB.ready()]);
    databaseName = dbA;
    const poolA = storeA.getPool();
    const poolB = storeB.getPool();
    const pidRP = await poolA.query('SELECT pg_backend_pid() AS pid, txid_current() AS txid');
    const backendPid = String(pidRP.rows[0].pid);
    const transactionId = String(pidRP.rows[0].txid);
    const samplesA = [];
    const samplesB = [];
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        samplesA.push(poolA.totalCount - poolA.idleCount);
        samplesB.push(poolB.totalCount - poolB.idleCount);
        await new Promise((r) => setTimeout(r, 5));
      }
    })();
    const started = Date.now();
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(poolA.query('SELECT $1::int AS n, pg_sleep(0.05)', [i]));
      promises.push(poolB.query('SELECT $1::int AS n, pg_sleep(0.05)', [10 + i]));
    }
    const settled = await Promise.allSettled(promises);
    sampling = false;
    await sampler;
    const elapsed = Date.now() - started;
    const succeeded = settled.filter((s) => s.status === 'fulfilled').length;
    const failed = settled.filter((s) => s.status === 'rejected').length;
    const observedPeakA = Math.max(0, ...samplesA);
    const observedPeakB = Math.max(0, ...samplesB);
    const configuredMax = 5;
    const cappedA = observedPeakA <= configuredMax && observedPeakA > 0;
    const cappedB = observedPeakB <= configuredMax && observedPeakB > 0;
    // AC-27106-1: 20 concurrent queries return, and observed max
    // in-use on each pool is at most configured max.
    results.push({
      anchorAcId: 'AC-27106-1',
      verdict: (succeeded === 20 && failed === 0 && cappedA && cappedB) ? 'pass' : 'fail',
      detail: `Given two facade instances opened concurrently against the - 20 checked-out, ${succeeded} returned, ${failed} rejected, wall-clock ${elapsed}ms; observed peak in-use A=${observedPeakA} B=${observedPeakB} (configured max=${configuredMax}); samplesA=${samplesA.length} samplesB=${samplesB.length}`,
      evidence: {
        backendPid,
        transactionId,
        databaseName,
        checkedOut: 20,
        succeeded,
        failed,
        elapsedMs: elapsed,
        observedPeakInUseA: observedPeakA,
        observedPeakInUseB: observedPeakB,
        configuredMax,
        sampleCountA: samplesA.length,
        sampleCountB: samplesB.length,
        poolPostureStatus: (cappedA && cappedB) ? 'capped-both-pools' : 'uncapped',
        poolConfigurationMetadata: { poolAConfiguredMax: configuredMax, poolBConfiguredMax: configuredMax, queryCountPerPool: 10 },
      },
    });
  } finally {
    const closeA = await storeA.close().catch((err) => err);
    const closeB = await storeB.close().catch((err) => err);
    teardown.push({ step: 'close pool A', ok: !(closeA instanceof Error), error: closeA instanceof Error ? closeA.message : null });
    teardown.push({ step: 'close pool B', ok: !(closeB instanceof Error), error: closeB instanceof Error ? closeB.message : null });
  }
  const failedTeardown = teardown.filter((t) => !t.ok);
  if (failedTeardown.length > 0) {
    // Teardown failure fails the verdict (authoring-standard rule 5).
    results.push({
      anchorReqId: 'persistence-data-postgres-REQ-006',
      verdict: 'fail',
      detail: `The facade opens a long-lived pg.Pool for the - teardown FAILED (${failedTeardown.length}/${teardown.length}): ${failedTeardown.map((t) => `${t.step} -> ${t.error}`).join('; ')}`,
      evidence: { teardown },
    });
  }
  return { results };
}
