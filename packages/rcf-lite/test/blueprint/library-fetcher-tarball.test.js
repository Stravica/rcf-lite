// Tarball fetcher tests (Phase 2c, spec §6.3). No network in the unit
// suite: each test produces a tarball buffer locally and hands the
// fetcher a stub `fetch` that returns it as a Response body.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import {
  createUstarBuffer,
  fetchTarballLibrary,
  parseUstar,
  sha256Hex,
} from '../../src/blueprint/library-fetcher-tarball.js';
import { ensureEmptyCache } from '../../src/blueprint/library-cache.js';
import { isRcfError } from '../../src/core/errors/index.js';

function libraryTarballEntries() {
  return [
    {
      path: 'library.json',
      content: JSON.stringify({
        libraryVersion: 1,
        libraryPrefix: 'wsd',
        displayName: 'WSD library',
        publisher: { id: 'wsd', displayName: 'West Somerset Data' },
        libraryRef: '1.0.0',
        bands: { ac: { start: 50000, end: 59999 } },
        blueprints: [{ slug: 'auth-oauth2', path: 'blueprints/auth-oauth2' }],
      }, null, 2),
    },
    { path: 'blueprints/auth-oauth2/', dir: true },
    { path: 'blueprints/auth-oauth2/contributions/', dir: true },
    {
      path: 'blueprints/auth-oauth2/blueprint.json',
      content: JSON.stringify({ slug: 'auth-oauth2', version: '1.0.0', contributions: [] }, null, 2),
    },
  ];
}

function stubFetch(buffer) {
  return async () => new Response(buffer);
}

test('parseUstar: round-trip - entries survive createUstarBuffer -> parseUstar', () => {
  const buf = createUstarBuffer(libraryTarballEntries());
  const parsed = parseUstar(buf);
  assert.equal(Array.isArray(parsed), true);
  const paths = parsed.map((e) => e.path).sort();
  assert.deepEqual(paths, [
    'blueprints/auth-oauth2/',
    'blueprints/auth-oauth2/blueprint.json',
    'blueprints/auth-oauth2/contributions/',
    'library.json',
  ]);
});

test('parseUstar: refuses absolute-path entries at extraction time', async () => {
  const buf = createUstarBuffer([{ path: 'library.json', content: '{}' }]);
  // Manually flip the first path byte to '/' so extraction refuses.
  const evil = Buffer.from(buf);
  evil.write('/lib.json', 0, 9, 'utf8');
  evil[9] = 0;
  const targetDir = await mkdtemp(join(tmpdir(), 'rcf-tar-target-'));
  await ensureEmptyCache(targetDir, { replace: true });
  const sha = sha256Hex(evil);
  const res = await fetchTarballLibrary({
    url: 'https://example.invalid/x.tar', expectedSha256: sha, targetDir, fetchImpl: stubFetch(evil),
  });
  assert.equal(isRcfError(res), true);
  assert.match(res.message, /absolute path/);
});

test('fetchTarballLibrary: successful extraction with the declared SHA-256 pin', async () => {
  const buf = createUstarBuffer(libraryTarballEntries());
  const sha = sha256Hex(buf);
  const targetDir = await mkdtemp(join(tmpdir(), 'rcf-tar-target-'));
  await ensureEmptyCache(targetDir, { replace: true });
  const res = await fetchTarballLibrary({
    url: 'https://example.invalid/x.tar', expectedSha256: sha, targetDir, fetchImpl: stubFetch(buf),
  });
  assert.equal(isRcfError(res), false, JSON.stringify(res));
  assert.equal(res.tarballSha256, sha);
  assert.equal(existsSync(join(targetDir, 'library.json')), true);
  assert.equal(existsSync(join(targetDir, 'blueprints', 'auth-oauth2', 'blueprint.json')), true);
  const meta = JSON.parse(await readFile(join(targetDir, 'library.json'), 'utf8'));
  assert.equal(meta.libraryPrefix, 'wsd');
});

