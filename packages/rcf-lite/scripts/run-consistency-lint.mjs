#!/usr/bin/env node
// CI gate that runs the chain-consistency lint over every shipped
// blueprint on the root `blueprints/` shelf (the monorepo-root
// authoritative sources). Reads each blueprint via the same loader
// the CLI uses; refuses exit 1 on any unsuppressed finding, exits 0
// when every blueprint passes.
//
// Shelf selection: when `RCF_LINT_SHELF=root` is set the lint always
// runs against the monorepo-root `blueprints/` sources; otherwise it
// prefers a staged copy at `packages/rcf-lite/blueprints/` when
// present and falls back to the monorepo root. CI sets
// `RCF_LINT_SHELF=root` on the ratified 2026-09-10 harden pass so
// the CI gate lints the authoritative sources regardless of any
// staged copy landing at pack time.
//
// Mode: `RCF_LINT_MODE=hard` (the shipped CI setting from the
// register-sweep hard flip, 2026-09-10) refuses exit 1 on any
// unsuppressed finding. The pre-flip `soft` mode is kept for local
// runs and named blueprint-family workthrough; it prints findings but
// exits 0. Non-empty assertion: an empty shelf exits 2 rather than
// vacuously passing.

import { readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadForLint,
  loadSuppressions,
  runLint,
} from '../src/blueprint/index.js';

const here = dirname(fileURLToPath(import.meta.url));
// The blueprint sources live at the monorepo root (`blueprints/`).
// `stage-blueprint-shelf.mjs` copies them into `packages/rcf-lite/blueprints/`
// at pack time; the lint runs against the pre-stage sources so a
// finding surfaces before the release-train stager touches anything.
// A staged local shelf at `packages/rcf-lite/blueprints/` is preferred
// when present (the CI stager may have run first), unless
// `RCF_LINT_SHELF=root` forces the monorepo-root shelf so the CI job
// lints the authoritative sources regardless of a local staged copy.
const stagedDir = resolve(here, '..', 'blueprints');
const monorepoRootDir = resolve(here, '..', '..', '..', 'blueprints');
const shelfOverride = (process.env.RCF_LINT_SHELF || '').toLowerCase();
let blueprintsDir;
if (shelfOverride === 'root') {
  blueprintsDir = monorepoRootDir;
} else {
  blueprintsDir = stagedDir;
  try {
    await readdir(stagedDir);
  } catch {
    blueprintsDir = monorepoRootDir;
  }
}
const mode = (process.env.RCF_LINT_MODE || 'soft').toLowerCase();

const entries = await readdir(blueprintsDir, { withFileTypes: true });
const slugs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
if (slugs.length === 0) {
  console.error(`[lint] shelf has zero blueprint slugs at ${blueprintsDir}; refuse (empty-shelf vacuous-pass guard).`);
  process.exit(2);
}

let anyUnsuppressed = 0;
let totalPass1 = 0;
let totalPass2 = 0;
for (const slug of slugs) {
  const sourcePath = join(blueprintsDir, slug);
  const loaded = await loadForLint(sourcePath);
  if ('error' in loaded) {
    console.error(`[lint] ${slug}: load failed: ${loaded.error}`);
    process.exit(1);
  }
  const suppressions = await loadSuppressions(sourcePath);
  const result = runLint(loaded, suppressions);
  totalPass1 += result.passCounts.pass1;
  totalPass2 += result.passCounts.pass2;
  const unsuppressed = result.findings.filter((f) => !f.suppressed);
  if (unsuppressed.length === 0) {
    console.log(`[lint] ${slug}: pass (pass1=${result.passCounts.pass1}, pass2=${result.passCounts.pass2}, suppressed=${result.passCounts.suppressed})`);
    continue;
  }
  anyUnsuppressed += unsuppressed.length;
  const tag = mode === 'hard' ? '[FAIL]' : '[soft-mode]';
  console.log(`${tag} ${slug}: ${unsuppressed.length} unsuppressed finding(s) (pass1=${result.passCounts.pass1}, pass2=${result.passCounts.pass2}, suppressed=${result.passCounts.suppressed})`);
  for (const f of unsuppressed) {
    console.log(`   ${f.pass} ${f.kind} ${f.id}: ${f.message}`);
  }
}
console.log(`[lint] shelf totals: pass1=${totalPass1}, pass2=${totalPass2}, unsuppressed=${anyUnsuppressed}, mode=${mode}`);
if (mode === 'hard' && anyUnsuppressed > 0) {
  console.error(`[lint] hard-mode: ${anyUnsuppressed} unsuppressed finding(s); refuse.`);
  process.exit(1);
}
process.exit(0);
