// The single-cell Durable Object class realising TAC-3402. A named
// instance of this class holds authoritative state behind the
// namespace facade; concurrent invocations against the same instance
// serialise per Cloudflare's documented DO consistency model
// (https://developers.cloudflare.com/durable-objects/).
//
// The class supports two construction paths:
//
//   - DO runtime: `new SingleCellObject(state, env)` per the
//     Cloudflare Workers Durable Object contract. workerd hands
//     the class a DurableObjectState (with `storage`) and the env
//     when instantiating an object.
//   - Test / factory: `new SingleCellObject({storage, eventSink,
//     name, clock})` for in-process probe drives.
//
// The class exposes typed domain verbs (`increment`, `read`,
// `reset`) that wrap the injected storage driver. Storage backend
// (sql or kv) is elicited per ADR-3403 and threaded through the
// driver factory; the class code does not care which backend is
// live. The `alarm` handler realises TAC-3403: on alarm fire, the
// handler runs exactly once per scheduled time and the injected
// event sink records `doAlarmFired` with metadata-only fields.
//
// `fetch(request)` is the DO-runtime entry point routed through
// the facade's `cellFetch(name, request)`; the request's URL path
// selects the domain verb (`/increment`, `/read`, `/reset`).

export class SingleCellObject {
  constructor(a, _env) {
    let storage;
    let eventSink;
    let name;
    let clock;
    let state = null;
    if (a && typeof a.eventSink === 'function') {
      // Test / factory path.
      storage = a.storage;
      eventSink = a.eventSink;
      name = typeof a.name === 'string' ? a.name : 'single-cell';
      clock = typeof a.clock === 'function' ? a.clock : () => Date.now();
    } else if (a && a.storage) {
      // DO runtime path: `a` is DurableObjectState.
      state = a;
      storage = a.storage;
      eventSink = (rec) => {
        try { console.log(`[do-single-cell] ${JSON.stringify(rec)}`); } catch (_err) { /* best effort */ }
      };
      name = (a.id && typeof a.id.name === 'string') ? a.id.name : 'do-cell';
      clock = () => Date.now();
    } else {
      throw new Error('SingleCellObject: storage is required');
    }
    if (typeof eventSink !== 'function') {
      throw new Error('SingleCellObject: eventSink must be a function');
    }
    this.state = state;
    this.storage = storage;
    this.eventSink = eventSink;
    this.name = name;
    this.clock = clock;
    this.queue = Promise.resolve();
  }

  // Per-instance serialisation. DO natively serialises per object;
  // the fixture replays that contract in-process by chaining every
  // invocation onto a single promise queue. Concurrent callers wait
  // in FIFO order, and one caller observes the other's write on the
  // subsequent read. Under workerd's real runtime the DO scheduler
  // provides the same guarantee at the request boundary; the queue
  // stacks on top of it, so removing the queue (the shipped mutation
  // check) surfaces on the wrangler-seam probe as two concurrent
  // requests both reading counter=0 and both writing counter=1.
  async _serialise(fn) {
    const next = this.queue.then(fn, fn);
    // Swallow errors on the chain so a failed invocation does not
    // poison every later one; the caller sees the rejection through
    // the returned promise.
    this.queue = next.catch(() => undefined);
    return next;
  }

  async increment(delta = 1) {
    return this._serialise(async () => {
      const current = (await this.storage.get('counter')) ?? 0;
      const next = current + Number(delta);
      await this.storage.put('counter', next);
      return { counter: next, witness: current };
    });
  }

  async read() {
    return this._serialise(async () => {
      const current = (await this.storage.get('counter')) ?? 0;
      return { counter: current };
    });
  }

  async reset() {
    return this._serialise(async () => {
      await this.storage.put('counter', 0);
      return { counter: 0 };
    });
  }

  async setAlarm(offsetMs) {
    const scheduledTime = this.clock() + Number(offsetMs);
    await this.storage.setAlarm(scheduledTime);
    return { scheduledTime };
  }

  async alarm() {
    const scheduledTime = await this.storage.getAlarm();
    await this.storage.deleteAlarm();
    this.eventSink({
      event: 'doAlarmFired',
      key: null,
      size: 0,
      ttl: null,
      timestamp: new Date(this.clock()).toISOString(),
      objectName: this.name,
      scheduledTime,
    });
    return { firedAt: this.clock(), scheduledTime };
  }

  // DO runtime entry point. workerd routes stub.fetch(request) to
  // this method. The path selects the domain verb.
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === 'POST' && path.endsWith('/increment')) {
      const result = await this.increment(1);
      return new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (request.method === 'GET' && path.endsWith('/read')) {
      const result = await this.read();
      return new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (request.method === 'POST' && path.endsWith('/reset')) {
      const result = await this.reset();
      return new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }
}

// Factory used by the facade (TAC-3401). The facade constructs one
// SingleCellObject per named handle behind the DO namespace; the
// fixture bypass constructs the class directly for probe drives.
export function createSingleCell({ storage, eventSink, name, clock }) {
  return new SingleCellObject({ storage, eventSink, name, clock });
}
