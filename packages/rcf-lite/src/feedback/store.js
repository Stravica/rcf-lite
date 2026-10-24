// Feedback local store (TAC-4102). Slice 1 (FBS-180): the on-disk log
// under `.rcf/feedback/`. Append-only JSONL for entries, fold-by-id on
// read; a per-session state ledger at `state.json`; an outbox directory
// for bundle files (written in slice 4, referenced here so the store's
// path helpers are complete).
//
// The store is gitignored via the 0.6.0 managed-block aggregator
// (`src/setup/managed-gitignore.js`). This module OWNS the aggregator
// entry constant (`feedbackGitignoreEntry`), mirroring the pattern in
// `src/preflight/secrets.js:preflightEntry` and
// `src/setup/identity-seed.js:identityEntry`. Adding it to the
// aggregator is a one-import, one-array-line change.
//
// A pre-write refusal (`ensureGitignore`) is the belt to the aggregator's
// braces: on a project whose `.gitignore` does not effectively cover
// `.rcf/feedback/` the first `rcf feedback add` refuses instead of
// creating the log, protecting a pre-upgrade project against an
// accidental push of raw entries. `--force` overrides for the test
// path and for the operator who has audited their `.gitignore` by
// hand.

import {
  mkdir, readFile, stat, writeFile,
} from 'node:fs/promises';
import {
  accessSync, constants, copyFileSync, existsSync, mkdirSync, readdirSync,
  readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import {
  basename, dirname, extname, join, relative, resolve, sep,
} from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

/** Absolute path helpers under a project root. */
const FEEDBACK_DIR = '.rcf/feedback';

/**
 * Relative path (from project root) of the per-project feedback
 * settings file. Committed to the repo; the hooks and the CLI treat
 * this as the source of truth for `ask`, `quietMinutes` and the
 * `redaction.allowHosts` extension list (design section 8).
 */
export const FEEDBACK_SETTINGS_PATH = 'rcf/feedback-settings.json';

/**
 * Default settings the hook and the ask-branch fall back to when
 * `rcf/feedback-settings.json` is missing or empty. `ask: true` keeps
 * the RULE 17 posture: silent capture, one ask per session at a
 * pause, unless the operator has opted out for the project.
 */
export const DEFAULT_FEEDBACK_SETTINGS = Object.freeze({
  settingsVersion: 1,
  ask: true,
  quietMinutes: 15,
  redaction: Object.freeze({ allowHosts: [] }),
});

/**
 * Managed-gitignore aggregator entry (§4.1's 0.7.0-style extension:
 * feature modules own their entry constant; the aggregator imports it).
 * The trailing slash keeps the whole directory ignored (log, state,
 * outbox and any future sibling files).
 */
export const feedbackGitignoreEntry = Object.freeze({
  path: '.rcf/feedback/',
  owner: 'rcf feedback: local feedback log and outbox (never committed)',
  since: '0.28.0',
});

/**
 * The project root whose `.rcf/feedback/` holds the queue (AC-16103-4).
 * In a linked git worktree that is the same project in the main checkout
 * (when the main checkout holds the project, `rcf/manifest.json`), so an
 * entry outlives `git worktree remove`. A queue the worktree already holds
 * in its own `.rcf/feedback/` (as 0.36.0 left it) is moved into the main
 * checkout's store on the first call once git ignores the store there, so
 * the move never leaves a file the main checkout would commit; until then
 * the worktree keeps its held queue and this returns `projectRoot`. The
 * move runs only while it holds the main checkout's store lock
 * (`takeStoreLock`): when another live command holds it (or is breaking a
 * stale one), this call does not move, leaves the held queue where it is
 * for the next command and returns the main checkout, so two moves never
 * overlap. A move that fails throws
 * (code `RCF_FEEDBACK_MOVE_FAILED`, naming the main checkout) having removed
 * a held file only once its content is in the main checkout's store, so
 * nothing is lost or duplicated and the next call completes the move; the
 * lock is released on success and on failure. Anywhere else (the main
 * checkout, no git, a main checkout without the project) it is
 * `projectRoot` itself.
 *
 * @param {string} projectRoot
 * @returns {string}
 */
export function storeRoot(projectRoot) {
  const mainRoot = mainCheckoutRoot(projectRoot);
  if (mainRoot === null || !existsSync(join(projectRoot, FEEDBACK_DIR))) return mainRoot ?? projectRoot;
  if (!storeIgnored(mainRoot)) return projectRoot;
  let lock = null;
  try {
    lock = takeStoreLock(mainRoot, 'move');
    if (lock !== null) moveHeldQueue(projectRoot, mainRoot, lock.keep);
  } catch (err) {
    const failure = new Error(`could not move this worktree's held feedback queue into the main checkout ${mainRoot}: ${err.message}`, { cause: err });
    failure.code = 'RCF_FEEDBACK_MOVE_FAILED';
    throw failure;
  } finally {
    lock?.release();
  }
  return mainRoot;
}

/**
 * The same project path in the main checkout when `projectRoot` sits in a
 * linked git worktree whose main checkout holds the project
 * (`rcf/manifest.json`); null anywhere else (the main checkout itself, no
 * git, a bare or separate-git-dir worktree, a main checkout without the
 * project, or a read error).
 *
 * @param {string} projectRoot
 * @returns {string | null}
 */
export function mainCheckoutRoot(projectRoot) {
  for (let top = resolve(projectRoot); ; top = dirname(top)) {
    const dotGit = join(top, '.git');
    if (existsSync(dotGit)) {
      try {
        if (statSync(dotGit).isDirectory()) return null;
        let gitDir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim();
        if (!gitDir) return null;
        gitDir = resolve(top, gitDir);
        const common = resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim());
        const mainRoot = join(dirname(common), relative(top, resolve(projectRoot)));
        if (basename(common) !== '.git' || !existsSync(join(mainRoot, 'rcf', 'manifest.json'))) return null;
        return mainRoot;
      } catch {
        return null;
      }
    }
    if (dirname(top) === top) return null;
  }
}

/**
 * Does git ignore the feedback store in `root`? Synchronous
 * `git check-ignore` (exit 0 only); any other answer is no.
 *
 * @param {string} root
 * @returns {boolean}
 */
function storeIgnored(root) {
  const r = spawnSync('git', ['check-ignore', '-q', join(FEEDBACK_DIR, 'entries.jsonl')], {
    cwd: root, env: process.env, stdio: 'ignore',
  });
  return r.status === 0;
}

