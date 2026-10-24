// Shared test harness (GR-40): the goldens a slice's round DEFINE records
// at the round's base with the round-base bin, and the same reading the
// bound test takes at HEAD, so the golden and the test read the bin one
// way. Imports Node builtins and the harness only; nothing under src/ or
// test/_helpers/.
//
// Recording, from packages/rcf-lite at the round's base (the test-author,
// in that slice's round DEFINE, before BUILD changes anything):
//
//   node test/_harness/goldens.js coverage test/fixtures/pin-move/coverage-at-base.json
//     FBS-232 (AC-19501-5, the stage-keeper's ruling 6 on the Part B
//     summary's stops): the exit code and the sorted gap list of
//     node bin/rcf.js audit coverage --strict, as { "exitCode", "gaps" }.
//
//   node test/_harness/goldens.js readiness-chips test/fixtures/readiness/chips.json
//     FBS-240 (AC-20301-4, the stage-keeper's ruling 8 on the Part B
//     summary's stops), after the round DEFINE has committed the named
//     readiness fixture trees beside it: for each directory under
//     test/fixtures/readiness/, the Chips line node bin/rcf.js define
//     readiness prints over a scratch copy of that tree, as
//     { "<tree>": "D0:<state> D1:<state> ... D8:<state>" }.
//
//   node test/_harness/goldens.js own-chain test/fixtures/own-chain/at-639f07bb.json
//     FBS-240 (AC-20301-4's own-chain half and AC-20302-3, the stage-keeper's
//     ruling on part B3's open question 1, reading a): what both criteria
//     compare against at 639f07bb (0.36.1 on main), as { "rev",
//     "notApplicableStages", "liveCriteria" }: the stages
//     node bin/rcf.js define readiness --json reports notApplicable over
//     639f07bb's own chain with 639f07bb's own bin, and the description,
//     given, when and then (those present) of every criterion live at
//     639f07bb, by id. This recorder reads 639f07bb from the git history,
//     so it runs from a full clone; the tests read only the golden.

import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BIN, rcf, run } from './spawn.js';
import { json } from './capture.js';
import { git, gitTry, showAt } from './git.js';

/**
 * node bin/rcf.js audit coverage --strict --format json in cwd, read as
 * { exitCode, gaps }: the exit code, and the ids of the criteria it
 * reports uncovered, sorted.
 */
export async function coverageResult(cwd, { bin = BIN } = {}) {
  const r = await rcf(['audit', 'coverage', '--strict', '--format', 'json'], { cwd, bin, timeout: 300_000 });
  const doc = json(r.stdout);
  const gaps = doc.requirements.flatMap((q) => q.acs.filter((a) => !a.covered).map((a) => a.id)).sort();
  return { exitCode: r.code, gaps };
}

/**
 * The Chips line (the text after "Chips: ") that node bin/rcf.js define
 * readiness prints over a scratch copy of one readiness fixture tree; the
 * copy sits under the OS temp dir, so no enclosing chain is read, and is
 * removed afterwards.
 */
export async function readinessChips(treeDir, { bin = BIN } = {}) {
  const dir = join(mkdtempSync(join(tmpdir(), 'rcf-h-chips-')), 'tree');
  try {
    cpSync(treeDir, dir, { recursive: true });
    const r = await rcf(['define', 'readiness'], { cwd: dir, bin });
    const line = r.stdout.split('\n').find((l) => l.startsWith('Chips: '));
    if (!line) throw new Error(`define readiness over ${treeDir} printed no Chips line (exit ${r.code})\n${r.stdout.slice(0, 1500)}${r.stderr.slice(-1500)}`);
    return line.slice('Chips: '.length);
  } finally {
    rmSync(dirname(dir), { recursive: true, force: true });
  }
}

/** The readiness fixture trees: the directories directly under dir, sorted. */
export function readinessTrees(dir) {
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

/** 0.36.1 on main, the commit AC-20301-4 and AC-20302-3 compare against. */
export const MAIN_0361 = '639f07bb99ac70bd93c298be3b15bea4eb8a38b1';

/**
 * The own-chain golden of FBS-240 (recorded, never read by a test from
 * history): run from packages/rcf-lite in a full clone. Opens a temporary
 * worktree at rev, installs that tree's own dependencies, reads the
 * notApplicable stages of define readiness --json with that tree's own
 * bin, and reads every user story at rev for the live criteria (no
 * supersededBy) and their description, given, when and then.
 */
export async function ownChainAt(rev = MAIN_0361) {
  const root = git(process.cwd(), 'rev-parse', '--show-toplevel');
  if (gitTry(root, 'cat-file', '-e', `${rev}^{commit}`).code !== 0) throw new Error(`own-chain: ${rev} is not in this clone's history; record from a full clone`);
  const dir = join(mkdtempSync(join(tmpdir(), 'rcf-h-own-')), 'wt');
  git(root, 'worktree', 'add', '--detach', '--quiet', dir, rev);
  try {
    const inst = run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline', '--ignore-scripts'], { cwd: dir, env: { PATH: process.env.PATH } });
    if (inst.code !== 0) throw new Error(`own-chain: pnpm install at ${rev} exited ${inst.code}\n${inst.stderr.slice(-1500)}`);
    const then = join(dir, 'packages', 'rcf-lite');
    const r = await rcf(['define', 'readiness', '--json'], { cwd: then, bin: join(then, 'bin', 'rcf.js'), timeout: 300_000 });
    const notApplicableStages = json(r.stdout).stages.filter((st) => st.state === 'notApplicable').map((st) => st.stage).sort();
    const STORIES = 'packages/rcf-lite/rcf/user-stories';
    const paths = git(root, 'ls-tree', '--name-only', `${rev}:${STORIES}`).split('\n').filter(Boolean).map((f) => `${STORIES}/${f}`);
    const liveCriteria = {};
    for (const text of showAt(root, rev, paths).values()) {
      for (const a of JSON.parse(text).acceptanceCriteria ?? []) {
        if (a.supersededBy) continue;
        const fields = {};
        for (const k of ['description', 'given', 'when', 'then']) if (a[k] !== undefined) fields[k] = a[k];
        liveCriteria[a.id] = fields;
      }
    }
    const sorted = Object.fromEntries(Object.keys(liveCriteria).sort().map((id) => [id, liveCriteria[id]]));
    return { rev, notApplicableStages, liveCriteria: sorted };
  } finally {
    gitTry(root, 'worktree', 'remove', '--force', dir);
    gitTry(root, 'worktree', 'prune');
    rmSync(dirname(dir), { recursive: true, force: true });
  }
}

function writeGolden(out, value) {
  const abs = resolve(process.cwd(), out);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`);
  process.stdout.write(`golden written: ${out}\n`);
}

const RECORDERS = {
  coverage: async (out) => writeGolden(out, await coverageResult(process.cwd())),
  'readiness-chips': async (out) => {
    const trees = dirname(resolve(process.cwd(), out));
    const chips = {};
    for (const name of readinessTrees(trees)) chips[name] = await readinessChips(join(trees, name));
    writeGolden(out, chips);
  },
  'own-chain': async (out) => writeGolden(out, await ownChainAt(MAIN_0361)),
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [kind, out] = process.argv.slice(2);
  if (!RECORDERS[kind] || !out) {
    process.stderr.write(`usage: node test/_harness/goldens.js <${Object.keys(RECORDERS).join('|')}> <out file>\n`);
    process.exit(2);
  }
  await RECORDERS[kind](out);
}
