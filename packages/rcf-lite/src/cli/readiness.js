// `rcf define readiness` subcommand handler (REQ-175; proposal
// 2026-09-22 §2.4, §6.2 v3; spec 2026-10-01 §2.3, §3, §4 for the
// 0.29.0 PR B additions).
//
// Prints the readiness object (§2.4) or its JSON envelope. The 0.29.0
// train added two verdict lines at the top of the text report (shared
// with the Readiness tab via `formatVerdictLines`) and two new flags:
// `--level intent|build` which drives the exit code against
// `levels.<which>.ok` (stricter than `--check all` on warn-with-ack
// failures, per spec section 3.2 decision 4; the `[warn]` line still
// prints), and `--persona productOwner|engineer` which is a display
// filter and never affects the exit code or JSON content. `--check`
// behaviour is unchanged. The producer is wrapped with
// `runWithAdmissibilityGate` (NV-BL-SR-03 addendum) so a chain that
// refuses admissibility short-circuits with the same refusal envelope
// every other query verb has.

import { parseArgs } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveTestPointers, walkTree } from '#core/store';
import { checkCodeNodeResolution } from '#core/store';
import { findProjectRoot } from '../view/index.js';
import { loadFreezeRecord } from '../define/freeze-record.js';
import { loadAllLedgers } from '../define/ledgers.js';
import {
  STAGE_ALIASES,
  STAGE_GATES,
  STAGE_ORDER,
  STAGE_SHORT_NAMES,
  ackable,
  extractInterfacePathTokens,
  stagePolicy,
} from '../query/gates.js';
import {
  computeReadiness,
  countLitmusReadersAtHash,
  formatTreeLine,
  formatVerdictLines,
  parseLevelFlag,
  parseLitmusFlag,
  parsePersonaFlag,
} from '../query/readiness.js';
import { runWithAdmissibilityGate } from '../query/index.js';

