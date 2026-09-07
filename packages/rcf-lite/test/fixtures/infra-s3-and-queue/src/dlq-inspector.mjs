/**
 * DLQ inspector helper for the messaging-queue-cloudflare fixture.
 *
 * In a live Cloudflare Queues project, a DLQ is inspected by attaching
 * a dedicated Worker as a consumer on the dead_letter_queue (per the
 * dead-letter-queues doc's `wrangler queues consumer add
 * --dead-letter-queue` CLI form). The retry-and-dlq probe drives the
 * fixture's in-memory driver where the DLQ inspector reads the DLQ
 * contents in-process; the shipped facade contract does not change.
 */

export function createDlqInspector({ driver }) {
  return {
    async list() {
      return driver.dlqInspector.list();
    },
    async drain() {
      return driver.dlqInspector.drain();
    },
  };
}
