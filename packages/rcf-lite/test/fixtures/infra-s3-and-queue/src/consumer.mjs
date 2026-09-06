/**
 * Consumer registration fixture (T-3 slice of the messaging-queue-cloudflare
 * blueprint).
 *
 * Realises TAC-3002. Exports createConsumer({ handler, onEvent }) which
 * returns a queue-handler function of shape (batch, env, ctx) matching
 * the Cloudflare Queues Worker queue-handler contract per
 * https://developers.cloudflare.com/queues/configuration/javascript-apis/.
 * The handler is invoked once per message and returns a value used to
 * classify success (ack), retry (redeliver with incremented attempt
 * counter, then DLQ landing at max_retries per REQ-004 and ADR-3003), or
 * terminal (dead-letter on the first delivery when the fixture switch
 * SIMULATE_DLQ_OVERFLOW is set).
 *
 * Induced-failure switches:
 *   SIMULATE_CONSUMER_RETRY=true : handler returns retry classification
 *     regardless of the caller-supplied handler result.
 *   SIMULATE_DLQ_OVERFLOW=true : handler forces DLQ landing on the first
 *     delivery (overrides SIMULATE_CONSUMER_RETRY).
 *   SIMULATE_PII_IN_BODY=true : handler is invoked with a PII fixture body
 *     the caller supplies through the producer; used by event-secrecy
 *     probe to prove the whitelist enforces.
 */

import { createSinkAdapter } from './event-sink.mjs';

export function createConsumer({ handler, onEvent, dlqProducer, env = process.env }) {
  if (typeof handler !== 'function') throw new Error('consumer requires a handler function');
  const sink = createSinkAdapter({ onEvent });
  return async function queueHandler(batch /* , env, ctx */) {
    for (const msg of batch.messages) {
      const forceRetry = env.SIMULATE_CONSUMER_RETRY === 'true';
      const forceOverflow = env.SIMULATE_DLQ_OVERFLOW === 'true';
      let outcome;
      try {
        // Always invoke the handler so per-attempt observation lands
        // (probes rely on this for retry-trajectory assertions); the
        // induced-failure switch then overrides the outcome.
        const handlerOutcome = await handler(msg);
        if (forceOverflow) {
          outcome = 'deadLetter';
        } else if (forceRetry) {
          outcome = 'retry';
        } else if (handlerOutcome === 'retry' || handlerOutcome === 'ack' || handlerOutcome === 'deadLetter') {
          outcome = handlerOutcome;
        } else {
          outcome = 'ack';
        }
      } catch (_err) {
        outcome = 'retry';
      }
      if (outcome === 'ack') {
        msg.ack();
        sink({ event: 'messageAcked', ts: new Date().toISOString(), messageId: msg.id, queueName: batch.queue, attempts: msg.attempts });
      } else if (outcome === 'retry') {
        msg.retry();
        // messageDeadLettered surfaces here when the retry would exceed
        // max_retries; the driver moves the entry to the DLQ, we surface
        // the event on the last-attempt boundary.
      } else if (outcome === 'deadLetter') {
        // Simulated overflow: hand the message directly to the DLQ.
        if (dlqProducer) {
          await dlqProducer.send(msg.body, { headers: msg.headers });
        }
        msg.ack();
        sink({ event: 'messageDeadLettered', ts: new Date().toISOString(), messageId: msg.id, queueName: batch.queue, attempts: msg.attempts });
      }
    }
  };
}

/**
 * Companion helper: run the driver's delivery loop with the given
 * consumer handler until the primary queue drains OR the driver's
 * DLQ observations require surfacing.
 *
 * The fixture's in-memory queue-driver does not push to the Worker itself,
 * so probes call this helper to drive the loop. The helper also observes
 * DLQ landings (when driver.retry() overflows to DLQ) and fires
 * messageDeadLettered on the sink so the probe surface matches a real
 * Queues-with-DLQ-consumer wiring.
 */
export async function drainLoop({ consumer, driver, dlqSink }) {
  const seenDlqIds = new Set(dlqSink?.baseline ?? []);
  while (driver.state.primary.length > 0) {
    const batch = await driver.consumer.pull(driver.state.maxRetries * 4);
    if (batch.messages.length === 0) break;
    await consumer(batch);
    // After the batch, look at fresh DLQ entries and surface events.
    for (const entry of driver.state.dlq) {
      if (seenDlqIds.has(entry.id)) continue;
      seenDlqIds.add(entry.id);
      dlqSink?.onEvent?.({
        event: 'messageDeadLettered',
        ts: new Date().toISOString(),
        messageId: entry.id,
        queueName: driver.state.queueName,
        attempts: entry.attempts,
      });
    }
  }
}
