// Shared test harness (GR-40): spawn the app entry, bin/rcf.js, as a child
// process. Imports Node builtins only and nothing under src/ or
// test/_helpers/. The bin is resolved relative to this file, so the same
// test runs from the checkout and from the installed copy the Test-stage
// report stages (the package beside its test/ directory).

import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The package root: packages/rcf-lite in the checkout, the installed package in a staged copy. */
export const PACKAGE_ROOT = resolve(here, '..', '..');
/** The app entry every external test drives. */
export const BIN = join(PACKAGE_ROOT, 'bin', 'rcf.js');

/**
 * A PATH that reaches git and no agent CLI. `rcf init` probes the agent
 * CLI from PATH; node comes from process.execPath, so node's own
 * directory is never on it. Refuses loudly if a claude is reachable.
 */
export function claudeFreePath(inherited = process.env.PATH ?? '') {
  const dirs = inherited.split(delimiter).filter(Boolean);
  const gitDir = dirs.find((d) => existsSync(join(d, 'git')));
  if (!gitDir) throw new Error(`harness: no git on the inherited PATH\n${inherited}`);
  if (existsSync(join(gitDir, 'claude'))) throw new Error(`harness: the pinned PATH reaches an agent CLI in ${gitDir}`);
  return gitDir;
}

/** The environment every child runs in: pinned PATH, CI, no global git config, a fixture identity. */
export function baseEnv(extra = {}) {
  const env = {
    ...process.env,
    PATH: claudeFreePath(),
    CI: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.com',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.com',
    ...extra,
  };
  // A nested node --test must print its own output, not report to ours.
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/**
 * Run bin/rcf.js with args in cwd. Resolves { code, stdout, stderr, ms }
 * and never rejects on a non-zero exit.
 */
export function rcf(args, { cwd, env = {}, timeout = 120_000, bin = BIN } = {}) {
  const t0 = process.hrtime.bigint();
  return new Promise((res) => {
    execFile(process.execPath, [bin, ...args], {
      cwd, env: baseEnv(env), encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const code = err ? (typeof err.code === 'number' ? err.code : (err.killed ? 'timeout' : 1)) : 0;
      res({ code, stdout: stdout ?? '', stderr: stderr ?? '', ms });
    });
  });
}

/** As rcf(), but throws unless the exit code is 0; for fixture set-up steps. */
export async function rcfOk(args, opts) {
  const r = await rcf(args, opts);
  if (r.code !== 0) throw new Error(`harness: rcf ${args.join(' ')} exited ${r.code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  return r;
}

/** Run any node script or command synchronously in the harness environment; returns { code, stdout, stderr }. */
export function run(cmd, args, { cwd, env = {}, timeout = 300_000 } = {}) {
  try {
    const stdout = execFileSync(cmd, args, { cwd, env: baseEnv(env), encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: typeof err.status === 'number' ? err.status : 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

/** Lines of a stream, without the trailing empty line. */
export function lines(text) {
  return text.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === ''));
}
