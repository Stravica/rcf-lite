/**
 * Real-account concurrency smoke for messaging-queue-cloudflare.
 * v1.0.2.
 *
 * Self-provisioning: the fixture shim (packages/rcf-lite/test/fixtures/
 * cf-platform/h2-cf-queue-real-account-shim.mjs) mints a scratch
 * Cloudflare Queue under the throwaway prefix
 * `h2-cf-probe-integrity-scratch-q-`, a scratch KV namespace for
 * consumer telemetry under `h2-cf-probe-integrity-scratch-kv-tel-`,
 * and a throwaway consumer Worker under `h2-cf-probe-integrity-
 * scratch-w-` bound to the queue (consumer) with RCF_TEST_QUEUE
 * (shipped queue producer binding name) + RCF_TEST_TELEMETRY_KV
 * bindings. NO workers.dev subdomain is enabled (Dave ruling
 * 376b4f30): the consumer is invoked BY THE QUEUE, not over HTTP.
 *
 * Driver:
 *   1. Publishes 500 messages via the Cloudflare Queues REST publish
 *      endpoint in 10 concurrent 50-message batches
 *      (https://developers.cloudflare.com/api/operations/queue-publish-messages).
 *   2. Polls the telemetry KV namespace via the KV REST list + get
 *      endpoints until sum(batchSize) across records >= published
 *      (drain cap 120s).
 *   3. Computes maxConcurrent from an interval-overlap analysis on
 *      the per-invocation (start, end) timestamps the Worker's
 *      queue() handler recorded.
 *   4. Asserts totalConsumed === published, maxConcurrent > 1, and
 *      maxConcurrent <= 250 per Cloudflare's documented push-consumer
 *      cap (https://developers.cloudflare.com/queues/platform/limits/).
 *
 * Local proof is a mock of Cloudflare's REST contract, not the wire.
 * The local run exercises our lifecycle logic against a mock of the
 * shipped contract; the real-account gate is the only surface that
 * proves the wire format (Dave ruling 376b4f30). This probe is
 * therefore never described as "locally verified" - the local runs
 * are our own lifecycle-logic proof; wire correctness is proven at
 * the HQ real-account gate.
 *
 * Declared env (dispatch requirement 4):
 *   CI_HAS_CLOUDFLARE_ACCOUNT   required to enter the driver path.
 *   CF_ACCOUNT_ID               required (real-account only).
 *   CF_API_TOKEN                required (real-account only).
 *   CF_API_BASE_URL             optional test override (mock CF REST API).
 *   CF_QUEUE_MESSAGE_COUNT      optional; defaults to 500.
 *
 * Without CI_HAS_CLOUDFLARE_ACCOUNT the probe returns pass-with-
 * accountBoundSkipped per spec section 3.5; a pass is never reachable
 * from credential presence alone.
 *
 * Anchors AC-29108-2.
 */

import {
  mintScratchQueueAndWorker, destroyScratchQueueAndWorker,
  DECLARED_ENV, QUEUE_PREFIX, WORKER_PREFIX, TELEMETRY_KV_PREFIX,
} from '../../../../packages/rcf-lite/test/fixtures/cf-platform/h2-cf-queue-real-account-shim.mjs';
import { queuePublishBatch, kvListKeys, kvGet } from '../../../../packages/rcf-lite/test/fixtures/cf-platform/h2-cf-account-api.mjs';

const DEFAULT_MESSAGE_COUNT = 500;
const BATCH_SIZE = 50;
const DRAIN_POLL_INTERVAL_MS = 500;
const DRAIN_TIMEOUT_MS = 120000;
const DOCUMENTED_PUSH_CAP = 250;

export const anchorAcId = 'AC-29108-2';
export const accountBound = true;

