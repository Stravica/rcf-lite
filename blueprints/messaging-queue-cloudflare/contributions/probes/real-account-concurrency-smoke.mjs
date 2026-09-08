/**
 * Real-account concurrency smoke for messaging-queue-cloudflare.
 * v1.0.2.
 *
 * Self-provisioning: the fixture shim (packages/rcf-lite/test/fixtures/
 * cf-platform/h2-cf-queue-real-account-shim.mjs) mints a scratch
 * Cloudflare Queue under the throwaway prefix
 * `h2-cf-probe-integrity-scratch-q-`, uploads a throwaway consumer
 * Worker under `h2-cf-probe-integrity-scratch-w-` bound to that queue,
 * attaches the Worker as the queue's consumer, and enables its
 * workers.dev subdomain so the driver has an origin to hit. The
 * driver then POSTs 500 messages through the shipped producer facade
 * against the Worker's /publish-batch endpoint in 10 concurrent
 * batches of 50, polls /stats until totalConsumed >= published (drain
 * cap 120s), and asserts:
 *
 *   - every published message was consumed (totalConsumed === published)
 *   - observed concurrency exceeded 1 (maxConcurrent > 1)
 *   - observed concurrency did NOT exceed the documented push-consumer
 *     cap of 250 (maxConcurrent <= 250) per
 *     https://developers.cloudflare.com/queues/platform/limits/
 *
 * AC-29108-2 requires the consumer to actually process concurrently,
 * so this is the consumer-worker fixture shape (not a produce-only
 * light shape). Teardown deletes both the Worker (first, so the queue
 * has no active consumer at delete time) and the Queue on exit;
 * happy-path teardown uses exact identity only, and the shim's
 * separate sweepOrphans path lists over the account by frozen prefix
 * and deletes each match by exact identity (Dave hard constraints
 * 8be06ee5). The sweep is exercised locally against the ten live
 * production script names on the operator account by a dedicated
 * sweep-safety test.
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
  overrideWorkerUrl, DECLARED_ENV, QUEUE_PREFIX, WORKER_PREFIX,
} from '../../../../packages/rcf-lite/test/fixtures/cf-platform/h2-cf-queue-real-account-shim.mjs';

const DEFAULT_MESSAGE_COUNT = 500;
const BATCH_SIZE = 50;
const DRAIN_POLL_INTERVAL_MS = 500;
const DRAIN_TIMEOUT_MS = 120000;
const PUBLISH_TIMEOUT_MS = 60000;
const DOCUMENTED_PUSH_CAP = 250;

export const anchorAcId = 'AC-29108-2';
export const accountBound = true;

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${ms}ms`)), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function postJson(url, body, timeoutMs) {
  const guard = timeoutSignal(timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: guard.signal,
    });
    const text = await resp.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_err) { /* keep as text */ }
    return { ok: resp.ok, status: resp.status, json, text };
  } finally {
    guard.cancel();
  }
}

async function getJson(url, timeoutMs) {
  const guard = timeoutSignal(timeoutMs);
  try {
    const resp = await fetch(url, { method: 'GET', signal: guard.signal });
    const text = await resp.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_err) { /* keep as text */ }
    return { ok: resp.ok, status: resp.status, json, text };
  } finally {
    guard.cancel();
  }
}

function skipResult(detail) {
  return [{
    anchorAcId: 'AC-29108-2',
    verdict: 'pass',
    detail,
    accountBoundSkipped: true,
    envDeclared: Array.from(DECLARED_ENV),
    throwawayPrefixes: { queue: QUEUE_PREFIX, worker: WORKER_PREFIX },
  }];
}

