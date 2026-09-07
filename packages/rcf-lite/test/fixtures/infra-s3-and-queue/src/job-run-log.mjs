/**
 * Jobs-background run-log event sink (T-4 slice).
 *
 * Realises TAC-3103. This is the jobs-background-owned sink, NOT the T-3
 * event-sink.mjs (whose whitelist is frozen at
 * { event, ts, messageId, queueName, attempts }). The jobs sink enforces
 * its OWN whitelist { event, jobId, jobName, attempts, duration,
 * timestamp } (plus optional terminalErrorCode on jobFailed), leaving the
 * T-3 sink untouched. A v1.1 schema promotion could unify the two under
 * one envelope; this v1.0.0 lane keeps them separate.
 */

const WHITELIST = ['event', 'jobId', 'jobName', 'attempts', 'duration', 'timestamp', 'terminalErrorCode'];

/**
 * Build a jobs-background event sink over an upstream sink.
 * The upstream sink is typically the applied logger companion's event
 * emitter in a real project; in the fixture it is an array push closure
 * the probes read after the run.
 */
export function createRunLog({ upstream }) {
  return function fire(record) {
    if (!record || typeof record !== 'object') return;
    if (typeof record.event !== 'string') return;
    if (record.event === 'jobFailed' && typeof record.terminalErrorCode !== 'string') {
      // jobFailed requires a terminalErrorCode; refuse silently to avoid
      // shipping an ambiguous terminal event.
      return;
    }
    const filtered = {};
    for (const k of WHITELIST) {
      if (k in record && record[k] !== undefined) filtered[k] = record[k];
    }
    if (typeof upstream === 'function') upstream(filtered);
  };
}
