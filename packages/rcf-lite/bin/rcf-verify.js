#!/usr/bin/env node
// Unified `rcf-verify` binary (spec §3, dispatch pattern mirrors build's
// bin/rcf.js). Argv layout: `rcf-verify <subcommand> [args...]`. The first
// positional selects the subcommand handler; global --version / --help
// short-circuit before dispatch.

import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { main as runMain } from '../src/cli/run.js';
import { main as reportMain } from '../src/cli/report.js';
import { main as provisionMain } from '../src/cli/provision.js';
import { main as cleanupMain } from '../src/cli/cleanup.js';
import { main as mcpMain } from '../src/cli/mcp.js';
import { main as helpMain, TOP_LEVEL_HELP } from '../src/cli/help.js';

const here = dirname(fileURLToPath(import.meta.url));

const SUBCOMMANDS = {
  run: runMain,
  report: reportMain,
  provision: provisionMain,
  cleanup: cleanupMain,
  mcp: mcpMain,
  help: helpMain,
};

/**
 * @param {string[]} argv - argv minus node + script
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  if (argv.length === 0) {
    stdout.write(TOP_LEVEL_HELP);
    return 0;
  }
  const first = argv[0];
  if (first === '--version' || first === '-v') {
    stdout.write(`rcf-verify ${await readPackageVersion()}\n`);
    return 0;
  }
  if (first === '--help' || first === '-h') {
    stdout.write(TOP_LEVEL_HELP);
    return 0;
  }
  const handler = SUBCOMMANDS[first];
  if (!handler) {
    stderr.write(`[error] usage unknown subcommand: ${first}\n`);
    stderr.write(TOP_LEVEL_HELP);
    return 2;
  }
  return await handler(argv.slice(1), deps);
}

async function readPackageVersion() {
  try {
    const pkgPath = resolve(here, '..', 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Symlink-safe entry-point compare (mirrors build's bin/rcf.js). macOS `/tmp`
 * is a symlink to `/private/tmp` and every `pnpm link` shim is a symlink;
 * without realpath the isMain gate breaks and main() never runs.
 *
 * @param {string} metaUrl
 * @param {string} argvPath
 * @returns {boolean}
 */
export function isSameEntryPoint(metaUrl, argvPath) {
  try {
    const metaPath = fileURLToPath(metaUrl);
    return realpathSync(metaPath) === realpathSync(argvPath);
  } catch {
    try {
      return metaUrl === pathToFileURL(argvPath).href;
    } catch {
      return false;
    }
  }
}

const isMain = process.argv[1] && isSameEntryPoint(import.meta.url, process.argv[1]);
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`[rcf-verify] unexpected failure: ${err.message}\n${err.stack}\n`);
      process.exit(1);
    });
}
