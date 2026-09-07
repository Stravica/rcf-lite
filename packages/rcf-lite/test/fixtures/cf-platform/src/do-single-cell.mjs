// The single-cell Durable Object class realising TAC-3402. A named
// instance of this class holds authoritative state behind the
// namespace facade; concurrent invocations against the same instance
// serialise per Cloudflare's documented DO consistency model
// (https://developers.cloudflare.com/durable-objects/).
//
// The class exposes typed domain verbs (`increment`, `read`,
// `reset`) that wrap the injected storage driver. Storage backend
// (sql or kv) is elicited per ADR-3403 and threaded through the
// driver factory; the class code does not care which backend is
// live. The `alarm` handler realises TAC-3403: on alarm fire, the
// handler runs exactly once per scheduled time and the injected
// event sink records `doAlarmFired` with metadata-only fields.
//
// The class is NOT the sole reader of the DO namespace binding;
// it is instantiated by the facade (TAC-3401) which owns
// `env.CELL` and is the ONLY caller of `namespace.get(id).fetch`
// in a real Worker. The single-cell class itself takes the
// storage driver and the event sink as constructor arguments so
// the shipped code path composes without touching bindings.

export class SingleCellObject {
  constructor({ storage, eventSink, name, clock } = {}) {
    if (!storage) throw new Error('SingleCellObject: storage is required');
    if (typeof eventSink !== 'function') throw new Error('SingleCellObject: eventSink must be a function');
    this.storage = storage;
    this.eventSink = eventSink;
    this.name = typeof name === 'string' ? name : 'single-cell';
    this.clock = typeof clock === 'function' ? clock : () => Date.now();
    this.queue = Promise.resolve();
  }

  // Per-instance serialisation. DO natively serialises per object;
  // the fixture replays that contract in-process by chaining every
  // invocation onto a single promise queue. Concurrent callers wait
  // in FIFO order, and one caller observes the other's write on the
  // subsequent read.
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
}

// Factory used by the facade (TAC-3401). The facade constructs one
// SingleCellObject per named handle behind `env.CELL`; the fixture
// bypass constructs the class directly for probe drives.
export function createSingleCell({ storage, eventSink, name, clock }) {
  return new SingleCellObject({ storage, eventSink, name, clock });
}
