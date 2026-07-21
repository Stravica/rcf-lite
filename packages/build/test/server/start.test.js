// Tests for the HTTP + SSE server's startup, route surface, and clean
// shutdown. Uses free ephemeral ports so parallel test runs won't
// collide. The tests drive `startServer` directly (no bin subprocess);
// bin-level integration lives in test/view/cli.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '../../src/store/init.js';
import { startServer } from '../../src/server/index.js';

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
  const root = await mkdtemp(join(tmpdir(), 'rcf-server-'));
  await initProject({ projectRoot: root });
  return root;
}

test('startServer binds 127.0.0.1 on a free port and GET / returns the rendered HTML', async () => {
  const root = await makeCleanProject();
  const port = await freePort();
  const srv = await startServer({ projectRoot: root, port });
  try {
    assert.equal(srv.host, '127.0.0.1');
    assert.equal(srv.port, port);
    assert.equal(srv.url, `http://127.0.0.1:${port}/`);
    const res = await fetch(srv.url);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /^<!DOCTYPE html>/);
    assert.match(body, /<div id="rcf-live-content">/);
  } finally {
    await srv.close();
  }
});

test('startServer GET / serves text/html', async () => {
  const root = await makeCleanProject();
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    const res = await fetch(srv.url);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  } finally {
    await srv.close();
  }
});

test('startServer serves style.css, mermaid.min.js and live-client.js as static assets', async () => {
  const root = await makeCleanProject();
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    const style = await fetch(`${srv.url}style.css`);
    assert.equal(style.status, 200);
    assert.match(style.headers.get('content-type') ?? '', /text\/css/);
    const mermaid = await fetch(`${srv.url}mermaid.min.js`);
    assert.equal(mermaid.status, 200);
    assert.match(mermaid.headers.get('content-type') ?? '', /javascript/);
    const client = await fetch(`${srv.url}live-client.js`);
    assert.equal(client.status, 200);
    assert.match(client.headers.get('content-type') ?? '', /javascript/);
    const clientBody = await client.text();
    assert.match(clientBody, /window\.__rcfLiveClient/);
  } finally {
    await srv.close();
  }
});

test('startServer returns 404 with text/plain for unknown paths', async () => {
  const root = await makeCleanProject();
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    const res = await fetch(`${srv.url}nonexistent-path`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
  } finally {
    await srv.close();
  }
});

test('startServer never issues CORS headers on GET / (D11: no CORS)', async () => {
  const root = await makeCleanProject();
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    const res = await fetch(srv.url);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert.equal(res.headers.get('access-control-allow-methods'), null);
  } finally {
    await srv.close();
  }
});

test('startServer rejects non-GET methods with 405', async () => {
  const root = await makeCleanProject();
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    const res = await fetch(srv.url, { method: 'POST' });
    assert.equal(res.status, 405);
  } finally {
    await srv.close();
  }
});

test('startServer surfaces EADDRINUSE as a rejected Promise (D10)', async () => {
  const root = await makeCleanProject();
  const port = await freePort();
  const first = await startServer({ projectRoot: root, port });
  try {
    await assert.rejects(
      startServer({ projectRoot: root, port }),
      (err) => err.code === 'EADDRINUSE',
    );
  } finally {
    await first.close();
  }
});

test('startServer close() releases the port for a subsequent bind', async () => {
  const root = await makeCleanProject();
  const port = await freePort();
  const first = await startServer({ projectRoot: root, port });
  await first.close();
  const second = await startServer({ projectRoot: root, port });
  try {
    assert.equal(second.port, port);
  } finally {
    await second.close();
  }
});

test('startServer currentState() reports the walker version and payload', async () => {
  const root = await makeCleanProject();
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    const state = srv.currentState();
    assert.ok(state !== null);
    assert.equal(typeof state.version, 'number');
    assert.ok(state.version >= 1);
    assert.match(state.fullPageHtml, /^<!DOCTYPE html>/);
    assert.ok(state.contentHtml.length > 0);
  } finally {
    await srv.close();
  }
});

test('startServer rewalk() bumps the version and updates content', async () => {
  const root = await makeCleanProject();
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    const before = srv.currentState().version;
    await srv.rewalk();
    const after = srv.currentState().version;
    assert.ok(after > before, `expected version to bump; before=${before} after=${after}`);
  } finally {
    await srv.close();
  }
});

test('startServer initial-page HTML has the same content as the SSE first payload contentHtml', async () => {
  const root = await makeCleanProject();
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    const state = srv.currentState();
    const idxOpen = state.fullPageHtml.indexOf('<div id="rcf-live-content">');
    const idxClose = state.fullPageHtml.lastIndexOf('</div>\n  </main>');
    assert.ok(idxOpen > 0);
    assert.ok(idxClose > idxOpen);
    const inner = state.fullPageHtml.slice(idxOpen + '<div id="rcf-live-content">'.length, idxClose).trim();
    // The rendered inner content (whitespace-relaxed) should match the
    // SSE contentHtml the client receives on its first tree-update.
    assert.ok(inner.includes(state.contentHtml.trim().slice(0, 100)));
  } finally {
    await srv.close();
  }
});
