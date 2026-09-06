/**
 * In-memory queue driver realising the Cloudflare Queues binding shape.
 *
 * Implements the surface the producer facade (TAC-3001) reaches for on the
 * Queues binding, and the batch envelope the consumer registration
 * (TAC-3002) reads from. Semantics match the Cloudflare Queues shipped
 * shape closely enough that the facade module and the consumer module in
 * this fixture are indistinguishable from a real Cloudflare Queues run at
 * the facade boundary (per ADR-3001's opaque-adapter clause):
 *
 * - Producer.send(body, options) assigns a stable, monotonically unique
 *   message-id and appends the message to the primary queue with a fresh
 *   attempt counter of 1 and any producer-supplied headers passed through.
 * - Producer.sendBatch(messages) is the batch variant, same semantics per
 *   message.
 * - Consumer.pull(maxBatchSize, maxBatchWaitMs) returns a batch envelope
 *   whose ack() and retry() methods are per-message.
 * - A message.retry() reappends the message to the primary queue with an
 *   incremented attempt counter; when attempt counter would exceed
 *   maxRetries, the message lands on the dead-letter queue instead.
 * - A message.ack() removes the message from the in-flight set.
 *
 * The driver is deliberately dependency-free: probe runs on Node 24 do
 * not need a live wrangler-dev process, so CI stays reproducible without
 * a live Cloudflare account. The wrangler-dev-equivalent seam (SDR-3-a
 * per US-29107) is what this driver realises; the wrangler.toml alongside
 * declares the real Queues binding shape a project would receive if it
 * were bound against live Queues.
 */

let nextMessageId = 1;

function mintMessageId(queueName) {
  const n = nextMessageId++;
  return `${queueName}#msg-${n.toString(36).padStart(6, '0')}`;
}

/**
 * Create a queue pair: a primary queue plus a DLQ. Both share the driver
 * so producers, consumers, and the DLQ inspector operate on the same
 * in-memory state.
 */
export function createQueuePair({ queueName, dlqName, maxRetries = 3 }) {
  if (!queueName || typeof queueName !== 'string') throw new Error('queueName required');
  if (!dlqName || typeof dlqName !== 'string') throw new Error('dlqName required');
  const primary = [];
  const dlq = [];
  const state = { queueName, dlqName, maxRetries, primary, dlq };
  return {
    state,
    producer: makeProducer(state, queueName, primary),
    dlqProducer: makeProducer(state, dlqName, dlq),
    consumer: makeConsumer(state),
    dlqInspector: makeDlqInspector(state),
  };
}

function makeProducer(state, queueName, target) {
  return {
    async send(body, options = {}) {
      const messageId = mintMessageId(queueName);
      const entry = {
        id: messageId,
        queueName,
        body,
        headers: options.headers ? { ...options.headers } : {},
        attempts: 1,
      };
      target.push(entry);
      return { id: messageId };
    },
    async sendBatch(messages) {
      const out = [];
      for (const m of messages) {
        const r = await this.send(m.body, { headers: m.headers });
        out.push(r);
      }
      return out;
    },
  };
}

function makeConsumer(state) {
  return {
    async pull(maxBatchSize = 10, maxBatchWaitMs = 5000) {
      // In-memory: return whatever's in the primary queue up to the
      // batch size. A real wrangler-dev seam would wait up to
      // maxBatchWaitMs; here we return immediately for probe determinism.
      const take = state.primary.splice(0, maxBatchSize);
      return {
        queue: state.queueName,
        messages: take.map((entry) => makeBatchMessage(state, entry)),
      };
    },
  };
}

function makeBatchMessage(state, entry) {
  let settled = false;
  return {
    id: entry.id,
    body: entry.body,
    headers: entry.headers,
    attempts: entry.attempts,
    timestamp: new Date().toISOString(),
    ack() {
      if (settled) return;
      settled = true;
      // no-op: message is already removed from the primary queue.
    },
    retry() {
      if (settled) return;
      settled = true;
      const next = { ...entry, attempts: entry.attempts + 1 };
      if (next.attempts > state.maxRetries) {
        state.dlq.push(next);
      } else {
        state.primary.push(next);
      }
    },
  };
}

function makeDlqInspector(state) {
  return {
    async list() {
      return state.dlq.map((entry) => ({
        id: entry.id,
        queueName: state.dlqName,
        body: entry.body,
        headers: entry.headers,
        attempts: entry.attempts,
      }));
    },
    async drain() {
      const out = state.dlq.slice();
      state.dlq.length = 0;
      return out;
    },
  };
}
