/**
 * Toy job-definition module (T-4 slice of the jobs-background blueprint).
 *
 * Realises TAC-3101 for a POSIX cron schedule. Handler hits a stub
 * endpoint (represented in the fixture by an observation callback);
 * retry policy elicits at { maxAttempts: 5, backoff: 'constant' } and
 * timeout at 10000 ms. The cron string every-minute is the elicited
 * schedule under REQ-003; the scheduler publishes one message per cron
 * fire.
 */

export default {
  name: 'refresh-cache',
  inputSchema: { kind: 'opaque', shape: { cacheKey: 'string' } },
  retryPolicy: { maxAttempts: 5, backoff: 'constant' },
  timeoutMs: 10000,
  cron: '* * * * *',
  async handler(input, ctx) {
    if (ctx && ctx.observe) ctx.observe({ jobName: 'refresh-cache', input });
    return { refreshed: true };
  },
};
