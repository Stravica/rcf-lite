// `rcf audit separation` handler (FBS-233, US-19601 to US-19604,
// TAC-4153). Prints one PASS or FAIL line (or `--json` SeparationRow v2
// objects) for the commits in a pull request's range, each judged by its
// stage prefix against the path classes that stage owns
// (src/audit/separation.js).
//
// Exit table: 0 pass, 4 violation, 2 usage (the retired --require-hand
// included), a bad ref, a shallow repository or a malformed
// rcf/separation.json, 1 not a git repository. Read-only: the verb
// writes no file, reads no chain and spawns git only.

import { parseArgs } from 'node:util';

import { auditSeparation, STAGE_ROLES } from '../audit/separation.js';

const OPTION_SPEC = {
  base: { type: 'string' },
  head: { type: 'string' },
  json: { type: 'boolean' },
  // Retired in 0.37.0 (AC-19604-4): kept only to refuse it by name.
  'require-hand': { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf audit separation [--base <ref>] [--head <ref>] [--json]

Judge every commit in a pull request's range by the stage prefix on its
subject against the path classes that stage owns. The range is walked
with --first-parent from HEAD (or --head) to the merge-base with
origin/main (or --base). A merge commit is a row judged by the paths its
resolution changed (its combined diff); a commit reachable only through
a merge's second parent is never a row. A shallow repository is refused
(check out with fetch-depth 0). Read-only: spawns git only, writes no
file, reads no chain and never runs a declared generator.

Stage prefixes (strict: uppercase, a colon, a space) and their roles:
  DEFINE: test-author   BUILD: builder   REVIEW: reviewer
  TEST: verifier        FINALISE: stage-keeper
A commit with no prefix fails "no stage prefix"; a near miss (define:,
DEFINE:x, [DEFINE], VERIFY: ...) fails "malformed stage prefix".

Classes (defaults, matched at any depth, first match wins) and owners:
  generatorOutput   a declared output named by Generated-By: (FINALISE)
  reviewVerdict     rcf/verdicts/<h12>/review.json (REVIEW)
  testVerdict       rcf/verdicts/<h12>/test.json and test-strength.json
                    (TEST)
  releaseEvidence   rcf/verify-reports/releases/ (FINALISE)
  verifierEvidence  rcf/verify-reports/ (TEST)
  chainStatus       rcf/fbs/ (DEFINE, FINALISE)
  production        rcf/code-nodes/, and everything not listed (BUILD)
  criteria          the rest of rcf/ (DEFINE)
  lockfile          lockfiles (DEFINE, BUILD, FINALISE)
  versionField      package.json when its diff changes only the
                    "version" line (FINALISE)
  release           CHANGELOG*, RELEASE*, releases/releases.yaml (BUILD,
                    FINALISE)
  neutral           rcf/manifest.json, .github/, Markdown outside rcf/
                    (DEFINE, BUILD)
  hygieneTest       a hygiene/ directory directly under test/, tests/ or
                    __tests__/, and *.hygiene.test.* (BUILD)
  rcfTest           test/, tests/, __tests__/, e2e/, *.test.*, *.spec.*
                    (DEFINE)
REVIEW and TEST own only their verdict and evidence classes.

Transition (through 0.37.x): a Hand: trailer is read only to check that
it agrees with the stage's role. An agreeing trailer counts under
transition, a disagreeing one fails, and Hand: mixed fails as retired.

rcf/separation.json is read from the head commit through git, and
classes criteria itself:
  { "classes": { <class>: [glob, ...] },
    "generators": [ { "id": <id>, "command": <text>,
                      "outputs": [glob, ...], "checkedBy": <test file> } ] }
Configured classes extend the defaults and win over them, in file order
(a glob matches at any depth; ** spans directories). The 0.36.x names
test and stageKeeper are read as rcfTest and release, with a [warn]
line. A FINALISE: commit may touch a generator's outputs only with a
Generated-By: <id> trailer naming it; checkedBy must exist at the head;
the command is never run. A malformed file exits 2.

Prints one line:
  separation: PASS <n> commits (base <sha7>, head <sha7>): DEFINE <n>,
    BUILD <n>, REVIEW <n>, TEST <n>, FINALISE <n>, merges <n>,
    transition <n>
  separation: FAIL <k> of <n> commits (base <sha7>, head <sha7>):
    <sha7> <STAGE>: touches <path> (class <class>, owned by <stages>)[; ...]
Merges and transition commits also count under their stage. Each cause
of a failing commit is its own item, in check order: the prefix (then
the commit's only item), Hand: agreement, Hand: mixed, each path, each
Generated-By id. Items are joined by "; ".

Options:
  --base <ref>   Range start (default: merge-base with origin/main)
  --head <ref>   Range end (default: HEAD)
  --json         Print a JSON array of one SeparationRow v2 per commit:
                 { sha, subject, merge, stage, role, handTrailer,
                 classes, generators, verdict, reason, paths }
  --require-hand Retired: exits 2, since every commit needs a stage prefix
  --help         Print this help

Exit codes:
  0  every commit passes
  4  one or more commits violate separation
  2  usage error (the retired --require-hand included), a ref that does
     not resolve, a shallow repository or a malformed rcf/separation.json
  1  not a git repository
`;

const RETIRED_REQUIRE_HAND = '[error] usage --require-hand is retired; every commit needs a stage prefix';

/**
 * @param {string[]} argv - argv slice after `separation`
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const cwd = deps.cwd ?? process.cwd();

  let flags;
  try {
    ({ values: flags } = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: false, strict: true }));
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  if (flags.help) { stdout.write(HELP); return 0; }
  if (flags['require-hand']) {
    stderr.write(`${RETIRED_REQUIRE_HAND}\n`);
    return 2;
  }

  const result = await auditSeparation({ cwd, base: flags.base, head: flags.head, deps });
  if (!result.ok) {
    if (result.error === 'notRepo') {
      stderr.write('separation: not a git repository\n');
      return 1;
    }
    if (result.error === 'badOverride') {
      stderr.write(`separation: malformed ${result.path}: ${result.detail}\n`);
      return 2;
    }
    if (result.error === 'shallow') {
      stderr.write(`separation: shallow repository, the history from ${result.ref} is missing (fetch with full depth)\n`);
      return 2;
    }
    stderr.write(`separation: bad ref ${result.ref}\n`);
    return 2;
  }
  for (const warning of result.warnings) stderr.write(`[warn] ${warning}\n`);

  const { rows } = result;
  const failed = rows.filter((r) => r.verdict === 'fail');
  const code = failed.length ? 4 : 0;

  if (flags.json) {
    const out = rows.map(({ sha, subject, merge, stage, role, handTrailer, classes, generators, verdict, reason, paths }) => (
      { sha, subject, merge, stage, role, handTrailer, classes, generators, verdict, reason, paths }));
    stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return code;
  }

  const range = `(base ${result.base.slice(0, 7)}, head ${result.head.slice(0, 7)})`;
  if (failed.length) {
    const items = failed.flatMap((r) => r.items.map((item) => `${r.sha.slice(0, 7)} ${item}`));
    stdout.write(`separation: FAIL ${failed.length} of ${rows.length} commits ${range}: ${items.join('; ')}\n`);
    return code;
  }

  const counts = Object.fromEntries([...Object.keys(STAGE_ROLES), 'merges', 'transition'].map((k) => [k, 0]));
  for (const r of rows) {
    counts[r.stage] += 1;
    if (r.merge) counts.merges += 1;
    if (r.transition) counts.transition += 1;
  }
  const tally = Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ');
  stdout.write(`separation: PASS ${rows.length} commits ${range}: ${tally}\n`);
  return code;
}
