// Top-level and per-subcommand help. British English, ASCII hyphens
// only (Phase 4 §D17). Long-form docs land in Phase 8; this help block
// is the sole documentation surface for the phase.

import { HELP as BUILD_HELP } from './build.js';
import { HELP as MCP_HELP } from './mcp.js';
import { HELP as VIEW_HELP } from './view.js';

const TOP_LEVEL = `Usage: rcf <command> [options]

Commands:
  init                Scaffold a new RCF project
  view                Render the tree as HTML (live server)
  validate            Walk the tree and report schema and reference issues
  create <kind>       Create a new document
  read <id>           Print a document's body to stdout
  update <id>         Patch fields on an existing document
  delete <id>         Delete a document (refuses on dependents by default)
  link <us-id>        Link a US to a TAC (appends to tacIds; idempotent)
  unlink <us-id>      Unlink a US from a TAC
  coverage            Structural coverage report (PRD -> REQ -> US -> AC -> TS -> TC)
  trace <id>          Walk the graph forward / back / both from an id
  impact <id>         Impact fan-out with per-node action label
  build [fbs-id]      Assemble FBS spec bundles and drive the build queue
  mcp                 Serve the project over MCP (local stdio)
  help [command]      Print help for a command

Options:
  --version           Print the package version and exit
  --help              Print this help and exit

Exit codes:
  0  success
  1  IO / unexpected runtime failure
  2  usage error (bad flags, unknown id)
  3  schema validation or broken references
  4  refused (delete with dependents; other blocked mutations)

Run 'rcf help <command>' for command-specific help.
`;

const INIT_HELP = `Usage: rcf init [options]

Scaffold a new RCF project (creates the rcf/ tree, manifest, and
placeholder root documents). Interactive by default when stdout and
stdin are TTYs and --non-interactive is not set.

Options:
  --project-name <name>     Project name (required for --non-interactive)
  --non-interactive         Skip prompts; use seed values (default when
                            not on a TTY or when piped)
  --quiet                   Suppress non-error stdout
  --help                    Print this help
`;

const VALIDATE_HELP = `Usage: rcf validate [options]

Walk the rcf/ tree and report schema-validation and broken-reference
issues. Exits 0 when clean, 3 on issues.

Options:
  --quiet                   Only summary line + first 3 issues
  --json                    Emit machine-readable envelope
  --help                    Print this help
`;

const CREATE_HELP = `Usage: rcf create <kind> [options]

Kinds: req | us | ac | tac | adr | fbs | ts | tc

Options:
  --parent <id>             Required for every kind (post-3.7 every
                            non-root child carries a mandatory
                            parentId-style field)
  --id <id>                 Override auto-assigned id (refuses on
                            collision)
  --title <string>          Required for req / us / tac / adr / fbs / ts
                            (ac / tc use --description)
  --description <string>    Body description; required for ac / tc
  --acs <id>[,<id>...]      Required for fbs and ts (one or more AC ids)
  --ac <id>                 Required for tc (single AC id per test case)
  --purpose <string>        Required for ts
  --test-level <level>      Required for ts; one of
                            unit / integration / e2e / contract / manual
  --slug <slug>             Optional for tc; derived from description if
                            absent
  --test-pointer <path>     Optional for tc; format filePath::testName
  --build-order <int>       Optional for fbs; default = max+1 within its BS
  --from-file <path>        Read body fields from a JSON file
                            (merged with CLI fields; CLI wins on conflict)
  --dry-run                 Print intended writes without executing
  --quiet                   Suppress non-error stdout
  --help                    Print this help
`;

const READ_HELP = `Usage: rcf read <id> [options]

Options:
  --field <dotPath>         Print only the addressed field
  --raw                     Emit unformatted (single-line) JSON
  --help                    Print this help
`;

const UPDATE_HELP = `Usage: rcf update <id> [options]

Options:
  --set <dotPath>=<value>   Set a field; repeatable
  --from-file <path>        Merge body fields from a JSON file
                            (deep merge; arrays replace)
  --json                    Parse --set values as JSON (default: string)
  --dry-run                 Print intended writes without executing
  --quiet                   Suppress non-error stdout
  --help                    Print this help
`;

const DELETE_HELP = `Usage: rcf delete <id> [options]

Options:
  --cascade                 Also delete dependents and drop backrefs
                            (dependents discovered via computed maps)
  --dry-run                 Print the plan without executing
  --quiet                   Suppress non-error stdout
  --help                    Print this help
`;

