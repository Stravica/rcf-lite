#!/usr/bin/env node
// Stage the repo-root blueprint shelf into `packages/rcf-lite/blueprints/`
// so `npm pack` picks it up via the `files: [ "blueprints" ]` entry.
//
// Why this exists: the packaged CLI resolves bare-slug `rcf define
// blueprint add <slug>` against a shelf sitting alongside the CLI
// (`<packageRoot>/blueprints/<slug>/`). In this monorepo the authoritative
// shelf lives at the repo root (`<repoRoot>/blueprints/`) so it stays
// visible to the docs generator and the dogfood harnesses; publishing
// copies that shelf into the package before pack runs.
//
// The staged directory is git-ignored (see `.gitignore` in this dir) and
// wiped-then-recopied on each run to avoid stale entries.
//
// Node-only; no shell.

import { readdir, rm, mkdir, cp, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
const SOURCE_SHELF = join(REPO_ROOT, 'blueprints');
const TARGET_SHELF = join(PACKAGE_ROOT, 'blueprints');

async function main() {
  let sourceStat;
  try {
    sourceStat = await stat(SOURCE_SHELF);
  } catch (err) {
    if (err.code === 'ENOENT') {
      process.stderr.write(`[stage-blueprint-shelf] source shelf not found at ${SOURCE_SHELF}; nothing to stage.\n`);
      return;
    }
    throw err;
  }
  if (!sourceStat.isDirectory()) {
    throw new Error(`[stage-blueprint-shelf] ${SOURCE_SHELF} is not a directory`);
  }

  await rm(TARGET_SHELF, { recursive: true, force: true });
  await mkdir(TARGET_SHELF, { recursive: true });

  const entries = await readdir(SOURCE_SHELF, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const src = join(SOURCE_SHELF, entry.name);
    const dst = join(TARGET_SHELF, entry.name);
    await cp(src, dst, { recursive: true });
    count += 1;
  }
  process.stdout.write(`[stage-blueprint-shelf] staged ${count} blueprint(s) into ${TARGET_SHELF}\n`);
}

main().catch((err) => {
  process.stderr.write(`[stage-blueprint-shelf] failed: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
