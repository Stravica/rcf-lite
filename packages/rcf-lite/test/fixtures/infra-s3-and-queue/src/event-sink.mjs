/**
 * Lifecycle-event sink adapter fixture (TAC-3003 for the
 * messaging-queue-cloudflare blueprint).
 *
 * Enforces the metadata-only field whitelist in code: exactly
 * { event, ts, messageId, queueName, attempts } are allowed on every
 * record. Any additional field on the payload is stripped at this
 * boundary; a call site that hands a body-bearing payload to the sink
 * gets a filtered record with the forbidden fields removed. The shared
 * envelope prefix { event, ts, ... } matches the T-2 object-storage-s3
 * sink shape (per PR #157 gate reviewer note 2026-09-06) so a future
 * v1.1 minor can promote one shared envelope to schema enforcement.
 */

const WHITELIST = ['event', 'ts', 'messageId', 'queueName', 'attempts'];

export function createSinkAdapter({ onEvent }) {
  return function emit(record) {
    if (!record || typeof record !== 'object') return;
    const filtered = {};
    for (const k of WHITELIST) {
      if (k in record) filtered[k] = record[k];
    }
    if (typeof onEvent === 'function') onEvent(filtered);
  };
}