const OPTION_SPEC = {
  json: { type: 'boolean' },
  check: { type: 'string' },
  level: { type: 'string' },
  persona: { type: 'string' },
  litmus: { type: 'string' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf define readiness [options]

Compute and print the DEFINE readiness view: whether the tree is
freezeable, which stage gate blocks, what the delta and its fan-out
look like, and what the CLI recommends as the next action.

The compute is pure: it composes the freeze delta, per-id impact,
eight stage-gate checks (D1..D8), tree coverage and open decisions
into one object. The viewer's Readiness tab (slice 5) will render the
same object with no schema translation.

The text report prints two verdict lines at the top (shared with the
Readiness tab via formatVerdictLines): intent-complete (every
product-owner question answered) and ready-to-build (equals
freezeable). Blockers are grouped by persona, ordered by the
profile.md register marker.

Options:
  --json                    Emit the full readiness object as JSON.
                            --persona is ignored under --json.
  --check <stage>           Narrow the output to one stage. Accepts a
                            stage id (D1..D8) or its short name:
                            brief | skeleton | shapes | stories |
                            crosscut | consistency | decisions |
                            freeze. Exits 4 on a blocking-stage
                            failure (D1 / D2 / D4 / D7 / D8) and on
                            an unacknowledged D3 or D5 bite failure
                            (ADR-4131, 0.30.0 PR 5 and PR 6); exits 0
                            when D3 or D5 is acknowledged at the
                            current tree hash; exits 0 with a visible
                            '[warn]' line on an unacknowledged warn-
                            with-ack failure (D6 until PR 7 bites it).
                            Use
                            --check all to print every stage under
                            this exit-code policy.
  --level <intent|build>    Pick which verdict the exit code follows.
                            --level intent exits 4 when
                            levels.intentComplete.ok is false
                            (any failing product-owner check); exits
                            0 otherwise. --level build exits 4 when
                            levels.readyToBuild.ok is false, which is
                            stricter than --check all on unacked
                            warn-with-ack failures (the [warn] line
                            still prints). Combined with --check, the
                            invocation exits 4 if either policy
                            says 4. With neither flag the exit code
                            stays 0.
  --persona <po|engineer>   Display filter for the text report.
                            Values: productOwner | engineer. Collapses
                            the opposite-persona block to one line
                            with its check count and restricts the
                            per-stage detail to matching-persona
                            checks. Never affects the exit code or
                            the JSON content.
  --litmus <n>              Require n distinct litmus readings at the
                            current tree hash before passing (0.30.0
                            PR 7, ADR-4131 extended). A litmus reading
                            is a probe-ledger entry whose finding
                            begins litmus:<reader>: and whose text
                            includes the current tree hash. Fewer
                            than n distinct readers exits 4 naming
                            the shortfall. No process is spawned and
                            no network call is made; the harness
                            lands the readings through
                            rcf define ledger probes add.
  --help                    Print this help.
`;

/** Text label per stage state, for the chip line. */
const STATE_LABEL = {
  passed: 'passed',
  failing: 'failing',
  acknowledged: 'acknowledged',
  notApplicable: 'notApplicable',
};

/**
 * ADR-4131 (0.30.0 PR 5): walk the tree's TAC interfaces, extract the
 * `path:` tokens the engineer named, resolve each one against
 * `projectRoot` on disk, and return the set of tokens that resolve.
 * `shapes:pathsResolve` reads the set from the stage context and
 * decides the D3 bite without I/O. The compute is pure; this helper is
 * the one place I/O happens for the check.
 *
 * @param {string} projectRoot
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @returns {Promise<Set<string>>}
 */
async function resolveInterfacePaths(projectRoot, tree) {
  const resolved = new Set();
  /** @type {Set<string>} */
  const candidates = new Set();
  for (const tac of tree.tacs ?? []) {
    for (const iface of tac.interfaces ?? []) {
      const desc = typeof iface?.description === 'string' ? iface.description : '';
      for (const token of extractInterfacePathTokens(desc)) {
        candidates.add(token);
      }
    }
  }
  await Promise.all([...candidates].map(async (token) => {
    try {
      await stat(join(projectRoot, token));
      resolved.add(token);
    } catch {
      // Missing path stays out of the set; the gate decides whether
      // `authoredAt: D3` lets it through.
    }
  }));
  return resolved;
}

/**
 * Read `rcf/.identity/profile.md` when it exists; return null on
 * ENOENT. Any other read error surfaces as null so the profile
 * markers just fail to appear (the D1 check treats absence as a
 * finding, not a runtime error).
 *
 * @param {string} projectRoot
 * @returns {Promise<string|null>}
 */
async function readProfileText(projectRoot) {
  try {
    return await readFile(join(projectRoot, 'rcf', '.identity', 'profile.md'), 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    return null;
  }
}

/**
 * Pick the profile register from the text, returning one of
 * `productOwner` | `engineer` | `unstated`. The marker is a bare
 * word match (same convention as `checkD1Brief`); the first marker
 * found in the text wins. Absent or unrecognised yields `unstated`,
 * which the text report orders as PO first (spec section 4).
 *
 * @param {string | null} text
 * @returns {'productOwner' | 'engineer' | 'unstated'}
 */
function pickRegister(text) {
  if (typeof text !== 'string' || text.length === 0) return 'unstated';
  // Scan in file-order so the first marker in the document wins;
  // this matches how a human reads `profile.md`.
  const markers = ['productOwner', 'engineer', 'unstated'];
  let best = null;
  let bestIdx = Infinity;
  for (const m of markers) {
    const idx = text.indexOf(m);
    if (idx === -1) continue;
    if (idx < bestIdx) {
      bestIdx = idx;
      best = m;
    }
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

  const checkArg = flags.check;
  let checkStage = null;
  if (typeof checkArg === 'string') {
    if (checkArg === 'all') {
      checkStage = 'all';
    } else if (STAGE_ALIASES[checkArg]) {
      checkStage = STAGE_ALIASES[checkArg];
    } else {
      stderr.write(`[error] usage readiness: unknown --check ${checkArg} (expected D1..D8, one of ${Object.values(STAGE_SHORT_NAMES).join(' | ')}, or 'all')\n`);
      return 2;
    }
  }

  /** @type {'intent' | 'build' | null} */
  let level;
  try {
    level = parseLevelFlag(flags.level);
  } catch (err) {
    stderr.write(`[error] usage readiness: ${/** @type {Error} */ (err).message}\n`);
    return 2;
  }

  /** @type {'productOwner' | 'engineer' | null} */
  let persona;
  try {
    persona = parsePersonaFlag(flags.persona);
  } catch (err) {
    stderr.write(`[error] usage readiness: ${/** @type {Error} */ (err).message}\n`);
    return 2;
  }

  /** @type {number | null} */
  let litmus;
  try {
    litmus = parseLitmusFlag(flags.litmus);
  } catch (err) {
    stderr.write(`[error] usage readiness: ${/** @type {Error} */ (err).message}\n`);
    return 2;
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }

  const { tree, errors } = await walkTree({ projectRoot });
  const staleErrors = await checkCodeNodeResolution({ projectRoot, tree });
  const validateErrors = [...errors, ...staleErrors];

  const [freeze, ledgers, testPointers, profileText, resolvedPaths] = await Promise.all([
    loadFreezeRecord({ projectRoot }),
    loadAllLedgers({ projectRoot }),
    resolveTestPointers({ projectRoot, tree }),
    readProfileText(projectRoot),
    resolveInterfacePaths(projectRoot, tree),
  ]);

  const startedAt = Date.now();
  const chainRulesetVersion = typeof tree.manifest?.rulesetVersion === 'string'
    ? tree.manifest.rulesetVersion
    : null;

  // Readiness is a diagnostic: even a chain that refuses admissibility
  // wants to know which stage gate blocks it (AC-17902-4). Compute
  // readiness once up front, then run the admissibility wrap passing
  // the computed stages and validate-errors so it can cite
  // NV-DL-ADM-02 (D4 floor), NV-DL-ADM-03 (D3 bite) and NV-DL-ADM-04
  // (validate findings) alongside the NV-BL rules (PR 9).
  /** @type {import('../query/readiness.js').ReadinessResult} */
  const result = computeReadiness(tree, {
    freeze,
    ledgers,
    profile: undefined,
    profileText,
    testPointers,
    validateErrors,
    resolvedPaths,
  });
  const gated = await runWithAdmissibilityGate({
    tree,
    chainRulesetVersion,
    defineStages: result.stages,
    defineValidateErrors: validateErrors,
    produce: () => result,
  });
  const wallMs = Date.now() - startedAt;

  if (gated.status === 'refused-admissibility') {
    stderr.write(`[warn] readiness: chain admissibility refused (informational; the readiness compute still ran). ${gated.refusal}\n`);
  } else if (Array.isArray(gated.defineRules) && gated.defineRules.length > 0) {
    stderr.write(`[warn] readiness: DEFINE-stage admissibility rules bite (informational; the readiness compute still ran): [${gated.defineRules.join(', ')}]. Resolve the failing stages or record an --ack reason on freeze.gates to satisfy recordedInChain.\n`);
  }

  if (flags.json) {
    // JSON emission carries the full object plus the wall-time hint
    // and the invocation level as a stable side-band on `_meta`.
    // `_meta.level` is null when the flag was absent (spec section
    // 3.3): consumers can tell "no --level given" from "--level
    // build" explicitly, which matters for the ticket artefact.
    const envelope = { ...result, _meta: { wallMs, level, litmus } };
    stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return decideExitCode(result, checkStage, level, litmus, ledgers, stderr);
  }

  renderText(stdout, stderr, result, wallMs, checkStage, level, persona, profileText);
  return decideExitCode(result, checkStage, level, litmus, ledgers, stderr);
}

/**
 * Emit the text summary (spec section 4):
 *   1. Tree line.
 *   2. Verdict pair (intent-complete, ready-to-build).
 *   3. Next action, chip line, delta, coverage, decisions, freezeable
 *      (today's lines; omitted when --check narrows to one stage).
 *   4. Product-owner block and engineer block, ordered by the
 *      profile.md register (PO first by default; engineer first when
 *      the register is `engineer`; `unstated`/absent is PO first).
 *      With --persona the opposite-persona block collapses to one
 *      line; with --check <stage> the persona blocks are limited to
 *      that stage.
 *   5. Per-stage detail block (today's output; persona is now inside
 *      the parenthesis after `over`). With --persona only the
 *      matching-persona checks are rendered.
 *
 * @param {NodeJS.WritableStream} stdout
 * @param {NodeJS.WritableStream} stderr
 * @param {import('../query/readiness.js').ReadinessResult} result
 * @param {number} wallMs
 * @param {string | null} checkStage
 * @param {'intent' | 'build' | null} level
 * @param {'productOwner' | 'engineer' | null} persona
 * @param {string | null} profileText
 */
function renderText(stdout, stderr, result, wallMs, checkStage, level, persona, profileText) {
  stdout.write(`${formatTreeLine(result)}\n`);

  const verdicts = formatVerdictLines(result);
  stdout.write(`${verdicts.intentComplete}\n`);
  stdout.write(`${verdicts.readyToBuild}\n`);

  if (!checkStage || checkStage === 'all') {
    renderNextActions(stdout, result, level);
    stdout.write(`Chips: ${formatChipLine(result)}\n`);
    stdout.write(`Delta: changed ${result.delta.changed.length}, added ${result.delta.added.length}, removed ${result.delta.removed.length}, briefSince ${result.delta.briefSince.length}, impacted ${result.delta.impacted.length}, impactedFbs ${result.delta.impactedFbs.length}.\n`);
    stdout.write(`Coverage: tree ${result.coverage.tree.totals.covered}/${result.coverage.tree.totals.requirements} covered (strict), ${result.coverage.delta.length} REQ ancestor(s) scoped from the delta.\n`);
    stdout.write(`Decisions open: ${result.decisions.length}.\n`);
    stdout.write(`Freezeable: ${result.freezeable ? 'yes' : 'no'}. Compute: ${wallMs} ms.\n`);
  }

  const register = pickRegister(profileText);
  renderPersonaBlocks(stdout, result, persona, register, checkStage);

  for (const stage of result.stages) {
    if (checkStage && checkStage !== 'all' && stage.stage !== checkStage) continue;
    stdout.write(`\n${formatStageLine(stage)}\n`);
    for (const c of stage.checks) {
      if (persona && c.persona !== persona) continue;
      const mark = c.ok ? 'ok' : 'FAIL';
      stdout.write(`  [${mark}] ${c.name} (${c.over}, ${c.persona}): ${c.pass}/${c.total}\n`);
      for (const f of c.failing.slice(0, 20)) {
        stdout.write(`      - ${f.id}: ${f.why}\n`);
      }
      if (c.failing.length > 20) {
        stdout.write(`      ... ${c.failing.length - 20} more suppressed\n`);
      }
    }
  }
}

/**
 * Format the per-stage header line the text report prints, e.g.
 * `D3 (define.shapes): failing`. A `reason` trailer is appended only
 * when the envelope carries one (the `notApplicable` envelopes do; the
 * ADR-4138 tree-wide failing envelope does not). Exported so the
 * printed line is testable without driving the whole CLI.
 *
 * @param {{ stage: string, gate: string, state: string, reason?: string }} stage
 * @returns {string}
 */
export function formatStageLine(stage) {
  return `${stage.stage} (${stage.gate}): ${STATE_LABEL[stage.state] ?? stage.state}${stage.reason ? ` (${stage.reason})` : ''}`;
}

/**
 * Render the per-persona next-action lines (spec section 4). When a
 * `--level` is given the matching persona's line heads the pair; when
 * no `--level` is given the pair follows the register order. Each
 * line is `Next action (<persona>): <stage> / <check>; ids: ...`.
 *
 * @param {NodeJS.WritableStream} stdout
 * @param {import('../query/readiness.js').ReadinessResult} result
 * @param {'intent' | 'build' | null} level
 */
function renderNextActions(stdout, result, level) {
  const po = result.personas.productOwner.nextAction;
  const eng = result.personas.engineer.nextAction;
  const writeAction = (label, action) => {
    if (!action) {
      stdout.write(`Next action (${label}): none.\n`);
      return;
    }
    const ids = action.ids.length > 0 ? `; ids: ${action.ids.join(', ')}` : '';
    stdout.write(`Next action (${label}): ${action.stage} / ${action.check}${ids}. Run \`${action.command}\` after editing.\n`);
  };
  writeAction('product owner', po);
  writeAction('engineer', eng);
}