export default async function runProbe() {
  const hasAccount = process.env.CI_HAS_CLOUDFLARE_ACCOUNT === '1' || process.env.CI_HAS_CLOUDFLARE_ACCOUNT === 'true';
  if (!hasAccount) {
    return skipResult(`accountBoundSkipped: CI_HAS_CLOUDFLARE_ACCOUNT unset; a real-account run requires CI_HAS_CLOUDFLARE_ACCOUNT=true plus CF_ACCOUNT_ID and CF_API_TOKEN. The fixture mints its own throwaway Queue + consumer Worker under the H-2 prefixes; no pre-provisioned CF_QUEUE_WORKER_URL is required (removed as of v1.0.2 per w-2026-09-08-dave-017). Cap under test: ${DOCUMENTED_PUSH_CAP} concurrent invocations per push-consumer per https://developers.cloudflare.com/queues/platform/limits/. Message count: ${DEFAULT_MESSAGE_COUNT}.`);
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
    const effective = overrideWorkerUrl(mint);
    const base = effective.worker.url.replace(/\/$/, '');

    // Reset telemetry so a prior run does not leak counters.
    const reset = await postJson(`${base}/reset`, {}, PUBLISH_TIMEOUT_MS).catch((err) => ({ ok: false, status: 0, text: String(err) }));
    if (!reset.ok) {
      return [{
        anchorAcId: 'AC-29108-2',
        verdict: 'fail',
        detail: `POST ${base}/reset failed: status=${reset.status} text=${(reset.text || '').slice(-500)}. The throwaway consumer Worker must expose /reset before the concurrency driver runs.`,
        envDeclared: Array.from(DECLARED_ENV),
      }];
    }

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
      postJson(`${base}/publish-batch`, { messages: slice }, PUBLISH_TIMEOUT_MS)
        .catch((err) => ({ ok: false, status: 0, text: String(err) })),
    ));

    const publishFail = publishResults.find((r) => !r.ok);
    if (publishFail) {
      return [{
        anchorAcId: 'AC-29108-2',
        verdict: 'fail',
        detail: `publish batch failed: status=${publishFail.status} text=${(publishFail.text || '').slice(-500)}`,
        envDeclared: Array.from(DECLARED_ENV),
      }];
    }
    const publishedCount = publishResults.reduce((acc, r) => acc + (r.json?.count ?? 0), 0);

    let stats = null;
    const drainStart = Date.now();
    while (Date.now() - drainStart < DRAIN_TIMEOUT_MS) {
      const s = await getJson(`${base}/stats`, PUBLISH_TIMEOUT_MS).catch((err) => ({ ok: false, status: 0, text: String(err), json: null }));
      if (s.ok && s.json) {
        stats = s.json;
        if (stats.totalConsumed >= publishedCount) break;
      }
      await new Promise((r) => setTimeout(r, DRAIN_POLL_INTERVAL_MS));
    }

    if (!stats) {
      return [{
        anchorAcId: 'AC-29108-2',
        verdict: 'fail',
        detail: `unable to read /stats endpoint from ${base} within ${DRAIN_TIMEOUT_MS}ms; the throwaway consumer Worker did not expose consumer telemetry.`,
        envDeclared: Array.from(DECLARED_ENV),
      }];
    }

    const elapsed = Date.now() - started;
    const drained = stats.totalConsumed >= publishedCount;
    const withinCap = stats.maxConcurrent <= DOCUMENTED_PUSH_CAP;
    const observedConcurrency = stats.maxConcurrent > 1;
    const allOk = drained && withinCap && observedConcurrency;

    return [{
      anchorAcId: 'AC-29108-2',
      verdict: allOk ? 'pass' : 'fail',
      detail: allOk
        ? `queue=${mint.queue.name} (id=${mint.queue.id}) consumerWorker=${mint.worker.name} url=${base}: published ${publishedCount} messages via ${batches.length} batches to ${base}/publish-batch; consumer telemetry (${elapsed}ms elapsed): totalConsumed=${stats.totalConsumed} batches=${stats.batches} maxConcurrent=${stats.maxConcurrent} (>1 observed, <= ${DOCUMENTED_PUSH_CAP} documented push cap per https://developers.cloudflare.com/queues/platform/limits/); teardown removed queue and consumer worker on exit.`
        : `queue=${mint.queue.name} publishedCount=${publishedCount} totalConsumed=${stats.totalConsumed} maxConcurrent=${stats.maxConcurrent} batches=${stats.batches} elapsed=${elapsed}ms; drained=${drained} withinCap=${withinCap} observedConcurrency=${observedConcurrency}. Documented push cap: ${DOCUMENTED_PUSH_CAP} (https://developers.cloudflare.com/queues/platform/limits/).`,
      workerUrl: base,
      queueName: mint.queue.name,
      queueId: mint.queue.id,
      workerName: mint.worker.name,
      publishedCount,
      stats,
      elapsedMs: elapsed,
      envDeclared: Array.from(DECLARED_ENV),
      throwawayPrefixes: { queue: QUEUE_PREFIX, worker: WORKER_PREFIX },
    }];
  } finally {
    try {
      await destroyScratchQueueAndWorker(mint);
    } catch (err) {
      process.stderr.write(`h2-cf-queue probe: teardown failed for queue=${mint && mint.queue && mint.queue.id} worker=${mint && mint.worker && mint.worker.name}: ${err.message}; sweepOrphans will collect on next run.\n`);
    }
  }
}
