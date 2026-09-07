/**
 * Producer facade fixture (T-3 slice of the messaging-queue-cloudflare
 * blueprint).
 *
 * Realises TAC-3001. This module is the sole reader of the queue binding
 * (env.RCF_TEST_QUEUE in a real Worker; the in-memory queue-driver's
 * producer in the fixture per ADR-3001's opaque-adapter clause). Every
 * other module that publishes imports this module and calls its named
 * domain verbs (publish, publishBatch). No module outside this file holds
 * a reference to the raw binding.
 *
 * Lifecycle events (producerReady, messagePublished, messageAcked,
 * messageDeadLettered) fire through the sink adapter (TAC-3003), which
 * enforces the metadata-only field whitelist in code (event, ts,
 * messageId, queueName, attempts).
 */

import { createSinkAdapter } from './event-sink.mjs';

/**
 * Read the queue configuration from the environment / fixture defaults.
 * The elicited parameters (queue binding name, DLQ name, max_retries,
 * batch settings) mirror the wrangler.toml values so a real-Queues run
 * and an in-memory-driver run configure through the same shape.
 */
export function queueConfigFromEnv(env = process.env) {
  return {
    queueName: env.RCF_QUEUE_NAME ?? 'rcf-test-queue',
    dlqName: env.RCF_DLQ_NAME ?? 'rcf-test-dlq',
    maxRetries: Number.parseInt(env.RCF_MAX_RETRIES ?? '3', 10),
    batchSize: Number.parseInt(env.RCF_BATCH_SIZE ?? '10', 10),
    batchTimeoutMs: Number.parseInt(env.RCF_BATCH_TIMEOUT_MS ?? '5000', 10),
    devPort: Number.parseInt(env.WRANGLER_DEV_PORT ?? '8787', 10),
  };
}

/**
 * Create the producer facade. binding is the object the wrangler binding
 * resolves to (in a real Worker, env[bindingName]; in the fixture, the
 * queue-driver's producer). queueName is the elicited queue name. onEvent
 * is the caller-supplied lifecycle-event sink.
 */
export function createProducer({ binding, queueName, onEvent }) {
  if (!binding || typeof binding.send !== 'function') {
    throw new Error('producer facade requires a Queues binding with a send() method');
  }
  if (!queueName || typeof queueName !== 'string') {
    throw new Error('producer facade requires queueName');
  }
  const sink = createSinkAdapter({ onEvent });
  let ready = false;
  const readyPromise = openProducer({ binding, queueName, sink }).then(() => {
    ready = true;
  });

  async function guardReady() {
    if (!ready) await readyPromise;
  }

  return {
    ready: readyPromise,
    async publish(body, options = {}) {
      await guardReady();
      const headers = options.headers ?? {};
      const { id } = await binding.send(body, { headers });
      sink({ event: 'messagePublished', ts: nowIso(), messageId: id, queueName, attempts: 0 });
      return { id };
    },
    async publishBatch(messages) {
      await guardReady();
      const results = [];
      for (const m of messages) {
        const r = await this.publish(m.body, { headers: m.headers });
        results.push(r);
      }
      return results;
    },
    isReady() {
      return ready;
    },
  };
}

async function openProducer({ binding, queueName, sink }) {
  // A real Queues binding is bound at Worker startup, so the ready-check
  // is a bounded no-op. The fixture in-memory driver is always ready.
  sink({ event: 'producerReady', ts: nowIso(), messageId: null, queueName, attempts: 0 });
}

function nowIso() {
  return new Date().toISOString();
}
