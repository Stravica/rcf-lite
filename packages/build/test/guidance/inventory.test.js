// Guidance-pack inventory check (Phase 7.5 §D11.3). The manifest is
// the machine channel map Phase 7's plumbing reads (§D10); this test
// keeps manifest, filesystem and spec inventories mechanically agreed:
// every mapped file exists, slugs equal filename-minus-extension,
// prompt names follow the rcf_ convention, and no pack file is
// orphaned. Node 24 built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const guidanceDir = fileURLToPath(new URL('../../guidance', import.meta.url));

async function manifest() {
  return JSON.parse(await readFile(join(guidanceDir, 'manifest.json'), 'utf8'));
}

test('manifest parses with docs and prompts arrays of the specced shape', async () => {
  const m = await manifest();
  assert.equal(Array.isArray(m.docs), true);
  assert.equal(Array.isArray(m.prompts), true);
  for (const d of m.docs) {
    assert.equal(typeof d.slug, 'string');
    assert.equal(typeof d.file, 'string');
    assert.equal(typeof d.title, 'string');
  }
  for (const p of m.prompts) {
    assert.equal(typeof p.name, 'string');
    assert.equal(typeof p.file, 'string');
    assert.equal(typeof p.description, 'string');
  }
  // The locked inventories (§D3 / §D4): four docs, two prompts.
  assert.deepEqual(m.docs.map((d) => d.slug), ['overview', 'document-model', 'build-cycle', 'harness-template']);
  assert.deepEqual(m.prompts.map((p) => p.name), ['rcf_execute_build_cycle', 'rcf_elicit_requirements']);
});

test('every file the manifest maps exists in guidance/', async () => {
  const m = await manifest();
  for (const entry of [...m.docs, ...m.prompts]) {
    await assert.doesNotReject(access(join(guidanceDir, entry.file)), `${entry.file} is mapped but missing`);
  }
});

test('docs slugs equal filename minus extension', async () => {
  const m = await manifest();
  for (const d of m.docs) {
    assert.equal(d.slug, d.file.replace(/\.md$/, ''), `${d.file}: slug '${d.slug}' is not filename-minus-extension`);
  }
});

test('prompt names match the rcf_ naming convention', async () => {
  const m = await manifest();
  for (const p of m.prompts) {
    assert.match(p.name, /^rcf_[a-z_]+$/, `${p.name} breaks the prompt naming convention`);
  }
});

test('no pack file is orphaned: every .md except README.md appears in the manifest', async () => {
  const m = await manifest();
  const mapped = new Set([...m.docs, ...m.prompts].map((e) => e.file));
  const onDisk = (await readdir(guidanceDir)).filter((n) => n.endsWith('.md') && n !== 'README.md');
  for (const name of onDisk) {
    assert.equal(mapped.has(name), true, `${name} exists in guidance/ but the manifest does not map it`);
  }
});
