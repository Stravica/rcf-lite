// h2-cf-queue-consumer-worker.mjs
//
// Source of the throwaway consumer Worker the queue self-provisioning
// fixture uploads to the account. Kept as a plain string so
// workerUpload can multipart-post it verbatim, and so the source is
// trivially auditable side-by-side with the fixture Worker at
// packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/worker.mjs
// that the round-5 v1.0.0 build ships for wrangler dev.
//
// The Worker binds the throwaway Queue as `QUEUE` (producer) and
// registers a queue() handler bound to the same queue. Fetch surface
// mirrors the fixture Worker: POST /reset, POST /publish-batch, GET
// /stats. Consumer telemetry (published, batches, totalConsumed,
// inFlight, maxConcurrent) lives in module-level state; between smoke
// runs the /reset endpoint zeros it.

export const CONSUMER_WORKER_SOURCE = `
// Throwaway consumer Worker uploaded by h2-cf-queue-real-account-shim.mjs.
// DO NOT edit on the account; the fixture destroys and re-uploads on
// each real-account run. Every instance name carries the H-2
// throwaway prefix h2-cf-probe-integrity-scratch-w-.
const telemetry = { published: 0, batches: 0, totalConsumed: 0, inFlight: 0, maxConcurrent: 0 };
function reset() { telemetry.published = 0; telemetry.batches = 0; telemetry.totalConsumed = 0; telemetry.inFlight = 0; telemetry.maxConcurrent = 0; }
export default {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/reset') {
      reset();
      return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
    }
    if (request.method === 'GET' && url.pathname === '/stats') {
      return new Response(JSON.stringify(telemetry), { headers: { 'content-type': 'application/json' } });
    }
    if (request.method === 'POST' && url.pathname === '/publish-batch') {
      const body = await request.json().catch(() => ({}));
      const messages = Array.isArray(body) ? body : (Array.isArray(body.messages) ? body.messages : []);
      const ids = [];
      for (const m of messages) {
        const id = 'msg-' + Math.random().toString(36).slice(2, 10);
        await env.QUEUE.send(m.body ?? m);
        ids.push(id);
      }
      telemetry.published += ids.length;
      return new Response(JSON.stringify({ ok: true, count: ids.length, ids }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('h2-cf-probe-integrity-scratch-w consumer: POST /reset | POST /publish-batch | GET /stats', { status: 200 });
  },
  async queue(batch, _env, _ctx) {
    telemetry.batches += 1;
    telemetry.inFlight += 1;
    if (telemetry.inFlight > telemetry.maxConcurrent) telemetry.maxConcurrent = telemetry.inFlight;
    try {
      for (const _m of batch.messages) { /* ack via return */ }
      telemetry.totalConsumed += batch.messages.length;
    } finally {
      telemetry.inFlight -= 1;
    }
  },
};
`;
