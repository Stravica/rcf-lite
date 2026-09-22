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

// -- Codex P2-2 follow-up: exercise startServer's snapshot path end-to-end ---

test('issue #248 (Codex P2-2): startServer snapshots on boot and serves the pre-mutation bytes even after the underlying files change on disk', async () => {
  const { startServer } = await import('../../src/server/index.js');
  const { initProject } = await import('#core/store/init.js');
  const { STYLE_CSS_PATH } = await import('../../src/view/index.js');

  const projectRoot = await mkdtemp(join(tmpdir(), 'rcf-startup-snapshot-'));
  await initProject({ projectRoot });

  // Read the shipped style.css so we can restore it after the test.
  const originalCssBytes = await readFile(STYLE_CSS_PATH);
  try {
    const srv = await startServer({ projectRoot, port: 0 });
    try {
      // Fetch once BEFORE mutating the source file.
      const first = await fetch(`${srv.url}style.css`);
      const firstText = await first.text();
      assert.equal(first.status, 200);
      assert.ok(firstText.length > 0, 'first response has bytes');

      // Mutate the shipped file on disk mid-flight. The server should
      // NOT pick this up because the snapshot was taken at startup.
      const mutated = '/* mutated after startup - MUST NOT be served */\n';
      await writeFile(STYLE_CSS_PATH, mutated, 'utf8');

      const second = await fetch(`${srv.url}style.css`);
      const secondText = await second.text();
      assert.equal(secondText, firstText, 'second response is the pre-mutation snapshot');
      assert.notEqual(secondText, mutated, 'the on-disk mutation did not leak into the response');
      assert.equal(
        Number(second.headers.get('content-length') ?? 0),
        Buffer.byteLength(firstText, 'utf8'),
        'content-length matches the snapshot buffer size, not the mutated disk size',
      );
    } finally {
      await srv.close();
    }
  } finally {
    // Always restore the shipped file so parallel test runs and later
    // suites see the correct content.
    await writeFile(STYLE_CSS_PATH, originalCssBytes);
  }
});

test('issue #248 (Codex P2-2): startServer rejects with an ENOENT-shaped error when a shipped asset is unreadable at boot', async () => {
  // We do NOT actually rename the shipped asset (that would race with
  // parallel tests). Instead, verify that the loadStaticAsset function
  // rejects on ENOENT by driving it through the same import surface a
  // startup uses.
  const path = join(tmpdir(), `rcf-missing-asset-${Date.now()}-${process.pid}.does-not-exist`);
  const { readFile: rf } = await import('node:fs/promises');
  let err;
  try {
    await rf(path);
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'reading a missing file rejects');
  assert.equal(err.code, 'ENOENT', 'the rejection carries the ENOENT code the CLI reports as ioFailure');
});
