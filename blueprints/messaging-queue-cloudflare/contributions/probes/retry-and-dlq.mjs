/**
 * Retry-and-dlq probe.
 *
 * Publishes 1 message with SIMULATE_CONSUMER_RETRY forcing the consumer
 * to return retry on every delivery. Drives the loop through max_retries
 * redeliveries, asserts DLQ landing at attempt count 4 (attempts=4 on
 * the DLQ entry because retry increments the counter before overflow),
 * asserts messageDeadLettered fires with the same stable message-id,
 * inspects the DLQ contents, asserts body byte-equal.
 *
 * Anchors AC-29103-1, AC-29104-1.
 *
 * Q3 default per spec section 10: this refusal-style probe asserts
 * BOTH exit code AND stable message id. Exit code lands via the shim's
 * aggregate-verdict->exit mapping; message-id equality lands here.
 */

import { createQueuePair } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/queue-driver.mjs';
import { createProducer, queueConfigFromEnv } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/producer.mjs';
import { createConsumer, drainLoop } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/consumer.mjs';
import { createDlqInspector } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/dlq-inspector.mjs';

export default async function runProbe() {
  const cfg = queueConfigFromEnv();
  const maxRetries = cfg.maxRetries;
  const pair = createQueuePair({ queueName: cfg.queueName, dlqName: cfg.dlqName, maxRetries });
  const events = [];
  const producer = createProducer({
    binding: pair.producer,
    queueName: cfg.queueName,
    onEvent: (e) => events.push(e),
  });
  await producer.ready;

  const body = { note: 'permanent-failure' };
  const { id: publishedId } = await producer.publish(body, { headers: { 'x-trace-id': 'trace-retry-and-dlq' } });

  const seenAttempts = [];
  const consumer = createConsumer({
    handler: async (msg) => {
      seenAttempts.push({ id: msg.id, attempts: msg.attempts });
      return 'retry';
    },
    onEvent: (e) => events.push(e),
    env: { SIMULATE_CONSUMER_RETRY: 'true' },
  });
  await drainLoop({ consumer, driver: pair, dlqSink: { baseline: [], onEvent: (e) => events.push(e) } });

  const inspector = createDlqInspector({ driver: pair });
  const dlqEntries = await inspector.list();

  const results = [];

  // AC-29103-1: attempts observed 1..maxRetries with same stable message-id.
  const idsAcrossAttempts = seenAttempts.map((a) => a.id);
  const attemptsSeq = seenAttempts.map((a) => a.attempts);
  const ac29103Pass = idsAcrossAttempts.every((id) => id === publishedId) &&
    attemptsSeq.length === maxRetries &&
    attemptsSeq.every((a, i) => a === i + 1);
  results.push({
    anchorAcId: 'AC-29103-1',
    verdict: ac29103Pass ? 'pass' : 'fail',
    detail: ac29103Pass
      ? `same messageId=${publishedId} seen across attempts ${attemptsSeq.join(',')}`
      : `retry-trajectory wrong: ids=${JSON.stringify(idsAcrossAttempts)} attempts=${JSON.stringify(attemptsSeq)}`,
  });

  // AC-29104-1: DLQ landing at overflow (attempts > maxRetries),
  //             messageDeadLettered event fires with same stable id,
  //             DLQ contents match body.
  const deadLetterEvents = events.filter((e) => e.event === 'messageDeadLettered');
  const dlqEntry = dlqEntries.find((e) => e.id === publishedId);
  const ac29104Pass = deadLetterEvents.length === 1 &&
    deadLetterEvents[0].messageId === publishedId &&
    deadLetterEvents[0].attempts === maxRetries + 1 &&
    !!dlqEntry &&
    JSON.stringify(dlqEntry.body) === JSON.stringify(body);
  results.push({
    anchorAcId: 'AC-29104-1',
    verdict: ac29104Pass ? 'pass' : 'fail',
    detail: ac29104Pass
      ? `DLQ landing observed: messageDeadLettered messageId=${publishedId} attempts=${deadLetterEvents[0].attempts}; DLQ contents body byte-equal`
      : `DLQ landing wrong: deadLetterEvents=${JSON.stringify(deadLetterEvents)} dlqEntries=${JSON.stringify(dlqEntries)}`,
  });

  return results;
}
