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
  // The locked inventories (§D3 / §D4, extended in 0.6.0 spec D-6 with
  // the managed/ sub-slug for the canonical CLAUDE.md/AGENTS.md block):
  // nine docs, four argument-free DEFINE / DISCOVERY prompts (REQ-182
  // amended, REQ-188).
  assert.deepEqual(m.docs.map((d) => d.slug), [
    'overview',
    'document-model',
    'build-cycle',
    'harness-template',
    'managed/agent-instructions-block',
    // Track C+D §10 shipped the persona-programme guidance file.
    'persona-programme',
    // REQ-186 (DEFINE step 3 PR 2) shipped the define-intent and
    // define-intake guidance files (spec 2026-10-01 §6).
    'define-intent',
    'define-intake',
    // REQ-188 (DEFINE step 3 PR 3) shipped the discovery-prototypes
    // guidance file (spec 2026-10-01 §5).
    'discovery-prototypes',
  ]);
  assert.deepEqual(
    m.prompts.map((p) => p.name),
    [
      'rcf_execute_build_cycle',
      'rcf_elicit_requirements',
      // REQ-186 (DEFINE step 3 PR 2): two new argument-free prompts.
      'rcf_define_intent',
      'rcf_define_intake',
      // REQ-188 (DEFINE step 3 PR 3): two new argument-free prompts
      // (draft shapes for the engineer, discovery prototype).
      'rcf_define_draft_shapes',
      'rcf_discover_prototype',
      // REQ-175 (DEFINE step 3 PR 7): the litmus harness prompt lands.
      'rcf_define_litmus',
    ],
  );
});

// REQ-182 (US-18202), AC-18202-2: the manifest advertises the four
// argument-free DEFINE / DISCOVERY prompts present on this PR;
// rcf_define_litmus landed in PR 7 and is now also expected.
test('guidance (REQ-182, AC-18202-2): the five argument-free DEFINE / DISCOVERY prompts are present', async () => {
  const m = await manifest();
  const defineAndDiscoveryPrompts = m.prompts.filter((p) =>
    p.name === 'rcf_define_intent' ||
    p.name === 'rcf_define_intake' ||
    p.name === 'rcf_define_draft_shapes' ||
    p.name === 'rcf_discover_prototype' ||
    p.name === 'rcf_define_litmus',
  );
  const names = defineAndDiscoveryPrompts.map((p) => p.name).sort();
  assert.deepEqual(
    names,
    ['rcf_define_draft_shapes', 'rcf_define_intake', 'rcf_define_intent', 'rcf_define_litmus', 'rcf_discover_prototype'],
    'the five DEFINE / DISCOVERY prompts for this PR must be present',
  );
  // Every one is argument-free: the prompt is a static markdown file
  // mapped to a slug in the manifest; the server plumbing serves the
  // file byte-faithfully with no arguments (REQ-182 US-18202 AC-2).
  for (const p of defineAndDiscoveryPrompts) {
    assert.equal(typeof p.file, 'string', `${p.name} must map to a file`);
    assert.match(p.file, /\.md$/, `${p.name}'s file must be markdown (argument-free)`);
  }
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
