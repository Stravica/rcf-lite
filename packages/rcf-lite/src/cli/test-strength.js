// `rcf audit test-strength` handler (FBS-236, US-19901 to US-19903,
// TAC-4155, ADR-4156; FBS-242, US-19904). Prints one PASS, FAIL or
// BLOCKED line (or, with --json, the TestStrengthReport v1 object alone)
// for the touched criteria: the structural check of their bound tests,
// then the mutation proof over their Code Node symbols
// (src/audit/test-strength/).
//
// Exit table: 0 pass, 4 fail or a --record refusal, 5 blocked (a
// criterion the audit cannot read, none failing), 2 usage or a whole-run
// failure (no rcf/test-strength.json or a malformed one, an unreadable
// entry point, no scope, an unknown id, a file-level Code Node on a code
// file, too many mutants, a bound test not committed or not run, a runner
// that cannot run, a bound test run that wrote in the project, --record
// with no REVIEW verdict), 3 the chain does not load, 130 SIGINT and 143
// SIGTERM. Precedence 2 over 4 over 5 over 0.

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
value (vi.mock is read as a module mock too). It runs for every
criterion in scope first.

Mutation proof (criteria that pass the structural check): for each
symbol-level Code Node (<path>#<symbol>) three mutants, stubToThrow (the
body throws), noOp (the body is empty) and callRemoval (each
statement-level call of the symbol in the project's source becomes a
no-op; notApplicable when there is none). A function, a method or a
function-valued initialiser is mutable; a class symbol expands to its
methods; any other symbol fails "no mutable symbol". A file-level Code
Node on a path that is not source (docs, JSON, YAML, workflows, chain
records) gets fileBlank (the file is emptied); one on a .js, .mjs or
.cjs file is never mutated. Each mutant is applied in a working copy
of HEAD the audit makes in its own scratch directory under the OS temp
directory, and only the criterion's bound tests run against it, each
through its runner; at least one must go red (killed): its runner's
report shows it failed, or its file failed to load. A mutant whose
tests outlive --mutant-timeout is "timeout" and counts as killed. A
working copy writes nothing in the project's .git, and its
node_modules directory is the audit's own, its entries linking the
project's installed packages. Nothing in the project is written
outside rcf/verdicts/<H12>/: the audit compares the project tree
(node_modules and every dot directory included, .git excluded) and
every node_modules directory on Node's module resolution path above
it, up to the repository root, before and after the bound tests run,
and a path a bound test run wrote there exits 2 "test-strength: a
bound test run wrote <path> in the project" (a path above the project
named relative to it) and records nothing. No scratch directory
outlives the run; one that cannot be removed is named in one stderr
line "[warn] test-strength: scratch directory <dir> could not be
removed". On an error exit the audit still runs that comparison and
the warn line, and its message names the scratch directory. On
SIGINT or SIGTERM the audit kills the process group of every bound
test run it started, removes its scratch directory and exits 130 or
143.

