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

import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { initProject } from '#core/store/init.js';
import {
  loadManagedBlock,
  manualSetupInstructions,
  writeAgentInstructions,
  writeMcpConfig,
} from '../setup/agent-setup.js';
import {
  findProjectPlaywrightKey,
  probeClaudeCodeMcp,
} from '../setup/playwright-checks.js';
import { PLAYWRIGHT_MCP_VERSION } from '../verify/engine/launcher.js';
import { writeKnowledgeSeed } from '../setup/knowledge-seed.js';
import { writeIdentityTemplate } from '../setup/identity-seed.js';
import {
  composeGitignoreBlock,
  computeGitignoreBlockHash,
  extractGitignoreBlock,
  GITIGNORE_MARKER_BEGIN,
  GITIGNORE_MARKER_END,
} from '../setup/managed-gitignore.js';
import { hashInnerContent } from '../setup/managed-block.js';

const OPTION_SPEC = {
  'project-name': { type: 'string' },
  'non-interactive': { type: 'boolean' },
  'no-agent-setup': { type: 'boolean' },
  'no-playwright-mcp': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf init [options]

Scaffolds the rcf/ tree, registers the MCP server in the project-root
.mcp.json and writes the agent-instructions fragment into both CLAUDE.md
and AGENTS.md (an existing instructions file is refreshed in place) -
the full pre-session bootstrap. Interactive runs prompt only for the
project name; everything else is seeded as placeholders for the agent
to elicit. Re-running on an existing project leaves the tree alone and
refreshes the wiring.

Options:
  --project-name <name>     Project name. In non-interactive mode this
                            defaults to the working directory's basename
                            (pass explicitly to override); an unusable
                            basename (empty, '.', or '/') still requires
                            the flag.
  --non-interactive         Skip prompts; use seed values (default when
                            not on a TTY or when piped)
  --no-agent-setup          Scaffold the tree only; print the manual
                            harness-wiring instructions instead
  --no-playwright-mcp       Skip the Playwright MCP entry step. The probe
                            still runs so the print-out remains honest, but
                            init writes no Playwright entry and touches no
                            existing one. Use when a user-scope Playwright
                            entry is declared in a harness init cannot probe.
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
    // Non-interactive: --project-name defaults to the working
    // directory's basename. An unusable basename (empty, '.', or '/')
    // still requires the flag - no silent fallback to a generic name.
    if (!projectName) {
      const candidate = basename(cwd).trim();
      if (candidate && candidate !== '.' && candidate !== '/') {
        projectName = candidate;
      } else {
        stderr.write(
          `[error] usage --project-name is required in non-interactive mode `
          + `(cwd basename '${candidate}' is unusable as a default)\n`,
        );
        stderr.write(HELP);
        return 2;
      }
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

  // Step 1a: Playwright MCP entry (spec 2026-09-03, section 4). Writes a
  // distinctly named 'playwright-rcf' entry ONLY when init can prove no
  // Playwright entry exists at any scope the harness can report. Detection
  // is by command tail (spec 4.1). Cross-scope probe of the Claude Code
  // harness via `claude mcp list` (spec 4.2). Where the harness cannot be
  // probed non-interactively, init falls back to the distinctly-named entry
  // with a notice (spec 4.3). --no-playwright-mcp suppresses the write
  // entirely; the probe still runs so the print-out remains honest.
  const playwrightPass = await runPlaywrightMcpPass({
    projectRoot: cwd,
    stdout,
    quiet: Boolean(flags.quiet),
    optOut: Boolean(flags['no-playwright-mcp']),
    probeClaudeCodeMcp: deps.probeClaudeCodeMcp ?? probeClaudeCodeMcp,
  });
  if (playwrightPass && 'kind' in playwrightPass && 'message' in playwrightPass) {
    stderr.write(`[error] ${playwrightPass.kind} ${playwrightPass.message}\n`);
    return 2;
  }

  // Step 2: agent-instructions managed block inside rcf markers (idempotent).
  // Source is the 0.6.0 canonical asset, not the harness-template fenced
  // fragment (which is now regenerated from the same canonical text at
  // package build time via scripts/gen-managed-artefacts.mjs).
  const fragment = await loadManagedBlock();
  if (typeof fragment !== 'string') {
    stderr.write(`[error] ${fragment.kind} ${fragment.message}\n`);
    return 1;
  }
  const instrResult = await writeAgentInstructions({ projectRoot: cwd, fragment });

  // Step 3: knowledge space (§3, AC-2.1..AC-2.3). Idempotent per file.
  const knowledgeResult = await writeKnowledgeSeed({ projectRoot: cwd });
  // Step 4: identity template (§5, AC-4.1..AC-4.2). Idempotent.
  const identityResult = await writeIdentityTemplate({ projectRoot: cwd });
  // Step 5: managed .gitignore block (§4, AC-3.1..AC-3.2). Written or
  // refreshed in place; operator content outside preserved byte-for-byte.
  const gitignoreResult = await ensureManagedGitignore({ projectRoot: cwd });

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
    stdout.write(`  Knowledge space    ${knowledgeVerbAndTarget(knowledgeResult)}.\n`);
    stdout.write(`  Operator profile   ${identityVerbAndTarget(identityResult)}.\n`);
    stdout.write(`  Gitignore          ${gitignoreVerbAndTarget(gitignoreResult)}.\n`);
    stdout.write('\nNext: start your agent session in this directory and tell it what you want to build. '
      + 'It elicits the requirements and drives the build from there - you do not fill in the document chain by hand.\n');
    stdout.write('\nRun `rcf doctor` to confirm the wiring stays clean over time '
      + '(it also checks whether managed blocks have drifted from the shipped canon).\n');
  }
  return 0;
}

