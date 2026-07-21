// `rcf view` subcommand handler. Wraps the Phase 3.8 HTTP + SSE server
// (`src/server/index.js`) behind the unified bin surface. Phase 4 §D23
// deletes the standalone `bin/rcf-view.js`; every call site becomes
// `pnpm run rcf view` / `rcf view`, and the pure helpers formerly
// exported from that bin now live here so the CLI tests can still
// exercise them without spawning a subprocess.

import { spawn } from 'node:child_process';
import { platform } from 'node:process';

import { formatErrors } from '../errors/index.js';
import { walkTree } from '../store/index.js';
import { findProjectRoot } from '../view/index.js';
import { startServer } from '../server/index.js';

export const DEFAULT_PORT = 4373;
export const SHUTDOWN_BUDGET_MS = 2000;

export const HELP = `Usage: rcf view [options]

Serve the on-disk RCF tree as a live HTML review surface. Runs a
long-running HTTP + SSE server on 127.0.0.1 that watches rcf/ and pushes
tree updates to the connected browser tab. No on-disk output; no static
files are written.

Options:
  --port <n>        Bind the HTTP server on the given port.
                    Precedence: --port beats RCF_VIEW_PORT env
                    beats the ${DEFAULT_PORT} default.
                    EADDRINUSE is a hard failure (exit 2).
  --strict          Startup gate: on boot, walk the tree once; if it
                    has structural errors (broken references, schema
                    failures) print them and exit 3 without opening
                    the HTTP listener. Without --strict, the server
                    starts regardless and streams walker errors to the
                    client via walker-error SSE events.
  --no-open         Do not open the rendered page in a browser
                    (auto-open runs by default when stdout is a TTY
                    and CI is unset).
  --verbose         Log each watch event and each SSE broadcast to
                    stderr.
  --help            Print this help and exit.

Security posture:
  The view server binds 127.0.0.1 only - localhost trust. No CORS,
  no auth, no rate limit. Do not expose it via SSH tunnel or reverse
  proxy without adding an auth layer first.

Shutdown:
  Ctrl-C (SIGINT) or SIGTERM triggers a clean shutdown: watcher
  closed, SSE connections drained with a shutdown event, port
  released, 2s force-exit budget.

Exit codes:
  0   normal shutdown
  1   render or runtime failure
  2   usage error (unknown flag, EADDRINUSE, no project root)
  3   validation failure (with --strict, on the initial walk)
  130 SIGINT
`;

/**
 * Parse the view subcommand argv. Hand-rolled so the CLI can pass
 * through argv slices without re-tokenising via parseArgs. Kept in the
 * same shape as the Phase 3.8 rcf-view bin for test compatibility.
 *
 * @param {string[]} argv
 * @returns {{ opts: object, errors: string[] }}
 */
export function parseArgs(argv) {
  const opts = {
    strict: false,
    verbose: false,
    help: false,
    noOpen: false,
    port: null,
  };
  const errors = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--strict':
        opts.strict = true;
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '--no-open':
        opts.noOpen = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--port': {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          errors.push('--port requires a numeric argument');
          break;
        }
        const n = Number(next);
        if (!Number.isInteger(n) || n < 0 || n > 65535) {
          errors.push(`--port expects an integer in [0, 65535], got ${next}`);
        } else {
          opts.port = n;
        }
        i += 1;
        break;
      }
      default:
        errors.push(`unknown option: ${arg}`);
    }
  }
  return { opts, errors };
}

/**
 * Resolve port precedence: --port beats RCF_VIEW_PORT env beats default.
 *
 * @param {number | null} flagPort
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ port: number, errors: string[] }}
 */
export function resolvePort(flagPort, env) {
  const errors = [];
  if (typeof flagPort === 'number') return { port: flagPort, errors };
  const raw = env.RCF_VIEW_PORT;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
      errors.push(`RCF_VIEW_PORT expects an integer in [0, 65535], got ${raw}`);
      return { port: DEFAULT_PORT, errors };
    }
    return { port: n, errors };
  }
  return { port: DEFAULT_PORT, errors };
}

/**
 * Platform opener command. Kept module-visible so the CLI test suite
 * can assert per-platform selection without spawning a browser.
 *
 * @param {string} plat
 * @param {string} target
 * @returns {{ command: string, args: string[] } | null}
 */
