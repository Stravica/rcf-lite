// Feedback harness hook (TAC-4108). Slice 5 (FBS-184): the ask.
//
// Two exports are the load-bearing surface:
//   - `shouldAsk(state)` is a pure function over the design 3.5 inputs
//     that returns 'ask' or 'silent'; every quiet-rule branch runs
//     through it and every unit-test truth table drives it directly.
//   - `emit(harness, decision, message)` writes the per-harness output
//     shape (Claude Code: exit 2 + stderr; Codex: stdout JSON block)
//     and returns the exit code the CLI wrapper propagates.
//
// The CLI wrapper (`rcf feedback hook stop|session-end|session-start`
// dispatched from `src/cli/feedback.js`) reads the harness JSON from
// stdin, gathers the store inputs (settings, pending entries, ask
// ledger, prior sessionId), calls `shouldAsk` and then `emit`, and
// (crucially) APPENDS the asked ledger record BEFORE the emit so a
// crash between emit and reply cannot cause a second ask.
//
// Design references: sections 3.5 (quiet rule + per-harness shape),
// 8 (settings and env vars), 9 (Stop is the ask event ADR), 10.3
// (quietMinutes default 15).

/**
 * Reason text the hook feeds Claude Code (stderr) or Codex (JSON
 * `reason`). Exported so a caller can assemble a locally augmented
 * variant (e.g. prefixing the outbox path from a carried-over session)
 * without re-typing the four verb names. Kept STATIC so the managed
 * block's hash-verified RULE 17 slice 6 text can pin the same verbs
 * once, in one place.
 *
 * @param {number} pendingCount
 * @returns {string}
 */
export function buildAskReason(pendingCount) {
  const n = Math.max(1, Number(pendingCount) || 1);
  const noun = n === 1 ? 'entry' : 'entries';
  return `rcf feedback: ${n} unsubmitted ${noun} on this project. `
    + "Run 'rcf feedback preview', show the operator the titles, "
    + 'bodies and destination it prints, ask once whether to send '
    + "them, then run 'rcf feedback submit --yes', "
    + "'rcf feedback defer' or 'rcf feedback opt-out'. "
    + 'Do not ask again this session.';
}

/**
 * Reason text the SessionStart hook injects on either harness when
 * one or more pending entries carried over from a prior session. The
 * wording mirrors RULE 17's ask contract without prescribing verbs
 * (SessionStart runs before any operator prompt; the ask itself
 * arrives on Stop).
 *
 * @param {number} pendingCount
 * @returns {string}
 */
export function buildCarryOverLine(pendingCount) {
  const n = Math.max(1, Number(pendingCount) || 1);
  const noun = n === 1 ? 'entry' : 'entries';
  return `rcf feedback: ${n} unsubmitted ${noun} carried over `
    + 'from an earlier session; ask the operator once at a natural '
    + 'pause (RULE 17).';
}

/**
 * @typedef {object} QuietRuleState
 * @property {boolean} optedOut         file `ask: false` or env silence
 * @property {number} pendingCount      pending entries visible to the
 *                                      hook right now
 * @property {boolean} askedThisSession `state.json` already recorded
 *                                      an `asked` entry for the
 *                                      incoming sessionId
 * @property {boolean} stopHookActive   Claude Code / Codex loop guard
 * @property {boolean} anyAskNow        one or more pending entries
 *                                      carry askNow: true
 * @property {number | null} newestPendingAgeMs
 *                                      milliseconds since the newest
 *                                      pending entry was recorded, or
 *                                      null when nothing is pending
 * @property {number} quietMinutes      operator-configurable gate; the
 *                                      caller resolves the default (15)
 * @property {boolean} queueComplete    `.rcf/feedback/state.json`
 *                                      `queueStateAt` cached
 *                                      complete / nothing-actionable
 * @property {boolean} anyCarriedOver   one or more pending entries were
 *                                      recorded under a prior sessionId
 */

