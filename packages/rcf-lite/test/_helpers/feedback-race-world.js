// Fixture world for the FBS-231 round 6 race tests (US-16103, US-16001):
// `node bin/rcf.js` child processes in real git repositories (host config
// isolated, no gh on PATH, no network, no agent CLI), the round 5 held-queue
// world rebuilt with new helpers, and the fixture side of the test-side
// preload test/_helpers/feedback-pause.mjs (a barrier, injected pauses and a
// pinned clock). Every temp dir comes from scratchDir; every child a test
// starts is reaped in t.after.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { initProject } from '#core/store/init.js';
import { scratchDir } from './scratch.js';

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');
const preload = pathToFileURL(join(here, 'feedback-pause.mjs')).href;

const ISOLATED = {
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
};

// No gh on this PATH: submit falls back to writing a bundle and never
// reaches the network.
export const NO_GH_PATH = '/nonexistent-bin';
const PLAIN_PATH = '/usr/bin:/bin';

// Every wait on a child is bounded well inside the 10 second test budget.
const WAIT_MS = 7000;

export function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd, env: { ...process.env, ...ISOLATED }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Start `node bin/rcf.js <args>` in cwd. opts: stdin, path (PATH), clock (an
 * ISO instant the child's clock is pinned to), and race (control dir, id,
 * pause points, barrier, main and held checkout directories).
 */
