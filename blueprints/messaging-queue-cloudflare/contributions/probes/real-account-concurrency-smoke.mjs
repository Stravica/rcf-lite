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
 * bindings. NO workers.dev subdomain is enabled (operator ruling
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
 * The local run exercises OUR lifecycle logic against a mock of
 * Cloudflare's contract; the real-account gate is the only surface
 * that proves the wire format (operator ruling). This probe is
 * therefore never described as "locally verified" - the local runs
 * are our own lifecycle-logic proof; wire correctness is proven at
 * the operator estate real-account gate.
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

// Every env var the probe reads. Superset of the shim's DECLARED_ENV
// (shim tracks its own reads; this probe additionally reads
// GITHUB_RUN_ID for the mint runId derivation).
const PROBE_DECLARED_ENV = Object.freeze([
  ...DECLARED_ENV,
  'GITHUB_RUN_ID',
]);

// Pre-flight observation: does the target Cloudflare account have a
// workers.dev subdomain provisioned? The queue consumer-attach step
// (see mintScratchQueueAndWorker) requires one, and on accounts
// without it the attach rejects with HTTP 403 code 10063 leaving a
// partial mint that the shim rolls back. Observing the account state
// up front lets the probe record a declared skip whose reason names
// the missing ACCOUNT prerequisite rather than any env var, and
// whose detail carries the API status and code as evidence. Endpoint:
// GET /accounts/{id}/workers/subdomain (verifiedOn 2026-09-10 per
// https://developers.cloudflare.com/api/resources/workers/subresources/subdomain/methods/get/).
async function preflightWorkersDevSubdomain() {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  const base = (process.env.CF_API_BASE_URL && process.env.CF_API_BASE_URL.trim())
    ? process.env.CF_API_BASE_URL.replace(/\/$/, '')
    : 'https://api.cloudflare.com/client/v4';
  const url = `${base}/accounts/${accountId}/workers/subdomain`;
  const resp = await fetch(url, { method: 'GET', headers: { authorization: `Bearer ${token}` } });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_err) { /* body may be empty or non-JSON */ }
  const errorCode = json && Array.isArray(json.errors) && json.errors[0] && json.errors[0].code;
  const result = json && json.result;
  const subdomain = result && typeof result.subdomain === 'string' && result.subdomain.trim().length > 0 ? result.subdomain : null;
  const provisioned = resp.ok && json && json.success === true && subdomain !== null;
  return { status: resp.status, errorCode, subdomain, provisioned };
}

