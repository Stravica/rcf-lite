// Top-level, per-group and per-verb help. British English, ASCII
// hyphens only (Phase 4 §D17). No em-dashes anywhere in user-facing
// strings.
//
// Single-source rule (unchanged): each per-verb block is imported from
// the module that implements the verb, so `rcf help <group> <verb>` and
// `rcf <group> <verb> --help` are the same string by construction. Do
// not reintroduce a local copy of a verb's help - `help-parity.test.js`
// fails the moment the two paths differ.
//
// The 0.10.0 reorg introduces two new surfaces:
//   - GROUP_HELP: printed by `rcf <group>` bare and `rcf help <group>`
//   - TOP_LEVEL_HELP: grouped verb catalogue; the primary cold-reader
//     entry point.

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
import { HELP as REQ_CLASSIFY_HELP } from './req-classify.js';
import { HELP as REQ_BASELINE_HELP } from './req-baseline.js';
import { HELP as INTAKE_HELP } from './intake.js';
import { HELP as BLUEPRINT_HELP } from './blueprint.js';
import { HELP as STANDARDS_HELP } from './standards.js';

// Verify group members (from the verify-suite subtree).
import { HELP as VERIFY_RUN_HELP } from '../verify/cli/run.js';
import { HELP as VERIFY_REPORT_HELP } from '../verify/cli/report.js';
import { HELP as VERIFY_PROVISION_HELP } from '../verify/cli/provision.js';
import { HELP as VERIFY_CLEANUP_HELP } from '../verify/cli/cleanup.js';
import { HELP as VERIFY_MCP_HELP } from '../verify/cli/mcp.js';

// Rendering order (spec §rcf help top-level layout): core first, then
// the five RCF stages in canonical order.
export const GROUP_ORDER = ['discover', 'define', 'build', 'verify', 'audit'];

const TOP_LEVEL = `Usage: rcf <command> [options]

The Requirements Confidence Framework CLI. Verbs are grouped by the
five RCF stages, plus a small core set for platform plumbing.

core         Platform plumbing that predates any RCF stage.
  init                     Scaffold a new RCF project in this directory.
  doctor                   Diagnose and repair init-hygiene drift.
  guidance [topic]         Print a method document from the installed pack.
  mcp                      Serve the project over MCP (local stdio).
  help [group] [verb]      Print help for a group or a verb.

discover     Learn what is already true for this project.
  intake                   Classify supplied artefacts.
  preflight                Elicit third-party service dependencies.
  req-classify <req-id>    Classify one or every REQ by shape.
  req-baseline <verb>      Sweep and record baseline ACs per REQ.
  ui-classify <fbs-id>     Classify one FBS as UI-bearing or not.
  ui-baseline <verb>       Rule and record the project's UI defaults.

define       Author the RCF tree.
  create <kind>            Create a new document.
  read <id>                Print a document's body.
  update <id>              Patch fields on an existing document.
  delete <id>              Delete a document.
  link <us-id>             Link a US to a TAC.
  unlink <us-id>           Unlink a US from a TAC.
  validate                 Walk the tree and report schema and reference
                           issues.
  design <fbs-id> <verb>   Design substage for a UI-bearing FBS.
  blueprint <verb>         Compose blueprints onto the project.
  standards <verb>         Register standards packs against the project.

build        Drive the FBS queue and the five-stage build cycle.
  queue                    Show the FBS build queue.
  bundle <fbs-id>          Spec bundle for one FBS (or --next).
  mark <fbs-id> <status>   Record a lifecycle transition.
  finalise <fbs-id>        Ship gate: run the independent verifier and
                           promote a complete FBS to verified.
  review <fbs-id>          Stage-3-to-Stage-4 audit.
  fbs <fbs-id> <verb>      FBS-level operations.
  test-suite <ts-id> <verb>  Test-suite operations.

verify       Run the independent adversarial ship-gate verifier.
  run                      Run adversarial verification; emit a report.
  report <path>            Re-render a prior report artifact.
  provision                Stand up prerequisite accounts and sandboxes.
  cleanup                  Tear down provisioned artefacts.
  mcp                      Serve verify over MCP (local stdio).
  browser <fbs-id>         Stage 5 browser-verification gate.

audit        Inspect the tree and its rollups.
  view                     Live HTML tree render (long-running server).
  coverage [scope-id]      Structural coverage over the REQ chain.
  trace <id>               Walk the graph forward, back, or both from a node.
  impact <id>              Change-impact fan-out from a node.

Options:
  --version                Print the package version and exit.
  --help                   Print this help and exit.

Exit codes:
  0  success
  1  IO / unexpected runtime failure
  2  usage error (bad flags, unknown id)
  3  schema validation or broken references
  4  refused (delete with dependents; other blocked mutations)

Run 'rcf help <group>' for group help; 'rcf help <group> <verb>' for
per-verb help.
`;