/**
 * Move a worktree's held queue into the main checkout's store
 * (AC-16103-4). The caller holds the main checkout's store lock, so no
 * other command changes that store while this reads and writes it, and
 * `keep` refreshes the lock before every step, so a long move is never
 * taken for stopped. Entry lines the main log does not already carry are
 * added in order (fold-by-id keeps each id once with its status, and a
 * rerun after an interrupted move adds nothing twice); the ask ledgers
 * merge (asked sessions united, the later `queueStateAt`). entries.jsonl
 * and state.json are replaced whole (`replaceFileSync`), so a reader never
 * sees a half-written file. An outbox bundle, and a filing a submit in the
 * worktree kept in its `filed/` (`recordFiling`), is compared by bytes with
 * every file of the main store's same directory: bytes already there are
 * not copied again (so a rerun after an interrupted move copies nothing
 * twice); other bytes are copied under the file's own name, or, when the
 * main store already uses that name, under a fresh one
 * (`copyUnderFreeName`), never over a main file. A moved filing is
 * recorded by the next submit in the main checkout (`foldFilingReceipts`),
 * so neither checkout files that entry again. The moved files are then
 * removed from the worktree, so nothing is left for `git worktree remove`
 * to drop.
 *
 * @param {string} fromRoot
 * @param {string} toRoot
 * @param {() => void} keep - refreshes the held store lock (throws when it was lost)
 * @returns {void}
 */
function moveHeldQueue(fromRoot, toRoot, keep) {
  const from = join(fromRoot, FEEDBACK_DIR);
  const to = join(toRoot, FEEDBACK_DIR);
  mkdirSync(to, { recursive: true });
  const moved = [];
  const fromEntries = join(from, 'entries.jsonl');
  if (existsSync(fromEntries)) {
    const toEntries = join(to, 'entries.jsonl');
    const have = existsSync(toEntries) ? readFileSync(toEntries, 'utf8') : '';
    const seen = new Set(have.split('\n').map((l) => l.trim()));
    const lines = readFileSync(fromEntries, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !seen.has(l));
    if (lines.length > 0) {
      keep();
      replaceFileSync(toEntries, `${have}${have === '' || have.endsWith('\n') ? '' : '\n'}${lines.join('\n')}\n`);
    }
    moved.push(fromEntries);
  }
  const fromState = join(from, 'state.json');
  if (existsSync(fromState)) {
    const toState = join(to, 'state.json');
    const parse = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) ?? {}; } catch { return {}; } };
    const held = parse(fromState);
    const own = existsSync(toState) ? parse(toState) : {};
    const asked = Array.isArray(own.asked) ? [...own.asked] : [];
    const keys = new Set(asked.map((a) => `${a?.sessionId}|${a?.askedAt}`));
    for (const a of Array.isArray(held.asked) ? held.asked : []) {
      if (!keys.has(`${a?.sessionId}|${a?.askedAt}`)) asked.push(a);
    }
    const stamps = [held.queueStateAt, own.queueStateAt].filter((s) => typeof s === 'string' && s !== '').sort();
    keep();
    replaceFileSync(toState, `${JSON.stringify({ ...held, ...own, asked, queueStateAt: stamps.at(-1) ?? null }, null, 2)}\n`);
    moved.push(fromState);
  }
  const fromOutbox = join(from, 'outbox');
  const fromFiled = join(from, FILED_DIR);
  for (const [fromDir, toDir] of [[fromOutbox, join(to, 'outbox')], [fromFiled, join(to, FILED_DIR)]]) {
    if (!existsSync(fromDir)) continue;
    mkdirSync(toDir, { recursive: true });
    const have = readdirSync(toDir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => readFileSync(join(toDir, d.name)));
    for (const dirent of readdirSync(fromDir, { withFileTypes: true })) {
      if (!dirent.isFile()) continue;
      const src = join(fromDir, dirent.name);
      const bytes = readFileSync(src);
      if (!have.some((b) => b.equals(bytes))) {
        keep();
        copyUnderFreeName(src, bytes, toDir, dirent.name);
        have.push(bytes);
      }
      moved.push(src);
    }
  }
  for (const p of moved) {
    keep();
    unlinkSync(p);
  }
  for (const d of [fromOutbox, fromFiled, from]) {
    try { rmdirSync(d); } catch { /* not empty or absent: a sibling the store does not own stays */ }
  }
}

/**
 * Copy `src` (whose content is `bytes`) into `dir` under `name`, or, when
 * `dir` already holds that name, under the first free
 * `<stem>+held-<n><ext>` (n = 1, 2, ...). COPYFILE_EXCL makes every attempt
 * fail rather than replace an existing file, so no file in `dir` is ever
 * overwritten; when an attempt meets a file that already holds the same
 * bytes, nothing is copied (the bundle is already there). The bundle
 * writers never take a `+held-` name: `writeBundle` writes
 * `<stamp>-<slug>[-<id>].md` and the SessionEnd hook
 * `<stamp>-session-end.md`, each with a `+<n>` suffix (digits only) only
 * when that name is taken. So a later write never lands on a fresh name,
 * and a fresh name never ends `-session-end.md`, so the SessionEnd hook's
 * idempotency scan never reads one as its own.
 *
 * @param {string} src
 * @param {Buffer} bytes
 * @param {string} dir
 * @param {string} name
 * @returns {void}
 */
function copyUnderFreeName(src, bytes, dir, name) {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 0; ; n += 1) {
    const to = join(dir, n === 0 ? name : `${stem}+held-${n}${ext}`);
    try {
      copyFileSync(src, to, constants.COPYFILE_EXCL);
      return;
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      if (readFileSync(to).equals(bytes)) return;
    }
  }
}

