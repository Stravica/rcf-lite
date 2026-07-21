// Top-level and per-subcommand help (mirrors build's cli/help.js). British
// English, ASCII hyphens only.

import { HELP as RUN_HELP } from './run.js';
import { HELP as REPORT_HELP } from './report.js';
import { HELP as PROVISION_HELP } from './provision.js';
import { HELP as CLEANUP_HELP } from './cleanup.js';
import { HELP as MCP_HELP } from './mcp.js';

export const TOP_LEVEL_HELP = `Usage: rcf-verify <command> [options]

A fresh-context adversarial verifier. Given an RCF chain (the acceptance
contract) and a running app under a declared runtime profile, it launches an
isolated verifier agent that walks real user journeys adversarially and emits a
structured verdict stamped with the runtime it ran against.

This is an independent ship-readiness signal, not a correctness guarantee.

Commands:
  run            Run adversarial verification and emit a report artifact
  report <path>  Re-render a prior report artifact
  provision      Stand up prerequisite accounts/sandboxes/data standalone
  cleanup        Tear down provisioned artefacts (all prefixed 'zzverify-')
  mcp            Serve verify over MCP (local stdio)
  help [command] Print help for a command

Options:
  --version      Print the package version and exit
  --help         Print this help and exit

Run 'rcf-verify help <command>' for command-specific help.
`;

const SUB_HELP = {
  run: RUN_HELP,
  report: REPORT_HELP,
  provision: PROVISION_HELP,
  cleanup: CLEANUP_HELP,
  mcp: MCP_HELP,
};

/**
 * @param {string[]} argv
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const topic = argv[0];
  if (topic && SUB_HELP[topic]) {
    stdout.write(SUB_HELP[topic]);
    return 0;
  }
  stdout.write(TOP_LEVEL_HELP);
  return 0;
}
