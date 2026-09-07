/**
 * Minimal Cloudflare Worker binding the wrangler.toml producer and
 * consumer surfaces to the shipped fixture facades. Wired so
 * `wrangler dev` from this fixture boots a live Worker whose
 * `env.RCF_TEST_QUEUE` producer forwards to the TAC-3001 facade
 * (src/producer.mjs), and whose queue-handler forwards to the TAC-3002
 * consumer registration (src/consumer.mjs). The `env.RCF_TEST_DLQ`
 * producer is bound for the DLQ inspector helper.
 *
 * fetch() exposes a POST /publish endpoint for quick smoke publishes
 * from a reviewer's `curl -X POST http://127.0.0.1:8787/publish -d '{...}'`.
 * queue() is the Worker queue-handler Cloudflare Queues invokes on
 * delivery.
 */

import { createProducer } from './producer.mjs';
import { createConsumer } from './consumer.mjs';

export default {
  async fetch(request, env, _ctx) {
    if (request.method === 'POST' && new URL(request.url).pathname === '/publish') {
      const producer = createProducer({ binding: env.RCF_TEST_QUEUE, queueName: 'rcf-test-queue', onEvent: () => {} });
      await producer.ready;
      const body = await request.json();
      const { id } = await producer.publish(body, { headers: { 'x-trace-id': request.headers.get('x-trace-id') ?? 'trace-worker' } });
      return new Response(JSON.stringify({ ok: true, id }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('rcf-test-queue fixture worker: POST /publish', { status: 200 });
  },
  async queue(batch, env, _ctx) {
    const handler = createConsumer({
      handler: async () => 'ack',
      onEvent: () => {},
      dlqProducer: env.RCF_TEST_DLQ,
      env: {},
    });
    await handler(batch);
  },
};
