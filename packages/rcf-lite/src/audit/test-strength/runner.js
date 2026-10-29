// The bounded job runner of `rcf audit test-strength` (FBS-236, US-19902,
// TAC-4155, ADR-4156; FBS-242, US-19904). Mutants run in scratch git
// worktrees of HEAD under the OS temp directory, one worktree per job and
// one mutant at a time per job: the mutant's files are written in the
// worktree, only its criterion's bound tests run (each through the runner
// its file resolves to, one test name per run), and the files are
// restored. A bound test fails when its runner's report says so (the
// legacy runner: when it exits non-zero); a mutant is killed when a bound
// test fails or its file fails to load (loadError), timeout when its
// tests outlive --mutant-timeout (the whole process group is killed; a
// timeout counts as killed), else survived. The project's working tree,
// index and tracked files are never written, and every worktree is
// removed with `git worktree remove` before the run returns, pass, fail
// or error.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { judge, readReport } from './report.js';

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const SEP = ' > ';

/**
 * The name filter of one bound test (the stage-keeper's ruling F1):
 * nodeTest and the legacy runner an escaped `^name$`; vitest the
 * pointer's segments joined by " > ", `^...$` for a leaf or a full path,
 * `^prefix` for a describe prefix; playwright the segments space-joined
 * and `$`-anchored only (a describe prefix: followed by a space).
 */
export function namePattern(kind, name, prefix = false) {
  if (kind === 'vitest') return prefix ? `^${escapeRegExp(name)}` : `^${escapeRegExp(name)}$`;
  if (kind === 'playwright') {
    const joined = escapeRegExp(name.split(SEP).join(' '));
    return prefix ? `${joined} ` : `${joined}$`;
  }
  return `^${escapeRegExp(name)}$`;
}

/** The runner argv for one bound test: <file>, <name> (its kind's filter) and <report> filled. */
export function runnerArgv(runner, { file, name, prefix = false }, report = '') {
  const pattern = namePattern(runner.kind, name, prefix);
  return runner.argv.map((a) => a.split('<file>').join(file).split('<name>').join(pattern).split('<report>').join(report));
}

/** The environment of a bound test run: this process's, without node:test's own nesting markers. */
function childEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  return env;
}

/** A vitest or playwright run also finds the project's own node_modules/.bin, as a package script would. */
function kindEnv(env, runner, cwd) {
  if (runner.kind !== 'vitest' && runner.kind !== 'playwright') return env;
  return { ...env, PATH: [join(cwd, 'node_modules', '.bin'), env.PATH].filter(Boolean).join(delimiter) };
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
 * deadline. Resolves { code, timedOut, stdout }; rejects when the runner
 * cannot be spawned.
 */
function runTest(argv, cwd, ms, env) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'ignore'], detached: process.platform !== 'win32' });
    } catch (err) {
      reject(err);
      return;
    }
    let timedOut = false;
    let code = null;
    let done = false;
    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    const finish = () => {
      if (done) return;
      done = true;
      resolve({ code: code ?? 1, timedOut, stdout: Buffer.concat(chunks).toString('utf8') });
    };
    const timer = setTimeout(() => { timedOut = true; killGroup(child); }, Math.max(1, ms));
    child.on('error', (err) => { clearTimeout(timer); done = true; reject(err); });
    child.on('exit', (c) => {
      clearTimeout(timer);
      code = c;
      // Nothing a bound test started outlives it.
      killGroup(child);
      setTimeout(finish, 2000).unref();
    });
    child.on('close', finish);
  });
}

/**
 * One run of one bound test through its runner, judged: { verdict, timedOut }
 * with verdict pass, fail, loadError, unreadable (no report the audit can
 * read), notRun or ambiguous (and the leaves' names).
 */