function knowledgeVerbAndTarget(result) {
  const created = result.writes.filter((w) => w.action === 'created').length;
  if (created === 0) return 'left as-is at rcf/knowledge/ (all managed files already present)';
  if (created === result.writes.length) return 'seeded at rcf/knowledge/ (write what you learn; grep before asking)';
  return `refreshed at rcf/knowledge/ (${created} new managed files)`;
}

function identityVerbAndTarget(result) {
  if (result.action === 'kept') return 'left as-is at rcf/.identity/profile.md (already present)';
  return 'template at rcf/.identity/profile.md (gitignored by default; fill in what is useful)';
}

function gitignoreVerbAndTarget(result) {
  if (result.action === 'noop') return 'managed block already up to date in .gitignore';
  if (result.action === 'created') return 'managed block written to .gitignore (rcf/.identity/ ignored)';
  if (result.action === 'appended') return 'managed block appended to existing .gitignore (rcf/.identity/ ignored)';
  return 'managed block refreshed in .gitignore (rcf/.identity/ ignored)';
}

/**
 * Ensure the project-root `.gitignore` carries the current managed
 * block. Writes/refreshes in place; operator entries outside markers
 * preserved byte-for-byte. Idempotent when block is already current.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @returns {Promise<{ action: 'created' | 'appended' | 'replaced' | 'noop' }>}
 */
