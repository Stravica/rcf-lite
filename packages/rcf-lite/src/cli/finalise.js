// `rcf build finalise` subcommand handler. Light Finalise (FBS-237,
// US-20001 to US-20003, TAC-4156, ADR-4157): run on the PR branch before
// the merge, it writes complete from the last round's recorded REVIEW,
// TEST and test-strength verdicts (src/finalise/light.js).
//
//   rcf build finalise <fbs-id> --ci-run <ref> [--merge-suite <file>]
//
// Hard contract points:
//   - Finalise never reads rcf/verify-reports/, never writes verified and
//     spawns nothing but git; the separation judgement runs in-process;
//   - the report-era flags exit 2 with one line before anything runs;
//   - every refusal leaves rcf/fbs/<fbs-id>.json byte-identical.

import process from 'node:process';
import { parseArgs } from 'node:util';

import { isRcfError, writeUnexpectedFailure } from '#core/errors';
import { updateDocument, walkTree } from '#core/store';

import { findProjectRoot } from '../view/index.js';
import { kindOf } from '../query/index.js';
import { judgeFinalise } from '../finalise/light.js';

// AC-20003-1: the report-era flags, parsed only so each exits 2 with
// this line.
const RETIRED_FLAGS = ['report', 'max-report-age', 'mode', 'url', 'allow-pre-merge', 'provision-mode', 'ship-without-eval', 'ship-without-verified'];
const RETIRED = 'finalise no longer reads a verify report; Finalise writes complete from the recorded REVIEW, TEST and test-strength verdicts (rcf guidance build-cycle)';

