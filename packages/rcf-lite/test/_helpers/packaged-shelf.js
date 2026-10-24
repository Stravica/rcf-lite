// Shared test helper: stage the packaged blueprint shelf once, atomically.
//
// The resolver reads the shelf from `packages/rcf-lite/blueprints/`
// (src/blueprint/shelf-resolver.js packagedShelfPath()). That directory
// is gitignored and generated: `scripts/stage-blueprint-shelf.mjs`
// (prepack) wipes it and copies the repo-root shelf back in, one
// blueprint at a time. Tests that read it used to depend on another file
// having staged it first, and the per-file helpers ran the stage script
// itself, so under a concurrent run one file could read the directory
// while another was between the wipe and the last copy (the
// companions-resolver "shelf-fallback" flake: origin 'unresolved').
//
// ensurePackagedShelfStaged() returns at once when every repo-root
// blueprint directory is already present in the packaged shelf. Otherwise
// it copies the repo-root shelf into a private directory under the
// package's node_modules/.cache (gitignored, same filesystem) and renames
// it into place, so a reader sees no shelf or a whole shelf, never a
// partial one. A concurrent stager that loses the rename discards its
// own copy. The script itself stays the prepack path; this helper only
// reproduces its output for tests.

import { cp, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..', '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
const SOURCE_SHELF = join(REPO_ROOT, 'blueprints');
export const PACKAGED_SHELF = join(PACKAGE_ROOT, 'blueprints');
const STAGE_PARENT = join(PACKAGE_ROOT, 'node_modules', '.cache');

async function dirNames(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  return entries === null ? null : entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function complete() {
  const source = await dirNames(SOURCE_SHELF);
  const target = await dirNames(PACKAGED_SHELF);
  // An installed copy ships the shelf inside the package and has no
  // repo-root shelf beside it: a populated packaged shelf is then whole.
  if (source === null) return target !== null && target.length > 0;
  if (target === null) return false;
  const have = new Set(target);
  return source.every((name) => have.has(name));
}

/**
 * Make sure packages/rcf-lite/blueprints/ holds the whole repo-root
 * shelf. Idempotent and safe to call from concurrent test files.
 *
 * @returns {Promise<string>} the packaged shelf path
 */
export async function ensurePackagedShelfStaged() {
  if (await complete()) return PACKAGED_SHELF;
  await mkdir(STAGE_PARENT, { recursive: true });
  const staging = await mkdtemp(join(STAGE_PARENT, 'rcf-shelf-stage-'));
  try {
    for (const name of await dirNames(SOURCE_SHELF)) {
      await cp(join(SOURCE_SHELF, name), join(staging, name), { recursive: true });
    }
    try {
      // rename(2) replaces an absent or empty target in one step.
      await rename(staging, PACKAGED_SHELF);
      return PACKAGED_SHELF;
    } catch (err) {
      if (!['ENOTEMPTY', 'EEXIST'].includes(err.code)) throw err;
    }
    if (await complete()) return PACKAGED_SHELF; // a concurrent stager won
    // A stale, partial shelf from an interrupted stage: swap it out whole.
    const aside = `${staging}-stale`;
    await rename(PACKAGED_SHELF, aside);
    await rename(staging, PACKAGED_SHELF);
    await rm(aside, { recursive: true, force: true });
    return PACKAGED_SHELF;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
