// library-cache path helpers + directory primitives (Phase 2c, spec §4.4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CACHE_ROOT,
  absoluteCachePath,
  ensureEmptyCache,
  relativeCachePath,
  removeCache,
  resolveCachePath,
  sanitiseRef,
} from '../../src/blueprint/library-cache.js';
import { isRcfError } from '../../src/core/errors/index.js';

test('CACHE_ROOT is rcf/.blueprint-libraries so a fresh clone keeps the tree self-contained', () => {
  assert.equal(CACHE_ROOT, 'rcf/.blueprint-libraries');
});

test('relativeCachePath composes <root>/<prefix>/<ref> with forward slashes', () => {
  assert.equal(relativeCachePath('wsd', '1.2.0'), 'rcf/.blueprint-libraries/wsd/1.2.0');
});

test('absoluteCachePath joins against the project root', () => {
  const projectRoot = '/tmp/proj';
  assert.equal(
    absoluteCachePath(projectRoot, 'wsd', '1.2.0'),
    join(projectRoot, 'rcf/.blueprint-libraries', 'wsd', '1.2.0'),
  );
});

test('sanitiseRef collapses path-hostile characters', () => {
  assert.equal(sanitiseRef('1.2.0'), '1.2.0');
  assert.equal(sanitiseRef('v1.0/rc1'), 'v1.0-rc1');
  assert.equal(sanitiseRef('with:colon'), 'with-colon');
});

test('resolveCachePath returns absolute cachePath verbatim; joins relative under projectRoot', () => {
  assert.equal(resolveCachePath('/tmp/proj', '/abs/local/path'), '/abs/local/path');
  assert.equal(resolveCachePath('/tmp/proj', 'rcf/.blueprint-libraries/wsd/1.2.0'), '/tmp/proj/rcf/.blueprint-libraries/wsd/1.2.0');
});

test('ensureEmptyCache creates a fresh directory when the path does not exist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-cache-'));
  const target = join(root, 'nested', 'wsd', '1.2.0');
  const err = await ensureEmptyCache(target);
  assert.equal(err, null);
  assert.equal(existsSync(target), true);
});

test('ensureEmptyCache refuses when a non-empty directory already exists at the path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-cache-'));
  const target = join(root, 'existing');
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'library.json'), '{}', 'utf8');
  const err = await ensureEmptyCache(target);
  assert.equal(isRcfError(err), true);
  assert.match(err.message, /already exists/);
});

test('ensureEmptyCache with replace: true wipes the pre-existing tree first', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-cache-'));
  const target = join(root, 'existing');
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'stale.txt'), 'x', 'utf8');
  const err = await ensureEmptyCache(target, { replace: true });
  assert.equal(err, null);
  assert.equal(existsSync(join(target, 'stale.txt')), false);
});

test('removeCache is a no-op on a missing path (idempotent)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-cache-'));
  const target = join(root, 'ghost');
  const err = await removeCache(target);
  assert.equal(err, null);
  assert.equal(existsSync(target), false);
});

test('removeCache wipes an existing tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-cache-'));
  const target = join(root, 'cache');
  await mkdir(join(target, 'inner'), { recursive: true });
  await writeFile(join(target, 'inner', 'file.txt'), 'x', 'utf8');
  const err = await removeCache(target);
  assert.equal(err, null);
  assert.equal(existsSync(target), false);
  // Confirm the readFile probe would definitely fail post-remove.
  await assert.rejects(() => readFile(join(target, 'inner', 'file.txt'), 'utf8'));
});
