// End-to-end tests for src/blueprint/standards.js. Covers AC-1003-1
// (add writes a manifest entry), AC-1003-2 (in-repo referenced in
// place), AC-1003-3 (out-of-root copied), AC-1003-4 (validates
// against the shipped schema).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject, walkTree } from '#core/store';
import { registerStandardsPack } from '../../src/blueprint/standards.js';

async function scaffoldProject() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-standards-'));
  const init = await initProject({ projectRoot: root, projectName: 'ST' });
  assert.equal(init.kind, undefined);
  return root;
}

test('registerStandardsPack: in-repo source is referenced in place (AC-1003-1, AC-1003-2)', async () => {
  const root = await scaffoldProject();
  await mkdir(join(root, 'docs', 'standards', 'wsd-naming'), { recursive: true });
  await writeFile(join(root, 'docs', 'standards', 'wsd-naming', 'README.md'), '# WSD naming', 'utf8');
  const { tree } = await walkTree({ projectRoot: root });
  const result = await registerStandardsPack({
    projectRoot: root, tree,
    sourcePath: join(root, 'docs', 'standards', 'wsd-naming'),
    slug: 'wsd-naming',
    tags: ['naming', 'conventions'],
    testsProvidedBy: 'agent',
    provenance: 'corporate',
  });
  assert.equal(result.registered, true);
  assert.equal(result.copied, false);
  const manifest = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifest.standards.length, 1);
  assert.equal(manifest.standards[0].id, 'std-wsd-naming');
  assert.equal(manifest.standards[0].slug, 'wsd-naming');
  assert.equal(manifest.standards[0].sourcePath, 'docs/standards/wsd-naming');
  assert.equal(manifest.standards[0].copyPath, undefined);
  // Manifest validates (AC-1003-4).
  const { errors } = await walkTree({ projectRoot: root });
  assert.equal(errors.length, 0, `manifest should validate; errors: ${JSON.stringify(errors)}`);
});

test('registerStandardsPack: out-of-root source is copied into rcf/standards/<slug>/ (AC-1003-3)', async () => {
  const root = await scaffoldProject();
  const outsideRoot = await mkdtemp(join(tmpdir(), 'ext-standards-'));
  await writeFile(join(outsideRoot, 'PATTERNS.md'), '# Baseline', 'utf8');
  const { tree } = await walkTree({ projectRoot: root });
  const result = await registerStandardsPack({
    projectRoot: root, tree,
    sourcePath: outsideRoot,
    slug: 'security-baseline',
    tags: ['security'],
    testsProvidedBy: 'standard',
    provenance: 'personal',
  });
  assert.equal(result.registered, true);
  assert.equal(result.copied, true);
  assert.equal(result.copyPath, 'rcf/standards/security-baseline');
  // Mirror on disk.
  await stat(join(root, 'rcf', 'standards', 'security-baseline', 'PATTERNS.md'));
  const manifest = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  const entry = manifest.standards.find((s) => s.slug === 'security-baseline');
  assert.ok(entry);
  assert.equal(entry.copyPath, 'rcf/standards/security-baseline');
  assert.equal(entry.sourcePath, outsideRoot);
});

test('registerStandardsPack: re-registering the same pack is idempotent', async () => {
  const root = await scaffoldProject();
  await mkdir(join(root, 'docs', 'standards', 'wsd-naming'), { recursive: true });
  await writeFile(join(root, 'docs', 'standards', 'wsd-naming', 'x.md'), 'x', 'utf8');
  const opts = {
    projectRoot: root,
    sourcePath: join(root, 'docs', 'standards', 'wsd-naming'),
    slug: 'wsd-naming', tags: ['naming'],
    testsProvidedBy: 'agent', provenance: 'corporate',
  };
  const a = await registerStandardsPack({ ...opts, tree: (await walkTree({ projectRoot: root })).tree });
  assert.equal(a.registered, true);
  const b = await registerStandardsPack({ ...opts, tree: (await walkTree({ projectRoot: root })).tree });
  assert.equal(b.registered, false);
  assert.equal(b.alreadyRegistered, true);
  const manifest = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifest.standards.length, 1);
});

test('registerStandardsPack: byte-identical re-registration short-circuits before the manifest is rewritten (w-2026-08-19-004)', async () => {
  // Mirrors applyBlueprint's alreadyApplied fast-path: a duplicate call
  // MUST leave the manifest file byte-identical (and its mtime
  // untouched) so downstream watchers do not spuriously re-load.
  const root = await scaffoldProject();
  await mkdir(join(root, 'docs', 'standards', 'wsd-naming'), { recursive: true });
  await writeFile(join(root, 'docs', 'standards', 'wsd-naming', 'x.md'), 'x', 'utf8');
  const opts = {
    projectRoot: root,
    sourcePath: join(root, 'docs', 'standards', 'wsd-naming'),
    slug: 'wsd-naming', tags: ['naming'],
    testsProvidedBy: 'agent', provenance: 'corporate',
  };
  await registerStandardsPack({ ...opts, tree: (await walkTree({ projectRoot: root })).tree });
  const manifestPath = join(root, 'rcf', 'manifest.json');
  const bytesBefore = await readFile(manifestPath, 'utf8');
  const mtimeBefore = (await stat(manifestPath)).mtimeMs;
  // Sleep past filesystem mtime resolution so a rewrite would move mtime.
  await new Promise((r) => setTimeout(r, 25));
  const result = await registerStandardsPack({ ...opts, tree: (await walkTree({ projectRoot: root })).tree });
  assert.equal(result.registered, false);
  assert.equal(result.alreadyRegistered, true);
  const bytesAfter = await readFile(manifestPath, 'utf8');
  const mtimeAfter = (await stat(manifestPath)).mtimeMs;
  assert.equal(bytesAfter, bytesBefore, 'byte-identical re-registration must not rewrite the manifest');
  assert.equal(mtimeAfter, mtimeBefore, 'byte-identical re-registration must not touch the manifest mtime');
});