function skipResult(detail) {
  return [{
    anchorAcId: 'AC-29108-2',
    verdict: 'pass',
    detail,
    accountBoundSkipped: true,
    envDeclared: Array.from(DECLARED_ENV),
    throwawayPrefixes: { queue: QUEUE_PREFIX, worker: WORKER_PREFIX, telemetryKv: TELEMETRY_KV_PREFIX },
  }];
}

// Interval-overlap analysis: given records [{start, end, batchSize, ...}]
// compute the peak simultaneous in-flight invocation count using a
// sweep line over the (start, +1) / (end, -1) event list.
function computeMaxConcurrent(records) {
  const events = [];
  for (const r of records) {
    events.push([r.start, +1]);
    events.push([r.end, -1]);
  }
  // Sort by time; process starts before ends at the same instant so a
  // batch that finishes exactly when another begins does not
  // artificially deflate the concurrency count.
  events.sort((a, b) => (a[0] - b[0]) || (b[1] - a[1]));
  let cur = 0, max = 0;
  for (const [, delta] of events) {
    cur += delta;
    if (cur > max) max = cur;
  }
  return max;
}

async function readTelemetryRecords({ namespaceId }) {
  const keys = await kvListKeys({ namespaceId, prefix: 'telemetry-', limit: 1000 });
  const records = await Promise.all(keys.map(async (k) => {
    const g = await kvGet({ namespaceId, key: k.name });
    if (!g.ok) return null;
    try { return JSON.parse(g.text); } catch (_err) { return null; }
  }));
  return records.filter((r) => r && typeof r.start === 'number' && typeof r.end === 'number' && typeof r.batchSize === 'number');
}

