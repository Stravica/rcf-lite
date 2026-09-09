// h2-cf-queue-consumer-worker.mjs
//
// Source of the throwaway consumer Worker the queue self-provisioning
// fixture uploads to the account. Kept as a plain string so
// workerUpload can multipart-post it verbatim, and so the source is
// trivially auditable side-by-side with the fixture Worker at
// packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/worker.mjs
// that the round-5 v1.0.0 build ships for wrangler dev.
//
// Consumer-only Worker: the driver publishes to the queue directly
// via the Cloudflare Queues REST publish endpoint, so this Worker
// has NO fetch handler and needs NO workers.dev subdomain (Dave
// ruling 376b4f30). The queue() handler consumes the batch and
// writes one telemetry record per invocation to the scratch KV
// namespace bound at RCF_TEST_TELEMETRY_KV; the driver reads those
// records via the KV REST list + get endpoints and computes
// totalConsumed (sum of batchSize) and maxConcurrent (interval-
// overlap analysis on start/end timestamps).
//
// Bindings on this Worker (matches the shipped convention on
// packages/rcf-lite/test/fixtures/infra-s3-and-queue/wrangler.toml):
//   - RCF_TEST_QUEUE          queue producer binding (shipped name).
//                             Not read by this consumer body; declared
//                             so the throwaway matches the shipped
//                             binding shape and a later variant that
//                             wants to re-publish (retry, DLQ) has the
//                             same name available.
//   - RCF_TEST_TELEMETRY_KV   KV namespace the queue() handler writes
//                             per-invocation records to; driver reads
//                             back via KV REST.

export const CONSUMER_WORKER_SOURCE = `
// Throwaway consumer Worker uploaded by h2-cf-queue-real-account-shim.mjs.
// DO NOT edit on the account; the fixture destroys and re-uploads on
// each real-account run. Every instance name carries the H-2
// throwaway prefix h2-cf-probe-integrity-scratch-w-.
export default {
  async queue(batch, env, _ctx) {
    const start = Date.now();
    const id = (crypto.randomUUID && crypto.randomUUID()) || String(start) + '-' + Math.random().toString(36).slice(2, 10);
    // Simulate a small amount of work so real-CF push concurrency has
    // a window to observe overlapping invocations. In-flight cost is
    // ~5 ms; CF Queues push consumer fires up to 250 in parallel per
    // https://developers.cloudflare.com/queues/platform/limits/.
    await new Promise((r) => setTimeout(r, 5));
    const end = Date.now();
    // One key per invocation; padded start prefix keeps list order.
    const key = 'telemetry-' + String(start).padStart(20, '0') + '-' + id;
    const record = { start: start, end: end, batchSize: batch.messages.length, invocationId: id };
    await env.RCF_TEST_TELEMETRY_KV.put(key, JSON.stringify(record));
  },
};
`;
