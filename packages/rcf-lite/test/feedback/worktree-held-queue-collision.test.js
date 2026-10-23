// FBS-231 round 5 (US-16103, AC-16103-4): a linked worktree's held queue
// meets files of the same name in the main checkout's store. The move copies
// or unlinks three file classes under the worktree's .rcf/feedback/ (it skips
// anything that is not a regular file directly under outbox/ and leaves a
// directory that is not empty): entries.jsonl, state.json, and each outbox
// bundle (from the SessionEnd hook and from submit's bundle fallback). Each
// test drives `node bin/rcf.js` as a child process in a real git repository
// (host config isolated, no network, no agent CLI):
//
// 1. Identical content already in the main checkout, for every class: the
//    held files are removed and nothing is copied twice.
// 2. A main checkout with a state.json of its own: the held ask records are
//    merged in once each and every ask record the main checkout had is kept.
// 3. A held bundle whose name the main outbox already holds with different
//    bytes (one per writer): the held bytes are kept under a fresh name and
//    the main bundle stays byte-identical.
// 4. As 3, plus a move that fails after removing the collided held bundle (a
//    second held bundle is immutable, macOS chflags uchg): every held byte
//    stays readable from one of the two checkouts, and once the cause is put
//    right the next command completes the move with each bundle once.
//
// The held queue is recorded with the CLI in a separate plain checkout of a
// fixture project and its .rcf/feedback/ directory is copied into the
// worktree; a colliding main bundle is made by the main checkout's own CLI and
// given the held bundle's name with a rename. No JSON is written by hand and
// the store is never read through a module import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, readdirSync, realpathSync, renameSync } from 'node:fs';
import { cp, mkdir, writeFile } from 'node:fs/promises';
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

// No gh on this PATH: submit falls back to writing a bundle and never
// reaches the network.
const NO_GH_PATH = '/nonexistent-bin';

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd, env: { ...process.env, ...ISOLATED }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function rcf(cwd, args, stdin, path = '/usr/bin:/bin') {
  const env = { ...process.env, ...ISOLATED, CI: '1', PATH: path };
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
  assert.ok(/recorded (fb-[0-9a-z-]+)/.test(r.stdout), `fixture: rcf feedback add records "${title}" in ${cwd}\nstderr:\n${r.stderr}`);
  return /recorded (fb-[0-9a-z-]+)/.exec(r.stdout)[1];
}

async function hook(cwd, sub, sessionId, code) {
  const event = sub === 'stop' ? 'Stop' : 'SessionEnd';
  const r = await rcf(cwd, ['feedback', 'hook', sub, '--harness', 'claude-code'],
    JSON.stringify({ session_id: sessionId, cwd: '.', hook_event_name: event, stop_hook_active: false }));
  assert.equal(r.code, code, `fixture: rcf feedback hook ${sub} in ${cwd} exits ${code}\nstderr:\n${r.stderr}`);
}

