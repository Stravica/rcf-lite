// Feedback hook installer (ADR-4108). Slice 5 (FBS-184): rcf init
// merges three feedback hook entries into the two committed harness
// config files (`.claude/settings.json`, `.codex/hooks.json`); rcf
// doctor detects and repairs missing entries, and refuses foreign
// entries whose command names our binary with the wrong flags.
//
// Merge discipline mirrors `writeMcpConfig`:
//   - parse; refuse on invalid JSON with the same message shape;
//   - preserve every other server/hook verbatim;
//   - add our entries only when an entry naming `rcf feedback hook`
//     is absent for that event; otherwise leave the file alone.
// A caller passing `binPath` gets the pinned-bin shape
// (`{ command: 'node', args: [binPath, 'feedback', 'hook', ...] }`),
// mirroring the `.mcp.json` entry pattern; the default is the
// portable `npx rcf-lite feedback hook <event>` shape.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { rcfError } from '#core/errors';

/**
 * Command-substring marker used across the estate to identify our
 * hook commands. Matches both shapes we ship:
 *   - `npx rcf-lite feedback hook <event> --harness ...`
 *   - `node <binPath> feedback hook <event> --harness ...`
 * so a foreign-shape entry that names our verbs is still detected as
 * ours (and reported as foreign-hook) rather than treated as an
 * unrelated command.
 */
export const FEEDBACK_HOOK_COMMAND_MARKER = 'feedback hook';

/** Events the installer owns (per design 3.5). */
export const FEEDBACK_HOOK_EVENTS = /** @type {const} */ ([
  { event: 'Stop', subVerb: 'stop', timeout: 10, matcher: null, codexEvent: 'Stop' },
  { event: 'SessionEnd', subVerb: 'session-end', timeout: 5, matcher: null, codexEvent: 'SessionEnd' },
  { event: 'SessionStart', subVerb: 'session-start', timeout: 5, matcher: 'startup|resume', codexEvent: 'SessionStart' },
]);

/**
 * Build the Claude Code hook command string for one event.
 *
 * @param {string} subVerb
 * @param {'claude-code' | 'codex'} harness
 * @param {string | undefined} binPath
 * @returns {string}
 */
function buildCommand(subVerb, harness, binPath) {
  const args = ['feedback', 'hook', subVerb, '--harness', harness];
  if (typeof binPath === 'string' && binPath.length > 0) {
    return `node ${binPath} ${args.join(' ')}`;
  }
  return `npx rcf-lite ${args.join(' ')}`;
}

/**
 * Build the Claude Code hook entry a `.claude/settings.json` file
 * carries for one event. Matches the shape Claude Code writes to a
 * user-scope file via `/hooks add`: hooks arrays keyed by event,
 * each element `{ matcher?, hooks: [{ type: 'command', command,
 * timeout }] }`.
 *
 * @param {typeof FEEDBACK_HOOK_EVENTS[number]} spec
 * @param {string | undefined} binPath
 */
export function claudeHookEntry(spec, binPath) {
  const command = buildCommand(spec.subVerb, 'claude-code', binPath);
  const inner = {
    hooks: [
      { type: 'command', command, timeout: spec.timeout },
    ],
  };
  if (spec.matcher) inner.matcher = spec.matcher;
  return inner;
}

/**
 * Build the Codex hook entry a `.codex/hooks.json` file carries for
 * one event. Codex's schema (0.153.4+) keys hooks by event name and
 * takes an array of `{ command, timeout? }` shell entries; we mirror
 * that shape so a Codex `hooks list` shows one entry per event.
 *
 * @param {typeof FEEDBACK_HOOK_EVENTS[number]} spec
 * @param {string | undefined} binPath
 */
export function codexHookEntry(spec, binPath) {
  const command = buildCommand(spec.subVerb, 'codex', binPath);
  return { command, timeout: spec.timeout };
}

/**
 * Merge the three feedback hook entries into a parsed Claude Code
 * settings object; returns `{ next, added, foreign, kept }`. Pure
 * over the input; the caller writes if `added.length > 0` or a
 * `foreign` list on a settings file with no gating drift.
 *
 * @param {object | null} current
 * @param {string | undefined} binPath
 */