test('fetchTarballLibrary: SHA-256 mismatch refuses the fetch and writes nothing', async () => {
  const buf = createUstarBuffer(libraryTarballEntries());
  const wrong = 'a'.repeat(64);
  const targetDir = await mkdtemp(join(tmpdir(), 'rcf-tar-target-'));
  await ensureEmptyCache(targetDir, { replace: true });
  const res = await fetchTarballLibrary({
    url: 'https://example.invalid/x.tar', expectedSha256: wrong, targetDir, fetchImpl: stubFetch(buf),
  });
  assert.equal(isRcfError(res), true);
  assert.match(res.message, /SHA-256 mismatch/);
  assert.equal(existsSync(join(targetDir, 'library.json')), false);
});

test('fetchTarballLibrary: gzipped tarball with .tar.gz URL is gunzipped transparently', async () => {
  const buf = createUstarBuffer(libraryTarballEntries());
  const gz = gzipSync(buf);
  const sha = sha256Hex(gz);
  const targetDir = await mkdtemp(join(tmpdir(), 'rcf-tar-target-'));
  await ensureEmptyCache(targetDir, { replace: true });
  const res = await fetchTarballLibrary({
    url: 'https://example.invalid/x.tar.gz', expectedSha256: sha, targetDir, fetchImpl: stubFetch(gz),
  });
  assert.equal(isRcfError(res), false, JSON.stringify(res));
  assert.equal(existsSync(join(targetDir, 'library.json')), true);
});

test('fetchTarballLibrary: single top-level directory is unwrapped so library.json sits at cache root', async () => {
  const wrapped = [
    { path: 'package/', dir: true },
    { path: 'package/library.json', content: JSON.stringify({
      libraryVersion: 1,
      libraryPrefix: 'wsd',
      displayName: 'WSD library',
      publisher: { id: 'wsd', displayName: 'West Somerset Data' },
      libraryRef: '1.0.0',
      bands: { ac: { start: 50000, end: 59999 } },
      blueprints: [{ slug: 'auth-oauth2', path: 'blueprints/auth-oauth2' }],
    }, null, 2) },
    { path: 'package/blueprints/', dir: true },
    { path: 'package/blueprints/auth-oauth2/', dir: true },
    { path: 'package/blueprints/auth-oauth2/blueprint.json', content: JSON.stringify({ slug: 'auth-oauth2', version: '1.0.0', contributions: [] }, null, 2) },
  ];
  const buf = createUstarBuffer(wrapped);
  const sha = sha256Hex(buf);
  const targetDir = await mkdtemp(join(tmpdir(), 'rcf-tar-target-'));
  await ensureEmptyCache(targetDir, { replace: true });
  const res = await fetchTarballLibrary({
    url: 'https://example.invalid/x.tar', expectedSha256: sha, targetDir, fetchImpl: stubFetch(buf),
  });
  assert.equal(isRcfError(res), false, JSON.stringify(res));
  assert.equal(existsSync(join(targetDir, 'library.json')), true);
  assert.equal(existsSync(join(targetDir, 'package', 'library.json')), false);
});

test('fetchTarballLibrary: expectedSha256 in the wrong shape refuses before fetch', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'rcf-tar-target-'));
  const res = await fetchTarballLibrary({
    url: 'https://example.invalid/x.tar', expectedSha256: 'not-hex', targetDir, fetchImpl: async () => new Response(Buffer.alloc(0)),
  });
  assert.equal(isRcfError(res), true);
  assert.match(res.message, /64 hex chars/);
});

test('fetchTarballLibrary: HTTP non-2xx refuses cleanly', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'rcf-tar-target-'));
  await ensureEmptyCache(targetDir, { replace: true });
  const res = await fetchTarballLibrary({
    url: 'https://example.invalid/x.tar',
    expectedSha256: 'a'.repeat(64),
    targetDir,
    fetchImpl: async () => new Response('nope', { status: 404 }),
  });
  assert.equal(isRcfError(res), true);
  assert.match(res.message, /HTTP 404/);
});