/**
 * Render the two persona-grouped blocker blocks (spec section 4).
 * `register` orders the pair; `persona` (the display filter) collapses
 * the opposite block to one count line; `checkStage` (when not null
 * or 'all') restricts both blocks to blockers in that stage.
 *
 * @param {NodeJS.WritableStream} stdout
 * @param {import('../query/readiness.js').ReadinessResult} result
 * @param {'productOwner' | 'engineer' | null} persona
 * @param {'productOwner' | 'engineer' | 'unstated'} register
 * @param {string | null} checkStage
 */
function renderPersonaBlocks(stdout, result, persona, register, checkStage) {
  const stageFilter = (bs) => (checkStage && checkStage !== 'all'
    ? bs.filter((b) => b.stage === checkStage)
    : bs);
  // L1 blockedBy for the PO list (ignores stage state); L2 blockedBy
  // minus PO entries for the engineer list, matching
  // `personas.engineer.blockers`.
  const poBlockers = stageFilter(result.personas.productOwner.blockers);
  const engineerBlockers = stageFilter(result.personas.engineer.blockers);

  const order = register === 'engineer'
    ? [['engineer', engineerBlockers], ['productOwner', poBlockers]]
    : [['productOwner', poBlockers], ['engineer', engineerBlockers]];

  for (const [p, blockers] of order) {
    stdout.write('\n');
    const headerLabel = p === 'productOwner' ? 'Product owner' : 'Engineer';
    const noun = p === 'productOwner' ? 'question' : 'check blocking';
    const nounPlural = p === 'productOwner' ? 'questions' : 'checks blocking';
    if (persona && p !== persona) {
      stdout.write(`${headerLabel}: ${blockers.length} ${blockers.length === 1 ? noun : nounPlural} (hidden; run without --persona)\n`);
      continue;
    }
    if (blockers.length === 0) {
      stdout.write(`${headerLabel}: 0 ${nounPlural}.\n`);
      continue;
    }
    stdout.write(`${headerLabel}: ${blockers.length} ${blockers.length === 1 ? noun : nounPlural}\n`);
    for (const b of blockers) {
      stdout.write(`  ${b.stage} ${b.check}: ${b.question} ${b.failingCount}/${b.failingCount}\n`);
      for (const id of b.ids.slice(0, 20)) {
        stdout.write(`      - ${id}\n`);
      }
      if (b.failingCount > b.ids.length) {
        stdout.write(`      ... ${b.failingCount - b.ids.length} more suppressed\n`);
      }
    }
  }
}

