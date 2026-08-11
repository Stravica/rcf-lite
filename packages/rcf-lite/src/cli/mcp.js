// `rcf mcp` subcommand handler (Phase 7 §D1 / §D13). Resolves the
// project root ONCE at startup, wires process stdin / stdout / stderr
// into the MCP server core, and serves until stdin EOF or a signal.
//
// Stream discipline (D2): stdout carries MCP messages and NOTHING
// else. All logging goes to stderr; default stderr output is one
// startup line plus unexpected-failure blocks, with per-request lines
// behind --verbose. No root found: one stderr line and exit 2 BEFORE
// any stdout traffic - a misconfigured client sees a dead subprocess
// and a clear stderr message.

import { readFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import { findProjectRoot } from '../view/index.js';
import { createMcpServer, serveStreams } from '@stravica-ai/rcf-lite-core/mcp-shell';
import { createToolRegistry } from '../mcp/tools.js';
import { createResourceRegistry } from '../mcp/resources.js';
import { createPromptRegistry } from '../mcp/prompts.js';

const here = dirname(fileURLToPath(import.meta.url));

const OPTION_SPEC = {
  'project-root': { type: 'string' },
  verbose: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf mcp [options]

Serve the project over the Model Context Protocol (local stdio). An
MCP-capable agent harness launches 'rcf mcp' as a subprocess in a
project directory; stdout carries protocol messages only, logging
goes to stderr.

Serves eleven tools (rcf_validate, rcf_coverage, rcf_trace,
rcf_impact, rcf_read, rcf_create, rcf_update, rcf_delete, rcf_link,
rcf_unlink, rcf_build), resources (rcf://tree, rcf://doc/<id>,
rcf://docs/<slug>) and the agent-guidance prompts.

The project root is resolved once at startup and fixed for the
process lifetime; multi-project harnesses run multiple server
entries. The server exits when the client closes stdin.

Options:
  --project-root <path>     Resolve the project root from <path>
                            instead of the working directory
  --verbose                 Per-request logging on stderr
  --help                    Print this help
`;

const INSTRUCTIONS = 'Filesystem-backed RCF (Requirements Confidence Framework) project. '
  + 'Start with rcf_validate to check tree health, and the rcf://tree resource to orient. '
  + 'Coverage is structural, not semantic: rcf_coverage reports whether chains reach test '
  + 'cases, not whether acceptance criteria adequately capture intent. Write tools edit '
  + 'the git-tracked rcf/ tree directly.';

/**
 * @param {string[]} argv - argv slice after `mcp`
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const stdin = deps.stdin ?? process.stdin;
  const cwd = deps.cwd ?? process.cwd();
  const onSignal = deps.onSignal ?? ((sig, fn) => process.on(sig, fn));

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
  if (parsed.positionals.length > 0) {
    stderr.write('[error] usage mcp: takes no positional arguments\n');
    stderr.write(HELP);
    return 2;
  }

  // D13: resolve the root once, before any protocol traffic.
  const start = flags['project-root'] ? resolvePath(cwd, flags['project-root']) : cwd;
  const projectRoot = await findProjectRoot(start);
  if (!projectRoot) {
    // B3 (E2E matrix 2026-07-06-003): an MCP client surfaces this failure
    // as "zero tools" with no visible error, so the stderr line must tell
    // the operator exactly what to do next. Theme 1 funnel: incomplete
    // setup always routes to `npx rcf init` + a session restart.
    stderr.write(`[error] usage no project root found (no rcf/manifest.json in ${start} or any ancestor). `
      + 'The MCP server needs an existing rcf/ tree - run `npx rcf init` in the project first '
      + '(it wires the tree, .mcp.json and the agent instructions), then restart your agent '
      + 'session; or pass --project-root <path>. See docs/install.md, section 7.\n');
    return 2;
  }

  const verbose = Boolean(flags.verbose);
  const log = {
    info: verbose ? (line) => stderr.write(`[rcf mcp] ${line}\n`) : () => {},
    error: (line) => stderr.write(`${line}\n`),
  };

  const tools = createToolRegistry({ projectRoot, log });
  const resources = createResourceRegistry({ projectRoot });
  const prompts = createPromptRegistry();

  const server = createMcpServer({
    serverInfo: { name: 'rcf-build-lite', version: await readPackageVersion() },
    instructions: INSTRUCTIONS,
    capabilities: { tools: {}, resources: {}, prompts: {} },
    handlers: {
      'tools/list': async () => ({ tools: tools.definitions }),
      'tools/call': async (params) => {
        log.info(`tools/call ${params.name}`);
        return await tools.call(params.name, params.arguments);
      },
      'resources/list': async () => await resources.list(),
      'resources/read': async (params) => {
        log.info(`resources/read ${params.uri}`);
        return await resources.read(params.uri);
      },
      'prompts/list': async () => await prompts.list(),
      'prompts/get': async (params) => {
        log.info(`prompts/get ${params?.name}`);
        return await prompts.get(params);
      },
    },
    log,
  });

  stderr.write(`rcf mcp: serving ${projectRoot}\n`);

  const { done, stop } = serveStreams(server, { input: stdin, output: stdout, log });

  // D18: SIGINT / SIGTERM exit cleanly - nothing to drain, no ports,
  // no watchers. EOF on stdin is the spec's termination path.
  onSignal('SIGINT', () => { log.info('received SIGINT, shutting down'); stop(); });
  onSignal('SIGTERM', () => { log.info('received SIGTERM, shutting down'); stop(); });

  return await done;
}

async function readPackageVersion() {
  try {
    const pkgPath = resolvePath(here, '..', '..', 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