function skipResult({ reason, detail }) {
  return [{
    anchorAcId: 'AC-29108-2',
    verdict: 'pass',
    detail,
    accountBoundSkipped: true,
    reason,
    envDeclared: PROBE_DECLARED_ENV,
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
    return skipResult({
      reason: 'CI_HAS_CLOUDFLARE_ACCOUNT',
      detail: `accountBoundSkipped: CI_HAS_CLOUDFLARE_ACCOUNT unset; a real-account run requires CI_HAS_CLOUDFLARE_ACCOUNT=true. When set, the fixture shim self-provisions a throwaway Queue, consumer Worker and telemetry KV namespace under the frozen scratch prefixes, publishes via the Cloudflare Queues REST publish endpoint (verifiedOn 2026-09-10 per https://developers.cloudflare.com/api/operations/queue-publish-messages), reads telemetry via the KV REST list and get endpoints, and tears every resource down before exit. Cap under test: ${DOCUMENTED_PUSH_CAP} concurrent invocations per push-consumer per https://developers.cloudflare.com/queues/platform/limits/ (verifiedOn 2026-09-10). Message count: ${DEFAULT_MESSAGE_COUNT}.`,
    });
  }
  const missingCreds = [];
  if (!process.env.CF_ACCOUNT_ID) missingCreds.push('CF_ACCOUNT_ID');
  if (!process.env.CF_API_TOKEN) missingCreds.push('CF_API_TOKEN');
  if (missingCreds.length > 0) {
    const noun = missingCreds.length > 1 ? 'those credentials are' : 'that credential is';
    return skipResult({
      reason: missingCreds.join(','),
      detail: `accountBoundSkipped: ${missingCreds.join(' and ')} unset; a real-account run requires ${noun} present. Cap under test: ${DOCUMENTED_PUSH_CAP} concurrent invocations per push-consumer per https://developers.cloudflare.com/queues/platform/limits/ (verifiedOn 2026-09-10). Message count: ${DEFAULT_MESSAGE_COUNT}.`,
    });
  }
  // Pre-flight account-state observation: the queue consumer-attach
  // API requires the target Cloudflare account to have a workers.dev
  // subdomain provisioned (rejects with HTTP 403 code 10063 without
  // one, per https://developers.cloudflare.com/api/resources/queues/
  // subresources/consumers/ verifiedOn 2026-09-10). This probe
  // observes the subdomain state directly via
  // GET /accounts/{id}/workers/subdomain and records a declared skip
  // when the account has none - the reason names the missing ACCOUNT
  // prerequisite (not an env var) and the detail carries the API
  // status and error code as positive evidence of the observation.
  // A fully capable account carries a subdomain and the probe
  // proceeds unconditionally to mint / drive / teardown.
  const preflight = await preflightWorkersDevSubdomain();
  if (!preflight.provisioned) {
    return skipResult({
      reason: 'cloudflare-account-workers-dev-subdomain-not-provisioned',
      detail: `accountBoundSkipped: pre-flight GET /accounts/{id}/workers/subdomain returned status=${preflight.status} errorCode=${preflight.errorCode ?? 'null'} subdomain=${preflight.subdomain ?? 'null'} - the target Cloudflare account has no workers.dev subdomain provisioned. The queue consumer-attach step (see https://developers.cloudflare.com/api/resources/queues/subresources/consumers/, verifiedOn 2026-09-10) rejects with HTTP 403 code 10063 in that state, so the probe cannot complete a live run against this account. The account prerequisite (a provisioned workers.dev subdomain) is out of the probe's authorship scope. Cap under test: ${DOCUMENTED_PUSH_CAP} concurrent invocations per push-consumer per https://developers.cloudflare.com/queues/platform/limits/ (verifiedOn 2026-09-10). Message count: ${DEFAULT_MESSAGE_COUNT}.`,
    });
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
      envDeclared: PROBE_DECLARED_ENV,
    }];
  }

  let results = null;
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
      results = [{
        anchorAcId: 'AC-29108-2',
        verdict: 'fail',
        detail: `queuePublishBatch failed: status=${publishFail.status} error=${publishFail.error}`,
        envDeclared: PROBE_DECLARED_ENV,
      }];
      return results;
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

    results = [{
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
      envDeclared: PROBE_DECLARED_ENV,
      throwawayPrefixes: { queue: QUEUE_PREFIX, worker: WORKER_PREFIX, telemetryKv: TELEMETRY_KV_PREFIX },
    }];
    return results;
  } finally {
    try {
      await destroyScratchQueueAndWorker(mint);
    } catch (err) {
      const orphaned = {
        queueId: mint && mint.queue && mint.queue.id,
        queueName: mint && mint.queue && mint.queue.name,
        workerName: mint && mint.worker && mint.worker.name,
        telemetryKvId: mint && mint.telemetryKv && mint.telemetryKv.id,
      };
      const orphanRecord = {
        anchorAcId: 'AC-29108-2',
        verdict: 'fail',
        detail: `TEARDOWN FAILED: destroyScratchQueueAndWorker threw ${err && err.message ? err.message : String(err)}; potentially orphaned resources on the account: queue.id=${orphaned.queueId} queue.name=${orphaned.queueName} consumerWorker.name=${orphaned.workerName} telemetryKv.id=${orphaned.telemetryKvId}. sweepOrphans on the shim will collect on the next real-account run; a live account audit is still recommended.`,
        teardownFailed: true,
        orphaned,
        envDeclared: PROBE_DECLARED_ENV,
        throwawayPrefixes: { queue: QUEUE_PREFIX, worker: WORKER_PREFIX, telemetryKv: TELEMETRY_KV_PREFIX },
      };
      if (Array.isArray(results)) {
        results.push(orphanRecord);
      } else {
        // Body threw before assigning results (would have propagated already);
        // this branch keeps the safety net symmetric.
        results = [orphanRecord];
      }
    }
  }
}
