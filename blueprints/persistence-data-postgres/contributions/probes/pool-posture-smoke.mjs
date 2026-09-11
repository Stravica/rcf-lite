/**
 * Pool posture smoke probe.
 *
 * Opens two facade instances against the same postgres:17-alpine
 * container each configured at pool size 5, dispatches twenty
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

import { createStore, connectionUrlFromEnv } from '../../../../packages/rcf-lite/test/fixtures/infra-postgres/src/store.mjs';

export default async function runProbe() {
  const url = connectionUrlFromEnv();
  const storeA = createStore({ connectionUrl: url, poolConfig: { max: 5 } });
  const storeB = createStore({ connectionUrl: url, poolConfig: { max: 5 } });
  const results = [];
  const teardown = [];
  try {
    await Promise.all([storeA.ready(), storeB.ready()]);
    const poolA = storeA.getPool();
    const poolB = storeB.getPool();
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
      detail: `Given two facade instances opened concurrently against - 20 dispatched, ${succeeded} returned, ${failed} rejected, wall-clock ${elapsed}ms; observed peak in-use A=${observedPeakA} B=${observedPeakB} (configured max=${configuredMax}); samplesA=${samplesA.length} samplesB=${samplesB.length}`,
      evidence: {
        dispatched: 20,
        succeeded,
        failed,
        elapsedMs: elapsed,
        observedPeakInUseA: observedPeakA,
        observedPeakInUseB: observedPeakB,
        configuredMax,
        sampleCountA: samplesA.length,
        sampleCountB: samplesB.length,
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
    // Teardown failure fails the verdict (Addendum rule 5).
    results.push({
      anchorReqId: 'persistence-data-postgres-REQ-006',
      verdict: 'fail',
      detail: `The connection pool posture is elicited (pool-size - teardown FAILED (${failedTeardown.length}/${teardown.length}): ${failedTeardown.map((t) => `${t.step} -> ${t.error}`).join('; ')}`,
      evidence: { teardown },
    });
  }
  return results;
}
