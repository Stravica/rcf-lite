#!/usr/bin/env node
// Unified `rcf` binary. Phase 4 §D1 / §D23: replaces the standalone
// `bin/rcf-view.js` and adds init / validate / create / read / update /
// delete / link / unlink / help subcommands. Zero external deps.
//
// Argv layout: `rcf <subcommand> [args...]`. The first positional is
// the subcommand; everything after is handed to that subcommand's
// handler (`src/cli/<subcommand>.js`). Global `--version` and `--help`
// short-circuit before dispatch.

import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { main as buildMain } from '../src/cli/build.js';
import { main as coverageMain } from '../src/cli/coverage.js';
import { main as createMain } from '../src/cli/create.js';
import { main as deleteMain } from '../src/cli/delete.js';
import { main as helpMain, TOP_LEVEL_HELP } from '../src/cli/help.js';
import { main as impactMain } from '../src/cli/impact.js';
import { main as initMain } from '../src/cli/init.js';
import { main as linkMain } from '../src/cli/link.js';
import { main as mcpMain } from '../src/cli/mcp.js';
import { main as readMain } from '../src/cli/read.js';
import { main as traceMain } from '../src/cli/trace.js';
import { main as updateMain } from '../src/cli/update.js';
import { main as validateMain } from '../src/cli/validate.js';
import { main as viewMain } from '../src/cli/view.js';

const here = dirname(fileURLToPath(import.meta.url));

const SUBCOMMANDS = {
  init: initMain,
  view: viewMain,
  validate: validateMain,
  create: createMain,
  read: readMain,
  update: updateMain,
  delete: deleteMain,
  link: (argv, deps) => linkMain(argv, { ...deps, remove: false }),
  unlink: (argv, deps) => linkMain(argv, { ...deps, remove: true }),
  coverage: coverageMain,
  trace: traceMain,
  impact: impactMain,
  build: buildMain,
  mcp: mcpMain,
  help: helpMain,
};

/**
 * Entry point. Reads argv (minus node + script), dispatches on the
 * first positional. Returns a Promise resolving to an exit code.
 *
 * @param {string[]} argv
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
    const version = await readPackageVersion();
    stdout.write(`rcf ${version}\n`);
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
 * Compare `import.meta.url` to `process.argv[1]` in a symlink-safe way.
 * On macOS `/tmp` is a symlink to `/private/tmp`, and any `npm link` /
 * `pnpm link` install exposes the bin via a symlink. `import.meta.url`
 * always resolves via realpath; `process.argv[1]` is the raw string the
 * shell/OS passed. Normalise both via `fs.realpathSync` before compare.
 * Falls back to the raw compare if realpath fails (e.g. path removed).
 *
 * @param {string} metaUrl - `import.meta.url`
 * @param {string} argvPath - `process.argv[1]`
 * @returns {boolean}
 */
export function isSameEntryPoint(metaUrl, argvPath) {
  try {
    const metaPath = fileURLToPath(metaUrl);
    return realpathSync(metaPath) === realpathSync(argvPath);
  } catch {
    // realpath failed on one side — fall back to the raw URL compare.
    try {
      return metaUrl === pathToFileURL(argvPath).href;
    } catch {
      return false;
    }
  }
}

// isMain gate — normalise both sides via realpath. Without this, macOS symlinks
// like `/tmp` -> `/private/tmp` and every `npm link` / `pnpm link` shim break
// the compare and main() silently never runs. See BUG-001.
const isMain = process.argv[1] && isSameEntryPoint(import.meta.url, process.argv[1]);
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      // Exit 1 is the "unexpected" escape hatch (§D15). Stack is not
      // suppressed even under --quiet - operator needs the raw failure.
      process.stderr.write(`[rcf] unexpected failure: ${err.message}\n${err.stack}\n`);
      process.exit(1);
    });
}
