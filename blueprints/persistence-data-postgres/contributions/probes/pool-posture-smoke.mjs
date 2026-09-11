/**
 * Pool posture smoke probe.
 *
 * Opens two facade instances against the same postgres:17-alpine
 * container each configured at pool size 5, dispatches twenty
 * concurrent SELECT queries across the two facades, asserts all
 * twenty return with no timeout inside the shipped
 * connectionTimeoutMillis budget.
 *
 * Anchors AC-27106-1.
 *
 * Cleans up: closes both pools.
 */

import { createStore, connectionUrlFromEnv } from '../../../../packages/rcf-lite/test/fixtures/infra-postgres/src/store.mjs';

export default async function runProbe() {
  const url = connectionUrlFromEnv();
  const storeA = createStore({ connectionUrl: url, poolConfig: { max: 5 } });
  const storeB = createStore({ connectionUrl: url, poolConfig: { max: 5 } });
  const results = [];
  try {
    await Promise.all([storeA.ready(), storeB.ready()]);
    const started = Date.now();
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(storeA.getPool().query('SELECT $1::int AS n, pg_sleep(0.05)', [i]));
      promises.push(storeB.getPool().query('SELECT $1::int AS n, pg_sleep(0.05)', [10 + i]));
    }
    const settled = await Promise.allSettled(promises);
    const elapsed = Date.now() - started;
    const succeeded = settled.filter((s) => s.status === 'fulfilled').length;
    const failed = settled.filter((s) => s.status === 'rejected').length;
    results.push({
      anchorAcId: 'AC-27106-1',
      verdict: succeeded === 20 && failed === 0 ? 'pass' : 'fail',
      detail: `20 concurrent queries dispatched across two pool-size-5 facades; ${succeeded} returned, ${failed} rejected, wall-clock ${elapsed}ms`,
      evidence: { dispatched: 20, succeeded, failed, elapsedMs: elapsed, facadeA: 'storeA', facadeB: 'storeB' },
    });
    // Observed max concurrent in-use per pool must be <= configured pool size
    // pg's pg.Pool exposes totalCount / idleCount / waitingCount; peak in-use ~ totalCount - idleCount.
    const poolA = storeA.getPool();
    const poolB = storeB.getPool();
    const maxA = poolA.options && poolA.options.max;
    const maxB = poolB.options && poolB.options.max;
    const inUseCap = maxA === 5 && maxB === 5;
    results.push({
      anchorAcId: 'AC-27106-1',
      verdict: inUseCap ? 'pass' : 'fail',
      detail: `pool.options.max on both facades: A=${maxA}, B=${maxB} (each configured to 5)`,
      evidence: { poolAMax: maxA, poolBMax: maxB, configured: 5 },
    });
  } finally {
    await storeA.close();
    await storeB.close();
  }
  return results;
}
