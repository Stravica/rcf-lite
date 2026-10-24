// FBS-231 round 3 (US-16103, AC-16103-4): a queue a linked worktree already
// holds, past the round 2 move. Each behaviour is driven through
// `node bin/rcf.js` as a child process in a real git repository (host config
// isolated, no network, no agent CLI):
//
// 1. The main checkout's .gitignore does not cover .rcf/feedback/ (the
//    worktree's branch does) while the worktree holds a queue: nothing moves.
//    The worktree keeps listing its own held entries, the Stop hook there
//    keeps asking about them, and `rcf feedback add` there refuses with exit 2
//    naming the main checkout, `rcf doctor --fix` and when the held entries
//    move.
// 2. Once the main checkout ignores the store, the next `rcf feedback`
//    command in the worktree moves the held queue as round 2 does (guard).
// 3. The move fails (the main checkout's .rcf/ is not writable): the command
//    exits non-zero naming the failure, writes nothing to the worktree's queue
//    and removes nothing the worktree held.
//
// The held queue is recorded with the CLI in a separate plain checkout of a
// fixture project and its .rcf/feedback/ directory is copied into the
// worktree; no JSON is written by hand and the store is never read through a
// module import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { appendFile, chmod, cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initProject } from '#core/store/init.js';
import { scratchDir } from '../_helpers/scratch.js';

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

const HELD_MOVE_PHRASE = 'the held entries move into the main checkout once it ignores .rcf/feedback/';

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

