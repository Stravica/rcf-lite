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
// Two construction paths:
//
//   - DO runtime: `new HubObject(state, env)` per the Cloudflare
//     Workers Durable Object contract. `state.acceptWebSocket` and
//     `state.getWebSockets` are provided by the runtime.
//   - Test / factory: `new HubObject({state, storage, eventSink,
//     name, hibernateAfterIdleMs, clock})` for in-process probe
//     drives against a fake state and fake websocket pairs.
//
// `fetch(request)` is the DO-runtime entry point routed through
// the facade's `hubFetch(name, request)`. On a WebSocket upgrade
// request the handler creates a `WebSocketPair`, calls
// `state.acceptWebSocket(server)` (hibernatable mode) and returns
// a 101 upgrade with the client half. It sends one broadcast
// frame on connect so the wrangler-seam probe receives a message
// deterministically. Non-upgrade requests receive a 400.
//
// The wake handler contract is IDEMPOTENT: repeated wakes on the
// same last-persisted message must not double-emit downstream
// state, per ADR-3405.

export class HubObject {
  constructor(a, _env) {
    let state;
    let storage;
    let eventSink;
    let name;
    let hibernateAfterIdleMs;
    let clock;
    if (a && typeof a.eventSink === 'function') {
      // Test / factory path.
      state = a.state;
      storage = a.storage;
      eventSink = a.eventSink;
      name = typeof a.name === 'string' ? a.name : 'hub';
      hibernateAfterIdleMs = typeof a.hibernateAfterIdleMs === 'number' ? a.hibernateAfterIdleMs : 30000;
      clock = typeof a.clock === 'function' ? a.clock : () => Date.now();
    } else if (a && typeof a.acceptWebSocket === 'function') {
      // DO runtime path: `a` is DurableObjectState.
      state = a;
      storage = a.storage;
      eventSink = (rec) => {
        try { console.log(`[do-hub] ${JSON.stringify(rec)}`); } catch (_err) { /* best effort */ }
      };
      name = (a.id && typeof a.id.name === 'string') ? a.id.name : 'hub';
      hibernateAfterIdleMs = 30000;
      clock = () => Date.now();
    } else {
      throw new Error('HubObject: state.acceptWebSocket is required');
    }
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
    this.name = name;
    this.hibernateAfterIdleMs = hibernateAfterIdleMs;
    this.clock = clock;
    this._lastActivity = this.clock();
    this._woke = false;
  }

  async accept(ws) {
    this.state.acceptWebSocket(ws);
    this._lastActivity = this.clock();
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
      const sockets = this.state.getWebSockets();
      const outbound = JSON.stringify({ type: 'broadcast', payload: parsed.payload ?? null });
      for (const peer of sockets) {
        try { peer.send(outbound); } catch (_err) { /* dead socket, dropped */ }
      }
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

  // DO runtime entry point. workerd routes stub.fetch(request) to
  // this method. WebSocket upgrade requests receive a 101 with the
  // client half of a WebSocketPair; the server half is accepted
  // via `state.acceptWebSocket` (hibernatable mode). One broadcast
  // frame is sent immediately so the wrangler-seam probe receives
  // a deterministic message on connect.
  async fetch(request) {
    const upgrade = request.headers.get('Upgrade');
    if (upgrade && upgrade.toLowerCase() === 'websocket') {
      // `WebSocketPair` is a global provided by the workerd runtime.
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      // Send one broadcast frame on connect so the wrangler-seam
      // probe sees a deterministic message without needing to send
      // one first (which would require a second websocket client).
      try {
        server.send(JSON.stringify({ type: 'broadcast', payload: 'hello-from-hub' }));
      } catch (_err) {
        // Some runtimes require the socket be fully accepted before
        // send is legal; the failure is not a probe defect.
      }
      // Persist so a subsequent hibernate-and-wake sees the record.
      try {
        await this.storage.put('lastBroadcast', JSON.stringify({ type: 'broadcast', payload: 'hello-from-hub' }));
      } catch (_err) { /* best effort */ }
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('websocket upgrade required', { status: 400 });
  }
}

export function createHub({ state, storage, eventSink, name, hibernateAfterIdleMs, clock }) {
  return new HubObject({ state, storage, eventSink, name, hibernateAfterIdleMs, clock });
}
