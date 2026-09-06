/**
 * Event-secrecy probe.
 *
 * Drives publish and ack with a PII fixture body ({userId: 1234, ssn:
 * "123-45-6789"}) and asserts every event record on the sink carries
 * only the whitelist ({event, ts, messageId, queueName, attempts}) and
 * no PII fixture text. The sink adapter (event-sink.mjs) is what
 * enforces the whitelist; this probe proves the enforcement by driving
 * the pattern the induced-failure switch SIMULATE_PII_IN_BODY names.
 *
 * Anchors AC-29106-1.
 */

import { createQueuePair } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/queue-driver.mjs';
import { createProducer, queueConfigFromEnv } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/producer.mjs';
import { createConsumer, drainLoop } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/consumer.mjs';

const PII_STRINGS = ['123-45-6789', '1234'];
const FORBIDDEN_KEYS = ['body', 'headers', 'userId', 'ssn', 'consumerContext', 'producerContext'];

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

  // PII body driven per SIMULATE_PII_IN_BODY, in probe form.
  const body = { userId: 1234, ssn: '123-45-6789', note: 'secret payload' };
  await producer.publish(body, { headers: { 'x-trace-id': 'trace-event-secrecy' } });

  const consumer = createConsumer({
    handler: async (_msg) => 'ack',
    onEvent: (e) => events.push(e),
    env: { SIMULATE_PII_IN_BODY: 'true' },
  });
  await drainLoop({ consumer, driver: pair, dlqSink: { baseline: [], onEvent: (e) => events.push(e) } });

  const results = [];

  // Whitelist enforcement per record.
  const allowedKeys = new Set(['event', 'ts', 'messageId', 'queueName', 'attempts']);
  let recordsWithForbiddenKeys = 0;
  for (const rec of events) {
    for (const k of Object.keys(rec)) {
      if (!allowedKeys.has(k)) {
        recordsWithForbiddenKeys += 1;
        break;
      }
    }
  }

  // PII substring grep across the full JSON representation of the events.
  const serialised = JSON.stringify(events);
  const piiHits = PII_STRINGS.filter((s) => serialised.includes(s));
  const forbiddenKeyHits = FORBIDDEN_KEYS.filter((k) => serialised.includes(`"${k}"`));

  const pass = recordsWithForbiddenKeys === 0 && piiHits.length === 0 && forbiddenKeyHits.length === 0;
  results.push({
    anchorAcId: 'AC-29106-1',
    verdict: pass ? 'pass' : 'fail',
    detail: pass
      ? `whitelist enforced on ${events.length} events; no PII substring hit; no forbidden field name present`
      : `whitelist breach: recordsWithForbiddenKeys=${recordsWithForbiddenKeys} piiHits=${JSON.stringify(piiHits)} forbiddenKeyHits=${JSON.stringify(forbiddenKeyHits)}`,
  });

  return results;
}