/**
 * Compose the chip line: "D1:passed D2:failing D3:acknowledged ..."
 *
 * @param {import('../query/readiness.js').ReadinessResult} result
 * @returns {string}
 */
function formatChipLine(result) {
  return result.stages.map((s) => `${s.stage}:${s.state}`).join(' ');
}

/**
 * Decide the exit code for an invocation (spec section 3.2 matrix):
 *   - No `--check`, no `--level`, no `--litmus`: always 0.
 *   - `--check` alone: today's stage policy (4 on blocking failure,
 *     0 with `[warn]` on warn-with-ack failure).
 *   - `--level intent`: 4 iff `levels.intentComplete.ok === false`.
 *   - `--level build`: 4 iff `levels.readyToBuild.ok === false`
 *     (stricter than `--check all`; the warn line still prints).
 *   - `--litmus <n>`: 4 iff fewer than n distinct litmus readings at
 *     the current tree hash (spec section 11.6, ADR-4131 extended).
 *   - Several: 4 if any policy says 4.
 *
 * Warn lines are emitted whenever a warn-with-ack stage is failing,
 * independent of exit code, so an operator always sees why.
 *
 * @param {import('../query/readiness.js').ReadinessResult} result
 * @param {string | null} checkStage
 * @param {'intent' | 'build' | null} level
 * @param {number | null} litmus
 * @param {object} ledgers
 * @param {NodeJS.WritableStream} stderr
 * @returns {number}
 */
