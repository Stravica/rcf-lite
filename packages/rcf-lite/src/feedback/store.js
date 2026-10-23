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
  appendFile, mkdir, readFile, stat, writeFile,
} from 'node:fs/promises';
import {
  accessSync, constants, copyFileSync, existsSync, linkSync, mkdirSync, readdirSync,
  readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import {
  basename, dirname, extname, join, relative, resolve,
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
 * (`takeStoreLock`): when another live command holds it, this call does not
 * move, leaves the held queue where it is for the next command and returns
 * the main checkout, so two moves never overlap. A move that fails throws
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
    lock = takeStoreLock(mainRoot, false);
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
 * sees a half-written file. An outbox bundle is compared by bytes with
 * every file of the main outbox: bytes already there are not copied again
 * (so a rerun after an interrupted move copies nothing twice); other bytes
 * are copied under the bundle's own name, or, when the main outbox already
 * uses that name, under a fresh one (`copyUnderFreeName`), never over a
 * main file. The moved files are then removed from the worktree, so
 * nothing is left for `git worktree remove` to drop.
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
  if (existsSync(fromOutbox)) {
    const toOutbox = join(to, 'outbox');
    mkdirSync(toOutbox, { recursive: true });
    const have = readdirSync(toOutbox, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => readFileSync(join(toOutbox, d.name)));
    for (const dirent of readdirSync(fromOutbox, { withFileTypes: true })) {
      if (!dirent.isFile()) continue;
      const src = join(fromOutbox, dirent.name);
      const bytes = readFileSync(src);
      if (!have.some((b) => b.equals(bytes))) {
        keep();
        copyUnderFreeName(src, bytes, toOutbox, dirent.name);
        have.push(bytes);
      }
      moved.push(src);
    }
  }
  for (const p of moved) {
    keep();
    unlinkSync(p);
  }
  for (const d of [fromOutbox, from]) {
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
 * say, can lose it: `keep` then throws rather than write over the new
 * holder's lock). A lock whose content cannot be read yet (an exclusive
 * create a breath before its write) is judged by its file's age instead.
 */
const STORE_LOCK = 'store.lock';
const LOCK_STALE_MS = 60_000;
const LOCK_REFRESH_MS = 1_000;
const LOCK_POLL_MS = 25;
const LOCK_WAIT_MS = 10_000;
/** @type {Map<string, { depth: number, text: string, lock: object, refreshed: number, handle: { keep: () => void, release: () => void } }>} */
const heldLocks = new Map();
const lockPause = new Int32Array(new SharedArrayBuffer(4));

/**
 * Run `fn` holding the store lock of the store that `projectRoot` writes
 * (the main checkout's for a linked worktree). A held lock is waited for,
 * polling, for up to `RCF_FEEDBACK_LOCK_WAIT_MS` milliseconds (10 seconds
 * by default); if it is still held then, this throws
 * `RCF_FEEDBACK_STORE_BUSY` naming the holder's pid and the store's
 * checkout before `fn` writes anything. Nested calls in one process share
 * the lock.
 *
 * @template T
 * @param {string} projectRoot
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withStoreLock(projectRoot, fn) {
  const lock = takeStoreLock(storeRoot(projectRoot), true);
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
 * when another live command holds it: null for a caller that does not
 * wait (the move skips), else, once the wait runs out, an
 * `RCF_FEEDBACK_STORE_BUSY` error. A stale lock is broken and the create
 * retried.
 *
 * @param {string} root
 * @param {boolean} wait
 * @returns {{ keep: () => void, release: () => void } | null}
 */
function takeStoreLock(root, wait) {
  const dir = join(root, FEEDBACK_DIR);
  const path = join(dir, STORE_LOCK);
  const mine = heldLocks.get(path);
  if (mine) {
    mine.depth += 1;
    return mine.handle;
  }
  mkdirSync(dir, { recursive: true });
  const raw = process.env.RCF_FEEDBACK_LOCK_WAIT_MS ?? '';
  const waitMs = !wait ? 0 : /^\d+$/.test(raw) ? Number(raw) : LOCK_WAIT_MS;
  const start = performance.now();
  for (;;) {
    const at = new Date().toISOString();
    const lock = { pid: process.pid, hostname: hostname(), startedAt: at, refreshedAt: at, token: randomBytes(8).toString('hex') };
    const text = `${JSON.stringify(lock)}\n`;
    try {
      writeFileSync(path, text, { encoding: 'utf8', flag: 'wx' });
      return holdStoreLock(path, lock, text);
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
    }
    const seen = readStoreLock(path);
    if (seen === null) continue;
    if (storeLockStale(path, seen.lock)) {
      breakStoreLock(path, seen.text);
      continue;
    }
    if (performance.now() - start >= waitMs) {
      if (!wait) return null;
      const holder = seen.lock;
      const busy = new Error(`the feedback store in ${root} is busy: another rcf feedback command (process ${holder?.pid ?? 'unknown'} on ${holder?.hostname ?? 'unknown host'}, running since ${holder?.startedAt ?? 'an unknown time'}) is still changing it, so this command wrote nothing; run it again once that command finishes`);
      busy.code = 'RCF_FEEDBACK_STORE_BUSY';
      throw busy;
    }
    Atomics.wait(lockPause, 0, 0, LOCK_POLL_MS);
  }
}

/**
 * Record a lock this process just created and build its handle. `keep`
 * rewrites `refreshedAt` (whole, by rename) once a second at most, after
 * checking the lock is still this holder's; a lock another command broke
 * (this holder stalled for more than 60 seconds) is never written over,
 * `keep` throws instead. A timer calls `keep` while the holder awaits.
 *
 * @param {string} path
 * @param {object} lock
 * @param {string} text
 * @returns {{ keep: () => void, release: () => void }}
 */
function holdStoreLock(path, lock, text) {
  const state = { depth: 1, text, lock, refreshed: Date.now(), handle: null };
  const keep = () => {
    const now = Date.now();
    if (Math.abs(now - state.refreshed) < LOCK_REFRESH_MS) return;
    if (readStoreLock(path)?.text !== state.text) {
      const lost = new Error(`the feedback store lock ${path} was taken over by another command after this one stopped refreshing it`);
      lost.code = 'RCF_FEEDBACK_LOCK_LOST';
      throw lost;
    }
    state.lock = { ...state.lock, refreshedAt: new Date(now).toISOString() };
    state.text = `${JSON.stringify(state.lock)}\n`;
    replaceFileSync(path, state.text);
    state.refreshed = now;
  };
  const timer = setInterval(() => {
    try { keep(); } catch { clearInterval(timer); }
  }, LOCK_REFRESH_MS);
  timer.unref();
  state.handle = {
    keep,
    release() {
      state.depth -= 1;
      if (state.depth > 0) return;
      clearInterval(timer);
      heldLocks.delete(path);
      try {
        if (readStoreLock(path)?.text === state.text) unlinkSync(path);
      } catch { /* gone already: nothing of this holder's is left */ }
    },
  };
  heldLocks.set(path, state);
  return state.handle;
}

/**
 * @param {string} path
 * @returns {{ text: string, lock: any } | null} null when there is no lock file
 */
function readStoreLock(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
  try {
    return { text, lock: JSON.parse(text) };
  } catch {
    return { text, lock: null };
  }
}

/**
 * The stale rule (decision 86; see the lock's comment above): the holder's
 * pid is not alive on this host, or the lock has not been refreshed for 60
 * seconds by this process's clock. A refresh time ahead of this clock is
 * not stale.
 *
 * @param {string} path
 * @param {any} lock - the parsed lock, or null when its content is unreadable
 * @returns {boolean}
 */
function storeLockStale(path, lock) {
  if (lock?.hostname === hostname() && Number.isInteger(lock?.pid) && lock.pid > 0) {
    try {
      process.kill(lock.pid, 0);
    } catch (err) {
      if (err?.code === 'ESRCH') return true;
    }
  }
  let refreshed = Date.parse(lock?.refreshedAt ?? '');
  if (!Number.isFinite(refreshed)) {
    try { refreshed = statSync(path).mtimeMs; } catch { return false; }
  }
  return Date.now() - refreshed > LOCK_STALE_MS;
}

/**
 * Break the stale lock whose content was `seen`: rename it aside, and
 * remove it only when the file renamed is that stale lock. When a holder
 * refreshed or took the lock after it was judged (the content differs),
 * the file is linked back under the lock's name (exclusive, so it never
 * replaces a lock taken meanwhile) and nothing is broken.
 *
 * @param {string} path
 * @param {string} seen
 * @returns {void}
 */
function breakStoreLock(path, seen) {
  const aside = `${path}.${process.pid}.stale`;
  try {
    renameSync(path, aside);
  } catch (err) {
    if (err?.code === 'ENOENT') return;
    throw err;
  }
  let text = null;
  try { text = readFileSync(aside, 'utf8'); } catch { /* gone: nothing to put back */ }
  if (text !== null && text !== seen) {
    try { linkSync(aside, path); } catch { /* the name was taken meanwhile: that holder's lock stands */ }
  }
  try { unlinkSync(aside); } catch { /* gone already */ }
}

/**
 * Replace `path` with `text` whole: write a temp file in the same
 * directory, then rename it over `path`, so a reader sees the old file or
 * the new one, never a half-written one. A file that is there and not
 * writable is refused (EACCES) as a plain write would refuse it.
 *
 * @param {string} path
 * @param {string} text
 * @returns {void}
 */
function replaceFileSync(path, text) {
  if (existsSync(path)) accessSync(path, constants.W_OK);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, 'utf8');
  renameSync(temp, path);
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
 * (`withStoreLock`; a caller already holding it shares it). Ensures the
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
    await appendFile(entriesPath(projectRoot), line, 'utf8');
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
 * lock as `appendEntry` does.
 *
 * @param {string} projectRoot
 * @param {StateTransition} transition
 * @returns {Promise<void>}
 */
export async function appendState(projectRoot, transition) {
  await withStoreLock(projectRoot, async () => {
    await mkdir(feedbackDir(projectRoot), { recursive: true });
    const line = `${JSON.stringify(transition)}\n`;
    await appendFile(entriesPath(projectRoot), line, 'utf8');
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