async function submitToBundle(cwd) {
  const r = await rcf(cwd, ['feedback', 'submit', '--yes'], undefined, NO_GH_PATH);
  assert.equal(r.code, 0, `fixture: rcf feedback submit --yes without gh exits 0 in ${cwd}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /-> bundle /, `fixture: submit falls back to an outbox bundle in ${cwd}\nstdout:\n${r.stdout}`);
}

async function listIn(cwd, extra) {
  const r = await rcf(cwd, ['feedback', 'list', ...extra, '--json']);
  assert.equal(r.code, 0, `rcf feedback list ${extra.join(' ')} --json exits 0 in ${cwd}\nstderr:\n${r.stderr}`);
  return sortPairs(JSON.parse(r.stdout).map((e) => [e.id, e.status]));
}

function feedbackStatusLines(cwd) {
  return git(cwd, 'status', '--porcelain', '--untracked-files=all').split('\n').filter((l) => l.includes('.rcf/feedback'));
}

function namesDir(text, dir) {
  return text.includes(dir) || text.includes(realpathSync(dir));
}

// Every file under dir with its bytes ({} when dir is gone).
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

function mainStore(w) {
  return join(w.main, '.rcf', 'feedback');
}

// The names of the files in the main checkout's outbox/ that hold exactly
// these bytes.
function namesHolding(w, bytes) {
  const outbox = snapshot(join(mainStore(w), 'outbox'));
  return Object.keys(outbox).filter((n) => outbox[n] === bytes);
}

function mainAsked(w) {
  const p = join(mainStore(w), 'state.json');
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')).asked ?? []) : [];
}

function mainLines(w) {
  const p = join(mainStore(w), 'entries.jsonl');
  return existsSync(p) ? lines(readFileSync(p, 'utf8')) : [];
}

// A held file the command removed from the worktree has its content in the
// main checkout's store: each entry line is a line of the main entries.jsonl,
// each ask record is in the main state.json, and an outbox bundle's bytes are
// in a file of the main outbox/ under any name.
function assertHeldContentInMainStore(w, name, bytes) {
  if (name === 'entries.jsonl') {
    const have = mainLines(w);
    for (const line of lines(bytes)) {
      assert.ok(have.includes(line), `the removed held entries.jsonl has every line in the main checkout entries.jsonl; missing:\n${line}`);
    }
  } else if (name === 'state.json') {
    const asked = mainAsked(w);
    for (const record of JSON.parse(bytes).asked ?? []) {
      assert.ok(asked.some((r) => isDeepStrictEqual(r, record)),
        `the removed held state.json has every ask record in the main checkout state.json; missing: ${JSON.stringify(record)}`);
    }
  } else {
    assert.ok(namesHolding(w, bytes).length > 0,
      `the removed held ${name} has its bytes in a file of the main checkout outbox/ (under any name); the main outbox holds: ${Object.keys(snapshot(join(mainStore(w), 'outbox'))).join(', ')}`);
  }
}

// A main checkout (rcf project, committed, its .gitignore covering
// .rcf/feedback/) with a linked worktree that holds a queue as 0.36.0 left
// it, recorded with the CLI in a plain seed checkout and copied into the
// worktree's ignored .rcf/feedback/: entries.jsonl (one entry bundled by
// submit, one discarded, one pending), a state.json ask ledger (the Stop
// hook), a SessionEnd bundle and a submit fallback bundle. heldBundles lists
// the two bundle names in the order the move reads them (readdirSync with
// file types over the held outbox/).
async function collisionWorld(prefix) {
  const base = await scratchDir(prefix);
  const seed = join(base, 'seed');
  const main = join(base, 'repo');
  const lane = join(base, 'lane');

  await mkdir(seed, { recursive: true });
  await initProject({ projectRoot: seed, projectName: 'CollisionSeed' });
  await writeFile(join(seed, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  git(seed, 'init', '-q', '-b', 'main');
  await addEntry(seed, 'held in the worktree, bundled by submit');
  const discarded = await addEntry(seed, 'held in the worktree, discarded');
  const discard = await rcf(seed, ['feedback', 'discard', discarded]);
  assert.equal(discard.code, 0, `fixture: rcf feedback discard in the seed checkout\nstderr:\n${discard.stderr}`);
  await hook(seed, 'stop', 'seed-stop-session', 2);
  await hook(seed, 'session-end', 'seed-stop-session', 0);
  await submitToBundle(seed);
  await addEntry(seed, 'held in the worktree, pending');
  const heldIds = await listIn(seed, ['--all']);

  await mkdir(main, { recursive: true });
  await initProject({ projectRoot: main, projectName: 'Collision' });
  await writeFile(join(main, '.gitignore'), 'node_modules/\n.rcf/feedback/\n', 'utf8');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'chore: base');
  git(main, 'worktree', 'add', '-q', '-b', 'lane', lane);

  await cp(join(seed, '.rcf', 'feedback'), join(lane, '.rcf', 'feedback'), { recursive: true });
  const heldDir = join(lane, '.rcf', 'feedback');
  const held = snapshot(heldDir);
  const heldBundles = readdirSync(join(heldDir, 'outbox'), { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
  assert.ok(held['entries.jsonl'] && held['state.json'], `fixture: the worktree holds entries.jsonl and state.json: ${Object.keys(held).join(', ')}`);
  assert.ok(JSON.parse(held['state.json']).asked?.length > 0, 'fixture: the held state.json carries an ask record');
  assert.equal(heldBundles.length, 2, `fixture: the worktree holds two outbox bundles: ${heldBundles.join(', ')}`);
  assert.equal(heldBundles.filter((n) => n.endsWith('-session-end.md')).length, 1,
    `fixture: one held bundle is the SessionEnd hook's and one is submit's fallback: ${heldBundles.join(', ')}`);
  assert.equal(heldIds.length, 3, `fixture: the seed checkout lists three entries: ${JSON.stringify(heldIds)}`);
  assert.deepEqual(feedbackStatusLines(lane), [], 'fixture: the worktree branch ignores its held queue');
  assert.deepEqual(feedbackStatusLines(main), [], 'fixture: the main checkout ignores its store');
  return { base, seed, main, lane, heldDir, held, heldBundles, heldIds };
}

// The main checkout's own queue: one entry, a SessionEnd bundle and a submit
// fallback bundle, made by its own CLI. Returns its own bundle names (the
// SessionEnd one first) and its own listing.
async function mainOwnBundles(w) {
  await addEntry(w.main, 'recorded in the main checkout');
  await hook(w.main, 'session-end', 'main-end-session', 0);
  const sessionEnd = Object.keys(snapshot(join(mainStore(w), 'outbox')));
  assert.equal(sessionEnd.length, 1, `fixture: the main checkout SessionEnd hook writes one bundle: ${sessionEnd.join(', ')}`);
  await submitToBundle(w.main);
  const submit = Object.keys(snapshot(join(mainStore(w), 'outbox'))).filter((n) => n !== sessionEnd[0]);
  assert.equal(submit.length, 1, `fixture: the main checkout submit writes one fallback bundle: ${submit.join(', ')}`);
  return { names: [sessionEnd[0], submit[0]], ids: await listIn(w.main, ['--all']) };
}

// Give a main bundle the held bundle's name (a rename of CLI-made bytes), so
// the main outbox holds that name with different bytes.
function collide(w, mainName, heldName) {
  const outbox = join(mainStore(w), 'outbox');
  if (mainName !== heldName) renameSync(join(outbox, mainName), join(outbox, heldName));
  const bytes = readFileSync(join(outbox, heldName), 'utf8');
  assert.notEqual(bytes, w.held[`outbox/${heldName}`], `fixture: the main outbox holds ${heldName} with bytes other than the held bundle's`);
  return bytes;
}

function removeWorktree(w) {
  let removeError = null;
  try { git(w.main, 'worktree', 'remove', w.lane); } catch (err) { removeError = String(err.stderr ?? err.message); }
  assert.equal(removeError, null, `git worktree remove (no --force) succeeds: ${removeError}`);
}

test('AC-16103-4 guard: when the main checkout already holds the same entries.jsonl, state.json and outbox bundles (from the SessionEnd hook and from submit) as a linked worktree, the next rcf feedback command there removes every held file and copies nothing twice', async () => {
  const w = await collisionWorld('rcf-fbs231-collision-identical-');
  // Identical content already in the main checkout: its store is a copy of
  // the CLI-made bytes the worktree holds, every class under the same name.
  await cp(join(w.seed, '.rcf', 'feedback'), mainStore(w), { recursive: true });
  assert.deepEqual(snapshot(mainStore(w)), w.held, 'fixture: the main checkout store holds the same files with the same bytes');

  const r = await rcf(w.lane, ['feedback', 'list', '--all', '--json']);
  assert.equal(r.code, 0, `the next rcf feedback command in the worktree exits 0\nstderr:\n${r.stderr}`);
  assert.deepEqual(Object.keys(snapshot(w.heldDir)), [], 'every held file is removed from the worktree .rcf/feedback/');

  const have = mainLines(w);
  for (const line of lines(w.held['entries.jsonl'])) {
    assert.equal(have.filter((l) => l === line).length, 1,
      `each line the worktree held is in the main checkout entries.jsonl exactly once (nothing appended twice):\n${line}`);
  }
  const asked = mainAsked(w);
  for (const record of JSON.parse(w.held['state.json']).asked) {
    assert.equal(asked.filter((a) => isDeepStrictEqual(a, record)).length, 1,
      `each ask record the worktree held is in the main checkout state.json exactly once: ${JSON.stringify(record)}`);
  }
  for (const name of w.heldBundles) {
    assert.deepEqual(namesHolding(w, w.held[`outbox/${name}`]), [name],
      `the held ${name} bytes are in the main checkout outbox exactly once, at that name and under no second name`);
  }
  assert.deepEqual(Object.keys(snapshot(join(mainStore(w), 'outbox'))).sort(), [...w.heldBundles].sort(),
    'the main checkout outbox holds the same bundles and nothing else');

  removeWorktree(w);
  assert.deepEqual(await listIn(w.main, ['--all']), w.heldIds,
    'rcf feedback list --all --json from the main checkout lists every held id once with the status it had');
  assert.deepEqual(feedbackStatusLines(w.main), [], 'git status in the main checkout lists nothing under .rcf/feedback/');
});

test('AC-16103-4 guard: when the main checkout holds a state.json of its own, the next rcf feedback command in a linked worktree merges every held ask record into the main state.json once and keeps every ask record the main checkout had', async () => {
  const w = await collisionWorld('rcf-fbs231-collision-state-');
  // Different content under the same name: the main checkout records its own
  // entry and its own Stop hook ask, so its entries.jsonl and state.json
  // differ from the held ones.
  await addEntry(w.main, 'recorded in the main checkout');
  await hook(w.main, 'stop', 'main-stop-session', 2);
  const ownAsked = mainAsked(w);
  const heldAsked = JSON.parse(w.held['state.json']).asked;
  assert.ok(ownAsked.length > 0 && !isDeepStrictEqual(ownAsked, heldAsked), 'fixture: the main checkout state.json holds ask records other than the held ones');
  const mainIds = await listIn(w.main, ['--all']);

  const r = await rcf(w.lane, ['feedback', 'list', '--all', '--json']);
  assert.equal(r.code, 0, `the next rcf feedback command in the worktree exits 0\nstderr:\n${r.stderr}`);
  assert.equal(existsSync(join(w.heldDir, 'state.json')), false, 'the held state.json is removed from the worktree');

  const asked = mainAsked(w);
  for (const record of ownAsked) {
    assert.equal(asked.filter((a) => isDeepStrictEqual(a, record)).length, 1,
      `every ask record the main checkout had is kept once in its state.json (never overwritten): ${JSON.stringify(record)}`);
  }
  for (const record of heldAsked) {
    assert.equal(asked.filter((a) => isDeepStrictEqual(a, record)).length, 1,
      `every ask record the worktree held is in the main checkout state.json exactly once (never lost): ${JSON.stringify(record)}`);
  }

  removeWorktree(w);
  assert.deepEqual(await listIn(w.main, ['--all']), sortPairs([...w.heldIds, ...mainIds]),
    'rcf feedback list --all --json from the main checkout lists its own entries and every held entry, each id once with the status it had');
  assert.deepEqual(feedbackStatusLines(w.main), [], 'git status in the main checkout lists nothing under .rcf/feedback/');
});

test('AC-16103-4: when the main checkout outbox already holds the name of each held bundle (the SessionEnd and the submit fallback bundle) with different bytes, the next rcf feedback command in a linked worktree exits 0, keeps each held bundle under a fresh name in the main outbox, leaves each main bundle byte-identical and removes every held file', async () => {
  const w = await collisionWorld('rcf-fbs231-collision-bundle-');
  // The main checkout's own SessionEnd bundle takes the held SessionEnd
  // bundle's name and its own submit fallback bundle the held submit
  // bundle's name (the probe got a shared name from two flushes in the same
  // second).
  const own = await mainOwnBundles(w);
  const heldSessionEnd = w.heldBundles.find((n) => n.endsWith('-session-end.md'));
  const heldSubmit = w.heldBundles.find((n) => n !== heldSessionEnd);
  const before = { [heldSessionEnd]: collide(w, own.names[0], heldSessionEnd), [heldSubmit]: collide(w, own.names[1], heldSubmit) };

  const r = await rcf(w.lane, ['feedback', 'list', '--all', '--json']);
  assert.equal(r.code, 0, `the next rcf feedback command in the worktree exits 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  for (const name of w.heldBundles) {
    const at = namesHolding(w, w.held[`outbox/${name}`]);
    assert.equal(at.length, 1,
      `the held ${name} bytes are in the main checkout outbox exactly once (kept, never lost); the main outbox holds: ${Object.keys(snapshot(join(mainStore(w), 'outbox'))).join(', ')}`);
    assert.notEqual(at[0], name, `the held ${name} bytes are kept under a fresh name, not the colliding one`);
    assert.equal(readFileSync(join(mainStore(w), 'outbox', name), 'utf8'), before[name],
      `the main checkout bundle at ${name} is byte-identical to before (never overwritten)`);
  }
  assert.deepEqual(Object.keys(snapshot(w.heldDir)), [], 'no held file is left under the worktree .rcf/feedback/');
  assert.deepEqual(await listIn(w.main, ['--all']), sortPairs([...w.heldIds, ...own.ids]),
    'rcf feedback list --all --json from the main checkout lists its own entry and every held entry, each id once with the status it had');

  removeWorktree(w);
  assert.deepEqual(feedbackStatusLines(w.main), [], 'git status in the main checkout lists nothing under .rcf/feedback/');
});

test('AC-16103-4: when moving the held queue fails after removing a held bundle whose name the main outbox already holds with different bytes, rcf feedback list in a linked worktree exits 1 naming the error and the main checkout, every held byte stays readable from one of the two checkouts, and the next command completes the move with each held bundle once in the main outbox', {
  skip: process.platform === 'darwin' ? false : 'a per-file unlink failure needs chflags uchg (macOS); an unprivileged Linux user has no per-file equivalent',
}, async (t) => {
  const w = await collisionWorld('rcf-fbs231-collision-fails-');
  // The move removes the outbox files in the order it reads them: the first
  // held bundle collides with a main bundle of the same name, the last one
  // is immutable, so the move fails after the collided bundle's removal.
  const own = await mainOwnBundles(w);
  const collided = w.heldBundles[0];
  const stuck = join(w.heldDir, 'outbox', w.heldBundles[1]);
  const mainAtCollided = collide(w, own.names[w.heldBundles[0].endsWith('-session-end.md') ? 0 : 1], collided);
  execFileSync('/usr/bin/chflags', ['uchg', stuck]);
  t.after(() => { try { execFileSync('/usr/bin/chflags', ['nouchg', stuck]); } catch { /* ignore */ } });
  assert.throws(() => closeSync(openSync(stuck, 'r+')), /EPERM|EACCES/, 'fixture: the last held bundle is immutable (cannot be written or removed)');

  const list = await rcf(w.lane, ['feedback', 'list', '--all', '--json']);
  assert.equal(list.code, 1, `rcf feedback list exits 1 when the move fails\nstdout:\n${list.stdout}\nstderr:\n${list.stderr}`);
  assert.match(list.stderr, /EPERM|operation not permitted/i, `stderr names the error the move hit\nstderr:\n${list.stderr}`);
  assert.ok(namesDir(list.stderr, w.main), `stderr names the main checkout\nstderr:\n${list.stderr}`);
  const now = snapshot(w.heldDir);
  for (const [name, bytes] of Object.entries(w.held)) {
    if (Object.hasOwn(now, name)) assert.equal(now[name], bytes, `a held file still in the worktree is byte-identical: ${name}`);
    else assertHeldContentInMainStore(w, name, bytes);
  }
  assert.deepEqual(Object.keys(now).filter((n) => !Object.hasOwn(w.held, n)), [], 'nothing new is written under the worktree .rcf/feedback/');
  const expected = sortPairs([...w.heldIds, ...own.ids]);
  assert.deepEqual(await listIn(w.main, ['--all']), expected,
    'rcf feedback list --all --json from the main checkout lists its own entry and every held entry, each id exactly once with the status it had');

  // The cause is put right; the next command in the worktree completes the move.
  execFileSync('/usr/bin/chflags', ['nouchg', stuck]);
  const next = await rcf(w.lane, ['feedback', 'list', '--all', '--json']);
  assert.equal(next.code, 0, `the next rcf feedback command in the worktree exits 0\nstderr:\n${next.stderr}`);
  assert.deepEqual(Object.keys(snapshot(w.heldDir)), [], 'the next command completes the move: no held file is left under the worktree .rcf/feedback/');
  for (const name of w.heldBundles) {
    assert.equal(namesHolding(w, w.held[`outbox/${name}`]).length, 1, `the held ${name} bytes are in the main checkout outbox exactly once`);
  }
  assert.equal(readFileSync(join(mainStore(w), 'outbox', collided), 'utf8'), mainAtCollided,
    `the main checkout bundle at ${collided} is byte-identical to before (never overwritten)`);
  const have = mainLines(w);
  for (const line of lines(w.held['entries.jsonl'])) {
    assert.equal(have.filter((l) => l === line).length, 1, `each line the worktree held is in the main checkout entries.jsonl exactly once:\n${line}`);
  }

  removeWorktree(w);
  assert.deepEqual(await listIn(w.main, ['--all']), expected,
    'after git worktree remove, rcf feedback list --all --json from the main checkout lists every id once with its status');
  assert.deepEqual(feedbackStatusLines(w.main), [], 'git status in the main checkout lists nothing under .rcf/feedback/');
});