const DISCOVER_HELP = `Usage: rcf discover <verb> [options]

Learn what is already true for this project: classify supplied
artefacts, elicit external dependencies, propose baseline defaults from
prior art, classify existing REQs and FBS items.

Verbs:
  intake                   Classify supplied artefacts.
  preflight                Elicit third-party service dependencies.
  req-classify <req-id>    Classify one or every REQ by shape.
  req-baseline <verb>      Sweep and record baseline ACs per REQ.
  ui-classify <fbs-id>     Classify one FBS as UI-bearing or not.
  ui-baseline <verb>       Rule and record the project's UI defaults.

Run 'rcf help discover <verb>' for per-verb help.
`;

const DEFINE_HELP = `Usage: rcf define <verb> [options]

Author the RCF tree: create, edit, link, and validate RCF documents;
compose blueprints and register standards packs; author the design
substage for UI-bearing work. Everything that writes durable spec
content lives here.

Verbs:
  create <kind>            Create a new document.
  read <id>                Print a document's body.
  update <id>              Patch fields on an existing document.
  delete <id>              Delete a document.
  link <us-id>             Link a US to a TAC.
  unlink <us-id>           Unlink a US from a TAC.
  validate                 Walk the tree and report schema and reference
                           issues.
  design <fbs-id> <verb>   Design substage for a UI-bearing FBS.
  blueprint <verb>         Compose blueprints onto the project.
  standards <verb>         Register standards packs against the project.

Run 'rcf help define <verb>' for per-verb help.
`;

const BUILD_GROUP_HELP = `Usage: rcf build <verb> [options]

Drive the FBS queue and the five-stage build cycle. Every FBS item
walks: Define -> Build -> Review -> Test -> Finalise.

Verbs:
  queue                    Show the FBS build queue with parallel-safe tiers.
  bundle <fbs-id>          Assemble the spec bundle for one FBS (or --next).
  mark <fbs-id> <status>   Record a lifecycle transition (notStarted ->
                           inProgress -> complete). 'verified' is written
                           only by 'build finalise'.
  finalise <fbs-id>        Ship gate: run the independent verifier and
                           promote a complete FBS to verified.
  review <fbs-id>          Stage-3-to-Stage-4 audit (test-theatre and
                           mutation-sampling).
  fbs <fbs-id> <verb>      FBS-level operations (depends-on).
  test-suite <ts-id> <verb>  Test-suite operations (provenance, approve).

Run 'rcf help build <verb>' for per-verb help.
`;

const VERIFY_GROUP_HELP = `Usage: rcf verify <verb> [options]

Run the fresh-context adversarial ship-gate verifier against a running
app, and gate UI-bearing work through browser verification. Independent
ship-readiness signal, not a correctness proof.

Verbs:
  run                      Run adversarial verification; emit a report.
  report <path>            Re-render a prior report artifact.
  provision                Stand up prerequisite accounts and sandboxes.
  cleanup                  Tear down provisioned artefacts (all prefixed
                           'zzverify-').
  mcp                      Serve verify over MCP (local stdio).
  browser <fbs-id>         Stage 5 browser-verification gate for a
                           UI-bearing FBS.

Run 'rcf help verify <verb>' for per-verb help.
`;