/**
 * Pure quiet-rule decision (design 3.5, ADR-4107).
 *
 * Ask on `stop` when ALL hold:
 *   - not opted out (per-project file OR per-user env);
 *   - pending entries exist;
 *   - no `asked` record for this session_id in `state.json`;
 *   - `stop_hook_active` is false (Claude Code loop guard; Codex
 *     sends the same field);
 *   - AND one of: an entry carries askNow; the newest pending entry
 *     is older than quietMinutes; queue-state cache reports complete
 *     or nothing-actionable; the entry was carried over from an
 *     earlier session.
 *
 * Otherwise, exit silent. The function is total, deterministic, and
 * has no side effects; unit tests drive it directly from a truth
 * table and the wrapper only calls it once per invocation.
 *
 * @param {QuietRuleState} state
 * @returns {'ask' | 'silent'}
 */
export function shouldAsk(state) {
  if (!state) return 'silent';
  if (state.optedOut) return 'silent';
  if (!Number.isFinite(state.pendingCount) || state.pendingCount <= 0) return 'silent';
  if (state.askedThisSession) return 'silent';
  if (state.stopHookActive) return 'silent';

  const quietMinutes = Number.isFinite(state.quietMinutes) && state.quietMinutes >= 0
    ? state.quietMinutes
    : 15;
  const ageMs = typeof state.newestPendingAgeMs === 'number'
    ? state.newestPendingAgeMs
    : null;
  const olderThanQuiet = ageMs !== null && ageMs >= quietMinutes * 60_000;

  const triggerAny = Boolean(state.anyAskNow)
    || olderThanQuiet
    || Boolean(state.queueComplete)
    || Boolean(state.anyCarriedOver);
  return triggerAny ? 'ask' : 'silent';
}

/**
 * Per-harness emit shape. Writes to the passed streams and returns
 * the exit code the wrapper should propagate. The reason is written
 * VERBATIM; callers pass the text `buildAskReason` (or their own
 * augmented variant) produced. On `silent` no bytes are written on
 * either stream and the exit code is 0 on both harnesses.
 *
 * @param {'claude-code' | 'codex'} harness
 * @param {'ask' | 'silent'} decision
 * @param {string} reason
 * @param {{ stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream }} streams
 * @returns {number} exit code the wrapper propagates
 */
export function emit(harness, decision, reason, streams) {
  if (decision !== 'ask') return 0;
  const stdout = streams?.stdout;
  const stderr = streams?.stderr;
  if (harness === 'codex') {
    // Codex requires JSON on stdout with { decision: 'block', reason };
    // plain text is invalid. The wrapper still exits 0 (Codex reads
    // the decision, not the exit code, on Stop).
    const payload = { decision: 'block', reason };
    stdout?.write(`${JSON.stringify(payload)}\n`);
    return 0;
  }
  // Claude Code default: exit 2 with the reason on stderr. Claude
  // Code feeds the reason back to Claude, which speaks to the user.
  stderr?.write(`${reason}\n`);
  return 2;
}

/**
 * SessionStart emit: one plain line for Claude Code (harness picks it
 * up as context), a JSON `additionalContext` shape for Codex. Both
 * return exit 0; the ledger is NOT touched on SessionStart (ask still
 * runs on Stop). If the Codex build in use does not accept a
 * SessionStart additionalContext, the RULE 17 fallback ("check
 * `rcf feedback status` at session start") carries the same posture;
 * the wrapper falls back gracefully.
 *
 * @param {'claude-code' | 'codex'} harness
 * @param {string} line
 * @param {{ stdout: NodeJS.WritableStream }} streams
 * @returns {number} exit code the wrapper propagates
 */
export function emitSessionStart(harness, line, streams) {
  const stdout = streams?.stdout;
  if (!line) return 0;
  if (harness === 'codex') {
    stdout?.write(`${JSON.stringify({ additionalContext: line })}\n`);
    return 0;
  }
  stdout?.write(`${line}\n`);
  return 0;
}
