/**
 * Toy job-definition module (T-4 slice of the jobs-background blueprint).
 *
 * Realises TAC-3101 for a one-shot delayed shape: a welcome-email
 * dispatch. Handler logs through the applied logger companion in a real
 * project; in the fixture we just count invocations on a shared
 * observation object. The retry policy is elicited at apply time; this
 * fixture ships { maxAttempts: 3, backoff: 'exponential' } and a 60000 ms
 * timeout (default per ADR-3104).
 */

export default {
  name: 'send-welcome-email',
  inputSchema: { kind: 'opaque', shape: { userId: 'number', email: 'string' } },
  retryPolicy: { maxAttempts: 3, backoff: 'exponential' },
  timeoutMs: 60000,
  async handler(input, ctx) {
    // In a real project this would call through the applied HTTP client
    // or the applied mail transport. In the fixture we surface the invoke
    // through the ctx object so probes can observe deterministically.
    if (ctx && ctx.observe) ctx.observe({ jobName: 'send-welcome-email', input });
    return { sent: true };
  },
};