export function startRcf(cwd, args, opts = {}) {
  const env = { ...process.env, ...ISOLATED, CI: '1', PATH: opts.path ?? PLAIN_PATH };
  for (const k of ['RCF_FEEDBACK_DISABLE', 'RCF_FEEDBACK_ASK', 'RCF_FEEDBACK_SESSION_ID', 'CLAUDECODE']) delete env[k];
  for (const k of Object.keys(env)) if (k.startsWith('RCF_TEST_')) delete env[k];
  const nodeArgs = [];
  if (opts.clock || opts.race) nodeArgs.push('--import', preload);
  if (opts.clock) env.RCF_TEST_CLOCK = opts.clock;
  if (opts.race) {
    const { ctrl, id, at = [], barrier = false, main, held } = opts.race;
    Object.assign(env, { RCF_TEST_PAUSE_DIR: ctrl, RCF_TEST_PAUSE_ID: id, RCF_TEST_PAUSE_AT: at.join(',') });
    if (barrier) env.RCF_TEST_BARRIER = '1';
    if (main) env.RCF_TEST_PAUSE_MAIN = main;
    if (held) env.RCF_TEST_PAUSE_HELD = held;
  }
  const child = spawn(process.execPath, [...nodeArgs, bin, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const h = { id: opts.race?.id ?? String(child.pid), child, exited: false, stdout: '', stderr: '', args };
  child.stdout.setEncoding('utf8').on('data', (d) => { h.stdout += d; });
  child.stderr.setEncoding('utf8').on('data', (d) => { h.stderr += d; });
  h.result = new Promise((res) => {
    child.on('close', (code, signal) => {
      h.exited = true;
      res({ code: code ?? (signal ? 128 : 1), stdout: h.stdout, stderr: h.stderr });
    });
  });
  if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
  child.stdin.end();
  return h;
}

export async function rcf(cwd, args, opts = {}) {
  return startRcf(cwd, args, opts).result;
}

// Kill and await every child the test started, so a failed assertion never
// leaves a paused child behind.
export function reap(t, handles) {
  t.after(async () => {
    for (const h of handles) {
      if (!h.exited) h.child.kill('SIGKILL');
      await h.result;
    }
  });
}

export function release(ctrl, h, point) {
  writeFileSync(join(ctrl, `release-${h.id}-${point}`), 'go');
}

// Wait until the child is paused at the point (its marker written) or has
// exited; a wait that runs out, or a preload timeout, fails on this line.
export async function pausedOrExited(ctrl, h, point) {
  const start = Date.now();
  for (;;) {
    if (existsSync(join(ctrl, `paused-${h.id}-${point}`))) return 'paused';
    if (h.exited) {
      assert.equal(readdirSync(ctrl).filter((f) => f.startsWith(`timeout-${h.id}-`)).length, 0,
        `fixture: the pause for ${h.id} at ${point} was released in time`);
      return 'exited';
    }
    assert.ok(Date.now() - start < WAIT_MS, `fixture: ${h.id} (${h.args.join(' ')}) reached ${point} or exited within ${WAIT_MS} ms`);
    await delay(5);
  }
}

export async function paused(ctrl, h, point) {
  const state = await pausedOrExited(ctrl, h, point);
  assert.equal(state, 'paused', `fixture: ${h.id} (${h.args.join(' ')}) is held at ${point} (marker written)\nstderr:\n${h.stderr}`);
}

// Start the children held at the barrier, wait until each is ready, then
// release them together.
export async function barrier(ctrl, handles) {
  const start = Date.now();
  while (!handles.every((h) => existsSync(join(ctrl, `ready-${h.id}`)))) {
    assert.ok(handles.every((h) => !h.exited), 'fixture: no child exits before the barrier releases it');
    assert.ok(Date.now() - start < WAIT_MS, `fixture: every child reached the barrier within ${WAIT_MS} ms`);
    await delay(5);
  }
  writeFileSync(join(ctrl, 'go'), 'go');
}

export async function addEntry(cwd, title, clock) {
  const r = await rcf(cwd, ['feedback', 'add', '--kind', 'core', '--target', 'rcf verify run', '--anchor', 'AC-101-1',
    '--class', 'verb-error', '--severity', 'minor', '--title', title, '--body', 'fixture entry',
    '--evidence', 'rcf verify run', '--harness', 'claude-code'], { clock });
  assert.ok(/recorded (fb-[0-9a-z-]+)/.test(r.stdout), `fixture: rcf feedback add records "${title}" in ${cwd}\nstderr:\n${r.stderr}`);
  return /recorded (fb-[0-9a-z-]+)/.exec(r.stdout)[1];
}

export function hookArgs(sub) {
  return ['feedback', 'hook', sub, '--harness', 'claude-code'];
}

export function hookStdin(sub, sessionId) {
  const event = { stop: 'Stop', 'session-end': 'SessionEnd', 'session-start': 'SessionStart' }[sub];
  return JSON.stringify({ session_id: sessionId, cwd: '.', hook_event_name: event, stop_hook_active: false });
}

export async function hook(cwd, sub, sessionId, code, clock) {
  const r = await rcf(cwd, hookArgs(sub), { stdin: hookStdin(sub, sessionId), clock });
  assert.equal(r.code, code, `fixture: rcf feedback hook ${sub} in ${cwd} exits ${code}\nstderr:\n${r.stderr}`);
  return r;
}

export async function submitToBundle(cwd, clock) {
  const r = await rcf(cwd, ['feedback', 'submit', '--yes'], { path: NO_GH_PATH, clock });
  assert.equal(r.code, 0, `fixture: rcf feedback submit --yes without gh exits 0 in ${cwd}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /-> bundle /, `fixture: submit falls back to an outbox bundle in ${cwd}\nstdout:\n${r.stdout}`);
  return r;
}

export function sortPairs(pairs) {
  return [...pairs].sort((a, b) => a[0].localeCompare(b[0]));
}

export async function listIn(cwd, extra = ['--all']) {
  const r = await rcf(cwd, ['feedback', 'list', ...extra, '--json']);
  assert.equal(r.code, 0, `rcf feedback list ${extra.join(' ')} --json exits 0 in ${cwd}\nstderr:\n${r.stderr}`);
  return sortPairs(JSON.parse(r.stdout).map((e) => [e.id, e.status]));
}

export function feedbackStatusLines(cwd) {
  return git(cwd, 'status', '--porcelain', '--untracked-files=all').split('\n').filter((l) => l.includes('.rcf/feedback'));
}

export function namesDir(text, dir) {
  return text.includes(dir) || text.includes(realpathSync(dir));
}

// Every file under dir with its bytes ({} when dir is gone).
export function snapshot(dir) {
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

// Every outbox file's name, bytes and mtime.
export function outboxState(store) {
  const dir = join(store, 'outbox');
  const out = {};
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    out[name] = { bytes: readFileSync(p, 'utf8'), mtimeMs: statSync(p).mtimeMs, ino: statSync(p).ino };
  }
  return out;
}

export function lines(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
}

export function storeOf(dir) {
  return join(dir, '.rcf', 'feedback');
}

// The names of the files in the store's outbox/ that hold exactly these bytes.
export function namesHolding(store, bytes) {
  const outbox = snapshot(join(store, 'outbox'));
  return Object.keys(outbox).filter((n) => outbox[n] === bytes);
}

// Outbox files whose bytes are none of the known ones.
export function newOutboxBytes(store, known) {
  const outbox = snapshot(join(store, 'outbox'));
  return Object.values(outbox).filter((b) => !known.includes(b));
}

export function askedIn(store) {
  const p = join(store, 'state.json');
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')).asked ?? []) : [];
}

export function linesIn(store) {
  const p = join(store, 'entries.jsonl');
  return existsSync(p) ? lines(readFileSync(p, 'utf8')) : [];
}

// A racing command exits as it would alone (0, or the code given), or 1
// with stderr naming the error the move hit and the main checkout's
// directory (the failure clause of AC-16103-4).
export function assertRaceExit(r, main, label, alone = 0) {
  if (r.code === alone) return;
  assert.equal(r.code, 1, `${label} exits ${alone}, or 1 for a failed move\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stderr, /\bE[A-Z]{2,}\b|error/i, `${label} exits 1 with stderr naming the error the move hit\nstderr:\n${r.stderr}`);
  assert.ok(namesDir(r.stderr, main), `${label} exits 1 with stderr naming the main checkout\nstderr:\n${r.stderr}`);
}

/**
 * The held-queue world: a main checkout (rcf project, committed, its
 * .gitignore covering .rcf/feedback/) with a linked worktree that holds a
 * queue as 0.36.0 left it, recorded with the CLI in a plain seed checkout
 * and copied into the worktree's ignored .rcf/feedback/. Every seed command
 * runs with its clock pinned to `clock` (a whole second), so the held
 * bundles' names are known.
 *
 * shape 'session-end': one pending entry, a Stop hook ask ledger and one
 *   SessionEnd bundle.
 * shape 'both': two entries bundled together by submit (no gh on PATH, the
 *   whole-destination name <stamp>-<slug>.md) after the Stop hook asked and
 *   the SessionEnd hook wrote its bundle, and one discarded entry; no held
 *   entry is pending. The main checkout records two pending entries of its
 *   own.
 * variants: copies of the CLI-made SessionEnd bundle's bytes, each made
 *   distinct by a line the fixture appends, under distinct SessionEnd names.
 */
export async function heldWorld(prefix, { shape = 'session-end', variants = 0, clock } = {}) {
  const base = await scratchDir(prefix);
  const seed = join(base, 'seed');
  const main = join(base, 'repo');
  const lane = join(base, 'lane');
  const ctrl = join(base, 'ctrl');
  await mkdir(ctrl, { recursive: true });

  await mkdir(seed, { recursive: true });
  await initProject({ projectRoot: seed, projectName: 'RaceSeed' });
  await writeFile(join(seed, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  git(seed, 'init', '-q', '-b', 'main');
  if (shape === 'session-end') {
    await addEntry(seed, 'held in the worktree, pending', clock);
    await hook(seed, 'stop', 'seed-session', 2, clock);
    await hook(seed, 'session-end', 'seed-session', 0, clock);
  } else {
    await addEntry(seed, 'held in the worktree, bundled by submit (one)', clock);
    await addEntry(seed, 'held in the worktree, bundled by submit (two)', clock);
    await hook(seed, 'stop', 'seed-session', 2, clock);
    await hook(seed, 'session-end', 'seed-session', 0, clock);
    await submitToBundle(seed, clock);
    const discarded = await addEntry(seed, 'held in the worktree, discarded', clock);
    const d = await rcf(seed, ['feedback', 'discard', discarded], { clock });
    assert.equal(d.code, 0, `fixture: rcf feedback discard in the seed checkout\nstderr:\n${d.stderr}`);
  }
  const heldIds = await listIn(seed);

  await mkdir(main, { recursive: true });
  await initProject({ projectRoot: main, projectName: 'Race' });
  await writeFile(join(main, '.gitignore'), 'node_modules/\n.rcf/feedback/\n', 'utf8');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'chore: base');
  git(main, 'worktree', 'add', '-q', '-b', 'lane', lane);

  await cp(storeOf(seed), storeOf(lane), { recursive: true });
  const heldDir = storeOf(lane);
  const seStamp = new Date(clock).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:]/g, '-');
  const seName = `${seStamp}-session-end.md`;
  if (variants > 0) {
    const bytes = readFileSync(join(heldDir, 'outbox', seName), 'utf8');
    for (let k = 1; k <= variants; k += 1) {
      const stamp = new Date(Date.parse(clock) - k * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:]/g, '-');
      writeFileSync(join(heldDir, 'outbox', `${stamp}-session-end.md`), `${bytes}<!-- fixture variant ${k} -->\n`);
    }
  }
  const held = snapshot(heldDir);
  const heldBundles = Object.keys(held).filter((n) => n.startsWith('outbox/')).map((n) => n.slice('outbox/'.length));
  assert.ok(held['entries.jsonl'] && held['state.json'], `fixture: the worktree holds entries.jsonl and state.json: ${Object.keys(held).join(', ')}`);
  assert.ok(JSON.parse(held['state.json']).asked?.length > 0, 'fixture: the held state.json carries an ask record');
  assert.ok(heldBundles.includes(seName), `fixture: the worktree holds the SessionEnd bundle ${seName}: ${heldBundles.slice(0, 3).join(', ')}`);
  assert.equal(heldBundles.length, (shape === 'both' ? 2 : 1) + variants, 'fixture: the worktree holds the expected number of outbox bundles');
  assert.equal(new Set(heldBundles.map((n) => held[`outbox/${n}`])).size, heldBundles.length, 'fixture: every held bundle has bytes of its own');
  const submitName = heldBundles.find((n) => !n.endsWith('-session-end.md')) ?? null;

  let ownIds = [];
  if (shape === 'both') {
    await addEntry(main, 'recorded in the main checkout (one)', clock);
    await addEntry(main, 'recorded in the main checkout (two)', clock);
    ownIds = await listIn(main);
  }
  assert.deepEqual(feedbackStatusLines(lane), [], 'fixture: the worktree branch ignores its held queue');
  assert.deepEqual(feedbackStatusLines(main), [], 'fixture: the main checkout ignores its store');
  const mainBefore = snapshot(join(storeOf(main), 'outbox'));
  return {
    base, seed, main, lane, ctrl, heldDir, held, heldBundles, heldIds, ownIds, seName, submitName, clock, mainBefore,
    race: (id, at, extra = {}) => ({ ctrl, id, at, main, held: lane, ...extra }),
  };
}