const OPTION_SPEC = {
  // CI evidence: the passing CI run on HEAD (required, never fetched).
  'ci-run': { type: 'string' },
  // A BaseSuiteRecord at the newest FINALISE: merge head after H.
  'merge-suite': { type: 'string' },
  report: { type: 'string' },
  'max-report-age': { type: 'string' },
  mode: { type: 'string' },
  url: { type: 'string' },
  'allow-pre-merge': { type: 'boolean' },
  'provision-mode': { type: 'string' },
  'ship-without-eval': { type: 'string' },
  'ship-without-verified': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf build finalise <fbs-id> --ci-run <ref> [--merge-suite <file>]

Light Finalise, run on the PR branch before the merge. Writes complete on
the FBS from the last round's recorded verdicts: the newest ReviewVerdict
reachable from HEAD whose fbsIds include the spec (its head is H), the
TestVerdict and the test-strength record at H under rcf/verdicts/<h12>/.
It never reads rcf/verify-reports/, never writes verified, and spawns
nothing but git (the separation audit runs in-process).

Checks, in this order; the first refusal exits:
  - the report-era flags exit 2 (Retired, below);
  - the tree validates (exit 3);
  - --ci-run <ref> is given (exit 4 "ci evidence missing: pass --ci-run
    <ref>");
  - a ReviewVerdict for the spec, MERGE/PASS at H;
  - the spec is not notStarted (the round's DEFINE: marks it inProgress);
  - after H only the REVIEW: commit adding the verdict for H, TEST: and
    FINALISE: commits;
  - TEST PASS at H and no FAIL TestVerdict after it;
  - with a FINALISE: merge after H, --merge-suite naming a green
    base-suite record at the newest merge head;
  - test strength at H for every touched criterion;
  - the touched criteria cover every criterion changed since the base
    (the merge-base with origin/main, else main) and, for a spec at
    inProgress at H, every live criterion it scopes;
  - a Code Node on every touched criterion (exit 3; a spec carrying
    noCodeNodes is exempt);
  - the separation audit over the range passes.

Then it writes executionStatus complete and prints
  finalise: <fbs-id> complete at <head7> (reviewed <H7>, ci <ref>, touched <n> criteria)
Already complete from this round: "finalise: <fbs-id> complete
(unchanged)", no write. Complete at H (an amend round): the complete
line, no write. Verified with every touched criterion testOnly:
"finalise: <fbs-id> verified (unchanged: touched criteria are
testOnly)", no write.

Required:
  <fbs-id>                  The FBS item to finalise
  --ci-run <ref>            The passing CI run on HEAD (recorded, never
                            fetched)

Options:
  --merge-suite <file>      A BaseSuiteRecord green at the newest
                            FINALISE: merge head after H
  --quiet                   Suppress non-error confirmations
  --help                    Print this help

Retired (exit 2, "${RETIRED}"):
  --report, --max-report-age, --mode, --url, --allow-pre-merge,
  --provision-mode, --ship-without-eval, --ship-without-verified

Exit codes:
  0  complete written, or confirmed with no write
  1  IO / unexpected runtime failure
  2  usage error (bad flags, a retired flag, unknown / non-FBS id)
  3  the tree does not validate, a touched criterion has no Code Node,
     or the write is refused
  4  refused: CI evidence missing, or a recorded verdict, the round, the
     merge suite, test strength, the touched criteria or the separation
     audit does not hold; the FBS is left unchanged
`;

/**
 * @param {string[]} argv - argv slice after `finalise`
 * @param {object} [deps] - injectable seams (stdout / stderr / cwd / spawn)
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const cwd = deps.cwd ?? process.cwd();

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: true, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  const flags = parsed.values;
  const positionals = parsed.positionals;
  if (flags.help) { stdout.write(HELP); return 0; }
  if (RETIRED_FLAGS.some((f) => flags[f] !== undefined)) {
    stderr.write(`${RETIRED}\n`);
    return 2;
  }

  const usage = (message) => {
    stderr.write(`[error] usage finalise: ${message}\n`);
    return 2;
  };

  if (positionals.length === 0) return usage('an <fbs-id> positional is required');
  if (positionals.length > 1) return usage('multiple positional ids are not supported');
  const fbsId = positionals[0];
  if (fbsId.includes('*') || fbsId.includes('?')) {
    return usage('wildcard / glob positional not supported');
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }

  // Walker errors block finalise entirely - no check runs against a tree
  // that fails validation, and no status write lands.
  const { tree, errors } = await walkTree({ projectRoot });
  if (errors.length > 0) {
    const emptyBinding = errors.find((e) => e?.documentId === fbsId && /acIds/.test(e?.message ?? ''));
    if (emptyBinding) {
      stderr.write(`[error] refused finalise: ${fbsId} has no bound acceptance criteria; there is nothing to finalise. `
        + 'Bind at least one AC to the FBS (acIds) before finalising it.\n');
      return 3;
    }
    stderr.write('[error] validation the RCF tree does not validate; fix it before finalising.\n');
    return 3;
  }

  const ciRun = flags['ci-run'];
  if (typeof ciRun !== 'string' || ciRun.trim().length === 0 || ciRun.startsWith('-')) {
    stderr.write('ci evidence missing: pass --ci-run <ref>\n');
    return 4;
  }

  const kind = kindOf(tree, fbsId);
  if (kind !== 'fbs') {
    if (!kind) return usage(`id ${fbsId} not found`);
    return usage(`${fbsId} is a ${kind} id; finalise addresses FBS items only`);
  }

  const verdict = await judgeFinalise({ projectRoot, tree, fbsId, ciRun, mergeSuite: flags['merge-suite'], deps });
  if (!verdict.ok) {
    stderr.write(`${verdict.line}\n`);
    return verdict.code;
  }
  if (verdict.info) stderr.write(`${verdict.info}\n`);
  if (verdict.write) {
    const result = await updateDocument({ projectRoot, tree, id: fbsId, sets: [{ path: 'executionStatus', value: verdict.write }] });
    if (isRcfError(result)) {
      if (result.kind === 'ioFailure') { writeUnexpectedFailure(result, stderr); return 1; }
      stderr.write(`[error] ${result.kind} ${result.message}\n`);
      if (result.kind === 'usage') return 2;
      if (result.kind === 'validation' || result.kind === 'brokenReference') return 3;
      return 1;
    }
  }
  if (!flags.quiet) stdout.write(`${verdict.out}\n`);
  return 0;
}
