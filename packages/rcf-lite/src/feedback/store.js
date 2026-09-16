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
import { join } from 'node:path';

/** Absolute path helpers under a project root. */
const FEEDBACK_DIR = '.rcf/feedback';

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
 * @param {string} projectRoot
 * @returns {string}
 */
export function feedbackDir(projectRoot) {
  return join(projectRoot, FEEDBACK_DIR);
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
export function entriesPath(projectRoot) {
  return join(projectRoot, FEEDBACK_DIR, 'entries.jsonl');
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
export function statePath(projectRoot) {
  return join(projectRoot, FEEDBACK_DIR, 'state.json');
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
export function outboxDir(projectRoot) {
  return join(projectRoot, FEEDBACK_DIR, 'outbox');
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
 * @property {'submitted' | 'bundled' | 'deferredUntilSession' | 'discarded'} status
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
 * Append one entry to the JSONL log. Ensures the parent directory
 * exists (mkdir recursive) so the first call on a fresh project does
 * not require a separate init step.
 *
 * @param {string} projectRoot
 * @param {FeedbackEntry} entry
 * @returns {Promise<void>}
 */
export async function appendEntry(projectRoot, entry) {
  await mkdir(feedbackDir(projectRoot), { recursive: true });
  const line = `${JSON.stringify(entry)}\n`;
  await appendFile(entriesPath(projectRoot), line, 'utf8');
}

/**
 * Append one state-transition line for an existing id. Callers pass a
 * SHAPE that the reader's fold-by-id merges over the base entry; state
 * transitions are additive, never destructive rewrites.
 *
 * @param {string} projectRoot
 * @param {StateTransition} transition
 * @returns {Promise<void>}
 */
export async function appendState(projectRoot, transition) {
  await mkdir(feedbackDir(projectRoot), { recursive: true });
  const line = `${JSON.stringify(transition)}\n`;
  await appendFile(entriesPath(projectRoot), line, 'utf8');
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
 * Overwrite the ask ledger. Only slice 5 needs to write this; slice 1
 * exports the writer so tests can seed a ledger without a private
 * import path.
 *
 * @param {string} projectRoot
 * @param {{ asked: Array<{ sessionId: string, askedAt: string }>, queueStateAt: string | null }} ledger
 * @returns {Promise<void>}
 */
export async function writeAskLedger(projectRoot, ledger) {
  await mkdir(feedbackDir(projectRoot), { recursive: true });
  await writeFile(statePath(projectRoot), `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}

/**
 * Pre-write gitignore check. Returns `{ ok: true }` when the project's
 * `.gitignore` effectively ignores `.rcf/feedback/` (a bare
 * `.rcf/feedback/`, `.rcf/feedback`, `.rcf/`, or `.rcf`, one per line);
 * returns `{ ok: false, reason }` otherwise. Callers with `--force`
 * bypass the check.
 *
 * The check is coarse on purpose: mirroring the identity-seed doctor
 * check, we look for the LITERAL entries that keep the directory out
 * of a `git add .`, not a full git-check-ignore evaluation. If the
 * project uses a broader pattern (`.rcf/*` etc.) the operator can
 * either add the exact line via `rcf doctor --fix` or pass `--force`.
 *
 * @param {string} projectRoot
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function ensureGitignore(projectRoot) {
  let text;
  try {
    text = await readFile(join(projectRoot, '.gitignore'), 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return { ok: false, reason: 'no .gitignore in project root' };
    }
    throw err;
  }
  // F-slice-1-01: walk the lines in order and track the ignore state
  // of `.rcf/feedback/`; a later `!` negation must cancel an earlier
  // positive line the same way git does. A Set-membership check would
  // pass a negated file straight through, leaking raw entries on push.
  const covers = new Set(['.rcf/feedback/', '.rcf/feedback', '.rcf/', '.rcf']);
  let ignored = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('!')) {
      const negated = line.slice(1);
      if (covers.has(negated) || negated === '.rcf/feedback/*' || negated === '.rcf/feedback/**') {
        ignored = false;
      }
      continue;
    }
    if (covers.has(line)) ignored = true;
  }
  if (ignored) return { ok: true };
  return { ok: false, reason: 'missing .gitignore entry .rcf/feedback/' };
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
  let id = newEntryId(now, rng);
  for (let i = 0; i < 32; i += 1) {
    if (!existing.has(id)) return id;
    id = newEntryId(now, rng);
  }
  return id;
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
