/**
 * Producer-facade-ready probe.
 *
 * Opens the fixture's producer facade against the in-memory queue driver
 * (the wrangler-dev-equivalent seam per US-29107, SDR-3-a), asserts
 * producerReady fires on the injected event sink with queueName.
 *
 * Anchors AC-29101-1.
 */

import { createQueuePair } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/queue-driver.mjs';
import { createProducer, queueConfigFromEnv } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/producer.mjs';

export default async function runProbe() {
  const cfg = queueConfigFromEnv();
  const pair = createQueuePair({ queueName: cfg.queueName, dlqName: cfg.dlqName, maxRetries: cfg.maxRetries });
  const events = [];
  const producer = createProducer({
    binding: pair.producer,
    queueName: cfg.queueName,
    onEvent: (e) => events.push(e),
  });
  const results = [];
  await producer.ready;
  const ready = events.find((e) => e.event === 'producerReady');
  const pass = !!ready && ready.queueName === cfg.queueName && producer.isReady();
  results.push({
    anchorAcId: 'AC-29101-1',
    verdict: pass ? 'pass' : 'fail',
    detail: pass
      ? `producerReady fired with queueName=${ready.queueName}; producer.isReady()=true`
      : `producerReady missing or wrong; events=${JSON.stringify(events)}`,
  });
  return results;
}