/**
 * The store-wide lock (AC-16103-4, decisions 84 to 86): one file,
 * `.rcf/feedback/store.lock`, beside entries.jsonl, state.json and outbox/
 * (git ignores it with the rest of the store; no reader takes it for a
 * queue file, and no move or writer takes it for a bundle). It is created
 * with exclusive create and holds `{ pid, hostname, startedAt, refreshedAt,
 * token }`. Every writer of a store takes it for its whole read, change and
 * write: the held-queue move, `rcf feedback add`, the Stop hook's ledger
 * write, the SessionEnd and submit bundle writes and every entry or ask
 * ledger write below.
 *
 * Stale rule (decision 86): a lock is stale, and may be broken, only when
 * its holder's pid is not alive on this host, or its `refreshedAt` is more
 * than 60 seconds behind this process's clock. The holder refreshes
 * `refreshedAt` while it works, whenever a second has passed since the
 * last refresh (the move before each of its steps, any other holder from
 * a one-second timer while it awaits), so a command that is still
 * running is never stale, however long ago it started, and its lock is
 * never broken (a holder stopped for more than 60 seconds, a laptop asleep
 * say, or one whose clock is behind the next command's, can lose it). A
 * lock whose content cannot be parsed (an exclusive create a breath before
 * its write, or a holder stopped between the two) is judged by its file's
 * age instead.
 *
 * Fencing (decision 88): a holder reads its lock again immediately before
 * every rename or replace it makes under the lock (`replaceFileSync`, and
 * `keep` under the claim); once the lock is no longer its own (another
 * command judged it stopped and took the store over) it writes nothing
 * more to the store and throws `RCF_FEEDBACK_LOCK_LOST`, naming the lock
 * file it lost (the dispatcher exits 1), so a holder that was set aside
 * never writes over a later holder's write.
 *
 * Breaking (decision 87): the lock file is replaced or removed only by a
 * command holding the claim on that one lock (`claimStoreLock`), after it
 * has read the lock again under the claim and found exactly what it
 * judged; the holder refreshes and removes its own lock under the same
 * claim. A breaker replaces the stale lock with its own in one rename, so
 * the store is never left unheld between the stopped holder and the next.
 * So any number of commands that judge one stale lock at once break it
 * once: one of them takes the store, every other one waits (a writer) or
 * leaves the held queue (a move), and no command removes a lock it did not
 * judge or a fresh holder's lock. A claim whose claimant is still running
 * on this host is never passed, however old it looks (decision 88).
 */
const STORE_LOCK = 'store.lock';
const LOCK_STALE_MS = 60_000;
const LOCK_REFRESH_MS = 1_000;
const LOCK_POLL_MS = 25;
const LOCK_WAIT_MS = 10_000;
/** The wait of the write that records a filed issue: the stale window and a margin (decision 87). */
const FILED_WAIT_MS = 65_000;
/** Where submit keeps a filing it could not record (`recordFiling`), under `.rcf/feedback/`. */
const FILED_DIR = 'filed';
/** @type {Map<string, { depth: number, text: string, lock: object, refreshed: number, handle: { keep: () => void, release: () => void } }>} */
const heldLocks = new Map();
const lockPause = new Int32Array(new SharedArrayBuffer(4));

/**
 * Run `fn` holding the store lock of the store that `projectRoot` writes
 * (the main checkout's for a linked worktree). A held lock is waited for,
 * polling, for up to `RCF_FEEDBACK_LOCK_WAIT_MS` milliseconds (by default
 * 10 seconds, or, with `filed`, 65 seconds of Date: the write that records
 * an issue submit has already filed); if it is still held then, this
 * throws `RCF_FEEDBACK_STORE_BUSY` naming the holder (its pid, or the lock
 * file's path and age when that file cannot be parsed) and the store's
 * checkout before `fn` writes anything. Nested calls in one process share
 * the lock.
 *
 * @template T
 * @param {string} projectRoot
 * @param {() => Promise<T>} fn
 * @param {{ filed?: boolean }} [opts]
 * @returns {Promise<T>}
 */
