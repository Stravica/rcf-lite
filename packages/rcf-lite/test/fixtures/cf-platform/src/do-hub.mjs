// The hibernatable-WebSocket hub Durable Object class realising
// TAC-3404. A named instance of this class accepts websocket
// clients via `state.acceptWebSocket(ws)` (per Cloudflare's
// hibernatable WebSockets shape,
// https://developers.cloudflare.com/durable-objects/), routes each
// message to per-message handlers by JSON `type` field, and
// broadcasts to all connected sockets. On hibernate-and-wake, the
// wake handler runs from cold and reads the same storage; the
// hibernation posture (`hibernate-after-idle` window) is elicited
// per ADR-3405.
//
// The class is dependency-free of the wrangler runtime for the
// probe drives: a fake state object supplies `acceptWebSocket`,
// `getWebSockets` and `storage`; the probe uses a fake websocket
// pair (send-through-buffer) so `websocket-hub-broadcast.mjs`
// exercises the shipped code path without a real ws connection.
//
// The wake handler contract is IDEMPOTENT: repeated wakes on the
// same last-persisted message must not double-emit downstream
// state, per ADR-3405.

export class HubObject {
  constructor({ state, storage, eventSink, name, hibernateAfterIdleMs, clock } = {}) {
    if (!state || typeof state.acceptWebSocket !== 'function') {
      throw new Error('HubObject: state.acceptWebSocket is required');
    }
    if (!storage) throw new Error('HubObject: storage is required');
    if (typeof eventSink !== 'function') {
      throw new Error('HubObject: eventSink must be a function');
    }
    this.state = state;
    this.storage = storage;
    this.eventSink = eventSink;
    this.name = typeof name === 'string' ? name : 'hub';
    this.hibernateAfterIdleMs = typeof hibernateAfterIdleMs === 'number' ? hibernateAfterIdleMs : 30000;
    this.clock = typeof clock === 'function' ? clock : () => Date.now();
    this._lastActivity = this.clock();
    this._woke = false;
  }

  async accept(ws) {
    this.state.acceptWebSocket(ws);
    this._lastActivity = this.clock();
    // Record the accept as a metadata-only event; helpful for the
    // audit trail without leaking connection headers.
    this.eventSink({
      event: 'doAccept',
      key: null,
      size: 0,
      ttl: null,
      timestamp: new Date(this.clock()).toISOString(),
      objectName: this.name,
    });
  }

  async webSocketMessage(ws, message) {
    this._lastActivity = this.clock();
    let parsed;
    try {
      parsed = typeof message === 'string' ? JSON.parse(message) : message;
    } catch (_err) {
      parsed = { type: 'text', payload: String(message) };
    }
    const type = parsed && typeof parsed.type === 'string' ? parsed.type : 'text';
    if (type === 'broadcast') {
      // Fan out to every connected socket, including the sender per the
      // hub shape trade-off (echo confirms delivery; the guide names it).
      const sockets = this.state.getWebSockets();
      const outbound = JSON.stringify({ type: 'broadcast', payload: parsed.payload ?? null });
      for (const peer of sockets) {
        try { peer.send(outbound); } catch (_err) { /* dead socket, dropped */ }
      }
      // Persist the last broadcast so hibernate-and-wake can restore it.
      await this.storage.put('lastBroadcast', outbound);
      return { fanOut: sockets.length };
    }
    if (type === 'set-state') {
      await this.storage.put(parsed.key, parsed.value);
      return { stored: parsed.key };
    }
    if (type === 'get-state') {
      const value = await this.storage.get(parsed.key);
      try { ws.send(JSON.stringify({ type: 'state', key: parsed.key, value })); } catch (_err) { /* dead socket */ }
      return { echoed: parsed.key };
    }
    return { ignored: type };
  }

  async webSocketClose(ws, code, reason) {
    this._lastActivity = this.clock();
    try { ws.close(code, reason); } catch (_err) { /* best effort */ }
  }

  // Called by the fixture harness when the object goes idle past
  // the hibernate-after-idle window. In a real DO the runtime
  // hibernates and the wake handler runs from cold on the next
  // message; the fixture simulates both halves in-process.
  async hibernate() {
    await this.storage.put('_hibernatedAt', this.clock());
    this.eventSink({
      event: 'doHibernate',
      key: null,
      size: 0,
      ttl: null,
      timestamp: new Date(this.clock()).toISOString(),
      objectName: this.name,
    });
  }

  async wake() {
    // Idempotent wake: repeated wakes on the same last-persisted
    // message do not double-emit downstream.
    if (this._woke) {
      return { alreadyAwake: true, lastBroadcast: await this.storage.get('lastBroadcast') };
    }
    this._woke = true;
    const lastBroadcast = await this.storage.get('lastBroadcast');
    this.eventSink({
      event: 'doWakeUp',
      key: null,
      size: 0,
      ttl: null,
      timestamp: new Date(this.clock()).toISOString(),
      objectName: this.name,
    });
    return { lastBroadcast };
  }
}

export function createHub({ state, storage, eventSink, name, hibernateAfterIdleMs, clock }) {
  return new HubObject({ state, storage, eventSink, name, hibernateAfterIdleMs, clock });
}
