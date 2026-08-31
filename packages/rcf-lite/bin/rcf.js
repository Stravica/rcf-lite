#!/usr/bin/env node
// Unified `rcf` binary. 0.10.0 CLI reorganisation around the five RCF
// tool groups (discover, define, build, verify, audit) plus a small
// deliberately-named core set (init, doctor, guidance, mcp, help). The
// old flat 32-verb surface is a clean break: no aliases, no shims, no
// hidden legacy dispatch. Old flat forms exit 2 with a pointer at the
// new grouped form.
//
// Argv layout:
//   `rcf <core-verb> [args...]`        for core verbs (init, doctor,
//                                      guidance, mcp, help)
//   `rcf <group> <verb> [args...]`     for grouped verbs
// Global `--version` and `--help` short-circuit before dispatch.

import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { main as buildMain } from '../src/cli/build.js';
import { main as coverageMain } from '../src/cli/coverage.js';
import { main as createMain } from '../src/cli/create.js';
import { main as deleteMain } from '../src/cli/delete.js';
import { main as doctorMain } from '../src/cli/doctor.js';
import { main as finaliseMain } from '../src/cli/finalise.js';
import { main as guidanceMain } from '../src/cli/guidance.js';
import { main as helpMain, TOP_LEVEL_HELP, GROUP_HELP, HELP_MAP } from '../src/cli/help.js';
import { main as impactMain } from '../src/cli/impact.js';
import { main as initMain } from '../src/cli/init.js';
import { main as linkMain } from '../src/cli/link.js';
import { main as mcpMain } from '../src/cli/mcp.js';
import { main as preflightMain } from '../src/cli/preflight.js';
import { main as readMain } from '../src/cli/read.js';
import { main as reviewMain } from '../src/cli/review.js';
import { main as fbsMain } from '../src/cli/fbs.js';
import { main as testSuiteMain } from '../src/cli/test-suite.js';
import { main as traceMain } from '../src/cli/trace.js';
import { main as uiBaselineMain } from '../src/cli/ui-baseline.js';
import { main as uiClassifyMain } from '../src/cli/ui-classify.js';
import { main as designMain } from '../src/cli/design.js';
import { main as browserVerifyMain } from '../src/cli/browser-verify.js';
import { main as blueprintMain } from '../src/cli/blueprint.js';
import { main as standardsMain } from '../src/cli/standards.js';
import { main as updateMain } from '../src/cli/update.js';
import { main as validateMain } from '../src/cli/validate.js';
import { main as versionMain } from '../src/cli/version.js';
import { main as viewMain } from '../src/cli/view.js';
import { main as reqClassifyMain } from '../src/cli/req-classify.js';
import { main as reqBaselineMain } from '../src/cli/req-baseline.js';
import { main as intakeMain } from '../src/cli/intake.js';

// Verify group members are handled by the verify-suite dispatch tree.
import { main as verifyRunMain } from '../src/verify/cli/run.js';
import { main as verifyReportMain } from '../src/verify/cli/report.js';
import { main as verifyProvisionMain } from '../src/verify/cli/provision.js';
import { main as verifyCleanupMain } from '../src/verify/cli/cleanup.js';
import { main as verifyMcpMain } from '../src/verify/cli/mcp.js';

const here = dirname(fileURLToPath(import.meta.url));

// Core verbs dispatch at the top level. Deliberately named set (spec
// §Core); NOT an "other" or "misc" bucket.
export const CORE = {
  init: initMain,
  doctor: doctorMain,
  guidance: guidanceMain,
  mcp: mcpMain,
  version: versionMain,
  // help handled inline below (needs group context)
};

