// `rcf audit test-strength` handler (FBS-236, US-19901 to US-19903,
// TAC-4155, ADR-4156). Prints one PASS or FAIL line (or, with --json,
// the TestStrengthReport v1 object) for the touched criteria: the
// structural check of their bound tests, then the mutation proof over
// their Code Node symbols (src/audit/test-strength/).
//
// Exit table: 0 pass, 4 fail or a --record refusal, 2 usage (no
// rcf/test-strength.json or a malformed one, no scope, an unknown id, an
// unsupported source, too many mutants, --record with no REVIEW verdict),
// 3 the chain does not load.

import { parseArgs } from 'node:util';

import { formatErrors } from '#core/errors';
import { walkTree } from '#core/store';
import { findProjectRoot } from '../view/index.js';
import { DEFAULT_MAX_MUTANTS, DEFAULT_MUTANT_TIMEOUT_S, auditTestStrength, defaultJobs } from '../audit/test-strength/index.js';

const OPTION_SPEC = {
  acs: { type: 'string' },
  fbs: { type: 'string' },
  record: { type: 'boolean' },
  json: { type: 'boolean' },
  jobs: { type: 'string' },
  'mutant-timeout': { type: 'string' },
  'max-mutants': { type: 'string' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf audit test-strength [--acs <AC id>[,...] | --fbs <id>[,...]] [--record]
                               [--json] [--jobs <n>] [--mutant-timeout <seconds>]
                               [--max-mutants <n>]

Prove that the touched criteria's bound tests are real, in two layers.
Scope: --acs, else the touchedAcIds of the newest REVIEW verdict
reachable from HEAD (rcf/verdicts/<h12>/review.json), else the --fbs
acIds.

Structural (static: test files and Code Node sources are read as text
at HEAD and never run): every import in a bound test file resolves to a
Node builtin, a third-party package, the declared harness or the app
entry; a module mock (mock.module) names a declared edge or clock
specifier; and no Code Node symbol gives a parameter or option named
logger, log, emitter, events, sender, mailer or notifier a default
value. It runs for every criterion in scope first.

Mutation proof (criteria that pass the structural check): for each
symbol-level Code Node (<path>#<symbol>) three mutants, stubToThrow (the
body throws), noOp (the body is empty) and callRemoval (each
statement-level call of the symbol in the project's source becomes a
no-op; notApplicable when there is none). A function, a method or a
function-valued initialiser is mutable; a class symbol expands to its
methods; any other symbol fails "no mutable symbol". A file-level Code
Node on a path that is not source (docs, JSON, YAML, workflows, chain
records) gets fileBlank (the file is emptied); one on a .js, .mjs or
.cjs file is never mutated. Each mutant is applied in a scratch git
worktree of HEAD under the OS temp directory, and only the criterion's
bound tests run against it, through the declared runner; at least one
must go red (killed). A mutant whose tests outlive --mutant-timeout is
"timeout" and counts as killed. The working tree, the index and every
tracked file are never changed, and no worktree outlives the run.

rcf/test-strength.json (required; written by the test-author):
  { "entry": [ { "kind": "bin" | "module" | "worker", "path": <path> } ],
    "harness": [glob, ...], "edge": [specifier, ...],
    "clock": [specifier, ...], "runner": [argv with <file> and <name>],
    "suiteCommand": <the project's RCF suite command> }
  entry and harness need one or more items; runner defaults to
  ["node", "--test", "--test-name-pattern", "<name>", "<file>"].
Sources: JavaScript ESM and CommonJS (.js, .mjs, .cjs). A bound test
file or a symbol-level Code Node on any other file, or a file-level Code
Node on .ts .tsx .jsx .py .rb .go .java .kt .rs .php .cs .swift, exits 2.

Prints one line:
  test-strength: PASS <n> criteria at <h7>: structural <n>/<n>, mutants
    killed <k>/<total> (timeout <t>, notApplicable <a>)
  test-strength: FAIL <k> of <n> criteria at <h7>: <AC id> <reason>[; ...]
<k> counts timeouts; <total> excludes notApplicable mutants. Reasons:
  imports <path> (not the app entry or the harness)
  mocks <specifier> (not a declared edge)
  silent default <name> in <path#symbol>
  vacuous: <operator> on <path#symbol> survived <k> bound tests
  no Code Node | no symbol-level Code Node | no mutable symbol <path#symbol>
  unbound

Options:
  --acs <ids>                Criteria to judge (comma-separated)
  --fbs <ids>                The acIds of these FBS records, when neither
                             --acs nor a REVIEW verdict gives the scope
  --record                   Write TestStrengthReport v1 to
                             rcf/verdicts/<H12>/test-strength.json for the
                             reviewed head H of the newest REVIEW verdict
                             (pass or fail); never commits
  --json                     Print the TestStrengthReport v1 object
  --jobs <n>                 Mutants run at once, one worktree each
                             (default: half the CPU count, at least 1)
  --mutant-timeout <seconds> Time limit per mutant (default ${DEFAULT_MUTANT_TIMEOUT_S})
  --max-mutants <n>          Refuse a scope with more mutants (default ${DEFAULT_MAX_MUTANTS})
  --help                     Print this help

--record needs a REVIEW verdict reachable from HEAD whatever the scope
flags, and refuses (exit 4) a dirty working tree or a HEAD that differs
from the reviewed head outside rcf/verdicts/, rcf/verify-reports/ and
FINALISE classes. It writes nothing else.

Exit codes:
  0  every criterion passes
  4  a criterion fails, or --record refused
  2  usage: no or malformed rcf/test-strength.json, no scope, an unknown
     id, an unsupported source, more mutants than --max-mutants, or
     --record with no REVIEW verdict
  3  the chain does not load
`;

const ids = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : null);

/** A positive number flag, or null when it is not one. */
function positive(value, { integer }) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) return null;
  return n;
}

/**
 * @param {string[]} argv - argv slice after `test-strength`
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const cwd = deps.cwd ?? process.cwd();
  const usage = (line) => { stderr.write(`[error] usage ${line}\n`); return 2; };

  let flags;
  try {
    ({ values: flags } = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: false, strict: true }));
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  if (flags.help) { stdout.write(HELP); return 0; }
  if (flags.acs !== undefined && flags.fbs !== undefined) return usage('--acs and --fbs are alternatives; pass one');
  const numbers = {};
  for (const [flag, key, integer, fallback] of [
    ['jobs', 'jobs', true, defaultJobs()],
    ['mutant-timeout', 'mutantTimeoutS', false, DEFAULT_MUTANT_TIMEOUT_S],
    ['max-mutants', 'maxMutants', true, DEFAULT_MAX_MUTANTS],
  ]) {
    if (flags[flag] === undefined) { numbers[key] = fallback; continue; }
    const n = positive(flags[flag], { integer });
    if (n === null) return usage(`--${flag} needs a positive ${integer ? 'integer' : 'number'}`);
    numbers[key] = n;
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }
  const { tree, errors } = await walkTree({ projectRoot });
  if (errors.length > 0) {
    stderr.write(`${formatErrors(errors, { verbose: false, strict: false })}\n`);
    return 3;
  }
  const result = await auditTestStrength({
    projectRoot, tree, acs: ids(flags.acs), fbs: ids(flags.fbs), record: Boolean(flags.record), ...numbers, deps,
  });
  for (const line of result.err) stderr.write(`${line}\n`);
  if (flags.json && result.report) stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  else if (result.out) stdout.write(`${result.out}\n`);
  return result.code;
}
