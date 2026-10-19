// `rcf audit separation` handler (FBS-222, US-19101, TAC-4149). Prints
// one PASS or FAIL line (or `--json` SeparationRows) for the commits in
// a pull request's range, judged by src/audit/separation.js.
//
// Exit table: 0 pass, 4 violation, 2 bad ref (and usage), 1 not a git
// repository. Read-only: the verb writes no file and reads no chain.

import { parseArgs } from 'node:util';

import { auditSeparation } from '../audit/separation.js';

const OPTION_SPEC = {
  base: { type: 'string' },
  head: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf audit separation [--base <ref>] [--head <ref>] [--json]

Judge each non-merge commit's Hand: trailer against the path classes it
touches, over the range from the merge-base with origin/main (or --base)
to HEAD (or --head). Merge commits are skipped. Read-only: spawns git
only, writes no file and reads no chain.

Hands: test-author, builder, reviewer, verifier, stage-keeper, mixed.
Classes (defaults, matched at any depth):
  test              test/, tests/, __tests__/, e2e/, *.test.*, *.spec.*
                    (test-author)
  criteria          rcf/ except the paths below (test-author)
  production        everything else, and rcf/code-nodes/ (builder)
  verifierEvidence  rcf/verify-reports/ (verifier)
  stageKeeper       CHANGELOG*, RELEASE* (stage-keeper)
  neutral           rcf/fbs/, rcf/manifest.json, Markdown outside rcf/,
                    lockfiles, .github/ (anyone)
A declared hand passes when it touches only its own classes plus
neutral; an undeclared commit passes when it touches at most one
non-neutral class. Any other Hand: value is a violation.

Prints one line:
  separation: PASS <n> commits (base <sha7>, head <sha7>): test-author <n>,
    builder <n>, verifier <n>, stage-keeper <n>, neutral <n>,
    undeclared <n>, exceptions <n>
  separation: FAIL <k> of <n> commits (base <sha7>, head <sha7>):
    <sha7> Hand=<hand> touches <path>[; ...]

Options:
  --base <ref>   Range start (default: merge-base with origin/main)
  --head <ref>   Range end (default: HEAD)
  --json         Print a JSON array of one SeparationRow per non-merge
                 commit: { sha, subject, hand, declared, classes,
                 verdict, reason, paths }
  --help         Print this help

Exit codes:
  0  every commit passes
  4  one or more commits violate separation
  2  usage error or a ref that does not resolve
  1  not a git repository
`;

const COUNTED_HANDS = ['test-author', 'builder', 'verifier', 'stage-keeper'];

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

  const result = await auditSeparation({ cwd, base: flags.base, head: flags.head, deps });
  if (!result.ok) {
    if (result.error === 'notRepo') {
      stderr.write('separation: not a git repository\n');
      return 1;
    }
    stderr.write(`separation: bad ref ${result.ref}\n`);
    return 2;
  }

  const { rows } = result;
  const failed = rows.filter((r) => r.verdict === 'fail');
  const code = failed.length ? 4 : 0;

  if (flags.json) {
    const out = rows.map(({ sha, subject, hand, declared, classes, verdict, reason, paths }) => (
      { sha, subject, hand, declared, classes, verdict, reason, paths }));
    stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return code;
  }

  const range = `(base ${result.base.slice(0, 7)}, head ${result.head.slice(0, 7)})`;
  if (failed.length) {
    const items = failed.map((r) => {
      const who = `${r.sha.slice(0, 7)} Hand=${r.hand ?? 'none'}`;
      return r.offending.length ? `${who} touches ${r.offending.join(', ')}` : `${who} ${r.reason}`;
    });
    stdout.write(`separation: FAIL ${failed.length} of ${rows.length} commits ${range}: ${items.join('; ')}\n`);
    return code;
  }

  const counts = Object.fromEntries([...COUNTED_HANDS, 'neutral', 'undeclared', 'exceptions'].map((k) => [k, 0]));
  for (const r of rows) {
    if (COUNTED_HANDS.includes(r.hand)) counts[r.hand] += 1;
    else if (r.classes.every((c) => c === 'neutral')) counts.neutral += 1;
    else counts.undeclared += 1;
  }
  const tally = Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ');
  stdout.write(`separation: PASS ${rows.length} commits ${range}: ${tally}\n`);
  return code;
}
