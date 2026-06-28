#!/usr/bin/env node
// rcf view standalone bin (Phase 3, OQ12 / OQ13). Thin wrapper around
// renderView. Owns flag parsing, project-root discovery, summary printing
// and process.exit.

import process from 'node:process';

import { formatErrors } from '../src/errors/index.js';
import { findProjectRoot, renderView } from '../src/view/index.js';

const HELP = `Usage: rcf-view [options]

Render the on-disk RCF tree as a Mermaid diagram and a browsable HTML
page. Read-only; runs no server.

Options:
  --strict          Refuse to write output if the tree has validation
                    failures or broken references (exit code is still
                    3). Without the flag, output is written with
                    broken-section markers (default).
  --quiet           Suppress non-error stdout.
  --verbose         Per-document and per-output-file log lines.
  --help            Print this help and exit.

Exit codes:
  0  success
  1  render failure (IO error or unexpected runtime)
  2  usage error
  3  validation failure or broken references

Output directory: <project-root>/.rcf-view/
`;

function parseArgs(argv) {
  const opts = { strict: false, quiet: false, verbose: false, help: false };
  const errors = [];
  for (const arg of argv) {
    switch (arg) {
      case '--strict': opts.strict = true; break;
      case '--quiet': opts.quiet = true; break;
      case '--verbose': opts.verbose = true; break;
      case '--help':
      case '-h': opts.help = true; break;
      default: errors.push(`unknown option: ${arg}`);
    }
  }
  if (opts.quiet && opts.verbose) {
    errors.push('--quiet and --verbose are mutually exclusive');
  }
  return { opts, errors };
}

async function main(argv) {
  const { opts, errors: argErrors } = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (argErrors.length > 0) {
    for (const msg of argErrors) process.stderr.write(`[error] usage ${msg}\n`);
    process.stderr.write(HELP);
    return 2;
  }

  const cwd = process.cwd();
  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    process.stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor).\n');
    process.stderr.write('Run `rcf init` (Phase 4) or create rcf/manifest.json to start.\n');
    return 2;
  }

  const sink = opts.quiet ? () => {} : (line) => process.stdout.write(`${line}\n`);
  const result = await renderView({
    projectRoot,
    strict: opts.strict,
    verbose: opts.verbose,
    log: sink,
  });

  if (result.errors && result.errors.length > 0) {
    process.stderr.write(`${formatErrors(result.errors, { verbose: opts.verbose, strict: opts.strict })}\n`);
  }

  if (result.exitCode === 0) {
    if (!opts.quiet) {
      const count = result.written.length;
      process.stdout.write(`wrote ${count} file${count === 1 ? '' : 's'} to ${projectRoot}/.rcf-view/\n`);
    }
  } else if (result.exitCode === 3 && !opts.strict && result.written.length > 0 && !opts.quiet) {
    process.stdout.write(`wrote ${result.written.length} files to ${projectRoot}/.rcf-view/ (with broken-section markers)\n`);
  }

  return result.exitCode;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`[error] ioFailure unexpected: ${err.message}\n`);
    process.exit(1);
  });
