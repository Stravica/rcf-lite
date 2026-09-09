// Sole reader of the Cloudflare Workers Cron Trigger event on the
// cf-platform fixture per REQ-001. The scheduled handler wires the
// dispatcher (src/dispatcher.mjs) and the injected event sink at
// boot, emits cronReady on the first ready-check, and on every
// scheduled invocation delegates to dispatcher.dispatch.
//
// The scheduled handler intentionally does NOT dereference other
// bindings on env: the T-1 platform-cloudflare-kv facade is the
// sole reader of the KV binding, and the anatomy test greps this file
// for the binding name to prove the ownership boundary. A consumer route
// that needs KV imports the T-1 facade from its own module.

import { createDispatcher } from './dispatcher.mjs';

export function createScheduledHandler({ routes, eventSink, skewToleranceMs, softBudgetMs, clock }) {
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new Error('scheduled handler: routes must be a non-empty array');
  }
  if (typeof eventSink !== 'function') {
    throw new Error('scheduled handler: eventSink must be a function');
  }
  const dispatcher = createDispatcher({
    routes,
    eventSink,
    skewToleranceMs: typeof skewToleranceMs === 'number' ? skewToleranceMs : 30000,
    softBudgetMs: typeof softBudgetMs === 'number' ? softBudgetMs : 30000,
    clock,
  });

  async function ready() {
    // cronReady uses the cron-vocabulary metadata shape per REQ-001 and
    // TAC-3303's allow-list. expression and scheduledTime carry null on
    // boot (no vendor-scheduled fire has landed yet); outcome is
    // 'ready'; duration is 0. Every other cron lifecycle record on the
    // sink shares this shape so a downstream logging companion never
    // has to switch on event kind to know the record family.
    eventSink({
      event: 'cronReady',
      expression: null,
      scheduledTime: null,
      outcome: 'ready',
      duration: 0,
    });
  }

  async function scheduled(event, _env, ctx) {
    const dispatchPromise = dispatcher.dispatch({
      cron: event?.cron,
      scheduledTime: event?.scheduledTime,
    });
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(dispatchPromise);
    }
    return dispatchPromise;
  }

  return { ready, scheduled };
}

// Fixture default: the scheduled export the wrangler runtime picks up
// on the cf-platform fixture. A named createScheduledHandler(...) call
// wires the routes and the sink at apply time in a real project.
const fixtureSink = (rec) => {
  // Best-effort: write a line to the process stdout so wrangler dev's
  // log tail captures the event on the shipped path. A real project
  // wires the applied logging companion here.
  try {
    process.stdout.write(JSON.stringify(rec) + '\n');
  } catch (_err) {
    // wrangler dev may drain stdout; the anatomy test does not read
    // the tail.
  }
};

const fixtureHandler = createScheduledHandler({
  routes: [
    {
      expression: '* * * * *',
      handler: async ({ expression, scheduledTime }) => {
        // Fixture handler: a no-op that records the fire only through
        // the sink boundary. A real project's handler would call domain
        // code; the T-2 anatomy test never asserts side effects here.
        void expression;
        void scheduledTime;
      },
    },
    {
      expression: '*/5 * * * *',
      handler: async () => {
        // Second route: exists so wrangler.toml carries the multi-cron
        // shape and the dispatcher-routing probe drives it in-process.
      },
    },
  ],
  eventSink: fixtureSink,
});

export default {
  async scheduled(event, env, ctx) {
    return fixtureHandler.scheduled(event, env, ctx);
  },
};
