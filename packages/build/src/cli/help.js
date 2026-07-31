// Top-level and per-subcommand help. British English, ASCII hyphens
// only (Phase 4 §D17).
//
// Single-source rule: this module owns the TOP_LEVEL block and NOTHING
// else. Every per-subcommand block is imported from the module that
// implements the subcommand, so `rcf help <cmd>` and `rcf <cmd> --help`
// are the same string by construction. Do not reintroduce a local copy
// of a subcommand's help - `test/cli/help-parity.test.js` fails the
// moment the two paths differ. (This file previously kept private
// duplicates of nine blocks; every one of them had drifted stale, and
// `rcf help create` was hiding the `cn` kind outright.)

import { HELP as BUILD_HELP } from './build.js';
import { HELP as COVERAGE_HELP } from './coverage.js';
import { HELP as CREATE_HELP } from './create.js';
import { HELP as DELETE_HELP } from './delete.js';
import { HELP as DOCTOR_HELP } from './doctor.js';
import { HELP as FINALISE_HELP } from './finalise.js';
import { HELP as GUIDANCE_HELP } from './guidance.js';
import { HELP as IMPACT_HELP } from './impact.js';
import { HELP as INIT_HELP } from './init.js';
import { HELP as LINK_HELP, UNLINK_HELP } from './link.js';
import { HELP as MCP_HELP } from './mcp.js';
import { HELP as PREFLIGHT_HELP } from './preflight.js';
import { HELP as READ_HELP } from './read.js';
import { HELP as REVIEW_HELP } from './review.js';
import { HELP as FBS_HELP } from './fbs.js';
import { HELP as TEST_SUITE_HELP } from './test-suite.js';
import { HELP as TRACE_HELP } from './trace.js';
import { HELP as UI_CLASSIFY_HELP } from './ui-classify.js';
import { HELP as UI_BASELINE_HELP } from './ui-baseline.js';
import { HELP as DESIGN_HELP } from './design.js';
import { HELP as BROWSER_VERIFY_HELP } from './browser-verify.js';
import { HELP as UPDATE_HELP } from './update.js';
import { HELP as VALIDATE_HELP } from './validate.js';
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
  finalise <fbs-id>   Ship gate: verify the deployed app, then mark verified
  doctor              Diagnose init-hygiene drift (0.6.0 spec); --fix repairs
  guidance [topic]    Print a method document from the installed pack
  mcp                 Serve the project over MCP (local stdio)
  preflight           Elicit pre-flight service-attestation + design-shape record
  fbs <fbs-id>        FBS-level verbs (depends-on)
  test-suite <ts-id>  Test-suite verbs (provenance, approve)
  review <fbs-id>     REVIEW-stage audit (test-theatre + mutation-sampling)
  ui-classify <id>    Run the UI-bearing classifier on one FBS
  ui-baseline <verb>  UI baseline: init | show | opt-out
  design <fbs-id>     Design substage: dispatch worker or hand-author artefacts
  browser-verify <id> Stage 5 browser-verification gate for a UI-bearing FBS
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

// Every value here is an import. See the single-source rule at the top
// of this file before adding an entry.
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
  finalise: FINALISE_HELP,
  doctor: DOCTOR_HELP,
  guidance: GUIDANCE_HELP,
  mcp: MCP_HELP,
  view: VIEW_HELP,
  preflight: PREFLIGHT_HELP,
  review: REVIEW_HELP,
  fbs: FBS_HELP,
  'test-suite': TEST_SUITE_HELP,
  'ui-classify': UI_CLASSIFY_HELP,
  'ui-baseline': UI_BASELINE_HELP,
  design: DESIGN_HELP,
  'browser-verify': BROWSER_VERIFY_HELP,
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