function rcf(cwd, args, stdin) {
  const env = { ...process.env, ...ISOLATED, CI: '1', PATH: '/usr/bin:/bin' };
  for (const k of ['RCF_FEEDBACK_DISABLE', 'RCF_FEEDBACK_ASK', 'RCF_FEEDBACK_SESSION_ID', 'CLAUDECODE']) delete env[k];
  return new Promise((res) => {
    const child = execFile(process.execPath, [bin, ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 }, (err, stdout, stderr) => {
      res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
    if (stdin !== undefined) child.stdin.write(stdin);
    child.stdin.end();
  });
}

async function addEntry(cwd, title) {
  const r = await rcf(cwd, ['feedback', 'add', '--kind', 'core', '--target', 'rcf verify run', '--anchor', 'AC-101-1',
    '--class', 'verb-error', '--severity', 'minor', '--title', title, '--body', 'fixture entry',
    '--evidence', 'rcf verify run', '--harness', 'claude-code']);
  return { ...r, id: /recorded (fb-[0-9a-z-]+)/.exec(r.stdout)?.[1] };
}

async function listIn(cwd, extra) {
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

// Every file under dir with its bytes, so "nothing moved, nothing added,
// nothing removed" is one deepEqual.
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const dirent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, dirent.name);
      if (dirent.isDirectory()) walk(p);
      else out[relative(dir, p)] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

// A main checkout (rcf project, committed) with a linked worktree that holds a
// queue as 0.36.0 left it: one pending and one discarded entry, recorded with
// the CLI in a plain seed checkout and copied into the worktree's ignored
// .rcf/feedback/. mainIgnores picks whether the main checkout's .gitignore
// covers .rcf/feedback/; the worktree's branch always does.
async function heldQueueWorld(prefix, { mainIgnores }) {
  const base = await scratchDir(prefix);
  const seed = join(base, 'seed');
  const main = join(base, 'repo');
  const lane = join(base, 'lane');

  await mkdir(seed, { recursive: true });
  await initProject({ projectRoot: seed, projectName: 'HeldQueueSeed' });
  await writeFile(join(seed, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  git(seed, 'init', '-q', '-b', 'main');
  const heldPending = await addEntry(seed, 'held in the worktree, pending');
  const heldDiscarded = await addEntry(seed, 'held in the worktree, discarded');
  assert.ok(heldPending.id && heldDiscarded.id, `fixture: the seed checkout records two entries\n${heldPending.stderr}${heldDiscarded.stderr}`);
  const discard = await rcf(seed, ['feedback', 'discard', heldDiscarded.id]);
  assert.equal(discard.code, 0, `fixture: rcf feedback discard in the seed checkout\nstderr:\n${discard.stderr}`);

  await mkdir(main, { recursive: true });
  await initProject({ projectRoot: main, projectName: 'HeldQueue' });
  await writeFile(join(main, '.gitignore'), mainIgnores ? 'node_modules/\n.rcf/feedback/\n' : 'node_modules/\n', 'utf8');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'chore: base');
  git(main, 'worktree', 'add', '-q', '-b', 'lane', lane);
  if (!mainIgnores) {
    await writeFile(join(lane, '.gitignore'), 'node_modules/\n.rcf/feedback/\n', 'utf8');
    git(lane, 'commit', '-q', '-am', 'chore: ignore the feedback store on the lane branch');
  }

  await cp(join(seed, '.rcf', 'feedback'), join(lane, '.rcf', 'feedback'), { recursive: true });
  const heldDir = join(lane, '.rcf', 'feedback');
  assert.ok(existsSync(join(heldDir, 'entries.jsonl')), 'fixture: the worktree holds a queue');
  assert.deepEqual(feedbackStatusLines(lane), [], 'fixture: the worktree branch ignores its held queue');
  return { base, main, lane, heldDir, heldPending, heldDiscarded, held: snapshot(heldDir) };
}

function heldExpected(w) {
  return [[w.heldDiscarded.id, 'discarded'], [w.heldPending.id, 'pending']].sort((a, b) => a[0].localeCompare(b[0]));
}

function assertNothingMoved(w) {
  const now = existsSync(w.heldDir) ? snapshot(w.heldDir) : {};
  assert.equal(now['entries.jsonl'], w.held['entries.jsonl'],
    'the worktree still holds its queue: .rcf/feedback/entries.jsonl is byte-identical');
  assert.equal(existsSync(join(w.main, '.rcf', 'feedback')), false, 'nothing is written under the main checkout .rcf/feedback/');
  assert.deepEqual(feedbackStatusLines(w.main), [], 'git status in the main checkout lists nothing under .rcf/feedback/');
}

test('AC-16103-4: while the main checkout does not ignore .rcf/feedback/, a linked worktree that holds a queue keeps listing its own held entries with the status they had, and nothing moves', async () => {
  const w = await heldQueueWorld('rcf-fbs231-held-unignored-list-', { mainIgnores: false });

  assert.deepEqual(await listIn(w.lane, ['--all']), heldExpected(w),
    'rcf feedback list --all --json in the worktree lists every held entry once with the status it had');
  assert.deepEqual(await listIn(w.lane, []), [[w.heldPending.id, 'pending']],
    'rcf feedback list --json in the worktree lists the held pending entry');
  const plain = await rcf(w.lane, ['feedback', 'list']);
  assert.ok(plain.stdout.includes(w.heldPending.id), `rcf feedback list in the worktree prints ${w.heldPending.id}\nstdout:\n${plain.stdout}`);

  assertNothingMoved(w);
});

test('AC-16103-4: while the main checkout does not ignore .rcf/feedback/, the Stop hook in a linked worktree that holds a queue keeps asking about its held pending entries, and nothing moves', async () => {
  const w = await heldQueueWorld('rcf-fbs231-held-unignored-hook-', { mainIgnores: false });

  const stop = await rcf(w.lane, ['feedback', 'hook', 'stop', '--harness', 'claude-code'],
    JSON.stringify({ session_id: 'lane-stop-session', cwd: '.', hook_event_name: 'Stop', stop_hook_active: false }));
  assert.equal(stop.code, 2, `the Stop hook in the worktree exits 2 with the ask\nstdout:\n${stop.stdout}\nstderr:\n${stop.stderr}`);
  assert.match(stop.stderr, /rcf feedback: 1 unsubmitted entry on this project\./, 'the ask counts the held pending entry');
  assert.match(stop.stderr, /rcf feedback preview/, 'the ask names rcf feedback preview');
  assert.equal(stop.stdout, '', 'stdout is empty on the Claude Code branch');

  assertNothingMoved(w);
});

test('AC-16103-4: while the main checkout does not ignore .rcf/feedback/, rcf feedback add in a linked worktree that holds a queue exits 2 naming the main checkout, rcf doctor --fix and that the held entries move once it ignores the store, and nothing moves', async () => {
  const w = await heldQueueWorld('rcf-fbs231-held-unignored-add-', { mainIgnores: false });

  const add = await addEntry(w.lane, 'recorded while the main checkout does not ignore the store');
  assert.equal(add.code, 2, `rcf feedback add without --force exits 2\nstdout:\n${add.stdout}\nstderr:\n${add.stderr}`);
  assert.match(add.stderr, /\.rcf\/feedback/, 'stderr names the missing gitignore entry');
  assert.match(add.stderr, /rcf doctor --fix/, 'stderr points at rcf doctor --fix');
  assert.ok(namesDir(add.stderr, w.main), `stderr names the main checkout\nstderr:\n${add.stderr}`);
  assert.ok(add.stderr.includes(HELD_MOVE_PHRASE), `stderr says "${HELD_MOVE_PHRASE}"\nstderr:\n${add.stderr}`);

  assertNothingMoved(w);
  assert.deepEqual(existsSync(w.heldDir) ? snapshot(w.heldDir) : {}, w.held, 'the refused add writes nothing to the worktree queue');
});

test('AC-16103-4 guard: once the main checkout ignores .rcf/feedback/, the next rcf feedback command in a linked worktree that held its queue while it did not moves that queue, and after git worktree remove every entry is listed from the main checkout once with the status it had', async () => {
  const w = await heldQueueWorld('rcf-fbs231-held-then-ignored-', { mainIgnores: false });

  // A command while the main checkout does not ignore the store moves nothing.
  const before = await rcf(w.lane, ['feedback', 'list', '--all', '--json']);
  assert.equal(before.code, 0, `rcf feedback list --all --json in the worktree exits 0\nstderr:\n${before.stderr}`);
  assert.equal(existsSync(join(w.main, '.rcf', 'feedback')), false, 'nothing moves while the main checkout does not ignore the store');

  // The operator adds the managed entry in the main checkout.
  await appendFile(join(w.main, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  git(w.main, 'commit', '-q', '-am', 'chore: ignore the feedback store');

  const fresh = await addEntry(w.lane, 'recorded once the main checkout ignores the store');
  assert.equal(fresh.code, 0, `rcf feedback add records the new entry in the worktree\nstderr:\n${fresh.stderr}`);
  assert.ok(fresh.id, `stdout names the recorded id: ${fresh.stdout}`);

  let removeError = null;
  try { git(w.main, 'worktree', 'remove', w.lane); } catch (err) { removeError = String(err.stderr ?? err.message); }
  assert.equal(removeError, null, `git worktree remove (no --force) succeeds: ${removeError}`);

  const expected = [...heldExpected(w), [fresh.id, 'pending']].sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(await listIn(w.main, ['--all']), expected,
    'after git worktree remove, rcf feedback list --all --json in the main checkout lists every held entry and the new one, each id once with the status it had');
  assert.deepEqual(feedbackStatusLines(w.main), [], 'git status in the main checkout lists nothing under .rcf/feedback/');
});

test('AC-16103-4: when moving the held queue fails, rcf feedback add in a linked worktree exits non-zero naming the error and the main checkout, writes nothing to the worktree queue and removes nothing it held', async (t) => {
  const w = await heldQueueWorld('rcf-fbs231-held-move-fails-', { mainIgnores: true });

  // The main checkout ignores the store, so the next command moves the held
  // queue; its .rcf/ directory is read-only, so the move cannot write.
  const mainRcf = join(w.main, '.rcf');
  await mkdir(mainRcf, { recursive: true });
  await chmod(mainRcf, 0o555);
  t.after(async () => { try { await chmod(mainRcf, 0o755); } catch { /* ignore */ } });
  assert.throws(() => mkdirSync(join(mainRcf, 'feedback')), /EACCES|EPERM/, 'fixture: the main checkout .rcf/ is not writable');

  const add = await addEntry(w.lane, 'recorded while the move cannot write');
  assert.notEqual(add.code, 0, `rcf feedback add exits non-zero when the move fails\nstdout:\n${add.stdout}\nstderr:\n${add.stderr}`);
  assert.match(add.stderr, /EACCES|permission denied/i, `stderr names the error the move hit\nstderr:\n${add.stderr}`);
  assert.ok(namesDir(add.stderr, w.main), `stderr names the main checkout\nstderr:\n${add.stderr}`);
  assert.deepEqual(existsSync(w.heldDir) ? snapshot(w.heldDir) : {}, w.held,
    'the worktree .rcf/feedback/ is byte-identical: no new entry is written there and nothing it held is removed');
  assert.equal(existsSync(join(mainRcf, 'feedback')), false, 'nothing is written under the main checkout .rcf/feedback/');
});
