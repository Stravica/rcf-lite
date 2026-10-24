// Fixture side of the FBS-231 round 8 store tests (AC-16103-4, decision 88):
// starts `node bin/rcf.js` children through test/_helpers/feedback-lock-world.js
// startWatched (the run 2 preload test/_helpers/feedback-lock-pause.mjs) with
// the round 7 preload test/_helpers/feedback-break-pause.mjs and the round 8
// preload test/_helpers/feedback-fence-pause.mjs loaded beside it through
// NODE_OPTIONS, and builds the one world the earlier helpers do not: a main
// checkout that does not ignore .rcf/feedback/ yet, with a linked worktree
// that holds a queue (decision 80's world e). The held-queue world, the
// outcome every concurrent path must leave, the break helpers and the gh
// double are the round 6 and round 7 helpers, reused unchanged.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { initProject } from '#core/store/init.js';
import { scratchDir } from './scratch.js';
import { startWatched } from './feedback-lock-world.js';
import { addEntry, git, listIn, snapshot, storeOf } from './feedback-race-world.js';

const here = dirname(fileURLToPath(import.meta.url));
const breakPreload = pathToFileURL(join(here, 'feedback-break-pause.mjs')).href;
const fencePreload = pathToFileURL(join(here, 'feedback-fence-pause.mjs')).href;

/**
 * startWatched with the round 7 and round 8 preloads. opts as startWatched's,
 * plus breakAt (round 7 pause points), ahead ({ ms, file }: the child's clock
 * moves ms ahead once file exists), fenceAt (round 8 pause points) and
 * record (the text a record of a filing carries, for retake-after-record).
 */
export function startFence(cwd, args, opts = {}) {
  const { breakAt = [], fenceAt = [], record, ahead, env: extra = {}, ...rest } = opts;
  const env = { ...extra, NODE_OPTIONS: `--import=${breakPreload} --import=${fencePreload}` };
  if (breakAt.length > 0) env.RCF_TEST_BREAK_AT = breakAt.join(',');
  if (fenceAt.length > 0) env.RCF_TEST_FENCE_AT = fenceAt.join(',');
  if (record !== undefined) env.RCF_TEST_FENCE_RECORD = record;
  if (ahead) Object.assign(env, { RCF_TEST_CLOCK_AHEAD_MS: String(ahead.ms), RCF_TEST_CLOCK_AHEAD_FILE: ahead.file });
  return startWatched(cwd, args, { ...rest, env });
}

/**
 * Decision 80's world e: a main checkout (rcf project, committed) whose
 * .gitignore does not cover .rcf/feedback/, with a linked worktree whose
 * branch does, holding a queue recorded with the CLI in a plain seed
 * checkout (one pending entry) and copied into the worktree's ignored
 * .rcf/feedback/. While the main checkout does not ignore the store, the
 * worktree's commands keep their own held queue (AC-16103-4), so its
 * store is the worktree's; `race` watches that store. ignoreInMain() adds
 * .rcf/feedback/ to the main checkout's .gitignore and commits it.
 */
export async function unignoredMainWorld(prefix, { clock } = {}) {
  const base = await scratchDir(prefix);
  const seed = join(base, 'seed');
  const main = join(base, 'repo');
  const lane = join(base, 'lane');
  const ctrl = join(base, 'ctrl');
  await mkdir(ctrl, { recursive: true });

  await mkdir(seed, { recursive: true });
  await initProject({ projectRoot: seed, projectName: 'FenceSeed' });
  await writeFile(join(seed, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  git(seed, 'init', '-q', '-b', 'main');
  await addEntry(seed, 'held in the worktree, pending, filed by a submit there', clock);
  const heldIds = await listIn(seed);

  await mkdir(main, { recursive: true });
  await initProject({ projectRoot: main, projectName: 'Fence' });
  await writeFile(join(main, '.gitignore'), 'node_modules/\n', 'utf8');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'chore: base');
  git(main, 'worktree', 'add', '-q', '-b', 'lane', lane);
  await writeFile(join(lane, '.gitignore'), 'node_modules/\n.rcf/feedback/\n', 'utf8');
  git(lane, 'commit', '-q', '-am', 'chore: ignore the feedback store on the lane branch');

  await cp(storeOf(seed), storeOf(lane), { recursive: true });
  const heldDir = storeOf(lane);
  const held = snapshot(heldDir);
  assert.ok(held['entries.jsonl'], `fixture: the worktree holds entries.jsonl: ${Object.keys(held).join(', ')}`);
  assert.equal(heldIds.length, 1, 'fixture: the worktree holds one entry');
  assert.equal(heldIds[0][1], 'pending', 'fixture: the held entry is pending');
  return {
    base, seed, main, lane, ctrl, heldDir, held, heldIds,
    race: (id, at, extra = {}) => ({ ctrl, id, at, main: lane, held: lane, ...extra }),
    async ignoreInMain() {
      await appendFile(join(main, '.gitignore'), '.rcf/feedback/\n', 'utf8');
      git(main, 'commit', '-q', '-am', 'chore: ignore the feedback store');
    },
  };
}

/** The path of a file under a control directory's marker, as the child named it. */
export function markerText(ctrl, name) {
  const p = join(ctrl, name);
  assert.ok(existsSync(p), `fixture: the marker ${name} was written`);
  return readFileSync(p, 'utf8');
}

/**
 * The entry a gh double filed first (its first issue create that
 * succeeded): the entry whose title the issue's title carries, among
 * `entries` ([id, title] pairs), and the issue's URL.
 */
export function firstFiled(gh, entries) {
  const call = gh.calls().find((c) => c.name === 'ghIssueCreate' && c.result?.ok);
  assert.ok(call, 'fixture: the gh double filed an issue');
  const hit = entries.find(([, title]) => String(call.args?.title ?? '').includes(title));
  assert.ok(hit, `fixture: the filed issue's title names one of the entries: ${call.args?.title}`);
  return { id: hit[0], title: hit[1], url: call.result.value.url };
}

/** Every create or comment the gh double logged for an entry's title. */
export function filingsOf(gh, title) {
  return gh.calls().filter((c) => (c.name === 'ghIssueCreate' || c.name === 'ghIssueComment')
    && c.result?.ok && String(c.args?.title ?? c.args?.body ?? '').includes(title));
}