export function mergeClaudeSettings(current, binPath) {
  const base = current && typeof current === 'object' && !Array.isArray(current)
    ? { ...current }
    : {};
  const hooks = base.hooks && typeof base.hooks === 'object' && !Array.isArray(base.hooks)
    ? { ...base.hooks }
    : {};
  const added = [];
  const foreign = [];
  const kept = [];
  for (const spec of FEEDBACK_HOOK_EVENTS) {
    const bucketRaw = hooks[spec.event];
    const bucket = Array.isArray(bucketRaw) ? bucketRaw.slice() : [];
    const ours = bucket.filter((entry) => entryClaudeIsOurs(entry));
    const expectedCommand = buildCommand(spec.subVerb, 'claude-code', binPath);
    if (ours.length === 0) {
      bucket.push(claudeHookEntry(spec, binPath));
      hooks[spec.event] = bucket;
      added.push(spec.event);
      continue;
    }
    // Foreign detection: an entry that names our marker but whose
    // command string (or timeout, or matcher for SessionStart) differs
    // from the current install shape.
    const drift = ours.filter((entry) => !entryClaudeMatches(entry, spec, expectedCommand));
    if (drift.length > 0) {
      for (const d of drift) {
        foreign.push({ event: spec.event, command: firstClaudeCommand(d) ?? '(unknown)' });
      }
    } else {
      kept.push(spec.event);
    }
    hooks[spec.event] = bucket;
  }
  return { next: { ...base, hooks }, added, foreign, kept };
}

/**
 * Merge the three feedback hook entries into a parsed Codex hooks
 * object; returns `{ next, added, foreign, kept }`. Pure over the
 * input, same discipline as `mergeClaudeSettings`.
 *
 * @param {object | null} current
 * @param {string | undefined} binPath
 */
export function mergeCodexHooks(current, binPath) {
  const base = current && typeof current === 'object' && !Array.isArray(current)
    ? { ...current }
    : {};
  const hooks = base.hooks && typeof base.hooks === 'object' && !Array.isArray(base.hooks)
    ? { ...base.hooks }
    : {};
  const added = [];
  const foreign = [];
  const kept = [];
  for (const spec of FEEDBACK_HOOK_EVENTS) {
    const bucketRaw = hooks[spec.codexEvent];
    const bucket = Array.isArray(bucketRaw) ? bucketRaw.slice() : [];
    const ours = bucket.filter((entry) => entryCodexIsOurs(entry));
    const expectedCommand = buildCommand(spec.subVerb, 'codex', binPath);
    if (ours.length === 0) {
      bucket.push(codexHookEntry(spec, binPath));
      hooks[spec.codexEvent] = bucket;
      added.push(spec.codexEvent);
      continue;
    }
    const drift = ours.filter((entry) => !entryCodexMatches(entry, spec, expectedCommand));
    if (drift.length > 0) {
      for (const d of drift) {
        foreign.push({ event: spec.codexEvent, command: d?.command ?? '(unknown)' });
      }
    } else {
      kept.push(spec.codexEvent);
    }
    hooks[spec.codexEvent] = bucket;
  }
  return { next: { ...base, hooks }, added, foreign, kept };
}

function entryClaudeIsOurs(entry) {
  const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
  return hooks.some((h) => typeof h?.command === 'string' && h.command.includes(FEEDBACK_HOOK_COMMAND_MARKER));
}

function firstClaudeCommand(entry) {
  const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
  const hit = hooks.find((h) => typeof h?.command === 'string' && h.command.includes(FEEDBACK_HOOK_COMMAND_MARKER));
  return hit?.command;
}

function entryClaudeMatches(entry, spec, expectedCommand) {
  const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
  // Compare matcher through a null-normalising cast: both spec and
  // entry may express the absence of a matcher as either null or
  // undefined (the former is deliberate on our specs; the latter is
  // what JSON round-trip drops).
  const specMatcher = spec.matcher ?? null;
  const entryMatcher = entry?.matcher ?? null;
  if (specMatcher !== entryMatcher) return false;
  const ourHooks = hooks.filter((h) => typeof h?.command === 'string' && h.command.includes(FEEDBACK_HOOK_COMMAND_MARKER));
  if (ourHooks.length !== 1) return false;
  const h = ourHooks[0];
  if (h.type !== 'command') return false;
  if (h.command !== expectedCommand) return false;
  if (h.timeout !== spec.timeout) return false;
  return true;
}

function entryCodexIsOurs(entry) {
  return typeof entry?.command === 'string' && entry.command.includes(FEEDBACK_HOOK_COMMAND_MARKER);
}

function entryCodexMatches(entry, spec, expectedCommand) {
  if (entry?.command !== expectedCommand) return false;
  if (entry?.timeout !== spec.timeout) return false;
  return true;
}

/**
 * Write / merge `.claude/settings.json` with the three feedback hook
 * entries. Returns an action summary the caller renders (or an
 * rcfError on invalid JSON, mirroring `writeMcpConfig`).
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} [args.binPath]
 */
