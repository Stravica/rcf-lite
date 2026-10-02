// `rcf define questions` subcommand handler (REQ-186; spec 2026-10-01
// §1.2, §6).
//
// Computes and prints the persona question set from readiness and the
// four ledgers. Pure read: writes NOTHING under rcf/.
//
//   rcf define questions [--json] [--persona productOwner|engineer]
//                        [--stage <D|short>] [--limit <n>]
//
// Persona defaults from the profile register (viewer / register
// marker scan in rcf/.identity/profile.md); when the profile is
// absent or unstated, the default is productOwner. Unknown persona
// exits 2 with the usage line naming productOwner and engineer.
// The verdict exit code lives on `rcf define readiness`; this verb
// is a diagnostic that always exits 0.

import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveTestPointers, walkTree } from '#core/store';
import { checkCodeNodeResolution } from '#core/store';
import { findProjectRoot } from '../view/index.js';
import { loadFreezeRecord } from '../define/freeze-record.js';
import { loadAllLedgers } from '../define/ledgers.js';
import { STAGE_ALIASES } from '../query/gates.js';
import { computeReadiness } from '../query/readiness.js';
import { computeQuestions, PERSONAS } from '../query/questions.js';

const OPTION_SPEC = {
  json: { type: 'boolean' },
  persona: { type: 'string' },
  stage: { type: 'string' },
  limit: { type: 'string' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf define questions [options]

Print the persona question set (REQ-186). Each failing product-owner
check in readiness becomes one plain question per failing item, each
carrying the exact write-back that answers it.

The compute is pure: it never creates or modifies a file under rcf/.
Answers land through the write-back the question carries; the loop
ends when 'rcf define readiness --level intent' reports ok.

Options:
  --json                    Emit the full questions object as JSON.
  --persona <who>           One of productOwner | engineer. Defaults
                            to the register marker in
                            rcf/.identity/profile.md, else
                            productOwner.
  --stage <stage>           Narrow the output to one stage. Accepts
                            a stage id (D1..D8) or its short name
                            (brief | skeleton | shapes | stories |
                            crosscut | consistency | decisions |
                            freeze).
  --limit <n>               Cap the questions[] array to the first n
                            entries. 'remaining' still counts every
                            matching item.
  --help                    Print this help.
`;

/**
 * Read `rcf/.identity/profile.md` when it exists; return null on
 * ENOENT or on any read error (the question compute treats absence
 * as "productOwner default" rather than a runtime error).
 *
 * @param {string} projectRoot
 * @returns {Promise<string|null>}
 */
async function readProfileText(projectRoot) {
  try {
    return await readFile(join(projectRoot, 'rcf', '.identity', 'profile.md'), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Pick the profile register from the text, returning one of
 * `productOwner` | `engineer` | `unstated`.
 */
function pickRegister(text) {
  if (typeof text !== 'string' || text.length === 0) return 'unstated';
  const markers = ['productOwner', 'engineer', 'unstated'];
  let best = null;
  let bestIdx = Infinity;
  for (const m of markers) {
    const idx = text.indexOf(m);
    if (idx === -1) continue;
    if (idx < bestIdx) { bestIdx = idx; best = m; }
  }
  return /** @type {any} */ (best) ?? 'unstated';
}

/**
 * @param {string[]} argv
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const cwd = deps.cwd ?? process.cwd();

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: false, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) {
    stdout.write(HELP);
    return 0;
  }

  // Validate --persona before any filesystem work.
  let persona = flags.persona;
  if (persona !== undefined && !PERSONAS.includes(persona)) {
    stderr.write(`[error] usage questions: unknown persona '${persona}' (expected one of ${PERSONAS.join(' | ')})\n`);
    return 2;
  }

  // Validate --stage against the readiness aliases (same vocabulary).
  let stageFilter = null;
  if (typeof flags.stage === 'string') {
    const canonical = STAGE_ALIASES[flags.stage];
    if (!canonical) {
      stderr.write(`[error] usage questions: unknown --stage '${flags.stage}' (expected D1..D8 or a short name)\n`);
      return 2;
    }
    stageFilter = canonical;
  }

  let limit = null;
  if (flags.limit !== undefined) {
    const n = Number(flags.limit);
    if (!Number.isInteger(n) || n < 0) {
      stderr.write(`[error] usage questions: --limit expects a non-negative integer, got '${flags.limit}'\n`);
      return 2;
    }
    limit = n;
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }

  const { tree, errors } = await walkTree({ projectRoot });
  const staleErrors = await checkCodeNodeResolution({ projectRoot, tree });
  const validateErrors = [...errors, ...staleErrors];

  const [freeze, ledgers, testPointers, profileText] = await Promise.all([
    loadFreezeRecord({ projectRoot }),
    loadAllLedgers({ projectRoot }),
    resolveTestPointers({ projectRoot, tree }),
    readProfileText(projectRoot),
  ]);

  if (persona === undefined) {
    const register = pickRegister(profileText);
    persona = register === 'engineer' ? 'engineer' : 'productOwner';
  }

  const readiness = computeReadiness(tree, {
    freeze, ledgers, profile: undefined, profileText, testPointers, validateErrors,
  });

  const result = computeQuestions(readiness, { tree, ledgers, profileText, persona });

  // Apply --stage and --limit AFTER compute so `remaining` counts
  // every matching item (spec §6).
  let filtered = result.questions;
  if (stageFilter) filtered = filtered.filter((q) => q.stage === stageFilter);
  const remaining = filtered.length;
  if (limit !== null) filtered = filtered.slice(0, limit);

  // Rebuild groups[] from the filtered list, preserving source-span keys.
  const groupMap = new Map();
  for (const q of filtered) {
    const key = q.context?.statement?.source ?? q.context?.sourceSpan ?? 'tree';
    const existing = groupMap.get(key) ?? { key, label: result.groups.find((g) => g.key === key)?.label ?? key, questionIds: [] };
    existing.questionIds.push(q.id);
    groupMap.set(key, existing);
  }
  const envelope = {
    ...result,
    questions: filtered,
    groups: [...groupMap.values()],
    remaining,
  };

  if (flags.json) {
    stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return 0;
  }

  renderText(stdout, envelope);
  return 0;
}

/**
 * Print the text summary (spec §1.5): one progress line, then each
 * group with its asks in plain words. Ids, verbs and stage names are
 * not shown unless the owner asks.
 *
 * @param {NodeJS.WritableStream} stdout
 * @param {ReturnType<typeof computeQuestions>} result
 */
function renderText(stdout, result) {
  const persona = result.persona;
  if (result.ok || result.remaining === 0) {
    stdout.write(persona === 'productOwner'
      ? 'Intent-complete: yes. The question set is empty.\n'
      : 'Ready-to-build: no engineer blockers in this stage.\n');
    return;
  }

  // Progress line: "Intent-complete: not yet; N questions left, ..."
  const n = result.remaining;
  const partition = partitionByGroupLabel(result);
  const parts = Object.entries(partition)
    .filter(([, c]) => c > 0)
    .map(([label, c]) => `${c} about ${label}`);
  const progressLine = persona === 'productOwner'
    ? `Intent-complete: not yet; ${n} ${n === 1 ? 'question' : 'questions'} left${parts.length ? `, ${parts.join(', ')}` : ''}.`
    : `Ready-to-build: not yet; ${n} ${n === 1 ? 'check' : 'checks'} blocking.`;
  stdout.write(`${progressLine}\n`);

  for (const group of result.groups) {
    stdout.write(`\n(${group.label})\n`);
    for (const qid of group.questionIds) {
      const q = result.questions.find((x) => x.id === qid);
      if (!q) continue;
      stdout.write(`  - ${q.ask}\n`);
    }
  }

  if (persona === 'productOwner' && result.optional?.length) {
    stdout.write('\nOpen decisions (optional, not blocking):\n');
    for (const o of result.optional) {
      stdout.write(`  - ${o.ask}\n`);
    }
  }
}

/**
 * Count questions by group-label bucket for the progress line. For
 * the PO register the two buckets are "your document" (brief:... items)
 * and "requirements" (REQ-... items); anything else goes under "other".
 */
function partitionByGroupLabel(result) {
  const buckets = { 'your document': 0, 'requirements': 0, 'other': 0 };
  for (const q of result.questions) {
    const src = q.context?.statement?.source ?? q.context?.sourceSpan ?? 'tree';
    if (typeof src === 'string' && src !== 'tree' && !src.startsWith('scan:')) buckets['your document']++;
    else if (q.context?.reqId) buckets['requirements']++;
    else buckets['other']++;
  }
  return buckets;
}