// Grouped verbs: two-level map (group -> verb -> handler). Rendering
// order in help output is fixed by the GROUP_ORDER export in help.js.
export const GROUPS = {
  discover: {
    intake: intakeMain,
    preflight: preflightMain,
    'req-classify': reqClassifyMain,
    'req-baseline': reqBaselineMain,
    'ui-classify': uiClassifyMain,
    'ui-baseline': uiBaselineMain,
  },
  define: {
    create: createMain,
    read: readMain,
    update: updateMain,
    delete: deleteMain,
    link: (argv, deps) => linkMain(argv, { ...deps, remove: false }),
    unlink: (argv, deps) => linkMain(argv, { ...deps, remove: true }),
    validate: validateMain,
    design: designMain,
    blueprint: blueprintMain,
    standards: standardsMain,
  },
  build: {
    // build sub-verbs are dispatched by build.js internally (queue |
    // bundle | mark). finalise, review, fbs, test-suite are their own
    // handlers.
    queue: (argv, deps) => buildMain(['queue', ...argv], deps),
    bundle: (argv, deps) => buildMain(['bundle', ...argv], deps),
    mark: (argv, deps) => buildMain(['mark', ...argv], deps),
    finalise: finaliseMain,
    review: reviewMain,
    fbs: fbsMain,
    'test-suite': testSuiteMain,
  },
  verify: {
    run: verifyRunMain,
    report: verifyReportMain,
    provision: verifyProvisionMain,
    cleanup: verifyCleanupMain,
    mcp: verifyMcpMain,
    browser: browserVerifyMain,
  },
  audit: {
    view: viewMain,
    coverage: coverageMain,
    trace: traceMain,
    impact: impactMain,
  },
};

// Old flat verb surface -> new grouped form. Consulted only when a
// bare unknown top-level token matches one of these keys, to emit a
// helpful stderr hint before exiting 2. This is NOT a back-compat
// fallback: the invocation still fails.
const OLD_FLAT_MAP = {
  intake: 'discover intake',
  preflight: 'discover preflight',
  'req-classify': 'discover req-classify',
  'req-baseline': 'discover req-baseline',
  'ui-classify': 'discover ui-classify',
  'ui-baseline': 'discover ui-baseline',
  create: 'define create',
  read: 'define read',
  update: 'define update',
  delete: 'define delete',
  link: 'define link',
  unlink: 'define unlink',
  validate: 'define validate',
  design: 'define design',
  blueprint: 'define blueprint',
  standards: 'define standards',
  finalise: 'build finalise',
  review: 'build review',
  fbs: 'build fbs',
  'test-suite': 'build test-suite',
  'browser-verify': 'verify browser',
  view: 'audit view',
  coverage: 'audit coverage',
  trace: 'audit trace',
  impact: 'audit impact',
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
    stdout.write(`rcf-lite ${version}\n`);
    return 0;
  }
  if (first === '--help' || first === '-h') {
    stdout.write(TOP_LEVEL_HELP);
    return 0;
  }

  // Core verbs dispatch directly.
  if (first === 'help') {
    return await helpMain(argv.slice(1), deps);
  }
  const coreHandler = CORE[first];
  if (coreHandler) {
    return await coreHandler(argv.slice(1), deps);
  }

  // Group dispatch.
  const group = GROUPS[first];
  if (group) {
    const verb = argv[1];
    if (!verb || verb === '--help' || verb === '-h') {
      stdout.write(GROUP_HELP[first]);
      return 0;
    }
    const verbHandler = group[verb];
    if (!verbHandler) {
      stderr.write(`[error] usage unknown verb '${verb}' in group '${first}'.\n`);
      stderr.write(GROUP_HELP[first]);
      return 2;
    }
    return await verbHandler(argv.slice(2), deps);
  }

  // Unknown top-level token. If it matches an old flat verb, name the
  // new form in the error message; otherwise the generic usage error.
  const oldForm = OLD_FLAT_MAP[first];
  if (oldForm) {
    stderr.write(
      `[error] usage unknown top-level command '${first}'. `
      + `Try 'rcf ${oldForm}' (see 'rcf help').\n`,
    );
    return 2;
  }
  stderr.write(`[error] usage unknown command '${first}'. Try 'rcf help'.\n`);
  return 2;
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
    // realpath failed on one side - fall back to the raw URL compare.
    try {
      return metaUrl === pathToFileURL(argvPath).href;
    } catch {
      return false;
    }
  }
}

// isMain gate - normalise both sides via realpath. Without this, macOS symlinks
// like `/tmp` -> `/private/tmp` and every `npm link` / `pnpm link` shim break
// the compare and main() silently never runs. See BUG-001.
const isMain = process.argv[1] && isSameEntryPoint(import.meta.url, process.argv[1]);
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`[rcf] unexpected failure: ${err.message}\n${err.stack}\n`);
      process.exit(1);
    });
}