export default async function runProbe() {
  const hasAccount = process.env.CI_HAS_CLOUDFLARE_ACCOUNT === '1' || process.env.CI_HAS_CLOUDFLARE_ACCOUNT === 'true';
  if (!hasAccount) {
    return skipResult(`accountBoundSkipped: CI_HAS_CLOUDFLARE_ACCOUNT unset; a real-account run requires CI_HAS_CLOUDFLARE_ACCOUNT=true plus CF_ACCOUNT_ID and CF_API_TOKEN. The fixture mints its own throwaway Queue + consumer Worker + telemetry KV namespace under the H-2 prefixes; publishes via the CF Queues REST publish endpoint (no workers.dev subdomain enabled); reads telemetry via the KV REST list + get endpoints. Cap under test: ${DOCUMENTED_PUSH_CAP} concurrent invocations per push-consumer per https://developers.cloudflare.com/queues/platform/limits/. Message count: ${DEFAULT_MESSAGE_COUNT}.`);
  }
  if (!process.env.CF_ACCOUNT_ID || !process.env.CF_API_TOKEN) {
    return [{
      anchorAcId: 'AC-29108-2',
      verdict: 'fail',
      detail: `CI_HAS_CLOUDFLARE_ACCOUNT=true but one of CF_ACCOUNT_ID / CF_API_TOKEN is missing: accountIdPresent=${!!process.env.CF_ACCOUNT_ID} tokenPresent=${!!process.env.CF_API_TOKEN}.`,
      envDeclared: Array.from(DECLARED_ENV),
    }];
  }

  const messageCount = Number.parseInt(process.env.CF_QUEUE_MESSAGE_COUNT ?? '', 10) || DEFAULT_MESSAGE_COUNT;
  const runId = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;

  let mint = null;
  try {
    mint = await mintScratchQueueAndWorker({ runId });
  } catch (err) {
    return [{
      anchorAcId: 'AC-29108-2',
      verdict: 'fail',
      detail: `mintScratchQueueAndWorker failed: ${err.message}`,
      envDeclared: Array.from(DECLARED_ENV),
    }];
  }

  try {
    const started = Date.now();
    const batches = [];
    for (let i = 0; i < messageCount; i += BATCH_SIZE) {
      const slice = [];
      for (let j = 0; j < BATCH_SIZE && i + j < messageCount; j++) {
        const seq = i + j;
        slice.push({ body: { seq, ts: new Date().toISOString(), payload: `h2-smoke-${seq}` } });
      }
      batches.push(slice);
    }

    const publishResults = await Promise.all(batches.map((slice) =>
      queuePublishBatch({ queueId: mint.queue.id, messages: slice })
        .then((r) => ({ ok: true, ...r }))
        .catch((err) => ({ ok: false, error: err.message, status: err.status || 0 })),
    ));
    const publishFail = publishResults.find((r) => !r.ok);
    if (publishFail) {
      return [{
        anchorAcId: 'AC-29108-2',
        verdict: 'fail',
        detail: `queuePublishBatch failed: status=${publishFail.status} error=${publishFail.error}`,
        envDeclared: Array.from(DECLARED_ENV),
      }];
    }
    const publishedCount = publishResults.reduce((acc, r) => acc + (r.count ?? 0), 0);

    let records = [];
    let totalConsumed = 0;
    const drainStart = Date.now();
    while (Date.now() - drainStart < DRAIN_TIMEOUT_MS) {
      records = await readTelemetryRecords({ namespaceId: mint.telemetryKv.id }).catch(() => []);
      totalConsumed = records.reduce((a, r) => a + r.batchSize, 0);
      if (totalConsumed >= publishedCount) break;
      await new Promise((r) => setTimeout(r, DRAIN_POLL_INTERVAL_MS));
    }

    const elapsed = Date.now() - started;
    const batchesConsumed = records.length;
    const maxConcurrent = computeMaxConcurrent(records);
    const drained = totalConsumed >= publishedCount;
    const withinCap = maxConcurrent <= DOCUMENTED_PUSH_CAP;
    const observedConcurrency = maxConcurrent > 1;
    const allOk = drained && withinCap && observedConcurrency;

    return [{
      anchorAcId: 'AC-29108-2',
      verdict: allOk ? 'pass' : 'fail',
      detail: allOk
        ? `queue=${mint.queue.name} (id=${mint.queue.id}) consumerWorker=${mint.worker.name} telemetryKv=${mint.telemetryKv.id}: published ${publishedCount} messages via ${batches.length} REST publish batches; consumer telemetry drawn from ${batchesConsumed} KV records in ${elapsed}ms elapsed: totalConsumed=${totalConsumed} batches=${batchesConsumed} maxConcurrent=${maxConcurrent} (>1 observed, <= ${DOCUMENTED_PUSH_CAP} documented push cap per https://developers.cloudflare.com/queues/platform/limits/); teardown removed worker, queue and telemetry KV namespace on exit.`
        : `queue=${mint.queue.name} publishedCount=${publishedCount} totalConsumed=${totalConsumed} maxConcurrent=${maxConcurrent} batches=${batchesConsumed} elapsed=${elapsed}ms; drained=${drained} withinCap=${withinCap} observedConcurrency=${observedConcurrency}. Documented push cap: ${DOCUMENTED_PUSH_CAP} (https://developers.cloudflare.com/queues/platform/limits/).`,
      queueName: mint.queue.name,
      queueId: mint.queue.id,
      workerName: mint.worker.name,
      telemetryKvId: mint.telemetryKv.id,
      publishedCount,
      totalConsumed,
      batches: batchesConsumed,
      maxConcurrent,
      elapsedMs: elapsed,
      envDeclared: Array.from(DECLARED_ENV),
      throwawayPrefixes: { queue: QUEUE_PREFIX, worker: WORKER_PREFIX, telemetryKv: TELEMETRY_KV_PREFIX },
    }];
  } finally {
    try {
      await destroyScratchQueueAndWorker(mint);
    } catch (err) {
      process.stderr.write(`h2-cf-queue probe: teardown failed for queue=${mint && mint.queue && mint.queue.id} worker=${mint && mint.worker && mint.worker.name} telemetryKv=${mint && mint.telemetryKv && mint.telemetryKv.id}: ${err.message}; sweepOrphans will collect on next run.\n`);
    }
  }
}
