// Tests for the SSE wire. Connects a raw HTTP client to `/events`,
// parses the event-stream framing by hand, and drives the server through
// its state transitions. `walker-error` is asserted by pointing the
// server at a fixture with a broken parent reference.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '@stravica-ai/rcf-lite-core/store/init.js';
import { startServer } from '../../src/server/index.js';
import { createSseHub } from '../../src/server/sse.js';

async function freePort() {
  return await new Promise((resolveP, rejectP) => {
    const s = createServer();
    s.on('error', rejectP);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolveP(port));
    });
  });
}

async function makeCleanProject() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-server-sse-'));
  await initProject({ projectRoot: root });
  return root;
}

/**
 * Open a raw SSE connection and return a reader that parses `event:` /
 * `data:` frames as they arrive. Caller must `close()` when done.
 */
async function openStream(url) {
  const controller = new AbortController();
  const res = await fetch(url, { signal: controller.signal, headers: { accept: 'text/event-stream' } });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  const waiters = [];

  function processBuffer() {
    while (true) {
      const idx = buffer.indexOf('\n\n');
      if (idx === -1) return;
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const ev = { event: 'message', data: '' };
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) ev.event = line.slice(6).trim();
        else if (line.startsWith('data:')) ev.data += line.slice(5).trim();
        // colon-prefixed comment lines are SSE noise; ignore.
      }
      if (ev.event === 'message' && ev.data === '') continue;
      events.push(ev);
      if (waiters.length) {
        const w = waiters.shift();
        w(events.shift());
      }
    }
  }

  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        processBuffer();
      }
    } catch (e) { /* aborted */ }
  })();

  return {
    async next(timeoutMs = 3000) {
      if (events.length) return events.shift();
      return await new Promise((resolveP, rejectP) => {
        const t = setTimeout(() => rejectP(new Error(`sse: no event within ${timeoutMs}ms`)), timeoutMs);
        waiters.push((ev) => { clearTimeout(t); resolveP(ev); });
      });
    },
    close() { controller.abort(); },
  };
}

test('SSE first event on connect is tree-update with the current state (D12)', async () => {
  const root = await makeCleanProject();
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    const stream = await openStream(`${srv.url}events`);
    try {
      const ev = await stream.next();
      assert.equal(ev.event, 'tree-update');
      const payload = JSON.parse(ev.data);
      assert.equal(typeof payload.version, 'number');
      assert.equal(payload.version, 1);
      assert.ok(payload.contentHtml.length > 0);
    } finally { stream.close(); }
  } finally { await srv.close(); }
});

test('SSE broadcasts tree-update on a re-walk with a monotonic version', async () => {
  const root = await makeCleanProject();
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    const stream = await openStream(`${srv.url}events`);
    try {
      const first = await stream.next();
      assert.equal(first.event, 'tree-update');
      const firstVersion = JSON.parse(first.data).version;
      await srv.rewalk();
      const second = await stream.next();
      assert.equal(second.event, 'tree-update');
      assert.ok(JSON.parse(second.data).version > firstVersion);
    } finally { stream.close(); }
  } finally { await srv.close(); }
});

test('SSE emits heartbeat at the configured interval', async () => {
  const root = await makeCleanProject();
  const srv = await startServer({ projectRoot: root, port: await freePort(), heartbeatMs: 100 });
  try {
    const stream = await openStream(`${srv.url}events`);
    try {
      // The initial event is a `tree-update` and (on macOS) fs.watch
      // recursive may fire spuriously on a freshly-initialised temp
      // project, giving one or two extra `tree-update` events before
      // the first heartbeat interval fires. Skip past them.
      let ev;
      for (let i = 0; i < 8; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        ev = await stream.next(1500);
        if (ev.event === 'heartbeat') break;
      }
      assert.equal(ev.event, 'heartbeat');
      const payload = JSON.parse(ev.data);
      assert.ok(typeof payload.ts === 'string' && payload.ts.length > 0);
    } finally { stream.close(); }
  } finally { await srv.close(); }
});

