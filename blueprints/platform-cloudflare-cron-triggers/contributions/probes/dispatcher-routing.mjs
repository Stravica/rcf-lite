// Dispatcher-routing probe for platform-cloudflare-cron-triggers v1.0.0.
//
// Wires two cron expressions to two spy handlers in-process (no
// wrangler). Drives each expression separately through the shipped
// dispatcher module and asserts only the routed spy fires. Then
// drives an unmatched expression and asserts cronUnmatched with no
// spy invocation.
//
// anchorAcId: AC-32102-1 (primary; AC-32102-2 covered as an
// additional result).
// accountBound: false.

export const anchorAcId = 'AC-32102-1';
export const accountBound = false;

export default async function runProbe() {
  const { createDispatcher } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/dispatcher.mjs');

  const events = [];
  const eventSink = (rec) => events.push(rec);

  const results = [];

  // AC-32102-1: two routes, dispatch to route A, only spy A fires.
  const spyA = { calls: 0, lastCtx: null };
  const spyB = { calls: 0, lastCtx: null };
  const dispatcher = createDispatcher({
    routes: [
      { expression: '* * * * *', handler: async (ctx) => { spyA.calls += 1; spyA.lastCtx = ctx; } },
      { expression: '*/5 * * * *', handler: async (ctx) => { spyB.calls += 1; spyB.lastCtx = ctx; } },
    ],
    eventSink,
    skewToleranceMs: 60000,
    softBudgetMs: 60000,
  });

  const scheduledMs = Date.now();
  await dispatcher.dispatch({ cron: '* * * * *', scheduledTime: scheduledMs });
  const matchedOnly = spyA.calls === 1 && spyB.calls === 0 && spyA.lastCtx && spyA.lastCtx.expression === '* * * * *' && spyA.lastCtx.scheduledTime === scheduledMs && typeof spyA.lastCtx.sink === 'function';
  results.push({
    anchorAcId: 'AC-32102-1',
    verdict: matchedOnly ? 'pass' : 'fail',
    detail: matchedOnly
      ? `dispatch({cron: "* * * * *"}) invoked spyA=${spyA.calls} spyB=${spyB.calls}; bounded context {expression, scheduledTime, sink} present`
      : `matched-only fault: spyA=${spyA.calls} spyB=${spyB.calls} ctx=${JSON.stringify(spyA.lastCtx ? { hasExpression: !!spyA.lastCtx.expression, hasScheduledTime: !!spyA.lastCtx.scheduledTime, hasSink: typeof spyA.lastCtx.sink === 'function' } : null)}`,
  });

  // AC-32102-2: unmatched expression fires cronUnmatched, no spy invocation.
  const priorAB = spyA.calls + spyB.calls;
  events.length = 0;
  await dispatcher.dispatch({ cron: '@yearly', scheduledTime: scheduledMs });
  const unmatched = events.filter((e) => e.event === 'cronUnmatched');
  const noSpyDelta = spyA.calls + spyB.calls === priorAB;
  const unmatchedOk = unmatched.length === 1 && noSpyDelta && unmatched[0].expression === '@yearly' && unmatched[0].outcome === 'unmatched' && unmatched[0].duration === 0;
  results.push({
    anchorAcId: 'AC-32102-2',
    verdict: unmatchedOk ? 'pass' : 'fail',
    detail: unmatchedOk
      ? `dispatch({cron: "@yearly"}) fired cronUnmatched once with outcome=unmatched duration=0; no spy invocation delta observed`
      : `unmatched fault: cronUnmatched=${unmatched.length} spyDelta=${(spyA.calls + spyB.calls) - priorAB} record=${JSON.stringify(unmatched[0] ?? null)}`,
  });

  return { results };
}
