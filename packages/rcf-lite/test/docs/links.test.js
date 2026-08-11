// Docs link check (Phase 8 §6.1). Every relative link in README.md +
// docs/*.md resolves on disk; every #anchor names a real heading slug
// in its target file; external URLs are asserted well-formed only (no
// network in CI). Node 24 built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const docsDir = join(repoRoot, 'docs');

async function docFiles() {
  const files = [{ name: 'README.md', path: join(repoRoot, 'README.md') }];
  for (const name of (await readdir(docsDir)).filter((n) => n.endsWith('.md'))) {
    files.push({ name: `docs/${name}`, path: join(docsDir, name) });
  }
  for (const f of files) f.text = await readFile(f.path, 'utf8');
  return files;
}

/** Remove fenced code blocks so pasted output and mermaid fences are not parsed as markdown. */
function stripFences(text) {
  return text.replace(/^```.*$[\s\S]*?^```\s*$/gm, '');
}

function extractLinks(text) {
  return [...stripFences(text).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);
}

/** GitHub-style heading slug: lower-case, drop punctuation, spaces to hyphens. */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

function headingSlugs(text) {
  const slugs = new Set();
  for (const m of stripFences(text).matchAll(/^#{1,6}\s+(.+)$/gm)) {
    slugs.add(slugify(m[1]));
  }
  return slugs;
}

test('the docs set exists: README.md plus the docs/ files', async () => {
  const names = (await docFiles()).map((f) => f.name).sort();
  assert.deepEqual(names, [
    'README.md',
    'docs/README.md',
    // Phase 10 (X2 CodeNode bridge, D19): in-repo docs for the CN layer.
    'docs/code-nodes.md',
    'docs/getting-started.md',
    'docs/how-it-works.md',
    'docs/install.md',
    'docs/why-it-exists.md',
  ]);
});

test('every relative file link in README.md + docs/*.md resolves on disk', async () => {
  for (const { name, path, text } of await docFiles()) {
    for (const link of extractLinks(text)) {
      if (link.startsWith('http://') || link.startsWith('https://') || link.startsWith('#')) continue;
      const onDisk = resolve(dirname(path), link.split('#')[0]);
      await assert.doesNotReject(access(onDisk), `${name}: relative link '${link}' does not resolve`);
    }
  }
});

test('every same-file anchor names a real heading', async () => {
  for (const { name, text } of await docFiles()) {
    const slugs = headingSlugs(text);
    for (const link of extractLinks(text)) {
      if (!link.startsWith('#')) continue;
      assert.equal(slugs.has(link.slice(1)), true, `${name}: anchor '${link}' has no matching heading`);
    }
  }
});

test('every cross-file anchor names a real heading in its target file', async () => {
  const files = await docFiles();
  for (const { name, path, text } of files) {
    for (const link of extractLinks(text)) {
      if (link.startsWith('http://') || link.startsWith('https://') || link.startsWith('#')) continue;
      const [targetRel, anchor] = link.split('#');
      if (!anchor) continue;
      if (!targetRel.endsWith('.md')) continue;
      const targetPath = resolve(dirname(path), targetRel);
      const targetText = await readFile(targetPath, 'utf8');
      assert.equal(
        headingSlugs(targetText).has(anchor), true,
        `${name}: anchor '${link}' has no matching heading in ${targetRel}`,
      );
    }
  }
});

test('every external link is a well-formed http(s) URL (not fetched)', async () => {
  let seen = 0;
  for (const { name, text } of await docFiles()) {
    for (const link of extractLinks(text)) {
      if (!link.startsWith('http://') && !link.startsWith('https://')) continue;
      seen += 1;
      assert.doesNotThrow(() => new URL(link), `${name}: external link '${link}' is not a valid URL`);
    }
  }
  assert.equal(seen > 0, true, 'expected at least one external link across the docs set');
});

test('docs/.gitkeep is gone (the directory has real content)', async () => {
  const names = await readdir(docsDir);
  assert.equal(names.includes('.gitkeep'), false);
});
