// h2-cf-queue-real-account-shim.mjs
//
// Fixture-side self-provisioning shim for the queue
// real-account-concurrency-smoke probe. AC-29108-2 requires a real
// consumer to process the published messages ("the consumer processes
// them concurrently up to the documented 250-invocation cap"), so the
// fixture provisions:
//   - a scratch Cloudflare Queue (prefix h2-cf-probe-integrity-scratch-q-);
//   - a scratch KV namespace for consumer telemetry
//     (prefix h2-cf-probe-integrity-scratch-kv- so the KV shim's own
//     sweep also collects any residue);
//   - a throwaway consumer Worker (prefix h2-cf-probe-integrity-
//     scratch-w-) bound to the queue as consumer, with RCF_TEST_QUEUE
//     (queue producer, shipped binding name) + RCF_TEST_TELEMETRY_KV
//     (KV binding for the per-invocation telemetry records the driver
//     reads back via the KV REST list + get endpoints).
//
// NO workers.dev subdomain enablement (Dave ruling 376b4f30): the
// consumer is invoked BY THE QUEUE, not over HTTP; the driver
// publishes via the CF Queues REST publish endpoint. The subdomain
// endpoint is also a state change on the operator account that is
// refused on review.
//
// Happy-path teardown deletes worker (first, so the queue has no
// active consumer at delete time), queue, then telemetry KV
// namespace, each by EXACT id / EXACT name against the mint record
// with three independent prefix guards. Separate crash-recovery
// sweepOrphans code path filters over the account by the frozen
// throwaway prefix constants and deletes each match by exact
// identity; the sweep is structurally unable to select a
// non-prefixed name (Dave hard constraints 1..4 8be06ee5).

import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  queueCreate, queueDelete, queueList,
  queueConsumerAttach, queueConsumerDelete, queueConsumerList,
  workerUpload, workerDelete, workerList,
  kvCreateNamespace, kvDeleteNamespace, kvListNamespaces,
} from './h2-cf-account-api.mjs';
import { CONSUMER_WORKER_SOURCE } from './h2-cf-queue-consumer-worker.mjs';
import { NAMESPACE_PREFIX as KV_PREFIX } from './h2-cf-kv-real-account-shim.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH_DIR = resolve(HERE, 'scratch');
const SCRATCH_PATH = join(SCRATCH_DIR, 'last-queue-fixture.json');

export const QUEUE_PREFIX = 'h2-cf-probe-integrity-scratch-q-';
export const WORKER_PREFIX = 'h2-cf-probe-integrity-scratch-w-';
// Telemetry KV namespaces intentionally start with the KV shim's own
// prefix so the KV shim's sweepOrphans also collects them; the tel-
// infix keeps them distinguishable from KV-probe namespaces at a
// glance.
export const TELEMETRY_KV_PREFIX = `${KV_PREFIX}tel-`;

// Every env var the probe / shim can skip or fail on. Copied verbatim
// into probe report.extra.envDeclared (dispatch requirement 4).
export const DECLARED_ENV = Object.freeze([
  'CI_HAS_CLOUDFLARE_ACCOUNT',
  'CF_ACCOUNT_ID',
  'CF_API_TOKEN',
  'CF_API_BASE_URL',
  'CF_QUEUE_MESSAGE_COUNT',
]);

function assertQueuePrefix(name, where) {
  if (typeof name !== 'string' || !name.startsWith(QUEUE_PREFIX)) {
    throw new Error(`${where}: refusing to act on queue name ${JSON.stringify(name)} - prefix ${QUEUE_PREFIX} not present`);
  }
}

function assertWorkerPrefix(name, where) {
  if (typeof name !== 'string' || !name.startsWith(WORKER_PREFIX)) {
    throw new Error(`${where}: refusing to act on worker script name ${JSON.stringify(name)} - prefix ${WORKER_PREFIX} not present`);
  }
}

function assertTelemetryKvPrefix(title, where) {
  if (typeof title !== 'string' || !title.startsWith(TELEMETRY_KV_PREFIX)) {
    throw new Error(`${where}: refusing to act on telemetry KV namespace title ${JSON.stringify(title)} - prefix ${TELEMETRY_KV_PREFIX} not present`);
  }
}

export function generateQueueName({ runId } = {}) {
  const rid = String(runId || process.env.GITHUB_RUN_ID || `local-${Date.now()}`);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${QUEUE_PREFIX}${rid}-${rand}`;
}

export function generateWorkerName({ runId } = {}) {
  const rid = String(runId || process.env.GITHUB_RUN_ID || `local-${Date.now()}`);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${WORKER_PREFIX}${rid}-${rand}`;
}

