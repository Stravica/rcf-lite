// Absent-verify handling (spec §8.3, amendment 5). When `rcf-verify` is not
// resolvable, the finalise gate MUST NOT silently skip - that recreates the
// false-confidence failure the whole programme exists to prevent. The
// sanctioned paths are exactly two, and nothing else:
//   - interactive TTY  -> prompt the operator to install now (y/N);
//   - non-interactive  -> require an explicit --install-verify flag.
// A silent skip and a silent auto-install are BOTH violations. Declining the
// prompt (or omitting the flag off a TTY) aborts finalise - it does not pass
// the gate.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { VERIFY_PACKAGE } from './detect.js';

/**
 * Interactive yes/no prompt over stdin/stdout. Resolves true only on an
 * explicit affirmative; EOF / anything else is a decline (safe default: do
 * not install, do not skip the gate).
 *
 * @param {string} question
 * @param {object} [io]
 * @param {NodeJS.ReadableStream} [io.input]
 * @param {NodeJS.WritableStream} [io.output]
 * @returns {Promise<boolean>}
 */
export function promptYesNo(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolvePromise) => {
    const rl = createInterface({ input, output });
    rl.question(`${question} `, (answer) => {
      rl.close();
      resolvePromise(/^y(es)?$/i.test((answer ?? '').trim()));
    });
  });
}

/**
 * Install rcf-verify globally (matches the install-together default of two
 * global bins). Streams npm's output to the operator. Returns the install
 * process exit code.
 *
 * @param {object} [deps]
 * @param {typeof spawn} [deps.spawn]
 * @param {NodeJS.WritableStream} [deps.stdout]
 * @param {NodeJS.WritableStream} [deps.stderr]
 * @param {string} [deps.packageSpec]
 * @returns {Promise<number>}
 */
export function installVerify(deps = {}) {
  const spawnFn = deps.spawn ?? spawn;
  const spec = deps.packageSpec ?? VERIFY_PACKAGE;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return new Promise((resolvePromise, reject) => {
    const child = spawnFn(npm, ['install', '-g', spec], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code, signal) => resolvePromise(code ?? (signal ? 1 : 0)));
  });
}

/**
 * The absent-verify decision (§8.3). Given the runtime shape (TTY? explicit
 * flag?) decides among: install-then-proceed, or abort. NEVER skip.
 *
 * @param {object} args
 * @param {boolean} args.installFlag - --install-verify was passed
 * @param {boolean} args.isTty - stdin+stdout are a TTY
 * @param {object} io - { stdout, stderr, input, output }
 * @param {object} [deps]
 * @param {typeof promptYesNo} [deps.promptYesNo]
 * @param {typeof installVerify} [deps.installVerify]
 * @returns {Promise<{ action: 'installed' } | { action: 'abort', reason: string, code: number }>}
 */
export async function resolveAbsentVerify({ installFlag, isTty }, io, deps = {}) {
  const prompt = deps.promptYesNo ?? promptYesNo;
  const install = deps.installVerify ?? installVerify;

  let wantsInstall = false;
  if (installFlag) {
    // Explicit flag: the sanctioned non-interactive install path.
    io.stdout.write(`[finalise] rcf-verify not found; installing ${VERIFY_PACKAGE} (--install-verify)...\n`);
    wantsInstall = true;
  } else if (isTty) {
    // Interactive: prompt. Declining aborts (never a silent skip).
    io.stderr.write(`[finalise] rcf-verify is not installed. The ship gate cannot run without it.\n`);
    wantsInstall = await prompt(`Install ${VERIFY_PACKAGE} now? [y/N]`, {
      input: io.input, output: io.output,
    });
    if (!wantsInstall) {
      return {
        action: 'abort',
        code: 4,
        reason: `finalise refused: rcf-verify is required and install was declined. `
          + `Install it (npm i -g ${VERIFY_PACKAGE}) or re-run with --install-verify. `
          + `The ship gate is never skipped.`,
      };
    }
  } else {
    // Non-interactive without the flag: cannot prompt, must not auto-install
    // silently, must not skip. Abort with the exact remedy.
    return {
      action: 'abort',
      code: 4,
      reason: `finalise refused: rcf-verify is not installed and no TTY is available to prompt. `
        + `Install it (npm i -g ${VERIFY_PACKAGE}) or re-run with --install-verify. `
        + `The ship gate is never silently skipped.`,
    };
  }

  const installCode = await install({ stdout: io.stdout, stderr: io.stderr });
  if (installCode !== 0) {
    return {
      action: 'abort',
      code: 1,
      reason: `finalise aborted: installing ${VERIFY_PACKAGE} failed (npm exit ${installCode}). `
        + `Install it manually and re-run finalise.`,
    };
  }
  return { action: 'installed' };
}