async function runBound(t, { cwd, ms, env, reports }) {
  const report = t.runner.kind === 'vitest' ? reports.next() : '';
  const argv = runnerArgv(t.runner, t, report);
  try {
    const r = await runTest(argv, cwd, ms, kindEnv(env, t.runner, cwd));
    if (r.timedOut) return { verdict: 'timeout', timedOut: true };
    if (t.runner.kind === 'legacy') return { verdict: r.code !== 0 ? 'fail' : 'pass' };
    let reportText = null;
    if (report && existsSync(report)) reportText = readFileSync(report, 'utf8');
    const j = judge(readReport(t.runner.kind, { stdout: r.stdout, reportText, file: t.file }), t.name);
    return { verdict: j.status, prefix: j.prefix, names: j.names };
  } finally {
    if (report && existsSync(report)) unlinkSync(report);
  }
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

/** A bound test the runner did not run, or a name matching several leaves: a whole-run failure (exit 2). */
export class NotRunError extends Error {
  constructor(test, names = null) {
    super(`bound test ${test.pointer} was not run by runner ${test.runner.argv.join(' ')}`
      + (names ? `: matches ${names.length} tests in ${test.file}: ${names.map((n) => JSON.stringify(n)).join(', ')}` : ''));
    this.test = test;
  }
}

/**
 * Run the mutants. Each mutant { edits, tests } rewrites `edits`
 * (project-relative path -> text) and runs `tests` ({ file, name,
 * pointer, runner }) in order until one fails or the mutant's deadline
 * passes. Results are returned in mutant order as { result, killedBy }
 * (and loadError true when the killing file failed to load). With
 * `unmutated` a bound test the runner did not run is the result notRun
 * (a vitest or playwright name is first tried as a leaf, then as a
 * describe prefix, which every later run of it then uses); otherwise it
 * stops the run with a NotRunError.
 *
 * @param {object} opts
 * @param {(args: string[]) => Promise<{ code: number|null, stderr: string }>} opts.git
 * @param {Array<{ edits: Map<string, string>, tests: Array<{ file: string, name: string, pointer: string, runner: object }> }>} opts.mutants
 * @returns {Promise<{ results: Array<{ result: string, killedBy: string[], loadError?: true, verdict?: string }>, left: string[] }>}
 */
export async function runMutants({ git, mutants, jobs, timeoutMs, head, toplevel, prefix, unmutated = false }) {
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
  // vitest writes its report to a file: one per run, in one temp directory.
  let reportDir = null;
  let n = 0;
  const reports = {
    next() {
      reportDir = reportDir ?? mkdtempSync(join(tmpdir(), 'rcf-test-strength-report-'));
      n += 1;
      return join(reportDir, `report-${n}.json`);
    },
  };
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
            const ctx = { cwd, env, reports };
            let r = await runBound(t, { ...ctx, ms: deadline - Date.now() });
            if (unmutated && r.verdict === 'notRun' && !t.prefix && (t.runner.kind === 'vitest' || t.runner.kind === 'playwright')) {
              t.prefix = true;
              r = await runBound(t, { ...ctx, ms: deadline - Date.now() });
              if (r.verdict === 'notRun') t.prefix = false;
            }
            if (r.timedOut) { outcome = { result: 'timeout', killedBy: [t.pointer] }; break; }
            if (r.verdict === 'notRun' || r.verdict === 'ambiguous') {
              if (!unmutated) throw new NotRunError(t, r.names);
              outcome = { result: 'notRun', killedBy: [t.pointer], verdict: r.verdict, names: r.names };
              break;
            }
            if (r.verdict === 'loadError') { outcome = { result: 'killed', killedBy: [t.pointer], loadError: true }; break; }
            if (r.verdict !== 'pass') { outcome = { result: 'killed', killedBy: [t.pointer], verdict: r.verdict }; break; }
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
    if (reportDir) {
      try { rmdirSync(reportDir); } catch { left.push(reportDir); }
    }
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
  return { results, left };
}

/**
 * The unmutated run (RC-45, AC-19902-9): before any mutant, run the bound
 * tests of each criterion that reaches the mutation proof once, unmutated,
 * in a scratch worktree of `head`, each through its runner. A bound test
 * red here would kill every mutant, a false PASS. Resolves the first bound
 * test that is not green as `red` ({ acId, test, result, verdict, names }:
 * result notRun when the runner did not run it, else the red verdict;
 * null when every one is green) and the worktrees that could not be
 * removed as `left`.
 *
 * @param {object} opts
 * @param {Array<{ acId: string, tests: Array<{ file: string, name: string, pointer: string, runner: object }> }>} opts.criteria
 * @returns {Promise<{ red: { acId: string, test: object, result: string, verdict?: string, names?: string[] }|null, left: string[] }>}
 */
export async function runUnmutated({ git, criteria, timeoutMs, head, toplevel, prefix }) {
  const checks = criteria.map((c) => ({ acId: c.acId, edits: new Map(), tests: c.tests }));
  const { results, left } = await runMutants({ git, mutants: checks, jobs: 1, timeoutMs, head, toplevel, prefix, unmutated: true });
  const at = results.findIndex((r) => r.result !== 'survived');
  if (at < 0) return { red: null, left };
  const r = results[at];
  const test = checks[at].tests.find((t) => t.pointer === r.killedBy[0]);
  return { red: { acId: checks[at].acId, test, result: r.result, verdict: r.loadError ? 'loadError' : r.verdict, names: r.names }, left };
}
