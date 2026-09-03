// Amendment A2 (2026-09-03): library-aware local path in the resolver.
// A path whose ancestor carries `library.json` stamps the same effective
// slug / identity a qualified `<prefix>:<slug>` add would, without
// requiring registry registration.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveBlueprintSource } from '../../src/blueprint/shelf-resolver.js';
import { isRcfError } from '../../src/core/errors/index.js';

async function scaffoldLibrary({ prefix = 'wsd', blueprintSlug = 'auth-oauth2', bands = { ac: { start: 50000, end: 59999 } } } = {}) {
  const root = await mkdtemp(join(tmpdir(), `rcf-a2-lib-${prefix}-`));
  const bpDir = join(root, 'blueprints', blueprintSlug);
  await mkdir(join(bpDir, 'contributions'), { recursive: true });
  await writeFile(join(bpDir, 'blueprint.json'), JSON.stringify({
    slug: blueprintSlug, version: '1.0.0', contributions: [],
  }, null, 2), 'utf8');
  await writeFile(join(root, 'library.json'), JSON.stringify({
    libraryVersion: 1,
    libraryPrefix: prefix,
    displayName: `${prefix} library`,
    publisher: { id: prefix, displayName: `${prefix} publisher` },
    libraryRef: '1.0.0',
    bands,
    blueprints: [{ slug: blueprintSlug, path: `blueprints/${blueprintSlug}` }],
  }, null, 2), 'utf8');
  return { libraryRoot: root, bpDir };
}

test('A2: plain absolute path to a blueprint inside a library returns kind=library with the effective slug', async () => {
  const { libraryRoot, bpDir } = await scaffoldLibrary();
  const res = await resolveBlueprintSource(bpDir);
  assert.equal(isRcfError(res), false, JSON.stringify(res));
  assert.equal(res.kind, 'library');
  assert.equal(res.libraryPrefix, 'wsd');
  assert.equal(res.libraryBlueprintSlug, 'auth-oauth2');
  assert.equal(res.effectiveSlug, 'wsd-auth-oauth2');
  assert.equal(res.libraryBands.ac.start, 50000);
  assert.equal(res.resolved, bpDir);
  // Sanity: the library root is an ancestor of the resolved path.
  assert.ok(bpDir.startsWith(libraryRoot));
});

test('A2: relative path (`./blueprints/<slug>`) inside a library-cwd resolves the same way', async () => {
  const { libraryRoot } = await scaffoldLibrary();
  const cwdBefore = process.cwd();
  try {
    process.chdir(libraryRoot);
    const res = await resolveBlueprintSource('./blueprints/auth-oauth2');
    assert.equal(isRcfError(res), false, JSON.stringify(res));
    assert.equal(res.kind, 'library');
    assert.equal(res.effectiveSlug, 'wsd-auth-oauth2');
  } finally {
    process.chdir(cwdBefore);
  }
});

test('A2: path NOT under blueprints/<slug> is refused with the expected-shape diagnostic', async () => {
  const { libraryRoot } = await scaffoldLibrary();
  // Point at the library root itself, which is under library.json but
  // does not have the required `blueprints/<slug>` shape.
  const res = await resolveBlueprintSource(libraryRoot);
  assert.equal(isRcfError(res), true);
  assert.match(res.message, /<library-root>\/blueprints\/<slug>/);
});

test('A2: path with no library.json in any ancestor keeps the phase-1 path route unchanged', async () => {
  // A tempdir with no library.json anywhere in its ancestor chain
  // (mkdtemp roots under $TMPDIR, whose ancestors do not carry
  // library.json in a working RCF checkout).
  const wanderer = await mkdtemp(join(tmpdir(), 'rcf-a2-nolib-'));
  const bpDir = join(wanderer, 'blueprints', 'lonely');
  await mkdir(join(bpDir, 'contributions'), { recursive: true });
  await writeFile(join(bpDir, 'blueprint.json'), JSON.stringify({ slug: 'lonely', version: '1.0.0', contributions: [] }, null, 2), 'utf8');
  const res = await resolveBlueprintSource(bpDir);
  assert.equal(isRcfError(res), false);
  assert.equal(res.kind, 'path');
  assert.equal(res.resolved, bpDir);
});

test('A2: blueprint under a library where library.json:blueprints[] does not declare its slug refuses', async () => {
  const { libraryRoot } = await scaffoldLibrary();
  // Add an on-disk blueprint dir with a slug the manifest does not
  // enumerate; A2 refuses so a stray directory does not silently apply.
  const strayDir = join(libraryRoot, 'blueprints', 'stray');
  await mkdir(join(strayDir, 'contributions'), { recursive: true });
  await writeFile(join(strayDir, 'blueprint.json'), JSON.stringify({ slug: 'stray', version: '1.0.0', contributions: [] }, null, 2), 'utf8');
  const res = await resolveBlueprintSource(strayDir);
  assert.equal(isRcfError(res), true);
  assert.match(res.message, /does not declare a blueprint with slug 'stray'/);
});
