// 0.13.0 G1: bare-slug and @stock/<slug> resolution against the packaged
// shelf, plus reservation of other @<library>/<slug> forms for the
// phase-2 external-libraries mechanism.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveBlueprintSource } from '../../src/blueprint/shelf-resolver.js';
import { isRcfError } from '../../src/core/errors/index.js';

async function scaffoldShelf(slugs) {
  const shelf = await mkdtemp(join(tmpdir(), 'rcf-shelf-'));
  for (const slug of slugs) {
    const dir = join(shelf, slug);
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, 'contributions'), { recursive: true });
    await writeFile(join(dir, 'blueprint.json'), JSON.stringify({ slug, version: '1.0.0', contributions: [] }, null, 2), 'utf8');
  }
  return shelf;
}

test('bare kebab slug resolves against the packaged shelf', async () => {
  const shelf = await scaffoldShelf(['deploy-cloudflare-workers', 'application-spa']);
  const res = await resolveBlueprintSource('deploy-cloudflare-workers', { packagedShelf: shelf });
  assert.equal(isRcfError(res), false);
  assert.equal(res.kind, 'shelf');
  assert.equal(res.slug, 'deploy-cloudflare-workers');
  assert.equal(res.original, 'deploy-cloudflare-workers');
  assert.equal(res.resolved, join(shelf, 'deploy-cloudflare-workers'));
});

test('@stock/<slug> qualifier resolves against the packaged shelf', async () => {
  const shelf = await scaffoldShelf(['observability-essentials']);
  const res = await resolveBlueprintSource('@stock/observability-essentials', { packagedShelf: shelf });
  assert.equal(isRcfError(res), false);
  assert.equal(res.kind, 'shelf');
  assert.equal(res.slug, 'observability-essentials');
  assert.equal(res.original, '@stock/observability-essentials');
  assert.equal(res.resolved, join(shelf, 'observability-essentials'));
});

test('other @<library>/<slug> (slash form) is refused and points at the colon form', async () => {
  // Phase 2b landed the ratified qualified surface (spec §9.2: colon).
  // The slash form is a reserved non-canonical shape; the resolver
  // refuses it and names the correct invocation so the operator sees
  // both the ratified reference form and the register-first step.
  const shelf = await scaffoldShelf(['application-spa']);
  const res = await resolveBlueprintSource('@dave/local-thing', { packagedShelf: shelf });
  assert.equal(isRcfError(res), true);
  assert.equal(res.kind, 'usage');
  assert.match(res.message, /slash-qualified/);
  assert.match(res.message, /colon form 'dave:local-thing'/);
  assert.match(res.message, /rcf define blueprint library add/);
  assert.match(res.message, /@stock\/<slug>/);
});

test('local relative path passes through unchanged', async () => {
  const shelf = await scaffoldShelf(['application-spa']);
  const res = await resolveBlueprintSource('./blueprints/mine', { packagedShelf: shelf });
  assert.equal(isRcfError(res), false);
  assert.equal(res.kind, 'path');
  assert.equal(res.original, './blueprints/mine');
  // Resolved should be an absolute expansion of the relative path.
  assert.equal(res.resolved.endsWith('/blueprints/mine'), true);
});

test('absolute path passes through unchanged', async () => {
  const shelf = await scaffoldShelf(['application-spa']);
  const res = await resolveBlueprintSource('/tmp/some/blueprint', { packagedShelf: shelf });
  assert.equal(isRcfError(res), false);
  assert.equal(res.kind, 'path');
  assert.equal(res.resolved, '/tmp/some/blueprint');
});

test('bare slug that is not on the shelf lists known shelf slugs in the miss message', async () => {
  const shelf = await scaffoldShelf(['deploy-cloudflare-workers', 'application-spa']);
  const res = await resolveBlueprintSource('does-not-exist', { packagedShelf: shelf });
  assert.equal(isRcfError(res), true);
  assert.equal(res.kind, 'usage');
  assert.match(res.message, /did not match a packaged shelf entry/);
  assert.match(res.message, /application-spa/);
  assert.match(res.message, /deploy-cloudflare-workers/);
});

test('nonsense token (not a slug, not a path) falls through as a path', async () => {
  // We keep this pass-through so the loader emits the familiar
  // "no blueprint.json found" error against the exact string the
  // operator typed. Failure locus stays close to the input.
  const shelf = await scaffoldShelf(['application-spa']);
  const res = await resolveBlueprintSource('NotAKebab_Slug', { packagedShelf: shelf });
  assert.equal(isRcfError(res), false);
  assert.equal(res.kind, 'path');
  assert.equal(res.original, 'NotAKebab_Slug');
});
