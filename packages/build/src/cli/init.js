// `rcf init` subcommand handler. Interactive by default when stdin +
// stdout are TTYs and --non-interactive is not set. Init is a bootstrap,
// not an elicitation session: it asks only for the project name and
// seeds a fully placeholder document tree - the same tree the
// non-interactive path produces - which the agent fills in during
// elicitation. It deliberately does NOT ask the user to name a first
// requirement / user story / problem statement up front (operator review
// 2026-07-16, comment 2: a product owner does not know those yet, and
// asking makes them freeze or type junk). Zero deps; prompt via
// node:readline/promises.
//
// Theme 1 (E2E matrix 2026-07-06-003): init is the full pre-session
// bootstrap. After scaffolding the tree it also (1) writes/merges the
// project-root .mcp.json rcf server entry and (2) writes the guidance
// fragment into CLAUDE.md / AGENTS.md inside rcf marker comments -
// the project is wired BEFORE the agent session starts. Re-running
// init on an existing tree leaves the tree alone and refreshes the
// wiring (idempotent). --no-agent-setup skips the wiring and prints
// the manual instructions instead.

import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';

import { initProject } from '../store/init.js';
import {
  loadHarnessFragment,
  manualSetupInstructions,
  writeAgentInstructions,
  writeMcpConfig,
} from '../setup/agent-setup.js';

const OPTION_SPEC = {
  'project-name': { type: 'string' },
  'non-interactive': { type: 'boolean' },
  'no-agent-setup': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

const HELP = `Usage: rcf init [options]

Scaffolds the rcf/ tree, registers the MCP server in the project-root
.mcp.json and writes the agent-instructions fragment into both CLAUDE.md
and AGENTS.md (an existing instructions file is refreshed in place) -
the full pre-session bootstrap. Interactive runs prompt only for the
project name; everything else is seeded as placeholders for the agent
to elicit. Re-running on an existing project leaves the tree alone and
refreshes the wiring.

Options:
  --project-name <name>     Project name (required for --non-interactive)
  --non-interactive         Skip prompts; use seed values (default when
                            not on a TTY or when piped)
  --no-agent-setup          Scaffold the tree only; print the manual
                            harness-wiring instructions instead
  --quiet                   Suppress non-error stdout
  --help                    Print this help
`;

/**
 * @param {string[]} argv - argv slice after `init`
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const stdin = deps.stdin ?? process.stdin;

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: true, strict: true });
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
  const cwd = deps.cwd ?? process.cwd();
  const agentSetup = !flags['no-agent-setup'];
  const forceNonInteractive = Boolean(flags['non-interactive']);
  const isTty = Boolean(stdout.isTTY && stdin.isTTY);
  const interactive = !forceNonInteractive && isTty;

  let projectName = flags['project-name'];
  let seed = null;

  if (interactive) {
    // Init asks only for the project name. Everything else in the tree
    // is seeded as a placeholder for the agent to elicit - see the file
    // header. `seed` stays null so interactive and non-interactive
    // produce the identical placeholder tree.
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      projectName = projectName ?? (await rl.question('Project name: ')).trim();
      if (!projectName) projectName = 'New RCF Project';
    } finally {
      rl.close();
    }
  } else {
    if (!projectName) {
      stderr.write('[error] usage --project-name is required in non-interactive mode\n');
      stderr.write(HELP);
      return 2;
    }
  }

  const result = await initProject({ projectRoot: cwd, projectName, seed });
  const treeExists = Boolean(result && 'kind' in result && result.kind === 'usage'
    && /already exists/.test(result.message));
  if (result && 'kind' in result && result.kind === 'usage' && !treeExists) {
    stderr.write(`[error] usage ${result.message}\n`);
    return 2;
  }
  if (result && 'kind' in result && !treeExists) {
    stderr.write(`[error] ${result.kind} ${result.message}\n`);
    return 1;
  }
  if (treeExists && !agentSetup) {
    // Nothing to do at all: tree present, wiring explicitly skipped.
    stderr.write(`[error] usage ${result.message}\n`);
    return 2;
  }

  // --no-agent-setup: scaffold the tree only, print the manual wiring
  // steps. (A tree-already-present + opt-out combination has already
  // been refused above, so this branch is always a fresh scaffold.)
  if (!agentSetup) {
    if (!flags.quiet) {
      stdout.write('Set up the RCF document chain under rcf/.\n');
      stdout.write(`${manualSetupInstructions()}\n`);
    }
    return 0;
  }

  // Step 1: .mcp.json (merge; never clobber other servers / unknown keys).
  const mcpResult = await writeMcpConfig({ projectRoot: cwd });
  if (mcpResult && 'kind' in mcpResult && 'message' in mcpResult) {
    stderr.write(`[error] ${mcpResult.kind} ${mcpResult.message}\n`);
    return 2;
  }

  // Step 2: agent-instructions fragment inside rcf markers (idempotent).
  const fragment = await loadHarnessFragment();
  if (typeof fragment !== 'string') {
    stderr.write(`[error] ${fragment.kind} ${fragment.message}\n`);
    return 1;
  }
  const instrResult = await writeAgentInstructions({ projectRoot: cwd, fragment });

  // High-level completion summary: what was set up and what to do next -
  // not a developer file list (operator review 2026-07-16, comment 3a).
  if (!flags.quiet) {
    let mcpDesc;
    if (mcpResult.action === 'kept') mcpDesc = 'already registered in .mcp.json (kept)';
    else if (mcpResult.action === 'merged') mcpDesc = 'registered in .mcp.json (merged with your existing servers)';
    else mcpDesc = 'registered in .mcp.json';

    const instrFiles = instrResult.writes.map((w) => w.file).join(' and ');
    const actions = new Set(instrResult.writes.map((w) => w.action));
    let instrVerb;
    if (actions.size === 1 && actions.has('created')) instrVerb = 'written to';
    else if (actions.has('replaced')) instrVerb = 'refreshed in';
    else instrVerb = 'updated in';

    if (treeExists) {
      stdout.write('RCF project already set up here - document chain left untouched, agent wiring refreshed.\n');
    } else {
      stdout.write('RCF project created.\n');
      stdout.write('  Document chain     scaffolded under rcf/ - PRD, requirement, story, acceptance criterion, architecture and build-sequence placeholders for your agent to fill in.\n');
    }
    stdout.write(`  MCP server         ${mcpDesc}.\n`);
    stdout.write(`  Agent instructions ${instrVerb} ${instrFiles}.\n`);
    stdout.write('\nNext: start your agent session in this directory and tell it what you want to build. '
      + 'It elicits the requirements and drives the build from there - you do not fill in the document chain by hand.\n');
  }
  return 0;
}
