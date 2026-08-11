#!/usr/bin/env node
// Build-time regenerator for managed canonical artefacts (0.6.0 spec
// §11, D-2 / finding G). Runs from `packages/rcf-lite/scripts/` and reads
// `packages/rcf-lite/guidance/managed/agent-instructions-block.md` as the
// single canonical source, then produces two derived artefacts:
//
//   1. `packages/rcf-lite/guidance/managed/agent-instructions-block.hash`
//      SHA-256 of the block's inner content (trimmed), one line, no
//      trailing whitespace. `rcf doctor`'s stale-hash check reads this.
//
//   2. `packages/rcf-lite/guidance/harness-template.md`
//      The ```markdown fenced fragment inside this file is replaced
//      byte-for-byte with the canonical block. The prose OUTSIDE the
//      fence (the "What this is" preamble, the "Customisation points"
//      trailer, etc.) is preserved verbatim - it is the manual-paste-in
//      documentation, not the block itself.
//
// AC-1.14 asserts the byte-match invariant: after this script runs, the
// fenced fragment inside harness-template.md is byte-identical to the
// managed block. The script is idempotent: running it twice on a
// consistent tree writes nothing on the second run (both artefacts are
// compared before overwriting so mtime does not churn).
//
// Wired into the release via `scripts.prepublishOnly` in
// `packages/rcf-lite/package.json` so a release cannot ship stale artefacts.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..');
const CANONICAL_PATH = resolve(PACKAGE_ROOT, 'guidance', 'managed', 'agent-instructions-block.md');
const HASH_PATH = resolve(PACKAGE_ROOT, 'guidance', 'managed', 'agent-instructions-block.hash');
const HARNESS_TEMPLATE_PATH = resolve(PACKAGE_ROOT, 'guidance', 'harness-template.md');

/**
 * SHA-256 of the trimmed canonical text. The trim matches doctor's
 * stale-hash primitive (inner content, whitespace-trimmed) so operator
 * whitespace around marker lines does not trip staleness.
 *
 * @param {string} text
 * @returns {string}
 */
export function hashOf(text) {
  return createHash('sha256').update(text.trim(), 'utf8').digest('hex');
}

/**
 * Splice `fragment` into the first ```markdown fence in `template`,
 * preserving every byte of prose outside the fence. Returns the new
 * template text. Throws if the fence is missing (indicates a broken
 * source tree that must be repaired by hand, not silently).
 *
 * @param {string} template
 * @param {string} fragment
 * @returns {string}
 */
export function spliceFragment(template, fragment) {
  const re = /(```markdown\n)([\s\S]*?)(```)/;
  const m = re.exec(template);
  if (!m) {
    throw new Error(`no \`\`\`markdown fragment fence in ${HARNESS_TEMPLATE_PATH} (cannot regenerate)`);
  }
  const trimmed = fragment.endsWith('\n') ? fragment : `${fragment}\n`;
  return template.replace(re, `$1${trimmed}$3`);
}

async function writeIfChanged(path, next) {
  let current = null;
  try {
    current = await readFile(path, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
  }
  if (current === next) return { path, changed: false };
  await writeFile(path, next, 'utf8');
  return { path, changed: true };
}

async function main() {
  const canonical = await readFile(CANONICAL_PATH, 'utf8');
  const hash = hashOf(canonical);
  const template = await readFile(HARNESS_TEMPLATE_PATH, 'utf8');
  const nextTemplate = spliceFragment(template, canonical);

  const results = [];
  results.push(await writeIfChanged(HASH_PATH, `${hash}\n`));
  results.push(await writeIfChanged(HARNESS_TEMPLATE_PATH, nextTemplate));

  for (const r of results) {
    process.stdout.write(`${r.changed ? 'wrote' : 'unchanged'}  ${r.path}\n`);
  }
}

// Only run when invoked directly (importers use hashOf / spliceFragment
// for tests without triggering side-effects).
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`[gen-managed-artefacts] failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  });
}