export async function withStoreLock(projectRoot, fn, { filed = false } = {}) {
  const lock = takeStoreLock(storeRoot(projectRoot), filed ? 'filed' : 'write');
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

/**
 * Take the store lock of `root`'s `.rcf/feedback/`. Returns its handle
 * (`keep` refreshes it, `release` removes it once the outermost holder in
 * this process is done, and only while it is still this holder's), or,
 * when another live command holds it (or holds the claim on a stale one):
 * null for the move (`mode` 'move' does not wait: it skips), else, once
 * the wait runs out, an `RCF_FEEDBACK_STORE_BUSY` error. A stale lock is
 * broken (`breakStoreLock`) and this command holds the store in its place.
 * The writers' wait (`mode` 'write') runs on the monotonic clock, the
 * filing record's (`mode` 'filed') on Date, as decision 87 words it.
 *
 * @param {string} root
 * @param {'move' | 'write' | 'filed'} mode
 * @returns {{ keep: () => void, release: () => void } | null}
 */
function takeStoreLock(root, mode) {
  const dir = join(root, FEEDBACK_DIR);
  const path = join(dir, STORE_LOCK);
  const mine = heldLocks.get(path);
  if (mine) {
    mine.depth += 1;
    return mine.handle;
  }
  mkdirSync(dir, { recursive: true });
  const raw = process.env.RCF_FEEDBACK_LOCK_WAIT_MS ?? '';
  const waitMs = mode === 'move' ? 0 : /^\d+$/.test(raw) ? Number(raw) : mode === 'filed' ? FILED_WAIT_MS : LOCK_WAIT_MS;
  const clock = mode === 'filed' ? () => Date.now() : () => performance.now();
  const start = clock();
  for (;;) {
    const fresh = newStoreLock();
    try {
      writeFileSync(path, fresh.text, { encoding: 'utf8', flag: 'wx' });
      return holdStoreLock(path, fresh.lock, fresh.text);
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
    }
    const seen = readStoreLock(path);
    if (seen === null) continue;
    if (storeLockStale(seen)) {
      const took = breakStoreLock(path, seen, fresh);
      if (took) return took;
      if (took === false) continue;
    }
    if (clock() - start >= waitMs) {
      if (mode === 'move') return null;
      const holder = seen.lock === null
        ? `a lock file ${path} that cannot be parsed, ${Math.max(0, Math.floor((Date.now() - seen.mtimeMs) / 1000))} seconds old (it counts as stopped once it is more than 60 seconds old)`
        : `another rcf feedback command (process ${seen.lock.pid ?? 'unknown'} on ${seen.lock.hostname ?? 'unknown host'}, running since ${seen.lock.startedAt ?? 'an unknown time'})`;
      const busy = new Error(seen.lock === null
        ? `the feedback store in ${root} is busy: it holds ${holder}, so this command wrote nothing; run it again once that lock is gone or stale`
        : `the feedback store in ${root} is busy: ${holder} is still changing it, so this command wrote nothing; run it again once that command finishes`);
      busy.code = 'RCF_FEEDBACK_STORE_BUSY';
      busy.root = root;
      busy.holder = holder;
      throw busy;
    }
    Atomics.wait(lockPause, 0, 0, LOCK_POLL_MS);
  }
}

/**
 * A new lock (or claim) for this process: its content and the text written.
 *
 * @returns {{ lock: { pid: number, hostname: string, startedAt: string, refreshedAt: string, token: string }, text: string }}
 */
function newStoreLock() {
  const at = new Date().toISOString();
  const lock = { pid: process.pid, hostname: hostname(), startedAt: at, refreshedAt: at, token: randomBytes(8).toString('hex') };
  return { lock, text: `${JSON.stringify(lock)}\n` };
}

/**
 * Record a lock this process just created (or took over) and build its
 * handle. `keep` rewrites `refreshedAt` (whole, by rename) once a second at
 * most, under the claim on this lock and after checking the lock is still
 * this holder's; a lock another command broke or is breaking (this holder
 * stalled for more than 60 seconds, or its clock is behind) is never
 * written over, `keep` throws instead. `fence` reads the lock again and
 * throws the same error when it is no longer this holder's
 * (`replaceFileSync` calls it before every replace under the lock).
 * `release` removes the lock under the same claim, and leaves it to a
 * command that holds the claim. A timer calls `keep` while the holder
 * awaits.
 *
 * @param {string} path
 * @param {object} lock
 * @param {string} text
 * @returns {{ keep: () => void, fence: () => void, release: () => void }}
 */
function holdStoreLock(path, lock, text) {
  const state = { depth: 1, text, lock, refreshed: Date.now(), handle: null };
  const lost = () => {
    const err = new Error(`this command lost its hold on the feedback store in ${dirname(dirname(dirname(path)))}: its lock ${path} was taken over by another command that judged it stopped (this command was held up for more than 60 seconds, or its clock is behind the other command's), so it stopped before changing the store any further; every write the other command made is kept, so run this command again`);
    err.code = 'RCF_FEEDBACK_LOCK_LOST';
    return err;
  };
  const keep = () => {
    const now = Date.now();
    if (Math.abs(now - state.refreshed) < LOCK_REFRESH_MS) return;
    const give = claimStoreLock(path, lock.token);
    if (give === null) throw lost();
    try {
      if (readStoreLock(path)?.text !== state.text) throw lost();
      state.lock = { ...state.lock, refreshedAt: new Date(now).toISOString() };
      state.text = `${JSON.stringify(state.lock)}\n`;
      replaceFileSync(path, state.text);
      state.refreshed = now;
    } finally {
      give();
    }
  };
  const timer = setInterval(() => {
    try { keep(); } catch { clearInterval(timer); }
  }, LOCK_REFRESH_MS);
  timer.unref();
  state.handle = {
    keep,
    fence() {
      if (readStoreLock(path)?.lock?.token !== lock.token) throw lost();
    },
    release() {
      state.depth -= 1;
      if (state.depth > 0) return;
      clearInterval(timer);
      heldLocks.delete(path);
      try {
        const give = claimStoreLock(path, lock.token);
        if (give === null) return;
        let removed = false;
        try {
          if (readStoreLock(path)?.text === state.text) {
            unlinkSync(path);
            removed = true;
          }
        } finally {
          give(removed);
        }
      } catch { /* gone already: nothing of this holder's is left */ }
    },
  };
  heldLocks.set(path, state);
  return state.handle;
}

/**
 * Read a lock (or claim) file: its text, its content when it parses as a
 * JSON object (else null), its inode and mtime, and its key (the token, or,
 * for a file that cannot be parsed, its inode and mtime).
 *
 * @param {string} path
 * @returns {{ text: string, lock: any, ino: number, mtimeMs: number, key: string } | null} null when there is no such file
 */
function readStoreLock(path) {
  let text;
  let st;
  try {
    text = readFileSync(path, 'utf8');
    st = statSync(path);
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
  let lock = null;
  try {
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object') lock = parsed;
  } catch { /* cannot be parsed: judged by its file's age */ }
  const key = typeof lock?.token === 'string' && /^[0-9a-f]{1,64}$/.test(lock.token)
    ? lock.token
    : `${st.ino}-${Math.trunc(st.mtimeMs)}`;
  return { text, lock, ino: st.ino, mtimeMs: st.mtimeMs, key };
}

/**
 * The stale rule (decision 86; see the lock's comment above): the holder's
 * pid is not alive on this host, or the lock has not been refreshed for 60
 * seconds by this process's clock (a lock that cannot be parsed: its file's
 * mtime). A refresh time ahead of this clock is not stale. A claim
 * (`claim`, decision 88) whose claimant's pid is alive on this host is
 * never stale, whatever its age: age passes a claim only when its pid
 * cannot be checked (another host, or a file that cannot be parsed).
 *
 * @param {{ lock: any, mtimeMs: number }} seen - as `readStoreLock` read it
 * @param {{ claim?: boolean }} [opts]
 * @returns {boolean}
 */
function storeLockStale(seen, { claim = false } = {}) {
  const lock = seen.lock;
  if (lock?.hostname === hostname() && Number.isInteger(lock?.pid) && lock.pid > 0) {
    try {
      process.kill(lock.pid, 0);
      if (claim) return false;
    } catch (err) {
      if (err?.code === 'ESRCH') return true;
      if (claim && err?.code === 'EPERM') return false;
    }
  }
  let refreshed = Date.parse(lock?.refreshedAt ?? '');
  if (!Number.isFinite(refreshed)) refreshed = seen.mtimeMs;
  return Date.now() - refreshed > LOCK_STALE_MS;
}

/**
 * Break the stale lock `seen` (decision 87): under the claim on that lock,
 * read it again and, only when it is still the lock that was judged (the
 * same bytes, inode and mtime), replace it with this command's lock
 * `fresh` in one rename, so the store is held throughout and a lock taken
 * after the judgement is never touched. Returns this command's handle once
 * it holds the store; false when the lock changed after it was judged
 * (look again); null when another command holds the claim (it is breaking,
 * refreshing or removing that lock: wait for it). Once the stale lock is
 * replaced, the claims of stopped claimants it passed are removed with its
 * own (decision 88): no command needs a claim on that lock any more.
 *
 * @param {string} path
 * @param {{ text: string, ino: number, mtimeMs: number, key: string }} seen
 * @param {{ lock: object, text: string }} fresh
 * @returns {{ keep: () => void, fence: () => void, release: () => void } | false | null}
 */
function breakStoreLock(path, seen, fresh) {
  const give = claimStoreLock(path, seen.key);
  if (give === null) return null;
  let replaced = false;
  try {
    const now = readStoreLock(path);
    if (now === null || now.text !== seen.text || now.ino !== seen.ino || now.mtimeMs !== seen.mtimeMs) return false;
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, fresh.text, 'utf8');
    renameSync(temp, path);
    replaced = true;
    return holdStoreLock(path, fresh.lock, fresh.text);
  } finally {
    give(replaced);
  }
}

/**
 * Take the claim on the lock whose key is `key` (decision 87): the one
 * right to replace or remove that lock, by exclusive create of
 * `store.lock.<key>.claim`. A claim whose claimant has stopped (its pid not
 * alive on this host, or, when its pid cannot be checked, more than 60
 * seconds old; `storeLockStale` with `claim`) is passed by the next level
 * (`.claim-1`, `.claim-2`, ...), so a command stopped inside a claim never
 * keeps a stale lock from being broken; a claimant still running on this
 * host is never passed, however old its claim looks. Returns the function
 * that gives the claim up (it removes this command's claim file; with
 * `retired`, once the lock the claim was for is replaced or removed, also
 * each passed claim that still reads as it did when it was passed), or null
 * when a live command holds the claim.
 *
 * @param {string} path
 * @param {string} key
 * @returns {((retired?: boolean) => void) | null}
 */
function claimStoreLock(path, key) {
  const passed = [];
  for (let n = 0; ;) {
    const claim = `${path}.${key}.claim${n === 0 ? '' : `-${n}`}`;
    try {
      writeFileSync(claim, newStoreLock().text, { encoding: 'utf8', flag: 'wx' });
      return (retired = false) => {
        try { unlinkSync(claim); } catch { /* gone already */ }
        if (!retired) return;
        for (const p of passed) {
          try {
            if (readStoreLock(p.path)?.text === p.text) unlinkSync(p.path);
          } catch { /* gone already */ }
        }
      };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
    }
    const held = readStoreLock(claim);
    if (held === null) continue;
    if (!storeLockStale(held, { claim: true })) return null;
    passed.push({ path: claim, text: held.text });
    n += 1;
  }
}

/**
 * Replace `path` with `text` whole: write a temp file in the same
 * directory, then rename it over `path`, so a reader sees the old file or
 * the new one, never a half-written one. A file that is there and not
 * writable is refused (EACCES) as a plain write would refuse it. Before a
 * replace in a store whose lock this process holds, the holder reads its
 * lock again (`fence`, decision 88) and writes nothing once it is lost.
 *
 * @param {string} path
 * @param {string} text
 * @returns {void}
 */
function replaceFileSync(path, text) {
  for (const [lockPath, held] of heldLocks) {
    if (path !== lockPath && path.startsWith(`${dirname(lockPath)}${sep}`)) held.handle.fence();
  }
  if (existsSync(path)) accessSync(path, constants.W_OK);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, 'utf8');
  renameSync(temp, path);
}

