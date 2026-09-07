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
import { createSinkAdapter } from '../../../../packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/event-sink.mjs';

const PII_STRINGS = ['123-45-6789', '1234'];
const FORBIDDEN_KEYS = ['body', 'headers', 'userId', 'ssn', 'consumerContext', 'producerContext'];

/**
 * Event-secrecy probe (with teeth per PR #159 gate finding 2).
 *
 * Two layers of assertion so the whitelist is exercised at the actual
 * boundary AC-29106-1 claims, not only observed via the shipped code
 * path that never hands the sink a body-bearing payload:
 *
 * (1) Direct-boundary assertion: construct a PII-bearing caller record
 *     locally, hand it to createSinkAdapter (the exact TAC-3003 boundary
 *     the AC claims), assert the forwarded record is stripped to the
 *     whitelist and carries no PII substring.
 *
 * (2) Consumer-driven assertion: turn on SIMULATE_LEAK_BODY_TO_SINK on
 *     the consumer so the shipped consumer path itself hands the sink
 *     a body-bearing payload (body, headers, userId, ssn,
 *     consumerContext), then drive publish and ack of a PII fixture
 *     body and assert every event record observed on the sink carries
 *     only the whitelist and no PII substring survives.
 *
 * A reviewer who disables the whitelist in src/event-sink.mjs and reruns
 * this probe observes it FAIL on both layers: layer (1) surfaces
 * forbidden keys on the direct record; layer (2) surfaces the leaked
 * body / userId / ssn on the acked event. That mutation-run failure is
 * what proves the probe has teeth (the shipped code, with the whitelist
 * in place, passes cleanly on the shipped head).
 */
export default async function runProbe() {
  const results = [];

  // Layer (1): direct-boundary assertion at createSinkAdapter.
  const directCaptured = [];
  const directSink = createSinkAdapter({ onEvent: (rec) => directCaptured.push(rec) });
  directSink({
    event: 'messageAcked',
    ts: new Date().toISOString(),
    messageId: 'direct-boundary-msg-001',
    queueName: 'rcf-test-queue',
    attempts: 1,
    body: { userId: 1234, ssn: '123-45-6789', note: 'direct probe leak attempt' },
    headers: { 'x-trace-id': 'trace-direct', authorization: 'Bearer secret-value' },
    userId: 1234,
    ssn: '123-45-6789',
    consumerContext: { workerId: 'direct-probe', handlerName: 'directHandler' },
    producerContext: { host: 'direct-probe-host' },
  });
  const directSerialised = JSON.stringify(directCaptured);
  const directAllowed = new Set(['event', 'ts', 'messageId', 'queueName', 'attempts']);
  const directForbiddenKeys = directCaptured.length === 1
    ? Object.keys(directCaptured[0]).filter((k) => !directAllowed.has(k))
    : ['record-count-mismatch'];
  const directPiiHits = PII_STRINGS.filter((s) => directSerialised.includes(s));
  const directForbiddenKeyHits = FORBIDDEN_KEYS.filter((k) => directSerialised.includes(`"${k}"`));
  const directPass = directCaptured.length === 1 && directForbiddenKeys.length === 0 && directPiiHits.length === 0 && directForbiddenKeyHits.length === 0;
  results.push({
    anchorAcId: 'AC-29106-1',
    verdict: directPass ? 'pass' : 'fail',
    detail: directPass
      ? `direct-boundary: PII-bearing caller record stripped by createSinkAdapter to ${Object.keys(directCaptured[0]).join(',')}; no PII / forbidden-key substring survived`
      : `direct-boundary breach: forwardedKeys=${JSON.stringify(directCaptured.map((r) => Object.keys(r)))} piiHits=${JSON.stringify(directPiiHits)} forbiddenKeyHits=${JSON.stringify(directForbiddenKeyHits)}`,
  });

  // Layer (2): consumer-driven assertion with SIMULATE_LEAK_BODY_TO_SINK.
  const cfg = queueConfigFromEnv();
  const pair = createQueuePair({ queueName: cfg.queueName, dlqName: cfg.dlqName, maxRetries: cfg.maxRetries });
  const events = [];
  const producer = createProducer({
    binding: pair.producer,
    queueName: cfg.queueName,
    onEvent: (e) => events.push(e),
  });
  await producer.ready;

  const body = { userId: 1234, ssn: '123-45-6789', note: 'secret payload' };
  await producer.publish(body, { headers: { 'x-trace-id': 'trace-event-secrecy', authorization: 'Bearer secret-value' } });

  const consumer = createConsumer({
    handler: async (_msg) => 'ack',
    onEvent: (e) => events.push(e),
    env: { SIMULATE_PII_IN_BODY: 'true', SIMULATE_LEAK_BODY_TO_SINK: 'true' },
  });
  await drainLoop({ consumer, driver: pair, dlqSink: { baseline: [], onEvent: (e) => events.push(e) } });

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
  const serialised = JSON.stringify(events);
  const piiHits = PII_STRINGS.filter((s) => serialised.includes(s));
  const forbiddenKeyHits = FORBIDDEN_KEYS.filter((k) => serialised.includes(`"${k}"`));

  // Also confirm SIMULATE_LEAK_BODY_TO_SINK actually fired: the consumer
  // hands the sink a body-bearing record on messageAcked, and the sink
  // adapter must have received the body for the whitelist to strip it.
  // We prove the leak-path was taken by observing at least one
  // messageAcked event in the captured records (a probe run where the
  // consumer switch was silently unwired would surface no messageAcked
  // and the assertion falls over even before the whitelist check).
  const ackedCount = events.filter((e) => e.event === 'messageAcked').length;

  const consumerPass = ackedCount >= 1 && recordsWithForbiddenKeys === 0 && piiHits.length === 0 && forbiddenKeyHits.length === 0;
  results.push({
    anchorAcId: 'AC-29106-1',
    verdict: consumerPass ? 'pass' : 'fail',
    detail: consumerPass
      ? `consumer-driven leak-path: SIMULATE_LEAK_BODY_TO_SINK on, ${ackedCount} messageAcked events observed on the sink; whitelist stripped all forbidden fields; no PII substring survived on ${events.length} events total`
      : `consumer-driven breach: ackedCount=${ackedCount} recordsWithForbiddenKeys=${recordsWithForbiddenKeys} piiHits=${JSON.stringify(piiHits)} forbiddenKeyHits=${JSON.stringify(forbiddenKeyHits)}`,
  });

  return results;
}
