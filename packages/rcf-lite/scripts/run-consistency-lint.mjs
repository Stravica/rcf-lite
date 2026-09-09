#!/usr/bin/env node
// CI gate that runs the chain-consistency lint over every shipped
// blueprint under packages/rcf-lite/blueprints/. Reads each blueprint
// via the same loader the CLI uses; refuses exit 1 on any unsuppressed
// finding, exits 0 when every blueprint passes.
//
// Absorbs the (currently 32) chain-layers-disagree findings on the
// shipped shelf as a documented suppression per blueprint; spec 2026-
// 09-09 section 8.2 decision 4 has this as the operator-ratified
// backfill plan. Until each blueprint's README lists its suppressions,
// this gate stays in "soft" mode: it prints the finding line but
// exits 0 so the merge is not blocked on 32 legacy findings that a
// separate backfill work item owns.
//
// Toggle behaviour by exporting `RCF_LINT_MODE=hard` (default is `soft`
// while the backfill is outstanding; ship-gate flip is a one-line
// change once the backfill lands).

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
// when present (the CI stager may have run first).
const stagedDir = resolve(here, '..', 'blueprints');
const monorepoRootDir = resolve(here, '..', '..', '..', 'blueprints');
let blueprintsDir = stagedDir;
try {
  await readdir(stagedDir);
} catch {
  blueprintsDir = monorepoRootDir;
}
const mode = (process.env.RCF_LINT_MODE || 'soft').toLowerCase();

const entries = await readdir(blueprintsDir, { withFileTypes: true });
const slugs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

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
