// Skew-tolerance probe for platform-cloudflare-cron-triggers v1.0.0.
//
// Drives the shipped dispatcher in-process against a fake clock and
// asserts:
//
//   (a) an aligned clock fires cronFired with outcome onTime and no
//       cronSkewed record (AC-32103-1).
//   (b) a 60-second-shifted clock fires cronSkewed with the observed
//       delta and the routed handler still runs (AC-32103-2).
//
// Also folds the soft-budget contract in as additional results
// (AC-32104-1 and AC-32104-2) so the shipped skew-tolerance probe
// is the one place the T-2 spec's time-based dispatcher behaviour is
// exercised end-to-end. SIMULATE_SLOW_HANDLER=true forces the spy
// handler past the soft budget on every dispatch so a reviewer can
// see cronStalled fires without editing the probe.
//
// anchorAcId: AC-32103-1 (primary; AC-32103-2, AC-32104-1 and
// AC-32104-2 covered as additional results).
// accountBound: false.

export const anchorAcId = 'AC-32103-1';
export const accountBound = false;

const SIMULATE_SLOW_HANDLER = process.env.SIMULATE_SLOW_HANDLER === 'true';

export default async function runProbe() {
  const { createDispatcher } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/dispatcher.mjs');

  const results = [];

  // AC-32103-1: aligned clock. Clock returns scheduledMs + tiny elapsed on each call.
  {
    const events = [];
    const sink = (rec) => events.push(rec);
    const scheduledMs = 1_700_000_000_000;
    let tick = 0;
    const clock = () => scheduledMs + tick++;
    const dispatcher = createDispatcher({
      routes: [{ expression: '* * * * *', handler: async () => { /* no-op */ } }],
      eventSink: sink,
      skewToleranceMs: 30000,
      softBudgetMs: 60000,
      clock,
    });
    await dispatcher.dispatch({ cron: '* * * * *', scheduledTime: scheduledMs });
    const fired = events.filter((e) => e.event === 'cronFired');
    const skewed = events.filter((e) => e.event === 'cronSkewed');
    const alignedOk = fired.length === 1 && fired[0].outcome === 'onTime' && skewed.length === 0;
    results.push({
      anchorAcId: 'AC-32103-1',
      verdict: alignedOk ? 'pass' : 'fail',
      detail: alignedOk
        ? `aligned clock fired cronFired outcome=onTime; no cronSkewed; duration=${fired[0].duration}`
        : `aligned-clock fault: cronFired=${fired.length} outcome=${fired[0]?.outcome} cronSkewed=${skewed.length}`,
    });
  }

  // AC-32103-2: shifted clock 60s past scheduledMs; cronSkewed fires with deltaMs=60000; handler still runs.
  {
    const events = [];
    const sink = (rec) => events.push(rec);
    const scheduledMs = 1_700_000_000_000;
    const shifted = scheduledMs + 60000;
    let tick = 0;
    const clock = () => shifted + tick++;
    let handlerCalls = 0;
    const dispatcher = createDispatcher({
      routes: [{ expression: '* * * * *', handler: async () => { handlerCalls += 1; } }],
      eventSink: sink,
      skewToleranceMs: 30000,
      softBudgetMs: 60000,
      clock,
    });
    await dispatcher.dispatch({ cron: '* * * * *', scheduledTime: scheduledMs });
    const skewed = events.filter((e) => e.event === 'cronSkewed');
    const fired = events.filter((e) => e.event === 'cronFired');
    const shiftedOk = skewed.length === 1 && skewed[0].deltaMs === 60000 && skewed[0].outcome === 'skewed' && handlerCalls === 1 && fired.length === 1;
    results.push({
      anchorAcId: 'AC-32103-2',
      verdict: shiftedOk ? 'pass' : 'fail',
      detail: shiftedOk
        ? `shifted-clock fired cronSkewed deltaMs=${skewed[0].deltaMs}; handler ran (${handlerCalls}); cronFired followed`
        : `shifted-clock fault: cronSkewed=${skewed.length} deltaMs=${skewed[0]?.deltaMs} handlerCalls=${handlerCalls} cronFired=${fired.length}`,
    });
  }

  // AC-32104-1 / AC-32104-2: soft budget. Use a REAL clock and a REAL setTimeout so the dispatcher's
  // internal soft-budget setTimeout fires deterministically. Handler resolves after 250ms; budget 100ms.
  {
    const events = [];
    const sink = (rec) => events.push(rec);
    const dispatcher = createDispatcher({
      routes: [
        {
          expression: '* * * * *',
          handler: async () => {
            const wait = SIMULATE_SLOW_HANDLER ? 350 : 250;
            await new Promise((r) => setTimeout(r, wait));
          },
        },
      ],
      eventSink: sink,
      skewToleranceMs: 60000,
      softBudgetMs: 100,
    });
    const beforeMs = Date.now();
    await dispatcher.dispatch({ cron: '* * * * *', scheduledTime: beforeMs });
    const stalled = events.filter((e) => e.event === 'cronStalled');
    const fired = events.filter((e) => e.event === 'cronFired');
    const stalledOk = stalled.length === 1 && stalled[0].duration >= 100 && stalled[0].softBudgetMs === 100;
    results.push({
      anchorAcId: 'AC-32104-1',
      verdict: stalledOk ? 'pass' : 'fail',
      detail: stalledOk
        ? `softBudget breach: cronStalled fired once with duration=${stalled[0].duration}ms softBudgetMs=${stalled[0].softBudgetMs}`
        : `soft-budget fault: cronStalled=${stalled.length} record=${JSON.stringify(stalled[0] ?? null)}`,
    });
    const continuedOk = fired.length === 1 && fired[0].duration >= 200;
    results.push({
      anchorAcId: 'AC-32104-2',
      verdict: continuedOk ? 'pass' : 'fail',
      detail: continuedOk
        ? `handler ran to completion after soft-budget breach; final cronFired duration=${fired[0].duration}ms`
        : `continue fault: cronFired=${fired.length} record=${JSON.stringify(fired[0] ?? null)}`,
    });
  }

  return { results };
}
