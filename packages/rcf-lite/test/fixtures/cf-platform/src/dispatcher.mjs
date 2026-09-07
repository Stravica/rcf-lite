// Expression-routed dispatcher per TAC-3302. Accepts an ordered
// map of {expression, handler} pairs and, on every dispatch,
// matches the incoming event.cron against routes[].expression by
// exact string equality. On match, the routed handler runs with a
// bounded context {expression, scheduledTime, sink}. On no match,
// a cronUnmatched event fires on the sink and dispatch returns
// without side effect.
//
// Skew tolerance and soft budget observations both land on the
// sink per TAC-3303. Records are metadata-only ({event, expression,
// scheduledTime, outcome, duration, softBudgetMs?, deltaMs?}); no
// handler input closures or body bytes ever cross the sink boundary.
//
// The dispatcher NEVER terminates a handler on soft-budget breach.
// Cloudflare's platform-level termination remains the sole terminator
// per https://developers.cloudflare.com/workers/platform/limits/.

export function createDispatcher({
  routes,
  eventSink,
  skewToleranceMs,
  softBudgetMs,
  clock,
}) {
  if (!Array.isArray(routes)) {
    throw new Error('dispatcher: routes must be an array');
  }
  if (typeof eventSink !== 'function') {
    throw new Error('dispatcher: eventSink must be a function');
  }
  const skewMs = typeof skewToleranceMs === 'number' ? skewToleranceMs : 30000;
  const budgetMs = typeof softBudgetMs === 'number' ? softBudgetMs : 30000;
  const now = typeof clock === 'function' ? clock : () => Date.now();

  function scheduledTimeMs(scheduledTime) {
    if (typeof scheduledTime === 'number') return scheduledTime;
    if (scheduledTime instanceof Date) return scheduledTime.getTime();
    if (typeof scheduledTime === 'string') {
      const parsed = Date.parse(scheduledTime);
      return Number.isFinite(parsed) ? parsed : now();
    }
    return now();
  }

  async function dispatch(event) {
    const expression = event && typeof event.cron === 'string' ? event.cron : null;
    const scheduledMs = scheduledTimeMs(event?.scheduledTime);
    const route = expression ? routes.find((r) => r.expression === expression) : null;

    if (!route) {
      eventSink({
        event: 'cronUnmatched',
        expression: expression ?? '',
        scheduledTime: scheduledMs,
        outcome: 'unmatched',
        duration: 0,
      });
      return;
    }

    const startedAt = now();
    const skewDelta = startedAt - scheduledMs;
    const skewOutcome = Math.abs(skewDelta) > skewMs ? 'skewed' : 'onTime';

    if (skewOutcome === 'skewed') {
      eventSink({
        event: 'cronSkewed',
        expression,
        scheduledTime: scheduledMs,
        outcome: 'skewed',
        duration: 0,
        deltaMs: skewDelta,
      });
    }

    let softBudgetFired = false;
    const softBudgetTimer = setTimeout(() => {
      softBudgetFired = true;
      const elapsed = now() - startedAt;
      eventSink({
        event: 'cronStalled',
        expression,
        scheduledTime: scheduledMs,
        outcome: 'stalled',
        duration: elapsed >= budgetMs ? elapsed : budgetMs,
        softBudgetMs: budgetMs,
      });
    }, budgetMs);
    if (typeof softBudgetTimer.unref === 'function') softBudgetTimer.unref();

    const context = {
      expression,
      scheduledTime: scheduledMs,
      sink: eventSink,
    };

    try {
      await route.handler(context);
    } finally {
      clearTimeout(softBudgetTimer);
      const settledAt = now();
      const duration = settledAt - startedAt;
      const finalOutcome = softBudgetFired
        ? 'stalled'
        : (skewOutcome === 'skewed' ? 'skewed' : 'onTime');
      eventSink({
        event: 'cronFired',
        expression,
        scheduledTime: scheduledMs,
        outcome: finalOutcome,
        duration,
      });
    }
  }

  return { dispatch };
}