export function generateTelemetryKvTitle({ runId } = {}) {
  const rid = String(runId || process.env.GITHUB_RUN_ID || `local-${Date.now()}`);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${TELEMETRY_KV_PREFIX}${rid}-${rand}`;
}

// Mint: telemetry KV first (so the Worker upload can bind it),
// queue second, worker upload with both bindings, attach consumer.
// Records ids + names in scratch file for follow-up teardown after
// a crash.
export async function mintScratchQueueAndWorker({ runId } = {}) {
  const queueName = generateQueueName({ runId });
  const workerName = generateWorkerName({ runId });
  const telemetryKvTitle = generateTelemetryKvTitle({ runId });
  assertQueuePrefix(queueName, 'mintScratchQueueAndWorker(queue)');
  assertWorkerPrefix(workerName, 'mintScratchQueueAndWorker(worker)');
  assertTelemetryKvPrefix(telemetryKvTitle, 'mintScratchQueueAndWorker(telemetry kv)');

  const telemetryKv = await kvCreateNamespace({ title: telemetryKvTitle });
  if (telemetryKv.title !== telemetryKvTitle) {
    // Best-effort revert: kill the KV we just made and refuse to proceed.
    await kvDeleteNamespace({ id: telemetryKv.id, title: telemetryKv.title }).catch(() => {});
    throw new Error(`mint: telemetry KV name drift (requested=${telemetryKvTitle} observed=${telemetryKv.title}); aborting`);
  }

  let queue;
  try {
    queue = await queueCreate({ name: queueName });
  } catch (err) {
    await kvDeleteNamespace({ id: telemetryKv.id, title: telemetryKv.title }).catch(() => {});
    throw err;
  }
  if (queue.name !== queueName) {
    await queueDelete({ id: queue.id, name: queue.name }).catch(() => {});
    await kvDeleteNamespace({ id: telemetryKv.id, title: telemetryKv.title }).catch(() => {});
    throw new Error(`mint: queue name drift (requested=${queueName} observed=${queue.name}); aborting`);
  }

  let upload;
  try {
    upload = await workerUpload({
      name: workerName,
      scriptSource: CONSUMER_WORKER_SOURCE,
      bindings: [
        // Shipped-convention producer binding name (Dave 376b4f30):
        // RCF_TEST_QUEUE matches the wrangler.toml on
        // packages/rcf-lite/test/fixtures/infra-s3-and-queue/. Not read
        // by the consumer body; declared for shape consistency with
        // the shipped fixture Worker.
        { type: 'queue', name: 'RCF_TEST_QUEUE', queue_name: queueName },
        { type: 'kv_namespace', name: 'RCF_TEST_TELEMETRY_KV', namespace_id: telemetryKv.id },
      ],
    });
  } catch (err) {
    await queueDelete({ id: queue.id, name: queue.name }).catch(() => {});
    await kvDeleteNamespace({ id: telemetryKv.id, title: telemetryKv.title }).catch(() => {});
    throw err;
  }

  let consumerAttach;
  try {
    consumerAttach = await queueConsumerAttach({ queueId: queue.id, scriptName: workerName });
  } catch (err) {
    await workerDelete({ name: workerName }).catch(() => {});
    await queueDelete({ id: queue.id, name: queue.name }).catch(() => {});
    await kvDeleteNamespace({ id: telemetryKv.id, title: telemetryKv.title }).catch(() => {});
    throw err;
  }

  const record = {
    queue: { id: queue.id, name: queue.name },
    worker: { name: workerName },
    telemetryKv: { id: telemetryKv.id, title: telemetryKv.title },
    consumer: { id: (consumerAttach && consumerAttach.consumerId) || null, scriptName: workerName },
    createdAt: new Date().toISOString(),
    runId: String(runId || process.env.GITHUB_RUN_ID || 'local'),
    uploadResponse: upload.response || null,
  };
  await mkdir(SCRATCH_DIR, { recursive: true });
  await writeFile(SCRATCH_PATH, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return record;
}

export async function destroyScratchQueueAndWorker(record) {
  let target = record;
  if (!target) {
    try {
      target = JSON.parse(await readFile(SCRATCH_PATH, 'utf8'));
    } catch (err) {
      process.stderr.write(`h2-cf-queue shim: scratch file missing (${err.message}); teardown deferred to sweepOrphans.\n`);
      return { destroyed: null, reason: 'scratch-missing' };
    }
  }
  if (!target.queue || !target.queue.id || !target.worker || !target.worker.name || !target.telemetryKv || !target.telemetryKv.id) {
    throw new Error('destroyScratchQueueAndWorker: record missing queue.id, worker.name, or telemetryKv.id');
  }
  // Two independent guards per resource (Dave hard constraint 3):
  // record-side prefix assert plus live-listing observation.
  assertQueuePrefix(target.queue.name, 'destroyScratchQueueAndWorker(queue prefix)');
  assertWorkerPrefix(target.worker.name, 'destroyScratchQueueAndWorker(worker prefix)');
  assertTelemetryKvPrefix(target.telemetryKv.title, 'destroyScratchQueueAndWorker(kv prefix)');
  const liveQueues = await queueList();
  const observedQ = liveQueues.find((q) => q.id === target.queue.id);
  if (observedQ) assertQueuePrefix(observedQ.name, 'destroyScratchQueueAndWorker(queue live)');
  const liveWorkers = await workerList();
  const observedW = liveWorkers.find((w) => w.name === target.worker.name);
  if (observedW) assertWorkerPrefix(observedW.name, 'destroyScratchQueueAndWorker(worker live)');
  const liveKv = await kvListNamespaces();
  const observedKv = liveKv.find((n) => n.id === target.telemetryKv.id);
  if (observedKv) assertTelemetryKvPrefix(observedKv.title, 'destroyScratchQueueAndWorker(kv live)');

  // Correct teardown order (vendor contract per
  // https://developers.cloudflare.com/api/resources/queues/subresources/consumers/
  // verified 2026-09-09; H-2 real-account gate 2026-09-09 proved that
  // the Worker delete endpoint rejects with HTTP 403 code 10064
  // "Cannot delete this Worker as it is a consumer for a Queue"
  // while the script is still bound as a queue consumer):
  //   1) detach the consumer from the queue,
  //   2) delete the Worker,
  //   3) delete the queue,
  //   4) delete the telemetry KV.
  // If the mint record was written before this order was in force
  // (target.consumer missing or without an id), fall back to a live
  // consumer list against the queue so a legacy record still tears
  // down cleanly. Detach is 404-tolerant via queueConsumerDelete.
  const consumerResults = [];
  const consumerIdsToDetach = new Set();
  if (target.consumer && target.consumer.id) consumerIdsToDetach.add(target.consumer.id);
  try {
    const liveConsumers = await queueConsumerList({ queueId: target.queue.id });
    for (const c of liveConsumers) {
      if (c.scriptName === target.worker.name && c.consumerId) consumerIdsToDetach.add(c.consumerId);
    }
  } catch (_err) { /* queue may already be gone; downstream deletes are idempotent */ }
  for (const consumerId of consumerIdsToDetach) {
    const r = await queueConsumerDelete({ queueId: target.queue.id, consumerId });
    consumerResults.push(r);
  }

  const workerResult = await workerDelete({ name: target.worker.name });
  const queueResult = await queueDelete({ id: target.queue.id, name: target.queue.name });
  const kvResult = await kvDeleteNamespace({ id: target.telemetryKv.id, title: target.telemetryKv.title });

  try { await unlink(SCRATCH_PATH); } catch (_err) { /* fine */ }
  return {
    destroyed: {
      queue: target.queue.id,
      worker: target.worker.name,
      telemetryKv: target.telemetryKv.id,
      consumers: consumerResults.map((r) => r.consumerId),
    },
    api: { consumers: consumerResults, worker: workerResult, queue: queueResult, telemetryKv: kvResult },
  };
}

// Sweep: list all workers / queues / KV namespaces, keep only those
// carrying our frozen throwaway prefixes, delete each match by exact
// identity. Structurally unable to select a non-prefixed name (Dave
// hard constraint 4).
// Pure selection functions extracted from sweepOrphans so a safety
// test can feed live account listings and assert the filters select
// zero live-named resources without exercising any delete path (Dave
// hard constraint 4; live-inventory variant of the sweep-safety
// test). No IO, no mutation.
export function selectWorkerSweepCandidates(workers) {
  if (!Array.isArray(workers)) return [];
  return workers.filter((w) => typeof w.name === 'string' && w.name.startsWith(WORKER_PREFIX));
}

export function selectQueueSweepCandidates(queues) {
  if (!Array.isArray(queues)) return [];
  return queues.filter((q) => typeof q.name === 'string' && q.name.startsWith(QUEUE_PREFIX));
}

export function selectTelemetryKvSweepCandidates(kvNamespaces) {
  if (!Array.isArray(kvNamespaces)) return [];
  return kvNamespaces.filter((n) => typeof n.title === 'string' && n.title.startsWith(TELEMETRY_KV_PREFIX));
}

export async function sweepOrphans({ liveWorkers: lw, liveQueues: lq, liveKvNamespaces: lk } = {}) {
  const queues = Array.isArray(lq) ? lq : await queueList();
  const queueCandidates = selectQueueSweepCandidates(queues);
  // Correct vendor teardown order (H-2 real-account gate 2026-09-09):
  // detach the consumer from every scratch queue BEFORE deleting the
  // scratch worker; a scratch worker that is still bound to a queue
  // as a consumer refuses delete with HTTP 403 code 10064 (per
  // https://developers.cloudflare.com/api/resources/queues/subresources/consumers/
  // verified 2026-09-09). Same prefix filter as the destroy path -
  // the SELECTION is unchanged from d-2026-09-09-011 (queue prefix
  // constant, per-iteration assert), only the ORDER changes.
  const consumerSwept = [];
  for (const q of queueCandidates) {
    assertQueuePrefix(q.name, 'sweepOrphans(queue for consumer detach)');
    let liveConsumers = [];
    try {
      liveConsumers = await queueConsumerList({ queueId: q.id });
    } catch (err) {
      process.stderr.write(`sweepOrphans: consumer list on queue ${q.name} failed: ${err.message}\n`);
      continue;
    }
    for (const c of liveConsumers) {
      if (!c.consumerId) continue;
      try {
        await queueConsumerDelete({ queueId: q.id, consumerId: c.consumerId });
        consumerSwept.push({ queueId: q.id, consumerId: c.consumerId, scriptName: c.scriptName });
      } catch (err) {
        process.stderr.write(`sweepOrphans: consumer detach ${c.consumerId} on queue ${q.name} failed: ${err.message}\n`);
      }
    }
  }
  const workers = Array.isArray(lw) ? lw : await workerList();
  const workerCandidates = selectWorkerSweepCandidates(workers);
  const workerSwept = [];
  for (const w of workerCandidates) {
    assertWorkerPrefix(w.name, 'sweepOrphans(worker)');
    try {
      await workerDelete({ name: w.name });
      workerSwept.push({ name: w.name });
    } catch (err) {
      process.stderr.write(`sweepOrphans: worker delete ${w.name} failed: ${err.message}\n`);
    }
  }
  const queueSwept = [];
  for (const q of queueCandidates) {
    assertQueuePrefix(q.name, 'sweepOrphans(queue)');
    try {
      await queueDelete({ id: q.id, name: q.name });
      queueSwept.push({ id: q.id, name: q.name });
    } catch (err) {
      process.stderr.write(`sweepOrphans: queue delete ${q.name} failed: ${err.message}\n`);
    }
  }
  const kvNamespaces = Array.isArray(lk) ? lk : await kvListNamespaces();
  const kvCandidates = selectTelemetryKvSweepCandidates(kvNamespaces);
  const kvSwept = [];
  for (const n of kvCandidates) {
    assertTelemetryKvPrefix(n.title, 'sweepOrphans(telemetry kv)');
    try {
      await kvDeleteNamespace({ id: n.id, title: n.title });
      kvSwept.push({ id: n.id, title: n.title });
    } catch (err) {
      process.stderr.write(`sweepOrphans: kv delete ${n.id} failed: ${err.message}\n`);
    }
  }
  return {
    consumerSwept, consumerSweptCount: consumerSwept.length,
    workerSwept, workerSweptCount: workerSwept.length, workerCandidatesConsidered: workerCandidates.length, workersListed: workers.length,
    queueSwept, queueSweptCount: queueSwept.length, queueCandidatesConsidered: queueCandidates.length, queuesListed: queues.length,
    kvSwept, kvSweptCount: kvSwept.length, kvCandidatesConsidered: kvCandidates.length, kvNamespacesListed: kvNamespaces.length,
  };
}

export const _SCRATCH_PATH = SCRATCH_PATH;

if (import.meta.url === `file://${process.argv[1]}`) {
  const verb = process.argv[2] || 'sweep';
  if (verb !== 'sweep') {
    process.stderr.write(`unknown verb ${verb}; only 'sweep' is supported on the CLI\n`);
    process.exit(2);
  }
  sweepOrphans().then((r) => {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  }).catch((err) => {
    process.stderr.write(`sweep failed: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
