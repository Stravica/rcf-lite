// Interactive session for `rcf ui-baseline init` (spec §5.4).
//
// Two shapes:
// - `runInteractiveSession(...)` - the TTY path. Presents an
//   enter-to-accept-all summary screen. Typing a field name opens
//   per-field editing for that field alone; typing `edit-all` walks
//   every field sequentially. This preserves the "explicit never by
//   silence" property (operator has seen every field on the summary)
//   without the twelve-field walk ceremony that would reintroduce the
//   verbosity defect from the Entry 1 cold-run feedback log.
//
// - `normaliseNonInteractiveInput(input)` - CI / automation path. The
//   input file is a plain object with `optOuts` (array of { field,
//   reason }) and optional `overrides` (dot-path -> value). Every
//   field is treated as ack'd; the file's presence is the "seen every
//   field" signal.

import { UI_BASELINE_DEFAULTS_V1, deepGet, isKnownBaselinePath } from './defaults.js';

/**
 * @typedef {object} UiBaselineSessionResult
 * @property {Array<{ field: string, reason: string }>} optOuts
 * @property {object} overrides   dot-path -> value overrides for the defaults composer
 */

/**
 * Interactive session (TTY). Callers supply `prompt` and `write`
 * closures wrapping `readline.createInterface`. Refuses to exit
 * without visiting every field.
 *
 * @param {object} args
 * @param {(q: string) => Promise<string>} args.prompt
 * @param {(s: string) => void} args.write
 * @param {object} [args.preflightOverrides]  dot-path -> value seam pickup from preflight (spec §3.2)
 * @returns {Promise<UiBaselineSessionResult>}
 */
export async function runInteractiveSession({ prompt, write, preflightOverrides = {} }) {
  /** @type {Array<{ field: string, reason: string }>} */
  const optOuts = [];
  /** @type {Record<string, *>} */
  const overrides = { ...preflightOverrides };
  const editedFields = new Set(Object.keys(preflightOverrides));

  let done = false;
  while (!done) {
    renderSummary({ write, overrides, optOuts, editedFields });
    const answer = (await prompt('> ')).trim();
    if (answer === '' || answer.toLowerCase() === 'accept') {
      done = true;
      break;
    }
    if (answer.toLowerCase() === 'cancel') {
      throw new Error('ui-baseline: session cancelled by operator');
    }
    if (answer.toLowerCase() === 'edit-all') {
      for (const spec of UI_BASELINE_DEFAULTS_V1) {
        await editField({ spec, prompt, write, overrides, optOuts, editedFields });
      }
      continue;
    }
    if (isKnownBaselinePath(answer)) {
      const spec = UI_BASELINE_DEFAULTS_V1.find((s) => s.path === answer);
      await editField({ spec, prompt, write, overrides, optOuts, editedFields });
      continue;
    }
    write(`Unknown option '${answer}'. Type a field path (e.g. ${UI_BASELINE_DEFAULTS_V1[0].path}), 'edit-all', or press ENTER to accept.`);
  }
  return { optOuts, overrides };
}

function renderSummary({ write, overrides, optOuts, editedFields }) {
  write('');
  write('UI baseline defaults (v1). Every value below is ruled by the estate playbook.');
  write('');
  for (const spec of UI_BASELINE_DEFAULTS_V1) {
    const effective = Object.prototype.hasOwnProperty.call(overrides, spec.path) ? overrides[spec.path] : spec.value;
    const marker = optOuts.some((o) => o.field === spec.path)
      ? '*'
      : (editedFields.has(spec.path) ? '+' : ' ');
    write(`  ${marker} ${padEnd(spec.path, 46)}${formatValue(effective)}`);
  }
  write('');
  write('Press ENTER to accept these defaults. Type a field path to edit one, or \'edit-all\' to walk every field, or \'cancel\'.');
  write('  * = opt-out recorded, + = value differs from ruled default');
}

