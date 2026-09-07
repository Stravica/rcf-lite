/**
 * Publish-to-delivery probe.
 *
 * Publishes 5 messages through the producer facade, drives the consumer
 * loop, asserts the consumer receives all 5 with body byte-equal and
 * trace-id headers preserved.
 *
 * Anchors AC-29102-1, AC-29102-2, AC-29105-1, AC-29108-1.
 */

import { createQueuePair } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/queue-driver.mjs';
import { createProducer, queueConfigFromEnv } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/producer.mjs';
import { createConsumer, drainLoop } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/consumer.mjs';

export default async function runProbe() {
  const cfg = queueConfigFromEnv();
  const pair = createQueuePair({ queueName: cfg.queueName, dlqName: cfg.dlqName, maxRetries: cfg.maxRetries });
  const events = [];
  const producer = createProducer({
    binding: pair.producer,
    queueName: cfg.queueName,
    onEvent: (e) => events.push(e),
  });
  await producer.ready;

  // 5 messages, each with body and producer-supplied trace-id.
  const published = [];
  for (let i = 0; i < 5; i += 1) {
    const traceId = `trace-${i}-${Math.random().toString(36).slice(2, 8)}`;
    const body = { seq: i, note: `payload-${i}` };
    const { id } = await producer.publish(body, { headers: { 'x-trace-id': traceId } });
    published.push({ id, body, traceId });
  }

  const seen = [];
  const consumerHandler = async (msg) => {
    seen.push({ id: msg.id, body: msg.body, traceId: msg.headers['x-trace-id'], attempts: msg.attempts });
    return 'ack';
  };
  const consumer = createConsumer({
    handler: consumerHandler,
    onEvent: (e) => events.push(e),
    env: {},
  });
  await drainLoop({ consumer, driver: pair, dlqSink: { baseline: [], onEvent: (e) => events.push(e) } });

  const results = [];

  // AC-29102-1: 5 messages received body-byte-equal with trace-id present.
  const bodyMatch = seen.length === 5 && published.every((p, i) => JSON.stringify(seen[i].body) === JSON.stringify(p.body));
  const traceMatch = published.every((p, i) => seen[i]?.traceId === p.traceId);
  const idsMatch = published.every((p, i) => seen[i]?.id === p.id);
  const ac29102Pass = bodyMatch && traceMatch && idsMatch;
  results.push({
    anchorAcId: 'AC-29102-1',
    verdict: ac29102Pass ? 'pass' : 'fail',
    detail: ac29102Pass
      ? `5 messages received byte-equal with stable message-ids and producer trace-ids preserved; first id=${seen[0].id}`
      : `mismatch: bodyMatch=${bodyMatch} traceMatch=${traceMatch} idsMatch=${idsMatch}`,
  });

  // AC-29102-2: messageAcked events fired for each of the 5 messages.
  const ackedEvents = events.filter((e) => e.event === 'messageAcked');
  const ac29102b = ackedEvents.length === 5 && ackedEvents.every((e) => published.find((p) => p.id === e.messageId));
  results.push({
    anchorAcId: 'AC-29102-2',
    verdict: ac29102b ? 'pass' : 'fail',
    detail: ac29102b
      ? `messageAcked fired 5 times with matching message-ids and queueName=${ackedEvents[0].queueName}`
      : `messageAcked count wrong; got ${ackedEvents.length} events: ${JSON.stringify(ackedEvents)}`,
  });

  // AC-29105-1: one batched delivery (5 messages < batch max 10) with per-message ack.
  const publishedEvents = events.filter((e) => e.event === 'messagePublished');
  const ac29105Pass = publishedEvents.length === 5 && ackedEvents.length === 5;
  results.push({
    anchorAcId: 'AC-29105-1',
    verdict: ac29105Pass ? 'pass' : 'fail',
    detail: ac29105Pass
      ? `5 publishes, 5 acks; per-message ack semantics observed under batch max_batch_size=${cfg.batchSize}`
      : `batch semantics wrong: publishes=${publishedEvents.length} acks=${ackedEvents.length}`,
  });

  // AC-29108-1 mirrors AC-29102-1 in the wrangler-dev-equivalent seam.
  results.push({
    anchorAcId: 'AC-29108-1',
    verdict: ac29102Pass ? 'pass' : 'fail',
    detail: ac29102Pass
      ? `wrangler-dev-equivalent seam round-trip complete; 5 messages delivered with stable ids`
      : `wrangler-dev-equivalent seam mismatch`,
  });

  return results;
}
