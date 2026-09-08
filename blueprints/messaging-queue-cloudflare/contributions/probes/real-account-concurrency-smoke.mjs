/**
 * Real-account concurrency smoke.
 *
 * When CI_HAS_CLOUDFLARE_ACCOUNT is set the probe drives 500
 * messages through the shipped producer facade against a deployed
 * Worker that binds a live Cloudflare Queues queue, then reads the
 * Worker's consumer telemetry endpoint until the queue has drained
 * and asserts the observed max concurrent invocations exceed 1 and
 * do not exceed the documented push-invocation cap of 250 per
 * Cloudflare Queues Platform Limits (see
 * https://developers.cloudflare.com/queues/platform/limits/). Also
 * asserts every published message was consumed (totalConsumed ===
 * published).
 *
 * The deployed Worker is parameterised through env at gate time.
 * HQ's shared queue for this pass is `rcf-lite-ci-queue-smoke`
 * (Q2 default per spec section 10); the Worker's wrangler binding
 * targets that queue. The driver itself is queue-agnostic - it
 * POSTs against CF_QUEUE_WORKER_URL/publish-batch and polls
 * CF_QUEUE_WORKER_URL/stats; the queue name lives in the Worker's
 * wrangler.toml.
 *
 * Activation env:
 *   CI_HAS_CLOUDFLARE_ACCOUNT   required to enter the driver path.
 *   CF_QUEUE_WORKER_URL         required deployed Worker origin.
 *   CF_QUEUE_NAME               optional; recorded in the report
 *                               detail so a reviewer can trace
 *                               which queue was exercised.
 *   CF_QUEUE_MESSAGE_COUNT      optional; defaults to 500 per
 *                               spec section 3.5.
 *
 * Without CI_HAS_CLOUDFLARE_ACCOUNT the probe returns pass-with-
 * accountBoundSkipped per spec section 3.5; a pass is never
 * reachable from credential presence alone.
 *
 * Anchors AC-29108-2.
 */

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

export default async function runProbe() {
  const hasAccount = process.env.CI_HAS_CLOUDFLARE_ACCOUNT === '1' || process.env.CI_HAS_CLOUDFLARE_ACCOUNT === 'true';
  if (!hasAccount) {
    return [{
      anchorAcId: 'AC-29108-2',
      verdict: 'pass',
      detail: `accountBoundSkipped: CI_HAS_CLOUDFLARE_ACCOUNT unset; a real-account run requires CI_HAS_CLOUDFLARE_ACCOUNT=true plus CF_QUEUE_WORKER_URL (deployed Worker origin binding a live Cloudflare Queues queue). Cap under test: ${DOCUMENTED_PUSH_CAP} concurrent invocations per push-consumer per https://developers.cloudflare.com/queues/platform/limits/. Message count: ${DEFAULT_MESSAGE_COUNT}.`,
      accountBoundSkipped: true,
    }];
  }

  const workerUrl = process.env.CF_QUEUE_WORKER_URL;
  if (!workerUrl) {
    return [{
      anchorAcId: 'AC-29108-2',
      verdict: 'fail',
      detail: 'CI_HAS_CLOUDFLARE_ACCOUNT=true but CF_QUEUE_WORKER_URL is unset; the concurrency driver needs the deployed-Worker origin (HQ default: the Worker bound to rcf-lite-ci-queue-smoke on the operator Cloudflare account).',
    }];
  }

  const base = workerUrl.replace(/\/$/, '');
  const messageCount = Number.parseInt(process.env.CF_QUEUE_MESSAGE_COUNT ?? '', 10) || DEFAULT_MESSAGE_COUNT;
  const queueLabel = process.env.CF_QUEUE_NAME ?? '<Worker-bound queue>';

  // Reset the Worker's telemetry so a prior run does not leak counters.
  const reset = await postJson(`${base}/reset`, {}, PUBLISH_TIMEOUT_MS).catch((err) => ({ ok: false, status: 0, text: String(err) }));
  if (!reset.ok) {
    return [{
      anchorAcId: 'AC-29108-2',
      verdict: 'fail',
      detail: `POST ${base}/reset failed: status=${reset.status} text=${(reset.text || '').slice(-500)}. Deployed Worker must expose /reset and /stats for the concurrency driver.`,
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
    }];
  }
  const publishedCount = publishResults.reduce((acc, r) => acc + (r.json?.count ?? 0), 0);

  // Poll for drain: totalConsumed >= published within the drain cap.
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
      detail: `unable to read /stats endpoint from ${base} within ${DRAIN_TIMEOUT_MS}ms; deployed Worker did not expose consumer telemetry.`,
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
      ? `queue=${queueLabel}: published ${publishedCount} messages via ${batches.length} batches to ${base}/publish-batch; consumer telemetry (${elapsed}ms elapsed): totalConsumed=${stats.totalConsumed} batches=${stats.batches} maxConcurrent=${stats.maxConcurrent} (>1 observed, <= ${DOCUMENTED_PUSH_CAP} documented push cap per https://developers.cloudflare.com/queues/platform/limits/).`
      : `queue=${queueLabel}: publishedCount=${publishedCount} totalConsumed=${stats.totalConsumed} maxConcurrent=${stats.maxConcurrent} batches=${stats.batches} elapsed=${elapsed}ms; drained=${drained} withinCap=${withinCap} observedConcurrency=${observedConcurrency}. Documented push cap: ${DOCUMENTED_PUSH_CAP} (https://developers.cloudflare.com/queues/platform/limits/).`,
    workerUrl: base,
    queueLabel,
    publishedCount,
    stats,
    elapsedMs: elapsed,
  }];
}
