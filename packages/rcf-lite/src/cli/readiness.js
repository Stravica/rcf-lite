// `rcf define readiness` subcommand handler (REQ-175; proposal
// 2026-09-22 §2.4, §6.2 v3).
//
// Prints the readiness object (§2.4) or its JSON envelope. `--check
// <stage>` narrows the output to one stage; blocking stages exit 4 on
// failure (matching `coverage`'s per-AC refusal exit); warn-with-ack
// stages exit 0 with a visible `[warn]` line on unacknowledged
// failure. The producer is wrapped with `runWithAdmissibilityGate`
// (NV-BL-SR-03 addendum) so a chain that refuses admissibility short-
// circuits with the same refusal envelope every other query verb has.

import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
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
  stagePolicy,
} from '../query/gates.js';
import { computeReadiness, formatTreeLine } from '../query/readiness.js';
import { runWithAdmissibilityGate } from '../query/index.js';

const OPTION_SPEC = {
  json: { type: 'boolean' },
  check: { type: 'string' },
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

Options:
  --json                    Emit the full readiness object as JSON.
  --check <stage>           Narrow the output to one stage. Accepts a
                            stage id (D1..D8) or its short name:
                            brief | skeleton | shapes | stories |
                            crosscut | consistency | decisions |
                            freeze. Exits 4 on a blocking-stage
                            failure (D1 / D2 / D4 / D7 / D8); exits 0
                            with a visible '[warn]' line on an
                            unacknowledged warn-with-ack failure
                            (D3 / D5 / D6). Use --check all to print
                            every stage under this exit-code policy.
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

  const startedAt = Date.now();
  const chainRulesetVersion = typeof tree.manifest?.rulesetVersion === 'string'
    ? tree.manifest.rulesetVersion
    : null;

  // Readiness is a diagnostic: even a chain that refuses admissibility
  // wants to know which stage gate blocks it. The wrap runs first so
  // the ruleset toolScope guard is honoured (NV-BL-SR-03 addendum);
  // on refuse the refusal envelope is threaded through as informational
  // context and the compute still runs (ADR-4123).
  const gated = await runWithAdmissibilityGate({
    tree,
    chainRulesetVersion,
    produce: () => computeReadiness(tree, {
      freeze,
      ledgers,
      profile: undefined,
      profileText,
      testPointers,
      validateErrors,
    }),
  });

  /** @type {import('../query/readiness.js').ReadinessResult} */
  const result = gated.status === 'refused-admissibility'
    ? computeReadiness(tree, {
      freeze, ledgers, profile: undefined, profileText, testPointers, validateErrors,
    })
    : gated.payload;
  const wallMs = Date.now() - startedAt;

  if (gated.status === 'refused-admissibility') {
    stderr.write(`[warn] readiness: chain admissibility refused (informational; the readiness compute still ran). ${gated.refusal}\n`);
  }

  if (flags.json) {
    // JSON emission carries the full object plus the wall-time hint
    // as a stable side-band on `_meta` so consumers can spot
    // regressions without changing shape.
    const envelope = { ...result, _meta: { wallMs } };
    stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return checkStage ? decideExitCode(result, checkStage, stderr) : 0;
  }

  renderText(stdout, result, wallMs, checkStage);
  if (checkStage) {
    return decideExitCode(result, checkStage, stderr);
  }
  return 0;
}

/**
 * Emit the text summary: tree line, next action, chip line, then a
 * per-stage failing-items block. When `--check <stage>` names a
 * stage, only that stage's block is rendered.
 *
 * @param {NodeJS.WritableStream} stdout
 * @param {import('../query/readiness.js').ReadinessResult} result
 * @param {number} wallMs
 * @param {string | null} checkStage
 */
function renderText(stdout, result, wallMs, checkStage) {
  stdout.write(`${formatTreeLine(result)}\n`);
  if (!checkStage || checkStage === 'all') {
    if (result.nextAction) {
      const ids = result.nextAction.ids.length > 0 ? `; ids: ${result.nextAction.ids.join(', ')}` : '';
      stdout.write(`Next action: ${result.nextAction.stage} / ${result.nextAction.check}${ids}. Run \`${result.nextAction.command}\` after editing.\n`);
    } else {
      stdout.write('Next action: none; every gate passed, acknowledged or notApplicable. Freezeable.\n');
    }
    stdout.write(`Chips: ${formatChipLine(result)}\n`);
    stdout.write(`Delta: changed ${result.delta.changed.length}, added ${result.delta.added.length}, removed ${result.delta.removed.length}, briefSince ${result.delta.briefSince.length}, impacted ${result.delta.impacted.length}, impactedFbs ${result.delta.impactedFbs.length}.\n`);
    stdout.write(`Coverage: tree ${result.coverage.tree.totals.covered}/${result.coverage.tree.totals.requirements} covered (strict), ${result.coverage.delta.length} REQ ancestor(s) scoped from the delta.\n`);
    stdout.write(`Decisions open: ${result.decisions.length}.\n`);
    stdout.write(`Freezeable: ${result.freezeable ? 'yes' : 'no'}. Compute: ${wallMs} ms.\n`);
  }

  for (const stage of result.stages) {
    if (checkStage && checkStage !== 'all' && stage.stage !== checkStage) continue;
    stdout.write(`\n${stage.stage} (${stage.gate}) -- ${STATE_LABEL[stage.state] ?? stage.state}${stage.reason ? ` (${stage.reason})` : ''}\n`);
    for (const c of stage.checks) {
      const mark = c.ok ? 'ok' : 'FAIL';
      stdout.write(`  [${mark}] ${c.name} (${c.over}): ${c.pass}/${c.total}\n`);
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
 * Compose the chip line: "D1:passed D2:failing D3:acknowledged ..."
 *
 * @param {import('../query/readiness.js').ReadinessResult} result
 * @returns {string}
 */
function formatChipLine(result) {
  return result.stages.map((s) => `${s.stage}:${s.state}`).join(' ');
}

/**
 * Decide the exit code for a `--check <stage>` invocation:
 * - passed / acknowledged / notApplicable -> 0
 * - failing on a blocking stage (D1/D2/D4/D7/D8) -> 4
 * - failing on a warn-with-ack stage (D3/D5/D6) -> 0 with a stderr [warn]
 *
 * The 'all' target folds the individual codes: if any blocking stage
 * is failing, exit 4; otherwise 0 (warn lines print for each
 * warn-with-ack failure).
 *
 * @param {import('../query/readiness.js').ReadinessResult} result
 * @param {string} checkStage
 * @param {NodeJS.WritableStream} stderr
 * @returns {number}
 */
function decideExitCode(result, checkStage, stderr) {
  const stages = checkStage === 'all'
    ? result.stages
    : result.stages.filter((s) => s.stage === checkStage);
  let exitCode = 0;
  for (const s of stages) {
    if (s.state !== 'failing') continue;
    const policy = stagePolicy(s.stage);
    if (policy === 'blocking') {
      exitCode = 4;
    } else {
      stderr.write(`[warn] readiness: ${s.stage} (${s.gate}) is failing without an acknowledgement at the current tree hash. Run \`rcf define freeze --ack ${s.gate} --reason "<text>"\` to acknowledge, or edit the tree to clear the failure.\n`);
    }
  }
  return exitCode;
}

// Re-export the gate map so consumers importing this module (help,
// slice 3) share one seam.
export { STAGE_GATES, STAGE_ORDER, STAGE_SHORT_NAMES };
