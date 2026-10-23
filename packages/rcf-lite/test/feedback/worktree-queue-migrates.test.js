// FBS-231 round 2 (US-16103, AC-16103-4): the feedback queue in a linked git
// worktree, past the first round. Three behaviours, each driven through
// `node bin/rcf.js` as a child process in a real git repository (host config
// isolated, no network, no agent CLI):
//
// 1. A worktree that already holds a .rcf/feedback/ queue (as 0.36.0 left it)
//    has that queue moved into the main checkout's store by the next
//    `rcf feedback` command run there; after `git worktree remove` every entry,
//    old and new, is listed from the main checkout exactly once with the
//    status it had, and the main checkout's git status stays clean.
// 2. A main checkout whose .gitignore does not cover .rcf/feedback/ (the
//    worktree's branch does): `rcf feedback add` in the worktree refuses as
//    AC-15501-2 refuses, naming the main checkout, and writes nothing.
// 3. A main checkout that does not hold the rcf project (rcf adopted on the
//    worktree's branch only): `rcf feedback add` in the worktree never leaves a
//    file the main checkout would commit.
//
// The held queue is recorded with the CLI in a separate plain checkout of a
// fixture project and its .rcf/feedback/ directory is copied into the
// worktree; no JSON is written by hand and the store is never read through a
// module import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initProject } from '#core/store/init.js';
import { scratchDir } from '../_helpers/scratch.js';

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

