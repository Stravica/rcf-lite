// FBS-183 slice 4 unit tests for src/feedback/gh.js seam contract.
//
// The RCF_FEEDBACK_GH_MODULE seam is the entire testable surface for
// slice 4's gh work; every submit AC exercises it end-to-end via the
// CLI. These tests pin the seam mechanics directly:
//
//   - loadGhAdapter returns the default adapter when the env var is
//     absent, and the overriding module when it is set.
//   - The default adapter never writes GH_TOKEN or GITHUB_TOKEN into
//     process.env (design 3.1 / AC-15901-2 belt-and-braces).
//   - A partial override module falls back to defaults for unset
//     names so a slim fake does not need to stub every function.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadGhAdapter, DEFAULT_ADAPTER } from '../../src/feedback/gh.js';

test('loadGhAdapter returns the default adapter when RCF_FEEDBACK_GH_MODULE is absent', async () => {
  const env = { ...process.env };
  delete env.RCF_FEEDBACK_GH_MODULE;
  const adapter = await loadGhAdapter(env);
  assert.equal(typeof adapter.ghOnPath, 'function');
  assert.equal(typeof adapter.ghAuthStatus, 'function');
  assert.equal(typeof adapter.ghLabelList, 'function');
  assert.equal(typeof adapter.ghRepoView, 'function');
  assert.equal(typeof adapter.ghIssueSearch, 'function');
  assert.equal(typeof adapter.ghIssueCreate, 'function');
  assert.equal(typeof adapter.ghIssueComment, 'function');
  assert.equal(typeof adapter.ghLabelCreate, 'function');
  // The default adapter is the frozen export.
  assert.ok(Object.isFrozen(DEFAULT_ADAPTER));
});

test('loadGhAdapter honours the RCF_FEEDBACK_GH_MODULE override and returns its exports', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-gh-seam-'));
  const overridePath = join(tmp, 'fake.mjs');
  const src = [
    'export const seen = [];',
    'export async function ghOnPath() { seen.push("onPath"); return { ok: true, value: { present: true } }; }',
    // Deliberately omit ghAuthStatus so we can check the fall-through
    // to the default.
    'export async function ghIssueCreate(opts) { seen.push({ create: opts }); return { ok: true, value: { url: opts.url ?? "u", number: 1 } }; }',
  ].join('\n');
  await writeFile(overridePath, src, 'utf8');
  const adapter = await loadGhAdapter({ RCF_FEEDBACK_GH_MODULE: overridePath });
  const r = await adapter.ghOnPath();
  assert.equal(r.ok, true);
  assert.equal(r.value.present, true);
  // ghAuthStatus was not overridden; the loader falls back to the
  // default implementation (which would spawn gh if we called it).
  assert.equal(typeof adapter.ghAuthStatus, 'function');
});

test('the CLI process env has neither GH_TOKEN nor GITHUB_TOKEN synthesised by the seam', async () => {
  // The seam is a passive loader; asserting it does not mutate the
  // env is enough to lock in the design 3.1 contract at this layer.
  const before = { gh: process.env.GH_TOKEN, github: process.env.GITHUB_TOKEN };
  await loadGhAdapter(process.env);
  const after = { gh: process.env.GH_TOKEN, github: process.env.GITHUB_TOKEN };
  assert.equal(after.gh, before.gh);
  assert.equal(after.github, before.github);
});