/**
 * The outcome every concurrent path must leave, checked after every racing
 * command has finished: one more rcf feedback command run in the worktree,
 * then each held bundle's bytes in exactly one file of the main outbox, a
 * main outbox file that was there before byte-identical, each held entries
 * line once in the main entries.jsonl, each held ask record once in the main
 * state.json, no held file left under the worktree's .rcf/feedback/, every
 * id listed once from the main checkout with its status, git worktree remove
 * without --force, and nothing under .rcf/feedback/ in git status.
 * extra(w) runs after the bundle checks for the path's own writes.
 */
export async function assertOutcome(w, { expectedIds, extra, lanes = [w] } = {}) {
  for (const l of lanes) {
    const next = await rcf(l.lane, ['feedback', 'list', '--all', '--json']);
    assert.equal(next.code, 0, `one more rcf feedback command in the worktree exits 0\nstderr:\n${next.stderr}`);
  }
  const mainStore = storeOf(w.main);
  // The main outbox is read once; the names holding each set of bytes come
  // from that one read (namesHolding per bundle reread every file, which a
  // 300 bundle world cannot afford once every bundle is in place).
  const outboxNow = snapshot(join(mainStore, 'outbox'));
  const holding = new Map();
  for (const [n, b] of Object.entries(outboxNow)) holding.set(b, [...(holding.get(b) ?? []), n]);
  for (const l of lanes) for (const name of l.heldBundles) {
    const where = holding.get(l.held[`outbox/${name}`]) ?? [];
    assert.equal(where.length, 1,
      `each held bundle's bytes are in exactly one file of the main checkout outbox (never duplicated, overwritten or lost): ${name} is in [${where.slice(0, 8).join(', ')}${where.length > 8 ? ', ...' : ''}]`);
  }
  for (const [name, bytes] of Object.entries(w.mainBefore)) {
    assert.equal(outboxNow[name], bytes, `a main checkout outbox file that was there before is byte-identical: ${name}`);
  }
  if (extra) await extra(w);
  const have = linesIn(mainStore);
  for (const line of lanes.flatMap((l) => lines(l.held['entries.jsonl']))) {
    assert.equal(have.filter((l) => l === line).length, 1, `each held entries line is in the main checkout entries.jsonl exactly once:\n${line}`);
  }
  const asked = askedIn(mainStore);
  for (const record of lanes.flatMap((l) => JSON.parse(l.held['state.json']).asked ?? [])) {
    assert.equal(asked.filter((r) => isDeepStrictEqual(r, record)).length, 1,
      `each held ask record is in the main checkout state.json exactly once (never lost): ${JSON.stringify(record)}`);
  }
  for (const l of lanes) assert.deepEqual(Object.keys(snapshot(l.heldDir)), [], `no held file is left under the worktree .rcf/feedback/ (${l.lane})`);
  const expected = expectedIds ?? sortPairs([...lanes.flatMap((l) => l.heldIds), ...w.ownIds]);
  assert.deepEqual(await listIn(w.main), expected,
    'rcf feedback list --all --json from the main checkout lists every id once with the status it had');
  for (const l of lanes) {
    let removeError = null;
    try { git(w.main, 'worktree', 'remove', l.lane); } catch (err) { removeError = String(err.stderr ?? err.message); }
    assert.equal(removeError, null, `git worktree remove (no --force) succeeds: ${removeError}`);
  }
  assert.deepEqual(feedbackStatusLines(w.main), [], 'git status in the main checkout lists nothing under .rcf/feedback/');
}