function padEnd(s, n) {
  const str = String(s);
  return str.length >= n ? str : str + ' '.repeat(n - str.length);
}

function formatValue(v) {
  if (Array.isArray(v)) return `[${v.map((x) => JSON.stringify(x)).join(', ')}]`;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

async function editField({ spec, prompt, write, overrides, optOuts, editedFields }) {
  write('');
  write(`Field: ${spec.path}`);
  write(`  ruled: ${formatValue(spec.value)}`);
  write(`  source: ${spec.rulingSource}`);
  const current = Object.prototype.hasOwnProperty.call(overrides, spec.path) ? overrides[spec.path] : spec.value;
  write(`  current: ${formatValue(current)}`);
  const raw = await prompt('  new value (JSON) or ENTER to accept ruled, \'opt-out <reason>\' to record ledger entry: ');
  const answer = raw.trim();
  if (answer === '') {
    delete overrides[spec.path];
    for (let i = optOuts.length - 1; i >= 0; i -= 1) if (optOuts[i].field === spec.path) optOuts.splice(i, 1);
    editedFields.delete(spec.path);
    return;
  }
  if (answer.startsWith('opt-out')) {
    const reason = answer.slice('opt-out'.length).trim();
    if (reason.length < 20) {
      write(`  opt-out reason must be at least 20 characters (got ${reason.length}); no change written.`);
      return;
    }
    for (let i = optOuts.length - 1; i >= 0; i -= 1) if (optOuts[i].field === spec.path) optOuts.splice(i, 1);
    optOuts.push({ field: spec.path, reason });
    editedFields.add(spec.path);
    return;
  }
  try {
    const parsed = JSON.parse(answer);
    overrides[spec.path] = parsed;
    editedFields.add(spec.path);
  } catch (err) {
    write(`  parse error (${err.message}); no change written. Value stays: ${formatValue(current)}`);
  }
}

/**
 * Normalise a non-interactive input file into the session result shape.
 * Input file shape (spec §5.4):
 *   {
 *     "optOuts": [ { "field": "path.to.field", "reason": "..." } ],
 *     "overrides": { "path.to.field": <json value>, ... }
 *   }
 * Every field named must be a known baseline path; opt-out reasons must
 * be at least 20 characters (matches the opt-out ledger floor).
 *
 * @param {any} input
 * @returns {UiBaselineSessionResult}
 */
export function normaliseNonInteractiveInput(input) {
  if (input === null || typeof input !== 'object') {
    throw new Error('ui-baseline: non-interactive input must be an object');
  }
  const optOuts = [];
  const overrides = {};
  for (const raw of Array.isArray(input.optOuts) ? input.optOuts : []) {
    if (!raw || typeof raw.field !== 'string') {
      throw new Error('ui-baseline: input.optOuts[] entry missing field');
    }
    const field = raw.field.startsWith('defaults.') ? raw.field.slice('defaults.'.length) : raw.field;
    if (!isKnownBaselinePath(field)) {
      throw new Error(`ui-baseline: input.optOuts[] unknown field '${field}'`);
    }
    if (typeof raw.reason !== 'string' || raw.reason.length < 20) {
      throw new Error(`ui-baseline: input.optOuts[] for '${field}' needs a reason of at least 20 characters`);
    }
    optOuts.push({ field, reason: raw.reason });
  }
  const rawOverrides = input.overrides ?? {};
  if (rawOverrides !== null && typeof rawOverrides === 'object' && !Array.isArray(rawOverrides)) {
    for (const [rawKey, value] of Object.entries(rawOverrides)) {
      const key = rawKey.startsWith('defaults.') ? rawKey.slice('defaults.'.length) : rawKey;
      if (!isKnownBaselinePath(key)) {
        throw new Error(`ui-baseline: input.overrides has unknown field '${key}'`);
      }
      overrides[key] = value;
    }
  }
  return { optOuts, overrides };
}

export { deepGet };