async function ensureManagedGitignore({ projectRoot }) {
  const path = join(projectRoot, '.gitignore');
  let existing;
  try {
    existing = await readFile(path, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
    await writeFile(path, composeGitignoreBlock(), 'utf8');
    return { action: 'created' };
  }
  const located = extractGitignoreBlock(existing);
  const composed = composeGitignoreBlock();
  if (!located) {
    // No managed block yet - append with a blank-line separator.
    const beginCount = countLocal(existing, GITIGNORE_MARKER_BEGIN);
    const endCount = countLocal(existing, GITIGNORE_MARKER_END);
    if (beginCount !== 0 || endCount !== 0) {
      // Structurally malformed - leave alone; doctor will surface the
      // drift and the operator repairs by hand.
      return { action: 'noop' };
    }
    const sep = existing.length === 0 ? '' : (existing.endsWith('\n') ? '\n' : '\n\n');
    await writeFile(path, `${existing}${sep}${composed}`, 'utf8');
    return { action: 'appended' };
  }
  const innerHash = hashInnerContent(located.innerText);
  const expected = computeGitignoreBlockHash();
  if (innerHash === expected) return { action: 'noop' };
  const next = existing.slice(0, located.beginIndex) + composed + existing.slice(located.endIndex);
  await writeFile(path, next, 'utf8');
  return { action: 'replaced' };
}

function countLocal(haystack, needle) {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while (true) {
    const at = haystack.indexOf(needle, i);
    if (at < 0) return n;
    n += 1;
    i = at + needle.length;
  }
}

/**
 * Init's Playwright MCP pass (spec 2026-09-03, section 4). Decision tree:
 *
 *   1. If --no-playwright-mcp: probe still runs so the print-out is honest,
 *      but no .mcp.json entry is written or touched.
 *   2. If the project-scope .mcp.json carries a Playwright signature under
 *      any key (spec 4.1): print the 'left alone' line and return.
 *   3. Probe the Claude Code harness (spec 4.2):
 *      - 'found': print the 'already registered at <scope> scope' line and
 *        return (no shadowing).
 *      - 'none': write the distinctly-named 'playwright-rcf' entry.
 *      - 'inconclusive' (claude absent, non-zero, or unparseable): write the
 *        distinctly-named 'playwright-rcf' entry with the 'could not probe'
 *        notice.
 *
 * A distinct project-scope entry keeps init's "never write outside the
 * project root" discipline; a coexisting user-scope entry the operator has
 * that init could not see is not shadowed by naming convention.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {NodeJS.WritableStream} args.stdout
 * @param {boolean} args.quiet
 * @param {boolean} args.optOut
 * @param {import('../setup/playwright-checks.js').probeClaudeCodeMcp} args.probeClaudeCodeMcp
 * @returns {Promise<{ action: 'left-alone-project'|'left-alone-harness'|'written'|'skipped-opt-out', name?: string, scope?: string } | import('../core/errors/index.js').RcfError>}
 */
async function runPlaywrightMcpPass({ projectRoot, stdout, quiet, optOut, probeClaudeCodeMcp: probeImpl }) {
  const mcpPath = join(projectRoot, '.mcp.json');
  let mcpJson = null;
  try {
    const raw = await readFile(mcpPath, 'utf8');
    try {
      mcpJson = JSON.parse(raw);
    } catch {
      // writeMcpConfig already refused unparseable with a distinct error and
      // returned before us; if we somehow reach here with a corrupt file,
      // stay out and let doctor surface it. Return silently.
      return { action: 'skipped-opt-out' };
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // .mcp.json does not exist yet (rcf mcp write above would have created
    // it; if that step ran we should not hit ENOENT). Treat as no project
    // entry and continue to the probe.
  }

  const projectKey = mcpJson ? findProjectPlaywrightKey(mcpJson) : null;
  if (projectKey) {
    if (!quiet) {
      stdout.write(
        `Playwright MCP: already registered in .mcp.json under key '${projectKey}' at project scope, left alone.\n`,
      );
    }
    return { action: 'left-alone-project', name: projectKey };
  }

  // Probe the harness even when --no-playwright-mcp so the print-out remains
  // honest about what init can see.
  const probeResult = await probeImpl();
  if (probeResult.kind === 'found') {
    if (!quiet) {
      stdout.write(
        `Playwright MCP: already registered under key '${probeResult.name}' at ${probeResult.scope} scope in Claude Code, left alone.\n`,
      );
    }
    return { action: 'left-alone-harness', name: probeResult.name, scope: probeResult.scope };
  }

  if (optOut) {
    if (!quiet) {
      stdout.write('Playwright MCP: --no-playwright-mcp set; no entry written.\n');
    }
    return { action: 'skipped-opt-out' };
  }

  // Compose the distinctly-named entry. Distinct from 'playwright' (the
  // common name a user-scope entry uses) and from any name Claude Code
  // writes by default. If init could not see a user-scope entry that
  // actually exists, both coexist and no shadowing has occurred; verify
  // provisions its OWN MCP config anyway.
  const distinctEntry = {
    type: 'stdio',
    command: 'npx',
    args: ['-y', `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`],
    env: {},
  };
  const nextBody = mcpJson ?? {};
  const servers = (nextBody.mcpServers && typeof nextBody.mcpServers === 'object' && !Array.isArray(nextBody.mcpServers))
    ? nextBody.mcpServers
    : {};
  const nextConfig = {
    ...nextBody,
    mcpServers: {
      ...servers,
      'playwright-rcf': distinctEntry,
    },
  };
  await writeFile(mcpPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');

  if (!quiet) {
    if (probeResult.kind === 'inconclusive') {
      stdout.write(
        `Playwright MCP: could not probe user-scope entries (${probeResult.reason}). Wrote 'playwright-rcf' at project scope; remove with \`rcf init --no-playwright-mcp\` or delete the entry by hand.\n`,
      );
    } else {
      stdout.write(
        "Playwright MCP: wrote 'playwright-rcf' at project scope (no ambient Playwright entry found at any scope this init could probe). Remove with `rcf init --no-playwright-mcp` or delete the entry by hand.\n",
      );
    }
  }
  return { action: 'written' };
}