const AUDIT_HELP = `Usage: rcf audit <verb> [options]

Inspect the tree and its rollups: live HTML view, structural coverage,
forward and backward trace, change-impact fan-out. Read-only visibility
over what has been defined and built.

Verbs:
  view                     Live HTML tree render (long-running server).
  coverage [scope-id]      Structural coverage over the PRD -> REQ -> US ->
                           AC -> TS -> TC chain.
  trace <id>               Walk the graph forward, back, or both from a node.
  impact <id>              Change-impact fan-out from a node.

Run 'rcf help audit <verb>' for per-verb help.
`;

export const GROUP_HELP = {
  discover: DISCOVER_HELP,
  define: DEFINE_HELP,
  build: BUILD_GROUP_HELP,
  verify: VERIFY_GROUP_HELP,
  audit: AUDIT_HELP,
};

// Per-verb HELP_MAP is a two-level structure keyed by [group][verb].
// Every value is an import from the module that implements the verb.
// See the single-source rule at the top of this file before adding an
// entry.
export const HELP_MAP = {
  discover: {
    intake: INTAKE_HELP,
    preflight: PREFLIGHT_HELP,
    'req-classify': REQ_CLASSIFY_HELP,
    'req-baseline': REQ_BASELINE_HELP,
    'ui-classify': UI_CLASSIFY_HELP,
    'ui-baseline': UI_BASELINE_HELP,
  },
  define: {
    create: CREATE_HELP,
    read: READ_HELP,
    update: UPDATE_HELP,
    delete: DELETE_HELP,
    link: LINK_HELP,
    unlink: UNLINK_HELP,
    validate: VALIDATE_HELP,
    design: DESIGN_HELP,
    blueprint: BLUEPRINT_HELP,
    standards: STANDARDS_HELP,
  },
  build: {
    queue: BUILD_HELP,
    bundle: BUILD_HELP,
    mark: BUILD_HELP,
    finalise: FINALISE_HELP,
    review: REVIEW_HELP,
    fbs: FBS_HELP,
    'test-suite': TEST_SUITE_HELP,
  },
  verify: {
    run: VERIFY_RUN_HELP,
    report: VERIFY_REPORT_HELP,
    provision: VERIFY_PROVISION_HELP,
    cleanup: VERIFY_CLEANUP_HELP,
    mcp: VERIFY_MCP_HELP,
    browser: BROWSER_VERIFY_HELP,
  },
  audit: {
    view: VIEW_HELP,
    coverage: COVERAGE_HELP,
    trace: TRACE_HELP,
    impact: IMPACT_HELP,
  },
};

// Core-verb HELP blocks live outside the group tree.
export const CORE_HELP = {
  init: INIT_HELP,
  doctor: DOCTOR_HELP,
  guidance: GUIDANCE_HELP,
  mcp: MCP_HELP,
};

/**
 * `rcf help [group] [verb]` handler.
 *
 * Positional layout:
 *   - no positionals            -> top-level help
 *   - <core-verb>               -> per-verb help for a core verb
 *   - <group>                   -> group help
 *   - <group> <verb>            -> per-verb help for a grouped verb
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
  const first = argv[0];
  if (first in CORE_HELP) {
    stdout.write(CORE_HELP[first]);
    return 0;
  }
  if (first in GROUP_HELP) {
    const verb = argv[1];
    if (!verb) {
      stdout.write(GROUP_HELP[first]);
      return 0;
    }
    const body = HELP_MAP[first][verb];
    if (!body) {
      stderr.write(`[error] usage no help topic '${first} ${verb}'\n`);
      stdout.write(GROUP_HELP[first]);
      return 2;
    }
    stdout.write(body);
    return 0;
  }
  stderr.write(`[error] usage no help topic named '${first}'\n`);
  stdout.write(TOP_LEVEL);
  return 2;
}

export const TOP_LEVEL_HELP = TOP_LEVEL;
