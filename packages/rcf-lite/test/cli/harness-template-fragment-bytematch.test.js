// AC-1.14 — the ```markdown fenced fragment inside
// packages/rcf-lite/guidance/harness-template.md byte-matches the contents
// of packages/rcf-lite/guidance/managed/agent-instructions-block.md.
//
// The regeneration script (scripts/gen-managed-artefacts.mjs) is the
// authority: running it must leave both derived artefacts (harness
// fragment, .hash file) idempotently consistent with the canonical
// source. The test asserts the byte-equal invariant, then re-runs the
// script and re-asserts idempotency (a second run must not change
// either derived artefact).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..', '..');
const CANONICAL = resolve(PACKAGE_ROOT, 'guidance', 'managed', 'agent-instructions-block.md');
const HARNESS_TEMPLATE = resolve(PACKAGE_ROOT, 'guidance', 'harness-template.md');
const HASH_FILE = resolve(PACKAGE_ROOT, 'guidance', 'managed', 'agent-instructions-block.hash');
const SCRIPT = resolve(PACKAGE_ROOT, 'scripts', 'gen-managed-artefacts.mjs');

function extractFencedFragment(templateText) {
  const m = /```markdown\n([\s\S]*?)```/.exec(templateText);
  assert.notEqual(m, null, 'harness-template.md is missing the ```markdown fence');
  return m[1];
}

test('AC-1.14: fenced fragment in harness-template.md byte-matches the canonical managed block', async () => {
  const canonical = await readFile(CANONICAL, 'utf8');
  const template = await readFile(HARNESS_TEMPLATE, 'utf8');
  const fragment = extractFencedFragment(template);
  // Canonical file may or may not end in a trailing newline; the
  // script writes the fragment with exactly one trailing newline before
  // the closing fence. Assert canonical (normalised) equals the
  // fragment (fragment ends in \n before ```).
  const canonicalNormalised = canonical.endsWith('\n') ? canonical : `${canonical}\n`;
  assert.equal(fragment, canonicalNormalised, 'fragment must byte-match canonical block');
});

test('AC-1.14: re-running gen-managed-artefacts.mjs is a no-op on a consistent tree (idempotent)', async () => {
  const beforeHash = await readFile(HASH_FILE, 'utf8');
  const beforeTemplate = await readFile(HARNESS_TEMPLATE, 'utf8');
  await exec(process.execPath, [SCRIPT]);
  const afterHash = await readFile(HASH_FILE, 'utf8');
  const afterTemplate = await readFile(HARNESS_TEMPLATE, 'utf8');
  assert.equal(afterHash, beforeHash, 'hash file changed after a no-op regeneration');
  assert.equal(afterTemplate, beforeTemplate, 'harness-template.md changed after a no-op regeneration');
});
