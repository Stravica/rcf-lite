// `rcf-verify mcp` subcommand (spec §10 MCP; mirrors build's cli/mcp.js).
// Wires process stdin/stdout/stderr into the core MCP protocol shell and
// serves the verify tool registry. stdout carries MCP messages and NOTHING
// else; all logging goes to stderr.

import { readFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import { createMcpServer, serveStreams } from '@stravica-ai/rcf-lite-core/mcp-shell';

import { createToolRegistry } from '../mcp/tools.js';

const here = dirname(fileURLToPath(import.meta.url));

export const HELP = `Usage: rcf-verify mcp [options]

Serve verify over the Model Context Protocol (local stdio). Exposes one tool,
rcf_verify_run, over the same in-process engine the CLI uses. stdout carries
protocol messages only; logging goes to stderr.

Options:
  --verbose     Per-request logging on stderr
  --help        Print this help
`;

const INSTRUCTIONS = 'Fresh-context adversarial verifier for RCF chains. rcf_verify_run takes an RCF '
  + 'chain (the acceptance contract) and a running app under a declared runtime profile, launches an '
  + 'isolated verifier agent that tries to DISPROVE the app against its acceptance criteria, and '
  + 'returns a structured verdict stamped with the runtime it ran against. Only a "deployed" profile '
  + '(or a declared --parity-env runtime) yields a SHIP verdict. This is an independent ship-readiness '
  + 'signal, not a correctness guarantee.';

/**
 * @param {string[]} argv - argv slice after `mcp`
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const stdin = deps.stdin ?? process.stdin;
  const onSignal = deps.onSignal ?? ((sig, fn) => process.on(sig, fn));

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { verbose: { type: 'boolean' }, help: { type: 'boolean' } }, allowPositionals: false, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  if (parsed.values.help) {
    stdout.write(HELP);
    return 0;
  }

  const verbose = Boolean(parsed.values.verbose);
  const log = {
    info: verbose ? (line) => stderr.write(`[rcf-verify mcp] ${line}\n`) : () => {},
    error: (line) => stderr.write(`${line}\n`),
  };

  const tools = createToolRegistry(deps);

  const server = createMcpServer({
    serverInfo: { name: 'rcf-verify-lite', version: await readPackageVersion() },
    instructions: INSTRUCTIONS,
    capabilities: { tools: {} },
    handlers: {
      'tools/list': async () => ({ tools: tools.definitions }),
      'tools/call': async (params) => {
        log.info(`tools/call ${params.name}`);
        return await tools.call(params.name, params.arguments);
      },
    },
    log,
  });

  stderr.write('rcf-verify mcp: serving\n');

  const { done, stop } = serveStreams(server, { input: stdin, output: stdout, log });
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