function decideExitCode(result, checkStage, level, litmus, ledgers, stderr) {
  let exitCode = 0;

  // --check policy. ADR-4131 (0.30.0 PR 5): D3 bites, so a failing D3
  // without an acknowledgement at the current tree hash exits 4.
  // 0.30.0 PR 6 lifts the bite to D5 (crosscut:catalogue, the four new
  // D4/D2 engineer checks ride D5's ack because the --ack channel is
  // per gate). 0.30.0 PR 7 lifts the bite to D6 (the four consistency
  // scans; the --ack channel D3/D5/D6 already share stays unchanged).
  // The 'acknowledged' state is already folded by foldState() in
  // gates.js when the freeze record acknowledges the gate at the
  // current hash, so a failing-but-unacked bite stays failing here and
  // exit 4 is the right answer. `ackable(stage)` names the three gates
  // that accept an --ack override; a failing ackable stage that is not
  // acknowledged bites.
  const BITING_STAGES = new Set(['D3', 'D5', 'D6']);
  if (checkStage) {
    const stages = checkStage === 'all'
      ? result.stages
      : result.stages.filter((s) => s.stage === checkStage);
    for (const s of stages) {
      if (s.state !== 'failing') continue;
      const policy = stagePolicy(s.stage);
      const bites = BITING_STAGES.has(s.stage);
      if (policy === 'blocking' || bites) {
        exitCode = 4;
      } else if (ackable(s.stage)) {
        stderr.write(`[warn] readiness: ${s.stage} (${s.gate}) is failing without an acknowledgement at the current tree hash. Run \`rcf define freeze --ack ${s.gate} --reason "<text>"\` to acknowledge, or edit the tree to clear the failure.\n`);
      }
    }
  }

  // --level policy. When explicit, exit 4 if that level says "no".
  // --level build is stricter than --check all: it exits 4 even on an
  // unacknowledged warn-with-ack failure (spec decision 4). The warn
  // lines are still emitted (above when --check all is also set, or
  // here when --level build is given alone).
  if (level === 'intent' && result.levels.intentComplete.ok === false) {
    exitCode = 4;
  } else if (level === 'build' && result.levels.readyToBuild.ok === false) {
    exitCode = 4;
    // When --level build is set without --check all, we have not yet
    // emitted the per-stage warn lines. Emit them here so an operator
    // still sees which warn-with-ack stage drove the "no".
    if (!checkStage || checkStage !== 'all') {
      const seen = new Set();
      if (checkStage) {
        // --level build + --check <stage>: the --check branch already
        // emitted that stage's warn line (if any). Avoid duplicates.
        seen.add(checkStage);
      }
      for (const s of result.stages) {
        if (seen.has(s.stage)) continue;
        if (s.state !== 'failing') continue;
        if (stagePolicy(s.stage) === 'blocking') continue;
        stderr.write(`[warn] readiness: ${s.stage} (${s.gate}) is failing without an acknowledgement at the current tree hash. Run \`rcf define freeze --ack ${s.gate} --reason "<text>"\` to acknowledge, or edit the tree to clear the failure.\n`);
      }
    }
  }

  // --litmus policy (0.30.0 PR 7, ADR-4131 extended; R9 clarified
  // 2026-10-03, w-2026-10-03-dave-011). Count distinct readers who
  // have landed a probe-ledger entry at the current LITMUS HASH whose
  // finding begins litmus:<reader>:; exit 4 when fewer than n have
  // attested. The litmus hash is the tree hash computed with the
  // probes ledger excluded (see computeLitmusHash in src/query/readiness.js)
  // so a reader's own write does not shift the hash it is attesting to.
  if (typeof litmus === 'number' && litmus > 0) {
    const hash = result.tree.litmusHash;
    const readers = countLitmusReadersAtHash(ledgers, hash);
    if (readers.size < litmus) {
      stderr.write(`[warn] readiness: --litmus ${litmus} requires ${litmus} distinct litmus reading(s) at litmus hash ${hash}; found ${readers.size}. Spawn ${litmus - readers.size} more fresh-context reader(s) and land their readings through \`rcf define ledger probes add --req <reqId> --finding "litmus:<reader>: ..." --severity low\` with the litmus hash in the finding text (read it from \`rcf define readiness --json\` under \`tree.litmusHash\`).\n`);
      exitCode = 4;
    }
  }

  return exitCode;
}

// Re-export the gate map so consumers importing this module (help,
// slice 3) share one seam.
export { STAGE_GATES, STAGE_ORDER, STAGE_SHORT_NAMES };
