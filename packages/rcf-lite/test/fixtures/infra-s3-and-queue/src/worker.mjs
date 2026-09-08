/**
 * Minimal Cloudflare Worker binding the wrangler.toml producer and
 * consumer surfaces to the shipped fixture facades. Wired so
 * `wrangler dev` from this fixture boots a live Worker whose
 * `env.RCF_TEST_QUEUE` producer forwards to the TAC-3001 facade
 * (src/producer.mjs), and whose queue-handler forwards to the TAC-3002
 * consumer registration (src/consumer.mjs). The `env.RCF_TEST_DLQ`
 * producer is bound for the DLQ inspector helper.
 *
 * fetch() exposes a POST /publish endpoint for quick smoke publishes,
 * a POST /publish-batch endpoint that fans a batch through in one
 * request, a GET /stats endpoint returning consumer telemetry the
 * H-2 real-account-concurrency-smoke driver reads to assert
 * concurrent processing per Cloudflare's push-invocation cap, and a
 * POST /reset endpoint to zero the telemetry between smoke runs.
 * queue() is the Worker queue-handler Cloudflare Queues invokes on
 * delivery; it updates the telemetry counters (in-flight, max
 * concurrent, total consumed) around the shipped consumer handler.
 */

import { createProducer } from './producer.mjs';
import { createConsumer } from './consumer.mjs';

const telemetry = {
  published: 0,
  batches: 0,
  totalConsumed: 0,
  inFlight: 0,
  maxConcurrent: 0,
};

function resetTelemetry() {
  telemetry.published = 0;
  telemetry.batches = 0;
  telemetry.totalConsumed = 0;
  telemetry.inFlight = 0;
  telemetry.maxConcurrent = 0;
}

export default {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/publish') {
      const producer = createProducer({ binding: env.RCF_TEST_QUEUE, queueName: 'rcf-test-queue', onEvent: () => {} });
      await producer.ready;
      const body = await request.json();
      const { id } = await producer.publish(body, { headers: { 'x-trace-id': request.headers.get('x-trace-id') ?? 'trace-worker' } });
      telemetry.published += 1;
      return new Response(JSON.stringify({ ok: true, id }), { headers: { 'content-type': 'application/json' } });
    }
    if (request.method === 'POST' && url.pathname === '/publish-batch') {
      const producer = createProducer({ binding: env.RCF_TEST_QUEUE, queueName: 'rcf-test-queue', onEvent: () => {} });
      await producer.ready;
      const payload = await request.json();
      const messages = Array.isArray(payload) ? payload : (Array.isArray(payload.messages) ? payload.messages : []);
      const ids = [];
      for (const m of messages) {
        const { id } = await producer.publish(m.body ?? m, { headers: m.headers ?? {} });
        ids.push(id);
      }
      telemetry.published += ids.length;
      return new Response(JSON.stringify({ ok: true, count: ids.length, ids }), { headers: { 'content-type': 'application/json' } });
    }
    if (request.method === 'GET' && url.pathname === '/stats') {
      return new Response(JSON.stringify(telemetry), { headers: { 'content-type': 'application/json' } });
    }
    if (request.method === 'POST' && url.pathname === '/reset') {
      resetTelemetry();
      return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('rcf-test-queue fixture worker: POST /publish | POST /publish-batch | GET /stats | POST /reset', { status: 200 });
  },
  async queue(batch, env, _ctx) {
    telemetry.batches += 1;
    telemetry.inFlight += 1;
    if (telemetry.inFlight > telemetry.maxConcurrent) telemetry.maxConcurrent = telemetry.inFlight;
    try {
      const handler = createConsumer({
        handler: async () => 'ack',
        onEvent: () => {},
        dlqProducer: env.RCF_TEST_DLQ,
        env: {},
      });
      await handler(batch);
      telemetry.totalConsumed += batch.messages.length;
    } finally {
      telemetry.inFlight -= 1;
    }
  },
};
