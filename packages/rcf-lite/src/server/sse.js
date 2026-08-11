// SSE (Server-Sent Events) connection manager. Tracks the open long-lived
// `/events` responses, broadcasts payload events to all of them, keeps a
// heartbeat loop, and drains gracefully on server close (D16).
//
// D5: private surface between the server and its own browser client.
// Neither payload shape nor route path is a stable contract; downstream
// consumers (e.g. `rcf query`) get their own wire when the time comes.

/**
 * @typedef {Object} SseHubOptions
 * @property {number} [heartbeatMs=30000] - heartbeat interval in ms
 * @property {(msg: string) => void} [log] - optional stderr sink
 */

/**
 * @param {SseHubOptions} [opts]
 * @returns {{
 *   handle: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, current: { version: number, contentHtml: string } | null) => void,
 *   broadcast: (event: string, data: object) => void,
 *   heartbeatOnce: () => void,
 *   drain: (event?: string) => Promise<void>,
 *   size: () => number,
 *   close: () => void,
 * }}
 */
export function createSseHub(opts = {}) {
  const heartbeatMs = typeof opts.heartbeatMs === 'number' && opts.heartbeatMs > 0 ? opts.heartbeatMs : 30000;
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();
  let heartbeatTimer = null;
  let closed = false;

  function frame(event, data) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data ?? {});
    return `event: ${event}\ndata: ${payload}\n\n`;
  }

  function writeTo(res, event, data) {
    try {
      res.write(frame(event, data));
    } catch (err) {
      log(`[sse] write failed: ${/** @type {Error} */ (err).message}`);
      try { res.end(); } catch { /* swallow */ }
      clients.delete(res);
    }
  }

  function startHeartbeat() {
    if (heartbeatTimer || closed) return;
    heartbeatTimer = setInterval(() => {
      if (clients.size === 0) return;
      const ts = new Date().toISOString();
      for (const res of clients) writeTo(res, 'heartbeat', { ts });
    }, heartbeatMs);
    if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
  }

  function stopHeartbeat() {
    if (!heartbeatTimer) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  return {
    handle(req, res, current) {
      if (closed) {
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('server shutting down\n');
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no',
      });
      // Prime the stream so proxies don't buffer the initial event.
      try { res.write(': ok\n\n'); } catch { /* swallow */ }
      clients.add(res);
      req.on('close', () => {
        clients.delete(res);
      });
      // First event on connect carries the current state so the client
      // is in sync without a separate resume protocol (D12).
      if (current) writeTo(res, 'tree-update', current);
      startHeartbeat();
    },
    broadcast(event, data) {
      if (closed) return;
      for (const res of clients) writeTo(res, event, data);
    },
    heartbeatOnce() {
      if (clients.size === 0) return;
      const ts = new Date().toISOString();
      for (const res of clients) writeTo(res, 'heartbeat', { ts });
    },
    async drain(event = 'shutdown') {
      if (closed) return;
      closed = true;
      stopHeartbeat();
      for (const res of clients) {
        writeTo(res, event, {});
        try { res.end(); } catch { /* swallow */ }
      }
      clients.clear();
    },
    size() { return clients.size; },
    close() {
      closed = true;
      stopHeartbeat();
      for (const res of clients) {
        try { res.end(); } catch { /* swallow */ }
      }
      clients.clear();
    },
  };
}