test('SSE emits walker-error on a broken tree (D17)', async () => {
  const root = await makeCleanProject();
  // Break the tree BEFORE the server starts: initial walk carries the error.
  const reqPath = join(root, 'rcf', 'requirements', 'req-001.json');
  const req = JSON.parse(await readFile(reqPath, 'utf8'));
  req.prdId = 'PRD-999';
  await writeFile(reqPath, JSON.stringify(req), 'utf8');
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    const stream = await openStream(`${srv.url}events`);
    try {
      // First event: tree-update (server still renders with markers).
      const first = await stream.next();
      assert.equal(first.event, 'tree-update');
      // A walker-error was broadcast on the initial walk too; a fresh
      // subscriber only sees future events, so trigger another walk
      // and consume events until a walker-error surfaces.
      await srv.rewalk();
      const seen = [];
      let errEv = null;
      for (let i = 0; i < 4; i += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const ev = await stream.next(1500);
          seen.push(ev);
          if (ev.event === 'walker-error') { errEv = ev; break; }
        } catch (e) {
          break;
        }
      }
      assert.ok(
        errEv,
        `expected a walker-error event; got ${seen.map((e) => e.event).join(', ')}`,
      );
      const payload = JSON.parse(errEv.data);
      assert.ok(Array.isArray(payload.errors));
      assert.ok(payload.errors.length > 0);
    } finally { stream.close(); }
  } finally { await srv.close(); }
});

test('SSE broadcasts shutdown to all clients on server.close() (D16)', async () => {
  const root = await makeCleanProject();
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  const stream = await openStream(`${srv.url}events`);
  try {
    await stream.next(); // initial tree-update
    const closingPromise = srv.close();
    const ev = await stream.next();
    assert.equal(ev.event, 'shutdown');
    await closingPromise;
  } finally {
    stream.close();
  }
});

test('SSE tracks multiple concurrent clients independently', async () => {
  const root = await makeCleanProject();
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    const a = await openStream(`${srv.url}events`);
    const b = await openStream(`${srv.url}events`);
    try {
      const [evA, evB] = await Promise.all([a.next(), b.next()]);
      assert.equal(evA.event, 'tree-update');
      assert.equal(evB.event, 'tree-update');
      await srv.rewalk();
      const [evA2, evB2] = await Promise.all([a.next(), b.next()]);
      assert.equal(evA2.event, 'tree-update');
      assert.equal(evB2.event, 'tree-update');
    } finally { a.close(); b.close(); }
  } finally { await srv.close(); }
});

test('SSE hub broadcast fires the same frame to every open client (unit test on the hub alone)', async () => {
  const hub = createSseHub({ heartbeatMs: 60000 });
  const chunks = [];
  const res1 = { write(s) { chunks.push([1, s]); }, writeHead() {}, end() {}, on() {} };
  const res2 = { write(s) { chunks.push([2, s]); }, writeHead() {}, end() {}, on() {} };
  const req = { on() {} };
  hub.handle(req, res1, { version: 1, contentHtml: 'a' });
  hub.handle(req, res2, { version: 1, contentHtml: 'a' });
  chunks.length = 0;
  hub.broadcast('tree-update', { version: 2, contentHtml: 'b' });
  const to1 = chunks.filter((c) => c[0] === 1).map((c) => c[1]).join('');
  const to2 = chunks.filter((c) => c[0] === 2).map((c) => c[1]).join('');
  assert.equal(to1, to2);
  assert.match(to1, /event: tree-update/);
  assert.match(to1, /"version":2/);
  hub.close();
});

test('SSE hub drain emits a shutdown event on every open client', async () => {
  const hub = createSseHub({ heartbeatMs: 60000 });
  const written = [];
  const res = {
    write(s) { written.push(s); },
    writeHead() {},
    end() {},
    on() {},
  };
  hub.handle({ on() {} }, res, { version: 1, contentHtml: 'x' });
  written.length = 0;
  await hub.drain('shutdown');
  assert.ok(written.some((s) => s.startsWith('event: shutdown')));
});