const ISOLATED = {
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
};

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd, env: { ...process.env, ...ISOLATED }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function rcf(cwd, args) {
  const env = { ...process.env, ...ISOLATED, CI: '1', PATH: '/usr/bin:/bin' };
  delete env.RCF_FEEDBACK_DISABLE;
  return new Promise((res) => {
    execFile(process.execPath, [bin, ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 }, (err, stdout, stderr) => {
      res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

async function addEntry(cwd, title) {
  const r = await rcf(cwd, ['feedback', 'add', '--kind', 'core', '--target', 'rcf verify run', '--anchor', 'AC-101-1',
    '--class', 'verb-error', '--severity', 'minor', '--title', title, '--body', 'fixture entry',
    '--evidence', 'rcf verify run', '--harness', 'claude-code']);
  return { ...r, id: /recorded (fb-[0-9a-z-]+)/.exec(r.stdout)?.[1] };
}

async function listAll(cwd, extra = ['--all']) {
  const r = await rcf(cwd, ['feedback', 'list', ...extra, '--json']);
  assert.equal(r.code, 0, `rcf feedback list ${extra.join(' ')} --json exits 0 in ${cwd}\nstderr:\n${r.stderr}`);
  return JSON.parse(r.stdout).map((e) => [e.id, e.status]).sort((a, b) => a[0].localeCompare(b[0]));
}

function feedbackStatusLines(cwd) {
  return git(cwd, 'status', '--porcelain', '--untracked-files=all').split('\n').filter((l) => l.includes('.rcf/feedback'));
}

function namesDir(text, dir) {
  return text.includes(dir) || text.includes(realpathSync(dir));
}

test('AC-16103-4: a queue a linked worktree already holds is moved into the main checkout by the next rcf feedback command run there, and after git worktree remove every entry, old and new, is listed from the main checkout exactly once with the status it had', async () => {
  const base = await scratchDir('rcf-fbs231-held-queue-');
  const seed = join(base, 'seed');
  const main = join(base, 'repo');
  const lane = join(base, 'lane');

  // The held queue: two entries recorded with the CLI in a plain checkout of a
  // fixture project, the second discarded, so the queue carries a state line.
  await mkdir(seed, { recursive: true });
  await initProject({ projectRoot: seed, projectName: 'HeldQueueSeed' });
  await writeFile(join(seed, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  git(seed, 'init', '-q', '-b', 'main');
  const heldPending = await addEntry(seed, 'held in the worktree, pending');
  const heldDiscarded = await addEntry(seed, 'held in the worktree, discarded');
  assert.ok(heldPending.id && heldDiscarded.id, `fixture: the seed checkout records two entries\n${heldPending.stderr}${heldDiscarded.stderr}`);
  const discard = await rcf(seed, ['feedback', 'discard', heldDiscarded.id]);
  assert.equal(discard.code, 0, `fixture: rcf feedback discard in the seed checkout\nstderr:\n${discard.stderr}`);

  // The main checkout, with a queue of its own, and a linked worktree.
  await mkdir(main, { recursive: true });
  await initProject({ projectRoot: main, projectName: 'HeldQueue' });
  await writeFile(join(main, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'chore: base');
  const mainOwn = await addEntry(main, 'recorded in the main checkout');
  assert.equal(mainOwn.code, 0, `fixture: the main checkout records its own entry\nstderr:\n${mainOwn.stderr}`);
  git(main, 'worktree', 'add', '-q', '-b', 'lane', lane);

  // The worktree holds the queue as 0.36.0 left it: its own ignored .rcf/feedback/.
  await cp(join(seed, '.rcf', 'feedback'), join(lane, '.rcf', 'feedback'), { recursive: true });
  assert.ok(existsSync(join(lane, '.rcf', 'feedback', 'entries.jsonl')), 'fixture: the worktree holds a queue');

  // The trigger: the next rcf feedback command in the worktree, recording one new entry.
  const fresh = await addEntry(lane, 'recorded in the worktree after the upgrade');
  assert.equal(fresh.code, 0, `rcf feedback add records the new entry in the worktree\nstderr:\n${fresh.stderr}`);
  assert.ok(fresh.id, `stdout names the recorded id: ${fresh.stdout}`);

  let removeError = null;
  try { git(main, 'worktree', 'remove', lane); } catch (err) { removeError = String(err.stderr ?? err.message); }
  assert.equal(removeError, null, `git worktree remove (no --force) succeeds: ${removeError}`);
  assert.equal(existsSync(lane), false, 'fixture: the worktree directory is gone');

  const expected = [
    [heldDiscarded.id, 'discarded'],
    [heldPending.id, 'pending'],
    [mainOwn.id, 'pending'],
    [fresh.id, 'pending'],
  ].sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(await listAll(main), expected,
    'after git worktree remove, rcf feedback list --all --json in the main checkout lists every entry the worktree held, the new one and its own, each id once with the status it had');
  assert.deepEqual(await listAll(main, []), expected.filter(([, s]) => s === 'pending'),
    'rcf feedback list --json in the main checkout lists the pending ones');
  const plain = await rcf(main, ['feedback', 'list']);
  for (const id of [heldPending.id, fresh.id, mainOwn.id]) {
    assert.ok(plain.stdout.includes(id), `rcf feedback list in the main checkout prints ${id}\nstdout:\n${plain.stdout}`);
  }
  assert.deepEqual(feedbackStatusLines(main), [], 'git status in the main checkout lists nothing under .rcf/feedback/');
});

test('AC-16103-4: when the main checkout does not ignore .rcf/feedback/ (the worktree branch does), rcf feedback add in a linked worktree refuses as AC-15501-2 refuses, names the main checkout, and writes nothing under either checkout', async () => {
  const base = await scratchDir('rcf-fbs231-main-unignored-');
  const main = join(base, 'repo');
  const lane = join(base, 'lane');
  await mkdir(main, { recursive: true });
  await initProject({ projectRoot: main, projectName: 'MainUnignored' });
  await writeFile(join(main, '.gitignore'), 'node_modules/\n', 'utf8');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'chore: base');
  git(main, 'worktree', 'add', '-q', '-b', 'lane', lane);
  await writeFile(join(lane, '.gitignore'), 'node_modules/\n.rcf/feedback/\n', 'utf8');
  git(lane, 'commit', '-q', '-am', 'chore: ignore the feedback store on the lane branch');

  const add = await addEntry(lane, 'recorded where the main checkout does not ignore it');

  assert.deepEqual(feedbackStatusLines(main), [], 'git status in the main checkout lists nothing under .rcf/feedback/');
  assert.equal(add.code, 2, `rcf feedback add without --force exits 2\nstdout:\n${add.stdout}\nstderr:\n${add.stderr}`);
  assert.match(add.stderr, /\.rcf\/feedback/, 'stderr names the missing gitignore entry');
  assert.match(add.stderr, /rcf doctor --fix/, 'stderr points at rcf doctor --fix');
  assert.ok(namesDir(add.stderr, main), `stderr names the main checkout whose .gitignore lacks the entry\nstderr:\n${add.stderr}`);
  assert.equal(existsSync(join(main, '.rcf', 'feedback')), false, 'nothing is created under the main checkout .rcf/feedback/');
  assert.equal(existsSync(join(lane, '.rcf', 'feedback')), false, 'nothing is created under the worktree .rcf/feedback/');
});

test('AC-16103-4: when the main checkout does not hold the rcf project (adopted on the worktree branch only), rcf feedback add in a linked worktree never leaves a file the main checkout would commit', async () => {
  const base = await scratchDir('rcf-fbs231-lane-only-');
  const main = join(base, 'repo');
  const lane = join(base, 'lane');
  await mkdir(main, { recursive: true });
  await writeFile(join(main, 'README.md'), 'a repository without rcf on main\n', 'utf8');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'chore: base');
  git(main, 'worktree', 'add', '-q', '-b', 'lane', lane);
  await initProject({ projectRoot: lane, projectName: 'LaneOnly' });
  await writeFile(join(lane, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  git(lane, 'add', '-A');
  git(lane, 'commit', '-q', '-m', 'chore: adopt rcf on the lane branch');

  const add = await addEntry(lane, 'recorded where only the lane branch holds the project');

  assert.deepEqual(feedbackStatusLines(main), [], 'git status in the main checkout lists nothing under .rcf/feedback/');
  if (add.code === 0) {
    const listed = await listAll(lane, []);
    assert.deepEqual(listed, [[add.id, 'pending']], 'an entry the add accepted is listed from the worktree');
  } else {
    assert.equal(add.code, 2, `a refusal is a usage refusal (exit 2)\nstderr:\n${add.stderr}`);
  }
});