export function openerFor(plat, target) {
  if (plat === 'darwin') return { command: 'open', args: [target] };
  if (plat === 'linux') return { command: 'xdg-open', args: [target] };
  if (plat === 'win32') return { command: 'start', args: ['""', target] };
  return null;
}

/**
 * Auto-open the served URL when we are on a TTY, CI is unset, and
 * --no-open was not passed. Never blocks the parent and never throws;
 * spawn failures fall through to a stderr warning.
 *
 * @param {object} args
 * @returns {boolean}
 */
export function maybeAutoOpen({ target, noOpen, stream, env, stderr, spawnFn = spawn, platformName = platform }) {
  if (noOpen) return false;
  if (env.CI) return false;
  if (!stream || !stream.isTTY) return false;
  const opener = openerFor(platformName, target);
  if (!opener) return false;
  try {
    const child = spawnFn(opener.command, opener.args, { detached: true, stdio: 'ignore' });
    if (child && typeof child.unref === 'function') child.unref();
    return true;
  } catch (err) {
    stderr.write(`[warn] auto-open: ${err.message}\n`);
    return false;
  }
}

/**
 * Main entry for the `rcf view` subcommand. Mirrors the shape of the
 * old bin/rcf-view.js main().
 *
 * @param {string[]} argv - the argv slice *after* the "view" positional
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const onSignal = deps.onSignal ?? ((sig, handler) => process.on(sig, handler));

  const { opts, errors: argErrors } = parseArgs(argv);
  if (opts.help) {
    stdout.write(HELP);
    return 0;
  }
  if (argErrors.length > 0) {
    for (const msg of argErrors) stderr.write(`[error] usage ${msg}\n`);
    stderr.write(HELP);
    return 2;
  }
  const { port: resolvedPort, errors: portErrors } = resolvePort(opts.port, env);
  if (portErrors.length > 0) {
    for (const msg of portErrors) stderr.write(`[error] usage ${msg}\n`);
    return 2;
  }

  const cwd = deps.cwd ?? process.cwd();
  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    stderr.write('Run `rcf init` or create rcf/manifest.json to start.\n');
    return 2;
  }

  if (opts.strict) {
    const { errors } = await walkTree({ projectRoot });
    if (errors.length > 0) {
      stderr.write(`${formatErrors(errors, { verbose: opts.verbose, strict: true })}\n`);
      return 3;
    }
  }

  const logSink = opts.verbose ? (line) => stderr.write(`${line}\n`) : () => {};

  let server;
  try {
    server = await startServer({
      projectRoot,
      port: resolvedPort,
      log: logSink,
    });
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EADDRINUSE') {
      stderr.write(`[error] usage port ${resolvedPort} is in use (another rcf view process, or a different service).\n`);
      stderr.write('Pass --port <n> or set RCF_VIEW_PORT to pick a free port.\n');
      return 2;
    }
    stderr.write(`[error] ioFailure server failed to start: ${err.message}\n`);
    return 1;
  }

  stdout.write(`rcf view server listening at ${server.url}\n`);
  stdout.write('watching rcf/ - Ctrl-C to shut down\n');

  maybeAutoOpen({
    target: server.url,
    noOpen: opts.noOpen,
    stream: stdout,
    env,
    stderr,
  });

  return new Promise((resolve) => {
    let signalled = false;
    async function handle(sig) {
      if (signalled) return;
      signalled = true;
      stderr.write(`[info] received ${sig}, shutting down\n`);
      let forced = false;
      const forceExit = setTimeout(() => {
        forced = true;
        stderr.write('[warn] shutdown timeout - forcing exit\n');
        resolve(sig === 'SIGINT' ? 130 : 1);
      }, SHUTDOWN_BUDGET_MS);
      if (typeof forceExit.unref === 'function') forceExit.unref();
      try {
        await server.close();
      } catch (err) {
        stderr.write(`[warn] shutdown error: ${err.message}\n`);
      }
      clearTimeout(forceExit);
      if (!forced) resolve(sig === 'SIGINT' ? 130 : 0);
    }
    onSignal('SIGINT', () => { handle('SIGINT'); });
    onSignal('SIGTERM', () => { handle('SIGTERM'); });
  });
}