/**
 * Add `line` at the end of `path` by replacing the whole file
 * (`replaceFileSync`, decision 87): the file ends with the same bytes an
 * append would leave, and a reader reads it as it was before or after,
 * never a partial line. The caller holds the store lock.
 *
 * @param {string} path
 * @param {string} line
 * @returns {void}
 */
function appendWhole(path, line) {
  let have = '';
  try {
    have = readFileSync(path, 'utf8');
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  replaceFileSync(path, `${have}${line}`);
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
export function feedbackDir(projectRoot) {
  return join(storeRoot(projectRoot), FEEDBACK_DIR);
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
export function entriesPath(projectRoot) {
  return join(feedbackDir(projectRoot), 'entries.jsonl');
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
export function statePath(projectRoot) {
  return join(feedbackDir(projectRoot), 'state.json');
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
export function outboxDir(projectRoot) {
  return join(feedbackDir(projectRoot), 'outbox');
}

/**
 * @typedef {object} FeedbackEntry
 * @property {string} id                 fb-<yyyymmdd>-<4-hex>
 * @property {string} recordedAt         ISO timestamp
 * @property {string} sessionId          session id at capture time
 * @property {'blueprint' | 'core'} kind
 * @property {object} target             see design §4.1
 * @property {string | null} anchor      AC/REQ/TAC/ADR id, or null
 * @property {string} symptomClass       closed enum (design §6)
 * @property {'blocker' | 'major' | 'minor'} severity
 * @property {string} title              <= 120 chars
 * @property {string} body               <= 8 KB
 * @property {Array<{ kind: string, value: string }>} evidence
 * @property {object} environment        harness / rcfLiteVersion / nodeVersion / platform
 * @property {boolean} askNow
 * @property {'pending' | 'submitted' | 'bundled' | 'discarded' | 'deferredUntilSession'} status
 * @property {object} destination
 */

/**
 * @typedef {object} StateTransition
 * @property {string} id
 * @property {string} at                 ISO timestamp
 * @property {'pending' | 'submitted' | 'bundled' | 'deferredUntilSession' | 'discarded'} status
 * @property {string} [issueUrl]
 * @property {string} [outboxPath]
 * @property {'new' | 'comment' | 'unchecked'} [dedupe]
 * @property {string} [sessionId]
 */

/**
 * Read `entries.jsonl` and fold by id: for each id the LAST line wins.
 * Returns an array of current-state entries in first-seen order, so
 * `list` prints them by recording time by default.
 *
 * @param {string} projectRoot
 * @returns {Promise<FeedbackEntry[]>}
 */
export async function readEntries(projectRoot) {
  let text;
  try {
    text = await readFile(entriesPath(projectRoot), 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return [];
    throw err;
  }
  const byId = new Map();
  const order = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      // A malformed line is not the store's failure surface; the writer
      // never appends malformed lines. If one appears, skip and let the
      // audit tools surface it.
      continue;
    }
    if (typeof obj?.id !== 'string') continue;
    if (!byId.has(obj.id)) {
      order.push(obj.id);
      byId.set(obj.id, obj);
    } else {
      byId.set(obj.id, { ...byId.get(obj.id), ...obj });
    }
  }
  return order.map((id) => byId.get(id));
}

/**
 * Append one entry to the JSONL log, holding the store lock
 * (`withStoreLock`; a caller already holding it shares it), by replacing
 * the whole file (`appendWhole`), so a reader never reads a partial line.
 * Ensures the
 * parent directory exists (mkdir recursive) so the first call on a fresh
 * project does not require a separate init step.
 *
 * @param {string} projectRoot
 * @param {FeedbackEntry} entry
 * @returns {Promise<void>}
 */
export async function appendEntry(projectRoot, entry) {
  await withStoreLock(projectRoot, async () => {
    await mkdir(feedbackDir(projectRoot), { recursive: true });
    const line = `${JSON.stringify(entry)}\n`;
    appendWhole(entriesPath(projectRoot), line);
  });
}

/**
 * Read the raw JSONL log and return the FIRST `discarded` transition
 * timestamp per id. Used by the retention sweep so the 30-day clock
 * runs from when the operator discarded the entry, not from when it
 * was first recorded (F-slice-1-09 fix: an entry discarded today that
 * was recorded 60 days ago must not prune on the next add).
 *
 * @param {string} projectRoot
 * @returns {Promise<Map<string, string>>}
 */
export async function readDiscardTimestamps(projectRoot) {
  const out = new Map();
  let text;
  try {
    text = await readFile(entriesPath(projectRoot), 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return out;
    throw err;
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (typeof obj?.id !== 'string') continue;
    if (obj.status !== 'discarded') continue;
    if (out.has(obj.id)) continue;
    // A real state transition carries `at`; a seeded initial entry
    // written with status:'discarded' from the start has only
    // `recordedAt`. Both are legitimate first-discarded timestamps.
    const ts = typeof obj.at === 'string'
      ? obj.at
      : (typeof obj.recordedAt === 'string' ? obj.recordedAt : null);
    if (ts) out.set(obj.id, ts);
  }
  return out;
}

/**
 * Append one state-transition line for an existing id. Callers pass a
 * SHAPE that the reader's fold-by-id merges over the base entry; state
 * transitions are additive, never destructive rewrites. Holds the store
 * lock and replaces the whole file as `appendEntry` does.
 *
 * @param {string} projectRoot
 * @param {StateTransition} transition
 * @returns {Promise<void>}
 */
export async function appendState(projectRoot, transition) {
  await withStoreLock(projectRoot, async () => {
    await mkdir(feedbackDir(projectRoot), { recursive: true });
    const line = `${JSON.stringify(transition)}\n`;
    appendWhole(entriesPath(projectRoot), line);
  });
}

/**
 * Read the per-session ask ledger (`state.json`). Missing file returns
 * the empty ledger. The shape is `{ asked: Array<{ sessionId, askedAt }>, queueStateAt: string | null }`;
 * slice 5 fills it, slice 1 keeps the reader here so the whole store's
 * shape lives in one file.
 *
 * @param {string} projectRoot
 * @returns {Promise<{ asked: Array<{ sessionId: string, askedAt: string }>, queueStateAt: string | null }>}
 */
export async function readAskLedger(projectRoot) {
  try {
    const text = await readFile(statePath(projectRoot), 'utf8');
    const parsed = JSON.parse(text);
    return {
      asked: Array.isArray(parsed?.asked) ? parsed.asked : [],
      queueStateAt: typeof parsed?.queueStateAt === 'string' ? parsed.queueStateAt : null,
    };
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return { asked: [], queueStateAt: null };
    }
    throw err;
  }
}

/**
 * Overwrite the ask ledger, whole (`replaceFileSync`: a reader never sees
 * a half-written state.json), holding the store lock as `appendEntry`
 * does. Only slice 5 needs to write this; slice 1 exports the writer so
 * tests can seed a ledger without a private import path.
 *
 * @param {string} projectRoot
 * @param {{ asked: Array<{ sessionId: string, askedAt: string }>, queueStateAt: string | null }} ledger
 * @returns {Promise<void>}
 */
export async function writeAskLedger(projectRoot, ledger) {
  await withStoreLock(projectRoot, async () => {
    await mkdir(feedbackDir(projectRoot), { recursive: true });
    replaceFileSync(statePath(projectRoot), `${JSON.stringify(ledger, null, 2)}\n`);
  });
}

/**
 * Record an issue `rcf feedback submit` has already filed or commented on
 * (its `submitted` state line, AC-16103-4, decision 87). The write is never
 * abandoned on a busy store: it waits for the store lock up to 65 seconds
 * of Date (`RCF_FEEDBACK_LOCK_WAIT_MS` overrides), so a hung holder is
 * broken as stale and the record lands. If the store is still held then,
 * the filing is kept whole in `.rcf/feedback/filed/<entry id>.json` (none
 * of the store's queue files, and no reader takes it for one) and this
 * throws `RCF_FEEDBACK_FILING_UNRECORDED`, naming the issue's URL and the
 * entry's id; the next submit records the kept filing
 * (`foldFilingReceipts`) and never files that entry again.
 *
 * @param {string} projectRoot
 * @param {StateTransition} transition - status submitted, with issueUrl
 * @returns {Promise<void>}
 */
export async function recordFiling(projectRoot, transition) {
  try {
    await withStoreLock(projectRoot, () => appendState(projectRoot, transition), { filed: true });
    return;
  } catch (err) {
    if (err?.code !== 'RCF_FEEDBACK_STORE_BUSY') throw err;
    let next;
    try {
      if (!/^[\w.-]+$/.test(transition.id)) throw new Error(`the entry id ${transition.id} is not a file name`);
      const dir = join(feedbackDir(projectRoot), FILED_DIR);
      mkdirSync(dir, { recursive: true });
      const kept = join(dir, `${transition.id}.json`);
      const temp = `${kept}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(transition)}\n`, 'utf8');
      renameSync(temp, kept);
      next = `the filing is kept in ${kept}, and the next rcf feedback submit records ${transition.id} as submitted without filing it again`;
    } catch (keepErr) {
      next = `keeping a record of the filing failed too (${keepErr.message}), so the next rcf feedback submit may file ${transition.id} again`;
    }
    const unrecorded = new Error(`rcf feedback submit filed ${transition.id} as ${transition.issueUrl}, but ${err.holder} still held the feedback store in ${err.root} when this command's wait for it ran out, so the store does not show ${transition.id} as submitted yet; ${next}`, { cause: err });
    unrecorded.code = 'RCF_FEEDBACK_FILING_UNRECORDED';
    throw unrecorded;
  }
}

/**
 * Record the filings an earlier submit kept (`recordFiling`) before this
 * submit reads its pending entries, holding the store lock: an entry still
 * pending or deferred gets the kept `submitted` state line, any other keeps
 * its status, and each kept file is removed once read, so no entry is filed
 * twice (a filing the held-queue move brought in from a worktree included).
 * Returns the transitions recorded. With `dryRun` (decision 88) it takes no
 * lock and writes nothing: it returns the transitions it would record, so
 * `submit --dry-run` never lists a kept filing as one it would file.
 *
 * @param {string} projectRoot
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<StateTransition[]>}
 */
export async function foldFilingReceipts(projectRoot, { dryRun = false } = {}) {
  const dir = join(feedbackDir(projectRoot), FILED_DIR);
  if (!existsSync(dir)) return [];
  const fold = async () => {
    const status = new Map((await readEntries(projectRoot)).map((e) => [e.id, e.status]));
    const recorded = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const kept = join(dir, name);
      let transition;
      try {
        transition = JSON.parse(readFileSync(kept, 'utf8'));
      } catch {
        continue;
      }
      if (typeof transition?.id !== 'string' || typeof transition?.issueUrl !== 'string') continue;
      const now = status.get(transition.id);
      if (now === 'pending' || now === 'deferredUntilSession') {
        if (!dryRun) await appendState(projectRoot, transition);
        status.set(transition.id, 'submitted');
        recorded.push(transition);
      }
      if (!dryRun) unlinkSync(kept);
    }
    if (!dryRun) {
      try { rmdirSync(dir); } catch { /* not empty: a file it did not read stays */ }
    }
    return recorded;
  };
  return dryRun ? fold() : withStoreLock(projectRoot, fold);
}

/**
 * Pre-write gitignore check. Returns `{ ok: true }` when git itself
 * would ignore the feedback store path we are about to write; returns
 * `{ ok: false, reason }` otherwise. Callers with `--force` bypass the
 * check.
 *
 * F-slice-1-01 regression fix: the previous implementation walked
 * `.gitignore` as a literal state machine and only recognised a small
 * covers-set (`.rcf/feedback/`, `.rcf/`, ...) plus a hand-coded
 * negation shortlist. That both missed valid wildcard shapes (`.rcf/*`
 * covers the dir, but was rejected) and mis-judged the ignored-parent
 * case (`.rcf/feedback/` + `!.rcf/feedback/*`: git cannot re-include a
 * file whose parent is ignored, so the store is still safe, but the
 * literal walker set `ignored=false` and refused). Delegating to
 * `git check-ignore` means we judge the path the way git will judge it
 * on the next `git add .`, which is the guarantee we actually need.
 *
 * When git is not installed or the project is not a git repo, we fall
 * back to a conservative textual read of `.gitignore`: any line that
 * folds one of `.rcf/feedback/`, `.rcf/feedback`, `.rcf/`, `.rcf`,
 * `.rcf/*`, `.rcf/**`, or `.rcf/feedback/*` into the ignore set is
 * enough. The fallback is deliberately generous because a machine
 * without git cannot mis-publish through `git add`.
 *
 * @param {string} projectRoot
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function ensureGitignore(projectRoot) {
  const probeRelative = join('.rcf', 'feedback', 'entries.jsonl');
  const git = await runGitCheckIgnore(projectRoot, probeRelative);
  if (git.ok !== null) {
    if (git.ok) return { ok: true };
    return { ok: false, reason: `git check-ignore says ${probeRelative} would be committed by git add` };
  }
  // Fallback (no git, or not a repo): permissive textual scan.
  let text;
  try {
    text = await readFile(join(projectRoot, '.gitignore'), 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return { ok: false, reason: 'no .gitignore in project root' };
    }
    throw err;
  }
  // Walk .gitignore in order; toggle the ignored state whenever a
  // line (positive or `!` negation) covers the feedback store. The
  // last-word wins, which mirrors git's own last-match-wins semantics
  // for a file whose parent chain is not itself excluded through a
  // pattern the negation cannot re-include (which we cannot judge
  // without git; the check-ignore path above does).
  //
  // Round 3 (fallback-negation regression): a `!` line whose pattern
  // is NOT in the coversFeedback vocabulary might still re-include
  // entries.jsonl under real git (e.g. `.rcf/feedback/*` paired with
  // `!*.jsonl`). The fallback cannot judge safely, so remember the
  // unrecognised negation and refuse ok:true when one appears
  // alongside a positive ignore. The known-vocabulary case still
  // toggles as before, preserving the last-word-wins semantics that
  // the round-2 tests pinned.
  let ignored = false;
  let unknownNegation = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const isNeg = line.startsWith('!');
    const pattern = (isNeg ? line.slice(1) : line).replace(/\/+$/, '').replace(/^\.\//, '');
    const covers = coversFeedback(pattern);
    if (covers) {
      ignored = !isNeg;
    } else if (isNeg) {
      unknownNegation = line;
    }
  }
  if (ignored && unknownNegation) {
    return {
      ok: false,
      reason: `.gitignore contains a negation the fallback cannot evaluate ('${unknownNegation}') and git is not available for check-ignore; install git (or 'git init' the project) so the check can decide safely`,
    };
  }
  if (ignored) return { ok: true };
  return { ok: false, reason: 'no .gitignore rule covers .rcf/feedback/' };
}

/**
 * Does a gitignore pattern (leading `!` already stripped, trailing
 * slash normalised) cover the feedback store directory or a file
 * inside it? Recognises the literal directory / file paths plus the
 * common wildcard shapes callers write (`.rcf/*`, `.rcf/**`,
 * `.rcf/feedback/*`, `.rcf/feedback/**`).
 *
 * @param {string} pattern
 * @returns {boolean}
 */
function coversFeedback(pattern) {
  const set = new Set([
    '.rcf',
    '.rcf/feedback',
    '.rcf/feedback/entries.jsonl',
    '.rcf/*',
    '.rcf/**',
    '.rcf/feedback/*',
    '.rcf/feedback/**',
  ]);
  return set.has(pattern);
}

/**
 * Run `git check-ignore -q <path>` in `projectRoot`. Returns `ok`
 * true when git says the path would be ignored (exit 0), false when
 * git says it would be committed (exit 1), and null when git could
 * not answer (no git, not a repo, or any other error) so the caller
 * knows to fall back.
 *
 * @param {string} projectRoot
 * @param {string} relativePath
 * @returns {Promise<{ ok: true | false | null, reason: string | null }>}
 */
async function runGitCheckIgnore(projectRoot, relativePath) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn('git', ['check-ignore', '-q', relativePath], {
        cwd: projectRoot,
        env: process.env,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
    } catch {
      resolvePromise({ ok: null, reason: 'git not spawnable' });
      return;
    }
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      resolvePromise(payload);
    };
    child.on('error', () => finish({ ok: null, reason: 'git spawn error' }));
    child.on('close', (code) => {
      if (code === 0) finish({ ok: true, reason: null });
      else if (code === 1) finish({ ok: false, reason: null });
      else finish({ ok: null, reason: `git check-ignore exit ${code}` });
    });
  });
}

