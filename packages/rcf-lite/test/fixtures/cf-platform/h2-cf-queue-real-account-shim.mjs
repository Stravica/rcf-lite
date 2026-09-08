// h2-cf-queue-real-account-shim.mjs
//
// Fixture-side self-provisioning shim for the queue
// real-account-concurrency-smoke probe. AC-29108-2 requires a real
// consumer to process the published messages ("the consumer processes
// them concurrently up to the documented 250-invocation cap"), so the
// fixture provisions BOTH a scratch Queue AND a throwaway consumer
// Worker bound to that queue, then destroys both on teardown. The
// happy-path teardown deletes by EXACT id and EXACT name only, and
// the crash-recovery sweep filters over the account by the frozen
// throwaway prefix and deletes each match by exact identity (Dave
// hard constraints 1..4 8be06ee5).
//
// Throwaway prefixes:
//   Queues:            h2-cf-probe-integrity-scratch-q-
//   Worker scripts:    h2-cf-probe-integrity-scratch-w-
//
// The uploaded Worker's source lives in
// h2-cf-queue-consumer-worker.mjs alongside; the shim never mutates
// it. Every uploaded script name is generated ONCE, held in a scratch
// record, and used as the exact identity for both the create and the
// delete.

import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  queueCreate, queueDelete, queueList, queueConsumerAttach,
  workerUpload, workerDelete, workerList, workerEnableSubdomain,
} from './h2-cf-account-api.mjs';
import { CONSUMER_WORKER_SOURCE } from './h2-cf-queue-consumer-worker.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH_DIR = resolve(HERE, 'scratch');
const SCRATCH_PATH = join(SCRATCH_DIR, 'last-queue-fixture.json');

export const QUEUE_PREFIX = 'h2-cf-probe-integrity-scratch-q-';
export const WORKER_PREFIX = 'h2-cf-probe-integrity-scratch-w-';

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

// Mint: create queue, upload worker with QUEUE binding at that queue's
// id, attach worker as consumer, enable workers.dev subdomain so the
// probe has an origin to drive. Records both names + ids in the
// scratch file for follow-up teardown after a crash.
export async function mintScratchQueueAndWorker({ runId } = {}) {
  const queueName = generateQueueName({ runId });
  const workerName = generateWorkerName({ runId });
  assertQueuePrefix(queueName, 'mintScratchQueueAndWorker(queue)');
  assertWorkerPrefix(workerName, 'mintScratchQueueAndWorker(worker)');

  const queue = await queueCreate({ name: queueName });
  // Sanity: create returned exactly the name we asked for.
  if (queue.name !== queueName) {
    throw new Error(`mint: queue name drift (requested=${queueName} observed=${queue.name}); aborting before worker upload`);
  }
  const upload = await workerUpload({
    name: workerName,
    scriptSource: CONSUMER_WORKER_SOURCE,
    bindings: [{ type: 'queue', name: 'QUEUE', queue_name: queueName }],
  });
  await queueConsumerAttach({ queueId: queue.id, scriptName: workerName });
  const sub = await workerEnableSubdomain({ name: workerName });

  const record = {
    queue: { id: queue.id, name: queue.name },
    worker: { name: workerName, url: sub.url, subdomain: sub.subdomain },
    createdAt: new Date().toISOString(),
    runId: String(runId || process.env.GITHUB_RUN_ID || 'local'),
    uploadResponse: upload.response || null,
  };
  await mkdir(SCRATCH_DIR, { recursive: true });
  await writeFile(SCRATCH_PATH, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return record;
}

// Test hook: allow the test harness to override the origin URL the
// probe drives against (the mock CF API serves worker origins under
// /w/<scriptName>/...). Only fires when the env var is present.
export function overrideWorkerUrl(record) {
  const override = process.env.H2_CF_QUEUE_WORKER_URL_OVERRIDE;
  if (!override || override.trim().length === 0) return record;
  const clone = JSON.parse(JSON.stringify(record));
  const base = override.replace(/\/$/, '');
  clone.worker = { ...clone.worker, url: `${base}/w/${record.worker.name}` };
  return clone;
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
  if (!target.queue || !target.queue.id || !target.worker || !target.worker.name) {
    throw new Error('destroyScratchQueueAndWorker: record missing queue.id or worker.name');
  }
  // Two independent guards per resource (Dave hard constraint 3):
  // exact-name equality against the record AND prefix assert. Live
  // observation is a third belt-and-braces read.
  assertQueuePrefix(target.queue.name, 'destroyScratchQueueAndWorker(queue prefix)');
  assertWorkerPrefix(target.worker.name, 'destroyScratchQueueAndWorker(worker prefix)');
  const liveQueues = await queueList();
  const observedQ = liveQueues.find((q) => q.id === target.queue.id);
  if (observedQ) assertQueuePrefix(observedQ.name, 'destroyScratchQueueAndWorker(queue live)');
  const liveWorkers = await workerList();
  const observedW = liveWorkers.find((w) => w.name === target.worker.name);
  if (observedW) assertWorkerPrefix(observedW.name, 'destroyScratchQueueAndWorker(worker live)');

  // Delete worker FIRST so the queue has no consumer left when it
  // goes away; if delete-order matters on Cloudflare the reverse is
  // harmless (a Queue delete with consumers reports the block, our
  // sweep collects the leak).
  const workerResult = await workerDelete({ name: target.worker.name });
  const queueResult = await queueDelete({ id: target.queue.id, name: target.queue.name });

  try { await unlink(SCRATCH_PATH); } catch (_err) { /* fine */ }
  return {
    destroyed: { queue: target.queue.id, worker: target.worker.name },
    api: { worker: workerResult, queue: queueResult },
  };
}

// Sweep: list all workers, keep only those with WORKER_PREFIX; list
// all queues, keep only those with QUEUE_PREFIX; delete each match by
// exact identity. Structurally unable to select a non-prefixed name
// (Dave hard constraint 4). No cutoff: we control the prefix, so a
// match is unambiguously ours.
export async function sweepOrphans({ liveWorkers: lw, liveQueues: lq } = {}) {
  const workers = Array.isArray(lw) ? lw : await workerList();
  const workerCandidates = workers.filter((w) => typeof w.name === 'string' && w.name.startsWith(WORKER_PREFIX));
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
  const queues = Array.isArray(lq) ? lq : await queueList();
  const queueCandidates = queues.filter((q) => typeof q.name === 'string' && q.name.startsWith(QUEUE_PREFIX));
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
  return {
    workerSwept, workerSweptCount: workerSwept.length, workerCandidatesConsidered: workerCandidates.length, workersListed: workers.length,
    queueSwept, queueSweptCount: queueSwept.length, queueCandidatesConsidered: queueCandidates.length, queuesListed: queues.length,
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
