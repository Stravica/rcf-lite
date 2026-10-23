// FBS-231 round 4 (US-16103, AC-16103-4): a move of a linked worktree's held
// queue into the main checkout that fails partway. The two partial-failure
// paths of the move, each driven through `node bin/rcf.js` as a child process
// in a real git repository (host config isolated, no network, no agent CLI):
//
// 1. The move fails after appending the held entries to the main checkout's
//    queue (the main checkout's .rcf/feedback/state.json is read-only): the
//    command exits 1 naming the error and the main checkout, the worktree
//    keeps every file it held, the main checkout lists each id once, and once
//    the mode is restored the next command completes the move with each id
//    once.
// 2. The move fails after removing some held files (the worktree's
//    .rcf/feedback/outbox/ is read-only): the command exits 1 naming the error
//    and the main checkout, every held file it removed has its content in the
//    main store, every file still held is byte-identical, and once the mode is
//    restored the next command completes the move with each id once.
//
// The held queue (entries.jsonl with one pending and one discarded entry, a
// state.json ask ledger and an outbox bundle) is recorded with the CLI in a
// separate plain checkout of a fixture project and its .rcf/feedback/
// directory is copied into the worktree; no JSON is written by hand and the
// store is never read through a module import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { chmod, cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

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

function hook(cwd, sub, sessionId) {
  const event = sub === 'stop' ? 'Stop' : 'SessionEnd';
  return rcf(cwd, ['feedback', 'hook', sub, '--harness', 'claude-code'],
    JSON.stringify({ session_id: sessionId, cwd: '.', hook_event_name: event, stop_hook_active: false }));
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

// Every file under dir with its bytes ({} when dir is gone), so "nothing
// added, nothing removed, nothing changed" is one deepEqual.
function snapshot(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
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

function lines(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
}

function sortPairs(pairs) {
  return [...pairs].sort((a, b) => a[0].localeCompare(b[0]));
}

// A main checkout (rcf project, committed, its .gitignore covering
// .rcf/feedback/) with a linked worktree that holds a queue as 0.36.0 left
// it: entries.jsonl with one pending and one discarded entry, a state.json
// ask ledger (the Stop hook) and an outbox bundle (the SessionEnd hook), all
// recorded with the CLI in a plain seed checkout and copied into the
// worktree's ignored .rcf/feedback/. mainOwn gives the main checkout one
// pending entry and a state.json of its own.
async function partialMoveWorld(prefix, { mainOwn }) {
  const base = await scratchDir(prefix);
  const seed = join(base, 'seed');
  const main = join(base, 'repo');
  const lane = join(base, 'lane');

  await mkdir(seed, { recursive: true });
  await initProject({ projectRoot: seed, projectName: 'PartialMoveSeed' });
  await writeFile(join(seed, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  git(seed, 'init', '-q', '-b', 'main');
  const heldPending = await addEntry(seed, 'held in the worktree, pending');
  const heldDiscarded = await addEntry(seed, 'held in the worktree, discarded');
  assert.ok(heldPending.id && heldDiscarded.id, `fixture: the seed checkout records two entries\n${heldPending.stderr}${heldDiscarded.stderr}`);
  const discard = await rcf(seed, ['feedback', 'discard', heldDiscarded.id]);
  assert.equal(discard.code, 0, `fixture: rcf feedback discard in the seed checkout\nstderr:\n${discard.stderr}`);
  const seedStop = await hook(seed, 'stop', 'seed-stop-session');
  assert.equal(seedStop.code, 2, `fixture: the Stop hook in the seed checkout asks (and records the ask in state.json)\nstderr:\n${seedStop.stderr}`);
  const seedEnd = await hook(seed, 'session-end', 'seed-stop-session');
  assert.equal(seedEnd.code, 0, `fixture: the SessionEnd hook in the seed checkout exits 0\nstderr:\n${seedEnd.stderr}`);

  await mkdir(main, { recursive: true });
  await initProject({ projectRoot: main, projectName: 'PartialMove' });
  await writeFile(join(main, '.gitignore'), 'node_modules/\n.rcf/feedback/\n', 'utf8');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'chore: base');
  git(main, 'worktree', 'add', '-q', '-b', 'lane', lane);

  let mainEntry = null;
  if (mainOwn) {
    mainEntry = await addEntry(main, 'recorded in the main checkout');
    assert.ok(mainEntry.id, `fixture: the main checkout records its own entry\n${mainEntry.stderr}`);
    const mainStop = await hook(main, 'stop', 'main-stop-session');
    assert.equal(mainStop.code, 2, `fixture: the Stop hook in the main checkout asks (and records the ask in state.json)\nstderr:\n${mainStop.stderr}`);
    assert.ok(existsSync(join(main, '.rcf', 'feedback', 'state.json')), 'fixture: the main checkout holds a state.json of its own');
  }

  await cp(join(seed, '.rcf', 'feedback'), join(lane, '.rcf', 'feedback'), { recursive: true });
  const heldDir = join(lane, '.rcf', 'feedback');
  const held = snapshot(heldDir);
  const heldOutbox = Object.keys(held).filter((n) => n.startsWith(`outbox${'/'}`));
  assert.ok(held['entries.jsonl'] && held['state.json'] && heldOutbox.length === 1,
    `fixture: the worktree holds entries.jsonl, state.json and one outbox bundle: ${Object.keys(held).join(', ')}`);
  assert.ok(JSON.parse(held['state.json']).asked?.length > 0, 'fixture: the held state.json carries an ask record');
  assert.deepEqual(feedbackStatusLines(lane), [], 'fixture: the worktree branch ignores its held queue');
  assert.deepEqual(feedbackStatusLines(main), [], 'fixture: the main checkout ignores its store');
  return { base, main, lane, heldDir, heldPending, heldDiscarded, mainEntry, held };
}

function heldExpected(w) {
  return sortPairs([[w.heldDiscarded.id, 'discarded'], [w.heldPending.id, 'pending']]);
}

// A held file the command removed from the worktree has its content in the
// main checkout's store: each entry line is a line of the main entries.jsonl,
// each ask record is in the main state.json, any other file (an outbox
// bundle) is byte-identical at the same path.
function assertContentInMainStore(w, name, bytes) {
  const mainDir = join(w.main, '.rcf', 'feedback');
  if (name === 'entries.jsonl') {
    const mainLines = existsSync(join(mainDir, name)) ? lines(readFileSync(join(mainDir, name), 'utf8')) : [];
    for (const line of lines(bytes)) {
      assert.ok(mainLines.includes(line), `the removed held entries.jsonl has every line in the main checkout entries.jsonl; missing:\n${line}`);
    }
  } else if (name === 'state.json') {
    const mainAsked = existsSync(join(mainDir, name)) ? (JSON.parse(readFileSync(join(mainDir, name), 'utf8')).asked ?? []) : [];
    for (const record of JSON.parse(bytes).asked ?? []) {
      assert.ok(mainAsked.some((r) => isDeepStrictEqual(r, record)),
        `the removed held state.json has every ask record in the main checkout state.json; missing: ${JSON.stringify(record)}`);
    }
  } else {
    const copy = join(mainDir, name);
    assert.equal(existsSync(copy) ? readFileSync(copy, 'utf8') : null, bytes,
      `the removed held ${name} is byte-identical in the main checkout .rcf/feedback/`);
  }
}

function removeWorktree(w) {
  let removeError = null;
  try { git(w.main, 'worktree', 'remove', w.lane); } catch (err) { removeError = String(err.stderr ?? err.message); }
  assert.equal(removeError, null, `git worktree remove (no --force) succeeds: ${removeError}`);
}

test('AC-16103-4: when moving the held queue fails after appending to the main queue, rcf feedback add in a linked worktree exits 1 naming the error and the main checkout, the worktree keeps every file it held, the main checkout lists each id once, and the next command completes the move with each id once', async (t) => {
  const w = await partialMoveWorld('rcf-fbs231-move-fails-after-append-', { mainOwn: true });

  // The main checkout ignores the store, so the next command in the worktree
  // moves the held queue; its state.json is read-only, so the move appends
  // the held entries to the main queue and then cannot merge the ask ledger.
  const mainState = join(w.main, '.rcf', 'feedback', 'state.json');
  const mode = statSync(mainState).mode & 0o777;
  await chmod(mainState, 0o444);
  t.after(async () => { try { await chmod(mainState, mode); } catch { /* ignore */ } });
  assert.throws(() => closeSync(openSync(mainState, 'r+')), /EACCES|EPERM/, 'fixture: the main checkout .rcf/feedback/state.json is not writable');

  const add = await addEntry(w.lane, 'recorded while the move cannot finish');
  assert.equal(add.code, 1, `rcf feedback add exits 1 when the move fails\nstdout:\n${add.stdout}\nstderr:\n${add.stderr}`);
  assert.match(add.stderr, /EACCES|permission denied/i, `stderr names the error the move hit\nstderr:\n${add.stderr}`);
  assert.ok(namesDir(add.stderr, w.main), `stderr names the main checkout\nstderr:\n${add.stderr}`);
  assert.deepEqual(snapshot(w.heldDir), w.held,
    'the worktree .rcf/feedback/ is byte-identical: nothing is written to its queue and nothing it held is removed');
  const expected = sortPairs([...heldExpected(w), [w.mainEntry.id, 'pending']]);
  assert.deepEqual(await listIn(w.main, ['--all']), expected,
    'rcf feedback list --all --json from the main checkout lists its own entry and every held entry, each id exactly once with the status it had');

  // The cause is put right; the next command in the worktree completes the move.
  await chmod(mainState, mode);
  const next = await rcf(w.lane, ['feedback', 'list', '--all', '--json']);
  assert.equal(next.code, 0, `the next rcf feedback command in the worktree exits 0\nstderr:\n${next.stderr}`);
  assert.deepEqual(Object.keys(snapshot(w.heldDir)), [], 'the next command completes the move: no held file is left under the worktree .rcf/feedback/');

  removeWorktree(w);
  assert.deepEqual(await listIn(w.main, ['--all']), expected,
    'after git worktree remove, rcf feedback list --all --json from the main checkout lists every id once with its status');
  const mainLines = lines(readFileSync(join(w.main, '.rcf', 'feedback', 'entries.jsonl'), 'utf8'));
  for (const line of lines(w.held['entries.jsonl'])) {
    assert.equal(mainLines.filter((l) => l === line).length, 1,
      `each line the worktree held is in the main checkout entries.jsonl exactly once (the completed move appends nothing twice):\n${line}`);
  }
  assert.deepEqual(feedbackStatusLines(w.main), [], 'git status in the main checkout lists nothing under .rcf/feedback/');
});

test('AC-16103-4: when moving the held queue fails after removing some held files, rcf feedback list in a linked worktree exits 1 naming the error and the main checkout, every removed held file has its content in the main store, every file still held is byte-identical, and the next command completes the move with each id once', async (t) => {
  const w = await partialMoveWorld('rcf-fbs231-move-fails-after-remove-', { mainOwn: false });

  // The main checkout ignores the store, so the next command in the worktree
  // moves the held queue; the worktree's outbox/ is read-only, so the move
  // copies everything and then cannot remove the held outbox bundle.
  const heldOutbox = join(w.heldDir, 'outbox');
  const mode = statSync(heldOutbox).mode & 0o777;
  await chmod(heldOutbox, 0o555);
  t.after(async () => { try { await chmod(heldOutbox, mode); } catch { /* ignore */ } });
  assert.throws(() => writeFileSync(join(heldOutbox, 'fixture-probe'), '', { flag: 'wx' }), /EACCES|EPERM/,
    'fixture: the worktree .rcf/feedback/outbox/ does not let a file be added or removed');

  const list = await rcf(w.lane, ['feedback', 'list', '--all', '--json']);
  assert.equal(list.code, 1, `rcf feedback list exits 1 when the move fails\nstdout:\n${list.stdout}\nstderr:\n${list.stderr}`);
  assert.match(list.stderr, /EACCES|permission denied/i, `stderr names the error the move hit\nstderr:\n${list.stderr}`);
  assert.ok(namesDir(list.stderr, w.main), `stderr names the main checkout\nstderr:\n${list.stderr}`);
  const now = snapshot(w.heldDir);
  for (const [name, bytes] of Object.entries(w.held)) {
    if (Object.hasOwn(now, name)) assert.equal(now[name], bytes, `a held file still in the worktree is byte-identical: ${name}`);
    else assertContentInMainStore(w, name, bytes);
  }
  assert.deepEqual(Object.keys(now).filter((n) => !Object.hasOwn(w.held, n)), [], 'nothing new is written under the worktree .rcf/feedback/');
  assert.ok(Object.keys(w.held).some((n) => !Object.hasOwn(now, n)), `the failed move removed at least one held file from the worktree (it fails after removing some held files); still held: ${Object.keys(now).join(', ')}`);
  assert.deepEqual(await listIn(w.main, ['--all']), heldExpected(w),
    'rcf feedback list --all --json from the main checkout lists every held entry, each id exactly once with the status it had');

  // The cause is put right; the next command in the worktree completes the move.
  await chmod(heldOutbox, mode);
  const next = await rcf(w.lane, ['feedback', 'list', '--all', '--json']);
  assert.equal(next.code, 0, `the next rcf feedback command in the worktree exits 0\nstderr:\n${next.stderr}`);
  assert.deepEqual(Object.keys(snapshot(w.heldDir)), [], 'the next command completes the move: no held file is left under the worktree .rcf/feedback/');

  removeWorktree(w);
  assert.deepEqual(await listIn(w.main, ['--all']), heldExpected(w),
    'after git worktree remove, rcf feedback list --all --json from the main checkout lists every id once with its status');
  assert.deepEqual(feedbackStatusLines(w.main), [], 'git status in the main checkout lists nothing under .rcf/feedback/');
});