/**
 * Generate a fresh entry id: `fb-<yyyymmdd>-<12-hex>`. Ruling R2
 * (Dave 2026-09-16): 12-hex tail with a uniqueness probe on append
 * so a busy day's 100+ findings do not collide (a 16-bit tail had a
 * ~7.6% collision at 100 finds/day, which converted a distinct
 * finding into a state transition on the old one via the fold-by-id
 * reader). Callers should use `mintUniqueEntryId` when they can
 * afford one read of the entries log; `newEntryId` remains the raw
 * generator for tests that inject an rng.
 *
 * @param {Date} [now]
 * @param {() => number} [rng] - 0..1; injectable for tests
 * @returns {string}
 */
export function newEntryId(now = new Date(), rng = Math.random) {
  const yyyy = now.getUTCFullYear().toString().padStart(4, '0');
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = now.getUTCDate().toString().padStart(2, '0');
  // 48 bits split into three 16-bit words so we never rely on 32-bit
  // integer coercion and every call has full 48-bit entropy.
  const words = [];
  for (let i = 0; i < 3; i += 1) {
    words.push(Math.floor(rng() * 0x10000).toString(16).padStart(4, '0'));
  }
  return `fb-${yyyy}${mm}${dd}-${words.join('')}`;
}

/**
 * Mint an entry id and re-generate on collision. F-slice-1-03 /
 * ruling R2: append is preceded by a uniqueness probe over the read
 * entries so no two rows share an id. The retry budget is 32; if
 * every generated id still collides (astronomically unlikely with
 * 48 bits of entropy) the last generated id is returned so the caller
 * can decide how to escalate.
 *
 * @param {string} projectRoot
 * @param {Date} [now]
 * @param {() => number} [rng]
 * @returns {Promise<string>}
 */