const LINK_HELP = `Usage: rcf link <us-id> --tac <tac-id> [options]

Options:
  --tac <tac-id>            TAC id to link (repeatable to link multiple
                            TACs in one invocation)
  --dry-run                 Print the intended write without executing
  --quiet                   Suppress non-error stdout
  --help                    Print this help
`;

const UNLINK_HELP = `Usage: rcf unlink <us-id> --tac <tac-id> [options]

Options:
  --tac <tac-id>            TAC id to unlink (repeatable)
  --dry-run                 Print the intended write without executing
  --quiet                   Suppress non-error stdout
  --help                    Print this help
`;

const COVERAGE_HELP = `Usage: rcf coverage [scope-id] [options]

Report structural coverage over the REQ chain (PRD -> REQ -> US -> AC
-> TS -> TC). Default is shallow-any (any AC covered by any TC = REQ
covered); --strict flips to per-AC-strict (every AC has TC coverage).

This is a mechanical / deterministic structural check. It does NOT
answer 'does the AC set adequately capture the REQ's intent?' - that
non-deterministic question is out of scope for Phase 5.

Positional:
  scope-id                  Optional PRD / REQ / US id to scope
                            coverage to a subtree. Below-AC ids
                            (AC / TS / TC / FBS / TAC / ADR / BS /
                            TAD) are refused with exit 2.

Options:
  --strict                  Per-AC-strict mode; exits 4 on any gap
  --format <format>         table (default) | json | mermaid
  --help                    Print this help
`;

const TRACE_HELP = `Usage: rcf trace <id> [options]

Walk the graph from <id> forward (descendants), backward (ancestors),
or both. Default is --forward.

Options:
  --forward                 Walk descendants (default)
  --back                    Walk ancestors up to the root PRD / TAD / BS
  --both                    Emit ancestors + descendants around <id>
  --format <format>         table (default) | json | mermaid
  --help                    Print this help

Notes:
  --forward, --back and --both are mutually exclusive.
  Cross-links are NOT traversed by --back (fan-out is what 'impact' is for).
`;

const IMPACT_HELP = `Usage: rcf impact <id> [options]

Report the fan-out for 'if <id> changes'. Emits ancestors (up to the
root PRD / TAD / BS) plus descendants (down to test-leaves) with a
per-node action label:
  re-run          test needs to be re-executed
  re-verify       suite ownership; check whether the change invalidates
  re-approve      the AC or PRD approval scope needs re-signing
  review-scope    US / REQ scope needs re-checking
  review-arch     TAD architectural context needs revisiting
  review-plan     BS build queue may need re-ordering
  re-execute      FBS delivery re-runs against updated AC
  review-context  TAC / ADR referenced by an affected FBS

Options:
  --format <format>         table (default) | json | mermaid
  --help                    Print this help
`;

// BUG-011 fix: `rcf help view` previously printed a pointer
// (`See 'rcf view --help' for view options.`). Every other subcommand's
// help block renders inline; wire `view` through to the same block that
// `rcf view --help` prints (imported above), so `rcf help view` is
// consistent with the other 8 subcommands.

const HELP_MAP = {
  init: INIT_HELP,
  validate: VALIDATE_HELP,
  create: CREATE_HELP,
  read: READ_HELP,
  update: UPDATE_HELP,
  delete: DELETE_HELP,
  link: LINK_HELP,
  unlink: UNLINK_HELP,
  coverage: COVERAGE_HELP,
  trace: TRACE_HELP,
  impact: IMPACT_HELP,
  build: BUILD_HELP,
  mcp: MCP_HELP,
  view: VIEW_HELP,
};

/**
 * `rcf help [command]` handler. Positional after `help` names the
 * subcommand; absent → top-level help.
 *
 * @param {string[]} argv - argv slice after `help`
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  if (argv.length === 0) {
    stdout.write(TOP_LEVEL);
    return 0;
  }
  const cmd = argv[0];
  const body = HELP_MAP[cmd];
  if (!body) {
    stderr.write(`[error] usage no help topic named '${cmd}'\n`);
    stdout.write(TOP_LEVEL);
    return 2;
  }
  stdout.write(body);
  return 0;
}

export const TOP_LEVEL_HELP = TOP_LEVEL;
export { HELP_MAP };