rcf/test-strength.json (required; written by the test-author):
  { "entry": [ { "kind": "bin" | "module" | "worker", "path": <path> } ],
    "harness": [glob, ...], "edge": [specifier, ...],
    "clock": [specifier, ...],
    "runners": [ { "files": [glob], "kind": "nodeTest" | "vitest" | "playwright",
                   "argv": [...] } ],
    "runner": [argv with <file> and <name>],
    "suiteCommand": <the project's RCF suite command> }
  entry and harness need one or more items.
  runners (optional): each bound test file runs under the first entry
  whose files glob matches it; an entry that matches no bound file is
  allowed and silent. files globs: "**" spans directories, "*" and "?"
  stay inside one segment. kind sets the default argv and the report
  the audit reads, and each default carries that reporter:
    nodeTest    node --test --test-reporter=tap --test-name-pattern <name> <file>
    vitest      vitest run <file> -t <name> --reporter=json --outputFile=<report>
    playwright  playwright test <file> -g <name> --reporter=json
  The audit adds no flag to a runner's argv: each kind's default argv
  runs as stated here and an argv override as written, an override
  naming its own cache flags included; what a runner writes under
  node_modules stays in the audit's working copy.
  <report> is a per-run temp path the audit sets and reads. argv, when
  given, replaces the whole argv (holding <file> or <name>, and <report>
  where its runner writes the report to a file) and must carry its own
  reporter flag (--test-reporter=tap, or --reporter=json); give the test
  runner alone, never a type checker. <name> is the pointer's name
  filter: nodeTest an escaped ^name$; vitest -t with the titles joined
  by " > ", a leaf as (^| > )<leaf>$ (anchored at the end and at a title
  boundary, so a nested test runs and a longer title ending in the same
  words does not), a full path as ^<titles joined by " > ">$, the leaf
  and title text regex-escaped, ^prefix with no $ for a describe title,
  and the report's space-joined fullName mapped back to the titles,
  never split on spaces;
  playwright the title path space-joined, $-anchored for a leaf or a
  path, and for a describe title followed by a space with no $. A pointer
  <file>::<name> names the leaf title, the title path ("describe > test")
  or a describe title (run when a leaf under it ran, failed when any
  leaf under it failed). An entry is malformed (exit 2, naming
  runners[<i>]) when files is missing, empty or not a list of non-empty
  strings, kind is none of the three, or argv holds neither <file> nor
  <name>.
  runner (optional, the legacy runner beside runners): a bound test file
  no runners entry matches runs under it, judged by its exit code; with
  neither, the file runs under kind nodeTest.
Sources: JavaScript ESM and CommonJS (.js, .mjs, .cjs); .ts, .mts and
.cts through node:module's stripTypeScriptTypes in strip mode; .tsx and
.jsx through a JSX scanner; .vue through its <script> and <script setup>
blocks (lang ts, tsx or js). A file-level Code Node on .ts .mts .cts .tsx
.jsx .py .rb .go .java .kt .rs .php .cs .swift exits 2; one on a .vue
file gets fileBlank.

Blocked: a bound test file or a symbol-level Code Node file the audit
cannot read makes its criterion blocked (result "blocked", reason
"TEST_STRENGTH_UNSUPPORTED", a detail per unreadable file joined by
"; ") while the other criteria are judged: a file of another type
("<file>:1:1: unsupported file type <ext>"), non-erasable TypeScript
syntax ("<file>:<line>:<col>: non-erasable TypeScript syntax
(<construct>)"), a failed JSX scan ("JSX scan failed at
<file>:<line>:<col>: <what the scanner met>") or a .vue script block
with a src attribute. <line> and <col> are 1-based and place the
first character of the construct in the file as committed: <line>
counts the line breaks before it (CRLF, a lone CR or LF), <col> the
UTF-16 code units from the start of that line; for a construct strip
mode refuses or a syntax error, it is where node's refusal places it
(node's caret, its width measured by node); when the input ends inside
a construct, it is where the innermost such construct opens; when node
names a line and no column, it is that line, column 1. When the audit
cannot check the position node gives (node's caret does not move
across the code points that share its column, as after an escape
character, or node's own probes of them disagree), the refusal is
placed at node's line, column node's caret index plus 1, and one
stderr line names the reason, "test-strength: column for
<file>:<line> is node's display column (position check withheld:
<reason>)": a documented degraded state, never a silent one.
A blocked criterion is not checked, gets no
mutant and counts in no total but criteria and blocked. An entry point
the views cannot read exits 2 "entry point unreadable".

Prints one line (none under --json):
  test-strength: PASS <n> criteria at <h7>: structural <n>/<n>, mutants
    killed <k>/<total> (timeout <t>, notApplicable <a>)
  test-strength: FAIL <k> of <n> criteria at <h7>: <AC id> <reason>[; ...]
    [, blocked <m>: <AC id> (<file>), ...]
  test-strength: BLOCKED <n> criteria at <h7>: structural <a>/<b>,
    mutants killed <k>/<total> (timeout <t>, notApplicable <a>,
    blocked <m>): <AC id> (<file>[ and <file>]), ...
<n> is the criteria in scope; <b> those less the blocked ones; blocked
ids ascend. <k> counts timeouts; <total> excludes notApplicable mutants.
Before any mutant the bound tests run once unmutated; one red, or one
its runner did not run, exits 2 with no result line. Reasons:
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
                             (pass, fail or blocked); never commits
  --json                     Print the TestStrengthReport v1 object alone
  --jobs <n>                 Mutants run at once, one working copy each
                             (default: half the CPU count, at least 1)
  --mutant-timeout <seconds> Time limit per mutant (default ${DEFAULT_MUTANT_TIMEOUT_S})
  --max-mutants <n>          Refuse a scope with more mutants (default ${DEFAULT_MAX_MUTANTS})
  --help                     Print this help

--record needs a REVIEW verdict reachable from HEAD whatever the scope
flags, and refuses (exit 4) a dirty working tree or a HEAD that differs
from the reviewed head outside rcf/verdicts/, rcf/verify-reports/ and
FINALISE classes. It writes nothing else.

Exit codes (precedence 2 over 4 over 5 over 0):
  0  every criterion passes
  4  a criterion fails, or --record refused
  5  blocked: a criterion the audit cannot read, and none fails
  2  usage or a whole-run failure: no or malformed
     rcf/test-strength.json, an unreadable entry point, no scope, an
     unknown id, a file-level Code Node on a code file, more mutants
     than --max-mutants, a bound test not committed, red unmutated or
     not run by its runner (or matching several tests), a runner that
     cannot run, a bound test run that wrote in the project, or
     --record with no REVIEW verdict
  3  the chain does not load
  130, 143  SIGINT, SIGTERM during the run
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