export async function mintUniqueEntryId(projectRoot, now = new Date(), rng = Math.random) {
  const existing = new Set((await readEntries(projectRoot)).map((e) => e.id));
  for (let i = 0; i < 32; i += 1) {
    const id = newEntryId(now, rng);
    if (!existing.has(id)) return id;
  }
  // F-slice-1-03 (fix round 2): fail closed rather than return a
  // colliding id the caller would blindly append. R2's contract says
  // "no two rows share an id"; returning the last colliding id would
  // violate the shape even if the collision is astronomically
  // unlikely (48 bits of entropy). handleAdd catches this and refuses
  // the write with a usage-shaped error so the operator sees it.
  const err = new Error(
    'entry-id retry exhausted: 32 mint attempts all collided with existing ids. '
    + 'This is astronomically unlikely with 48 bits of entropy - suspect a corrupted '
    + '.rcf/feedback/entries.jsonl or a broken rng seed.',
  );
  /** @type {any} */ (err).code = 'FEEDBACK_ID_EXHAUSTED';
  throw err;
}

/**
 * Read `rcf/feedback-settings.json` and fold onto the defaults. A
 * missing file returns the defaults verbatim (design section 8: a
 * project without the file is still an opted-in project); an
 * unparseable file returns `{ settings: defaults, parseError }` so
 * the caller can surface the fault without crashing the hook.
 *
 * @param {string} projectRoot
 * @returns {Promise<{ settings: { settingsVersion: number, ask: boolean, quietMinutes: number, redaction: { allowHosts: string[] } }, parseError: string | null, present: boolean }>}
 */