/**
 * A second linked worktree of the world's main checkout holding a queue of
 * its own (shape 'session-end', recorded with the CLI in its own seed
 * checkout with the world's pinned clock, so its SessionEnd bundle takes the
 * same name as the first worktree's with other bytes).
 */
export async function addLane(w, name) {
  const seed = join(w.base, `${name}-seed`);
  const lane = join(w.base, name);
  await mkdir(seed, { recursive: true });
  await initProject({ projectRoot: seed, projectName: 'RaceSeedTwo' });
  await writeFile(join(seed, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  git(seed, 'init', '-q', '-b', 'main');
  await addEntry(seed, `held in the ${name} worktree, pending`, w.clock);
  await hook(seed, 'stop', `${name}-seed-session`, 2, w.clock);
  await hook(seed, 'session-end', `${name}-seed-session`, 0, w.clock);
  const heldIds = await listIn(seed);
  git(w.main, 'worktree', 'add', '-q', '-b', name, lane);
  await cp(storeOf(seed), storeOf(lane), { recursive: true });
  const heldDir = storeOf(lane);
  const held = snapshot(heldDir);
  const heldBundles = Object.keys(held).filter((n) => n.startsWith('outbox/')).map((n) => n.slice('outbox/'.length));
  assert.deepEqual(heldBundles, [w.seName], `fixture: the ${name} worktree holds one SessionEnd bundle named as the first worktree's`);
  assert.notEqual(held[`outbox/${w.seName}`], w.held[`outbox/${w.seName}`], 'fixture: the two worktrees hold that name with different bytes');
  assert.deepEqual(feedbackStatusLines(lane), [], `fixture: the ${name} worktree branch ignores its held queue`);
  return { lane, heldDir, held, heldBundles, heldIds };
}

// A plain checkout of a fixture project (no worktree): the rcf project, its
// .gitignore covering .rcf/feedback/, git initialised.
export async function plainCheckout(prefix) {
  const base = await scratchDir(prefix);
  const dir = join(base, 'repo');
  await mkdir(dir, { recursive: true });
  await initProject({ projectRoot: dir, projectName: 'SameSecond' });
  await writeFile(join(dir, '.gitignore'), 'node_modules/\n.rcf/feedback/\n', 'utf8');
  git(dir, 'init', '-q', '-b', 'main');
  return dir;
}

// A whole second near now, as an ISO instant (the pinned clock).
export function wholeSecond(offsetMs = 0) {
  return new Date(Math.floor((Date.now() + offsetMs) / 1000) * 1000).toISOString();
}
