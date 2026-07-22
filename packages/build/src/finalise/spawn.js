// Fresh-subprocess invocation of `rcf-verify run` (spec §8.2). This is the
// load-bearing independence guarantee: build-lite's finalise step launches
// verify as a SEPARATE OS PROCESS with the isolation env - it MUST NOT import
// verify's engine in-process, because the verifier agent must start from a
// cold session with zero build context (§9). The subprocess exit code is the
// gate; findings flow back via the --out report file, never stdout scraping.
//
// The isolation env (core's ISOLATION_RECIPE, §7.3) is layered onto the child
// env here so the recipe travels with the process boundary exactly as §8.2
// specifies ("spawn ... with the isolation env").

import { spawn } from 'node:child_process';

import { isolationEnv } from '@stravica-ai/rcf-lite-core/isolation';

/**
 * Assemble the `rcf-verify run` argument vector from finalise options.
 * Deterministic and pure so it is directly unit-testable; the exact shape is
 * the §8.2 invocation contract.
 *
 * @param {object} opts
 * @param {string} opts.repo - RCF chain source (the project root)
 * @param {string} opts.url - the running deployed app
 * @param {string} opts.profile - deployed | ci | local-dev
 * @param {string} opts.out - report artifact path (always written by verify)
 * @param {string} opts.severityGate - PASS|COSMETIC|DEGRADED|BROKEN
 * @param {boolean} [opts.parityEnv]
 * @param {string} [opts.provision] - provisioning FILE path
 * @param {string} [opts.chain] - PRD/chain ref
 * @param {string} [opts.persona]
 * @returns {string[]}
 */
export function buildVerifyArgs(opts) {
  const args = [
    'run',
    '--repo', opts.repo,
    '--profile', opts.profile,
    '--url', opts.url,
    '--severity-gate', opts.severityGate,
    '--out', opts.out,
  ];
  if (opts.chain) args.push('--chain', opts.chain);
  if (opts.parityEnv) args.push('--parity-env');
  if (opts.provision) args.push('--provision', opts.provision);
  if (opts.persona) args.push('--persona', opts.persona);
  return args;
}

/**
 * Spawn rcf-verify as a fresh subprocess and resolve with its exit code.
 * stdio is inherited by default so the operator sees verify's live progress
 * and its verdict line; the report artifact is read separately by the caller.
 *
 * The child env is the isolation recipe layered over the current env (§8.2 +
 * §7.3): the recipe wins on conflict so a leaked parent value cannot re-enable
 * auto-memory or non-essential traffic in the verifier session.
 *
 * @param {object} args
 * @param {import('./detect.js').VerifyInvocation} args.invocation
 * @param {string[]} args.verifyArgs - from buildVerifyArgs()
 * @param {string} args.cwd
 * @param {object} [deps]
 * @param {typeof spawn} [deps.spawn]
 * @param {NodeJS.ProcessEnv} [deps.baseEnv]
 * @param {'inherit'|'pipe'|'ignore'} [deps.stdio]
 * @returns {Promise<{ code: number, signal: NodeJS.Signals | null, env: NodeJS.ProcessEnv }>}
 */
export function spawnVerify({ invocation, verifyArgs, cwd }, deps = {}) {
  const spawnFn = deps.spawn ?? spawn;
  const childEnv = isolationEnv(deps.baseEnv ?? process.env);
  const argv = [...invocation.prefixArgs, ...verifyArgs];
  return new Promise((resolvePromise, reject) => {
    const child = spawnFn(invocation.command, argv, {
      cwd,
      env: childEnv,
      stdio: deps.stdio ?? 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      // A signalled child (no numeric code) is a failure, not a pass.
      resolvePromise({ code: code ?? (signal ? 1 : 0), signal, env: childEnv });
    });
  });
}