export async function readFeedbackSettings(projectRoot) {
  const path = join(projectRoot, FEEDBACK_SETTINGS_PATH);
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return {
        settings: { ...DEFAULT_FEEDBACK_SETTINGS, redaction: { allowHosts: [] } },
        parseError: null,
        present: false,
      };
    }
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      settings: { ...DEFAULT_FEEDBACK_SETTINGS, redaction: { allowHosts: [] } },
      parseError: err.message,
      present: true,
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      settings: { ...DEFAULT_FEEDBACK_SETTINGS, redaction: { allowHosts: [] } },
      parseError: 'not a JSON object',
      present: true,
    };
  }
  const ask = typeof parsed.ask === 'boolean' ? parsed.ask : DEFAULT_FEEDBACK_SETTINGS.ask;
  const quietMinutes = Number.isFinite(parsed.quietMinutes) && parsed.quietMinutes >= 0
    ? parsed.quietMinutes
    : DEFAULT_FEEDBACK_SETTINGS.quietMinutes;
  const settingsVersion = Number.isFinite(parsed.settingsVersion)
    ? parsed.settingsVersion
    : DEFAULT_FEEDBACK_SETTINGS.settingsVersion;
  const allowHosts = Array.isArray(parsed?.redaction?.allowHosts)
    ? parsed.redaction.allowHosts.filter((v) => typeof v === 'string')
    : [];
  return {
    settings: { settingsVersion, ask, quietMinutes, redaction: { allowHosts } },
    parseError: null,
    present: true,
  };
}

/**
 * Overwrite `rcf/feedback-settings.json`, merging over the current
 * on-disk file (or the defaults, if absent). Callers pass the delta
 * they want applied; other fields survive verbatim.
 *
 * @param {string} projectRoot
 * @param {Partial<{ settingsVersion: number, ask: boolean, quietMinutes: number, redaction: { allowHosts: string[] } }>} delta
 * @returns {Promise<{ path: string, action: 'created' | 'updated' | 'noop', settings: object }>}
 */
export async function writeFeedbackSettings(projectRoot, delta) {
  const path = join(projectRoot, FEEDBACK_SETTINGS_PATH);
  let existed = true;
  let currentText;
  try {
    currentText = await readFile(path, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      existed = false;
      currentText = null;
    } else {
      throw err;
    }
  }
  let base = { ...DEFAULT_FEEDBACK_SETTINGS, redaction: { allowHosts: [] } };
  if (existed) {
    try {
      const parsed = JSON.parse(currentText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        base = { ...base, ...parsed };
        if (parsed.redaction && typeof parsed.redaction === 'object' && !Array.isArray(parsed.redaction)) {
          base.redaction = { allowHosts: Array.isArray(parsed.redaction.allowHosts) ? [...parsed.redaction.allowHosts] : [] };
        }
      }
    } catch { /* fall through with defaults */ }
  }
  const next = {
    ...base,
    ...delta,
    redaction: delta?.redaction ? { ...base.redaction, ...delta.redaction } : base.redaction,
  };
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  if (existed && serialized === currentText) {
    return { path, action: 'noop', settings: next };
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serialized, 'utf8');
  return { path, action: existed ? 'updated' : 'created', settings: next };
}

/**
 * Existence probe used by `rcf feedback status` to decide whether the
 * store has ever been written to. Not a truth-source for entries; use
 * `readEntries` for that.
 *
 * @param {string} projectRoot
 * @returns {Promise<boolean>}
 */
export async function storeExists(projectRoot) {
  try {
    await stat(entriesPath(projectRoot));
    return true;
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return false;
    throw err;
  }
}
