// The bounded job runner of `rcf audit test-strength` (FBS-236, US-19902,
// TAC-4155, ADR-4156). Mutants run in scratch git worktrees of HEAD under
// the OS temp directory, one worktree per job and one mutant at a time per
// job: the mutant's files are written in the worktree, only its
// criterion's bound tests run (each through the declared runner, one test
// name per run), and the files are restored. A mutant is killed when a
// bound test fails, timeout when its tests outlive --mutant-timeout (the
// whole process group is killed; a timeout counts as killed), else
// survived. The project's working tree, index and tracked files are never
// written, and every worktree is removed with `git worktree remove`
// before the run returns, pass, fail or error.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** The runner argv for one bound test: <file> and <name> filled (<name> as an anchored pattern). */
export function runnerArgv(runner, { file, name }) {
  const pattern = `^${escapeRegExp(name)}$`;
  return runner.map((a) => a.split('<file>').join(file).split('<name>').join(pattern));
}

/** The environment of a bound test run: this process's, without node:test's own nesting markers. */
function childEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  return env;
}

function killGroup(child) {
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

/**
 * Run one bound test in `cwd`, killing its whole process group at the
 * deadline. Resolves { code, timedOut }; rejects when the runner cannot
 * be spawned.
 */
function runTest(argv, cwd, ms, env) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: 'ignore', detached: process.platform !== 'win32' });
    } catch (err) {
      reject(err);
      return;
    }
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killGroup(child); }, Math.max(1, ms));
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      // Nothing a bound test started outlives it.
      killGroup(child);
      resolve({ code: code ?? 1, timedOut });
    });
  });
}

/**
 * Make `count` scratch worktrees of `head`, each with the main checkout's
 * node_modules directories linked in (the project's and each ancestor's
 * up to the repository root), so the bound tests resolve the same
 * dependencies. Hooks are off: adding a worktree runs no project code.
 */
async function makeWorktrees(git, { count, head, toplevel, prefix, made }) {
  const segs = prefix.split('/').filter(Boolean);
  for (let i = 0; i < count; i += 1) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rcf-test-strength-')));
    made.push(dir);
    const add = await git(['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', '--quiet', dir, head]);
    if (add.code !== 0) throw new Error(`git worktree add failed: ${add.stderr.trim()}`);
    for (let k = segs.length; k >= 0; k -= 1) {
      const rel = segs.slice(0, k).join('/');
      const from = join(toplevel, rel, 'node_modules');
      const to = join(dir, rel, 'node_modules');
      if (existsSync(from) && !existsSync(to)) symlinkSync(from, to, 'junction');
    }
  }
}

/** Remove every scratch worktree made, through git; an emptied directory left behind is removed too. */
async function removeWorktrees(git, made) {
  const left = [];
  for (const dir of made) {
    await git(['worktree', 'remove', '--force', dir]);
    if (existsSync(dir)) {
      try { rmdirSync(dir); } catch { left.push(dir); }
    }
  }
  await git(['worktree', 'prune']);
  return left;
}

/**
 * Run the mutants. Each mutant { edits, tests } rewrites `edits`
 * (project-relative path -> text) and runs `tests` ({ file, name,
 * pointer }) in order until one fails or the mutant's deadline passes.
 * Results are returned in mutant order as { result, killedBy }.
 *
 * @param {object} opts
 * @param {(args: string[]) => Promise<{ code: number|null, stderr: string }>} opts.git
 * @param {Array<{ edits: Map<string, string>, tests: Array<{ file: string, name: string, pointer: string }> }>} opts.mutants
 * @returns {Promise<{ results: Array<{ result: string, killedBy: string[] }>, left: string[] }>}
 */
export async function runMutants({ git, mutants, jobs, timeoutMs, runner, head, toplevel, prefix }) {
  const results = new Array(mutants.length);
  if (!mutants.length) return { results, left: [] };
  const made = [];
  // A signal must not leave a worktree registered: remove synchronously, then exit.
  const onSignal = (signal) => {
    for (const dir of made) {
      try { execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: toplevel, stdio: 'ignore' }); } catch { /* best effort */ }
    }
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const env = childEnv();
  let left = [];
  try {
    await makeWorktrees(git, { count: Math.min(jobs, mutants.length), head, toplevel, prefix, made });
    let next = 0;
    let failure = null;
    // Workers never reject: the first error stops every worker, and the
    // worktrees are removed only once all of them have stopped.
    const worker = async (dir) => {
      const cwd = join(dir, prefix);
      while (!failure && next < mutants.length) {
        const at = next;
        next += 1;
        const m = mutants[at];
        const originals = [];
        try {
          for (const [file, text] of m.edits) {
            const abs = join(cwd, file);
            originals.push([abs, readFileSync(abs)]);
            writeFileSync(abs, text);
          }
          const deadline = Date.now() + timeoutMs;
          let outcome = { result: 'survived', killedBy: [] };
          for (const t of m.tests) {
            const r = await runTest(runnerArgv(runner, t), cwd, deadline - Date.now(), env);
            if (r.timedOut) { outcome = { result: 'timeout', killedBy: [t.pointer] }; break; }
            if (r.code !== 0) { outcome = { result: 'killed', killedBy: [t.pointer] }; break; }
          }
          results[at] = outcome;
        } catch (err) {
          failure = failure ?? err;
        } finally {
          for (const [abs, bytes] of originals) writeFileSync(abs, bytes);
        }
      }
    };
    await Promise.all(made.map((dir) => worker(dir)));
    if (failure) throw failure;
  } finally {
    left = await removeWorktrees(git, made);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
  return { results, left };
}
