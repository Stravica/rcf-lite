// Issue #248 (0.28.3): shipped static assets (style.css, mermaid.min.js,
// live-client.js) are snapshotted at server startup and served from
// memory. A file mutation on disk during the server's lifetime cannot
// change what the router returns.
//
// The regression trigger: on 2026-09-22 the Product Map preview page
// rendered unstyled after a checkout branch switch while `rcf audit
// view` was running. The HTML was rendered from a pre-switch walk,
// but /style.css was `readFile`-d per request and returned the new
// branch's bytes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRouter } from '../../src/server/routes.js';

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

async function bindServer(handler) {
  const server = createServer(handler);
  const port = await freePort();
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${port}/`;
  return {
    url,
    close: () => new Promise((r) => server.close(r)),
  };
}

test('issue #248: a snapshotted styleAsset is served from memory even after the source file mutates on disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-static-snapshot-'));
  const stylePath = join(dir, 'style.css');
  const original = 'body { color: red; /* v1 */ }\n';
  await writeFile(stylePath, original, 'utf8');

  const buf = Buffer.from(original, 'utf8');
  const styleAsset = { buffer: buf, size: buf.length, contentType: 'text/css; charset=utf-8' };

  const router = createRouter({
    currentState: () => ({ fullPageHtml: '<html>ok</html>', contentHtml: '', version: 1 }),
    sse: { handle: () => {} },
    styleAsset,
    mermaidAsset: null,
    liveClientAsset: null,
    // Note: no fallback paths passed, so the router MUST use the snapshot.
  });

  const srv = await bindServer(router);
  try {
    // First request: original bytes.
    const first = await fetch(`${srv.url}style.css`);
    assert.equal(first.status, 200);
    const firstText = await first.text();
    assert.equal(firstText, original, 'first response is the snapshotted content');
    assert.match(first.headers.get('content-type') ?? '', /text\/css/);

    // Mutate the on-disk file mid-flight. This is the branch-switch
    // simulation: the file on disk now says something different.
    const mutated = 'body { color: blue; /* v2 - simulates a branch switch */ }\n';
    await writeFile(stylePath, mutated, 'utf8');
    const onDisk = await readFile(stylePath, 'utf8');
    assert.equal(onDisk, mutated, 'sanity: disk file did mutate');

    // Second request: STILL the original bytes because the router
    // serves from the snapshot, not the disk.
    const second = await fetch(`${srv.url}style.css`);
    const secondText = await second.text();
    assert.equal(secondText, original, 'second response is still the snapshotted content');
    assert.notEqual(secondText, mutated, 'the on-disk mutation did not leak into the response');
  } finally {
    await srv.close();
  }
});

test('issue #248: without an asset AND without a fallback path, the router returns 404 for /style.css (no silent disk read)', async () => {
  const router = createRouter({
    currentState: () => null,
    sse: { handle: () => {} },
    // No assets, no fallback paths.
  });
  const srv = await bindServer(router);
  try {
    const res = await fetch(`${srv.url}style.css`);
    assert.equal(res.status, 404);
  } finally {
    await srv.close();
  }
});

test('issue #248: the legacy fallback path is still honoured when no snapshot is provided (backwards compatibility)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-static-fallback-'));
  const stylePath = join(dir, 'style.css');
  await writeFile(stylePath, '/* fallback path */\n', 'utf8');

  const router = createRouter({
    currentState: () => null,
    sse: { handle: () => {} },
    stylePath,
  });

  const srv = await bindServer(router);
  try {
    const res = await fetch(`${srv.url}style.css`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /fallback path/);
  } finally {
    await srv.close();
  }
});
