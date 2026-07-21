// Guidance-pack link check (Phase 7.5 §D11.2). Relative links resolve
// on disk; the canonical stravica.ai footers match the manifest slugs
// slug-for-slug; no other external URL domain appears anywhere in the
// pack (§D3 posture, enforced). Node 24 built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const guidanceDir = fileURLToPath(new URL('../../guidance', import.meta.url));

const CANONICAL_PREFIX = 'https://stravica.ai/rcf-methodology/';
// The three methodology resources carry a canonical footer (§D3);
// harness-template deliberately does not (product surface, not
// methodology reference), and no other pack file does either.
const FOOTER_FILES = ['overview.md', 'document-model.md', 'build-cycle.md'];

async function packFiles() {
  const names = (await readdir(guidanceDir)).filter((n) => n.endsWith('.md'));
  const files = [];
  for (const name of names) {
    files.push({ name, text: await readFile(join(guidanceDir, name), 'utf8') });
  }
  return files;
}

test('every relative link in guidance/*.md resolves on disk', async () => {
  for (const { name, text } of await packFiles()) {
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = m[1];
      if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('#')) continue;
      const onDisk = resolve(guidanceDir, target.split('#')[0]);
      await assert.doesNotReject(access(onDisk), `${name}: relative link '${target}' does not resolve`);
    }
  }
});

test('the three methodology resources carry canonical footers matching their manifest slugs', async () => {
  const manifest = JSON.parse(await readFile(join(guidanceDir, 'manifest.json'), 'utf8'));
  for (const fileName of FOOTER_FILES) {
    const entry = manifest.docs.find((d) => d.file === fileName);
    assert.notEqual(entry, undefined, `${fileName} has no manifest docs entry`);
    const text = await readFile(join(guidanceDir, fileName), 'utf8');
    const urls = [...text.matchAll(/https:\/\/stravica\.ai\/rcf-methodology\/([a-z-]+)/g)];
    assert.equal(urls.length, 1, `${fileName}: expected exactly one canonical URL, found ${urls.length}`);
    assert.equal(urls[0][1], entry.slug, `${fileName}: canonical URL slug '${urls[0][1]}' != manifest slug '${entry.slug}'`);
  }
});

test('no pack file outside the three methodology resources carries a canonical URL', async () => {
  for (const { name, text } of await packFiles()) {
    if (FOOTER_FILES.includes(name)) continue;
    assert.equal(text.includes(CANONICAL_PREFIX), false, `${name}: unexpected canonical URL`);
  }
});

test('no external URL domain other than the canonical stravica.ai references appears in the pack', async () => {
  const files = await packFiles();
  files.push({ name: 'manifest.json', text: await readFile(join(guidanceDir, 'manifest.json'), 'utf8') });
  for (const { name, text } of files) {
    for (const m of text.matchAll(/https?:\/\/[^\s)`"'<>\]]+/g)) {
      assert.equal(
        m[0].startsWith(CANONICAL_PREFIX), true,
        `${name}: external URL '${m[0]}' is outside the canonical set`,
      );
    }
  }
});