export async function writeClaudeFeedbackHooks({ projectRoot, binPath } = {}) {
  const file = join(projectRoot, '.claude', 'settings.json');
  const raw = await readIfExists(file);
  let current = null;
  let existed = raw !== null;
  if (existed) {
    try {
      current = JSON.parse(raw);
    } catch (err) {
      return rcfError({
        kind: 'parseFailure',
        message: `.claude/settings.json exists but is not valid JSON (${err.message}); refusing to modify it. Fix it by hand, or add the feedback hook entries manually - see docs/feedback.md, section 'Slice 5 hooks'.`,
        filePath: '.claude/settings.json',
      });
    }
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      return rcfError({
        kind: 'parseFailure',
        message: '.claude/settings.json exists but is not a JSON object; refusing to modify it.',
        filePath: '.claude/settings.json',
      });
    }
  }
  const merge = mergeClaudeSettings(current, binPath);
  if (merge.foreign.length > 0) {
    return {
      file: '.claude/settings.json',
      action: 'foreign',
      foreign: merge.foreign,
      added: [],
    };
  }
  if (merge.added.length === 0) {
    return {
      file: '.claude/settings.json',
      action: 'kept',
      added: [],
      foreign: [],
    };
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(merge.next, null, 2)}\n`, 'utf8');
  return {
    file: '.claude/settings.json',
    action: existed ? 'merged' : 'created',
    added: merge.added,
    foreign: [],
  };
}

/**
 * Write / merge `.codex/hooks.json` with the three feedback hook
 * entries. Same discipline as `writeClaudeFeedbackHooks`.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} [args.binPath]
 */
export async function writeCodexFeedbackHooks({ projectRoot, binPath } = {}) {
  const file = join(projectRoot, '.codex', 'hooks.json');
  const raw = await readIfExists(file);
  let current = null;
  let existed = raw !== null;
  if (existed) {
    try {
      current = JSON.parse(raw);
    } catch (err) {
      return rcfError({
        kind: 'parseFailure',
        message: `.codex/hooks.json exists but is not valid JSON (${err.message}); refusing to modify it. Fix it by hand, or add the feedback hook entries manually - see docs/feedback.md, section 'Slice 5 hooks'.`,
        filePath: '.codex/hooks.json',
      });
    }
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      return rcfError({
        kind: 'parseFailure',
        message: '.codex/hooks.json exists but is not a JSON object; refusing to modify it.',
        filePath: '.codex/hooks.json',
      });
    }
  }
  const merge = mergeCodexHooks(current, binPath);
  if (merge.foreign.length > 0) {
    return {
      file: '.codex/hooks.json',
      action: 'foreign',
      foreign: merge.foreign,
      added: [],
    };
  }
  if (merge.added.length === 0) {
    return {
      file: '.codex/hooks.json',
      action: 'kept',
      added: [],
      foreign: [],
    };
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(merge.next, null, 2)}\n`, 'utf8');
  return {
    file: '.codex/hooks.json',
    action: existed ? 'merged' : 'created',
    added: merge.added,
    foreign: [],
  };
}

/**
 * Diagnose one Claude Code settings file WITHOUT writing. Returns
 * `{ missing: string[], foreign: Array<{event,command}> }` per event.
 * Doctor consumes this to decide missing-hook (fixable) vs
 * foreign-hook (refused) rows.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} [args.binPath]
 */
export async function diagnoseClaudeFeedbackHooks({ projectRoot, binPath } = {}) {
  const file = join(projectRoot, '.claude', 'settings.json');
  const raw = await readIfExists(file);
  if (raw === null) {
    return { present: false, missing: FEEDBACK_HOOK_EVENTS.map((s) => s.event), foreign: [] };
  }
  let current;
  try {
    current = JSON.parse(raw);
  } catch (err) {
    return { present: true, parseError: err.message, missing: [], foreign: [] };
  }
  if (current === null || typeof current !== 'object' || Array.isArray(current)) {
    return { present: true, parseError: 'not a JSON object', missing: [], foreign: [] };
  }
  const merge = mergeClaudeSettings(current, binPath);
  return { present: true, missing: merge.added, foreign: merge.foreign };
}

/**
 * Diagnose one Codex hooks file WITHOUT writing.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} [args.binPath]
 */
export async function diagnoseCodexFeedbackHooks({ projectRoot, binPath } = {}) {
  const file = join(projectRoot, '.codex', 'hooks.json');
  const raw = await readIfExists(file);
  if (raw === null) {
    return { present: false, missing: FEEDBACK_HOOK_EVENTS.map((s) => s.codexEvent), foreign: [] };
  }
  let current;
  try {
    current = JSON.parse(raw);
  } catch (err) {
    return { present: true, parseError: err.message, missing: [], foreign: [] };
  }
  if (current === null || typeof current !== 'object' || Array.isArray(current)) {
    return { present: true, parseError: 'not a JSON object', missing: [], foreign: [] };
  }
  const merge = mergeCodexHooks(current, binPath);
  return { present: true, missing: merge.added, foreign: merge.foreign };
}

async function readIfExists(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw err;
  }
}
