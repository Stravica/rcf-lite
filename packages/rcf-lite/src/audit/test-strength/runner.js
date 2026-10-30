// The bounded job runner of `rcf audit test-strength` (FBS-236, US-19902,
// TAC-4155, ADR-4156; FBS-242, US-19904). Mutants run in working copies
// of HEAD inside one scratch directory of the run under the OS temp
// directory, one working copy per job and one mutant at a time per job:
// the mutant's files are written in the working copy, only its
// criterion's bound tests run (each through the runner its file resolves
// to, one test name per run), and the files are restored. A bound test fails when its runner's report says so (the
// legacy runner: when it exits non-zero); a mutant is killed when a bound
// test fails or its file fails to load (loadError), timeout when its
// tests outlive --mutant-timeout (the whole process group is killed; a
// timeout counts as killed), else survived. Nothing in the project is
// written (AC-19903-5): a working copy is a shared clone, which writes
// nothing in the project's .git, and its node_modules is a directory of
// the run's own linking the project's installed packages, so a path any
// process creates there stays in the working copy. Each runner gets the
// scratch as its TMPDIR, and the scratch, with every working copy in it,
// is removed before the run returns, pass, fail, error or signal.

import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { judge, readReport } from './report.js';

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const SEP = ' > ';

/**
 * The name filter of one bound test (the stage-keeper's ruling F1):
 * nodeTest and the legacy runner an escaped `^name$`; vitest (ruling
 * F-8a) the titles joined by " > ", each regex-escaped, a leaf as
 * `(^| > )<leaf>$` (a nested test runs, a longer title ending in the
 * same words does not), a full path as `^<titles>$`, `^prefix` for a
 * describe prefix; playwright the segments space-joined and
 * `$`-anchored only (a describe prefix: followed by a space).
 */
export function namePattern(kind, name, prefix = false) {
  if (kind === 'vitest') {
    const titles = name.split(SEP).map(escapeRegExp);
    if (prefix) return `^${titles.join(SEP)}`;
    return titles.length === 1 ? `(^|${SEP})${titles[0]}$` : `^${titles.join(SEP)}$`;
  }
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
 * deadline. While it runs, the child is in `live` (a signal kills its
 * group). Resolves { code, timedOut, stdout }; rejects when the runner
 * cannot be spawned.
 */
function runTest(argv, cwd, ms, env, live) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'ignore'], detached: process.platform !== 'win32' });
    } catch (err) {
      reject(err);
      return;
    }
    live.add(child);
    let timedOut = false;
    let code = null;
    let done = false;
    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    const finish = () => {
      if (done) return;
      done = true;
      live.delete(child);
      resolve({ code: code ?? 1, timedOut, stdout: Buffer.concat(chunks).toString('utf8') });
    };
    const timer = setTimeout(() => { timedOut = true; killGroup(child); }, Math.max(1, ms));
    child.on('error', (err) => { clearTimeout(timer); done = true; live.delete(child); reject(err); });
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
async function runBound(t, { cwd, ms, env, reports, live }) {
  const report = t.runner.kind === 'vitest' ? reports.next() : '';
  const argv = runnerArgv(t.runner, t, report);
  try {
    const r = await runTest(argv, cwd, ms, kindEnv(env, t.runner, cwd), live);
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

// The dot entries of a node_modules directory a working copy links: the
// package manager's own (binaries, the pnpm store, their manifests). Any
// other dot entry is a cache and is not linked.
const LINKED_DOT = new Set(['.bin', '.pnpm', '.modules.yaml', '.package-lock.json']);

/**
 * Make `count` working copies of `head` in `root` (AC-19903-5): each a
 * shared clone of the repository (it writes nothing in the project's
 * .git) checked out detached at `head`, hooks off, so making one runs no
 * project code. Its node_modules, and each ancestor's up to the
 * repository root, is a fresh directory holding one link per top-level
 * entry of the project's (packages, scopes and LINKED_DOT), so the bound
 * tests resolve the same dependencies and a path any process creates
 * under node_modules lands in the working copy.
 */
async function makeWorkingCopies(git, { count, head, toplevel, prefix, root, made }) {
  const segs = prefix.split('/').filter(Boolean);
  for (let i = 1; i <= count; i += 1) {
    const dir = join(root, `wc-${i}`);
    const clone = await git(['clone', '--quiet', '--shared', '--no-checkout', toplevel, dir]);
    if (clone.code !== 0) throw new Error(`git clone --shared failed: ${clone.stderr.trim()}`);
    made.push(dir);
    const checkout = await git(['-C', dir, '-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '--detach', head]);
    if (checkout.code !== 0) throw new Error(`git checkout failed: ${checkout.stderr.trim()}`);
    for (let k = segs.length; k >= 0; k -= 1) {
      const rel = segs.slice(0, k).join('/');
      const from = join(toplevel, rel, 'node_modules');
      const to = join(dir, rel, 'node_modules');
      if (!existsSync(from) || existsSync(to)) continue;
      mkdirSync(to, { recursive: true });
      for (const e of readdirSync(from, { withFileTypes: true })) {
        if (e.name.startsWith('.') && !LINKED_DOT.has(e.name)) continue;
        symlinkSync(join(from, e.name), join(to, e.name), e.isFile() ? 'file' : 'junction');
      }
    }
  }
}

/**
 * The project tree the backstop compares (AC-19903-6): every path under
 * `root`, node_modules and every dot directory included, .git excluded;
 * a directory by its presence, anything else by its size, mtime and inode.
 *
 * @returns {Map<string, string>}
 */
export function projectTree(root) {
  const seen = new Map();
  const walk = (dir, rel) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === '.git') continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        seen.set(path, 'dir');
        walk(join(dir, e.name), path);
        continue;
      }
      try {
        const st = lstatSync(join(dir, e.name));
        seen.set(path, `${st.size}:${st.mtimeMs}:${st.ino}`);
      } catch {
        seen.set(path, 'gone');
      }
    }
  };
  walk(root, '');
  return seen;
}

/** The first path (in sorted order) new, changed or deleted between two project trees, or null. */
export function firstMoved(before, after) {
  const moved = [...after].filter(([path, v]) => before.get(path) !== v).map(([path]) => path);
  for (const path of before.keys()) if (!after.has(path)) moved.push(path);
  return moved.sort()[0] ?? null;
}

/**
 * On SIGINT or SIGTERM during a run (AC-19903-7): kill the process group
 * of every bound test run under way, remove the scratch directory with
 * its working copies, and exit 130 for SIGINT or 143 for SIGTERM.
 */
function stopOnSignal(signal, live, scratch) {
  for (const child of live) killGroup(child);
  try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); } catch { /* best effort */ }
  process.exit(signal === 'SIGINT' ? 130 : 143);
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
  // The working copies, the runners' temp files and caches, and vitest's
  // report files stay in one scratch directory of this run. Its name is
  // short: a runner may open a Unix socket under TMPDIR (tsx does), and
  // those paths are capped near 108 bytes.
  const scratch = mkdtempSync(join(tmpdir(), 'rcf-ts-'));
  const root = realpathSync(scratch);
  // The bound test runs under way: a signal kills each one's process group.
  const live = new Set();
  const onSignal = (signal) => stopOnSignal(signal, live, scratch);
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const env = { ...childEnv(), TMPDIR: scratch, TMP: scratch, TEMP: scratch };
  let n = 0;
  const reports = {
    next() {
      n += 1;
      return join(scratch, `report-${n}.json`);
    },
  };
  let left = [];
  try {
    await makeWorkingCopies(git, { count: Math.min(jobs, mutants.length), head, toplevel, prefix, root, made });
    let next = 0;
    let failure = null;
    // Workers never reject: the first error stops every worker, and the
    // scratch is removed only once all of them have stopped.
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
            const ctx = { cwd, env, reports, live };
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
    try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); } catch { /* named below */ }
    if (existsSync(scratch)) left = [scratch];
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
  return { results, left };
}

/**
 * The unmutated run (RC-45, AC-19902-9): before any mutant, run the bound
 * tests of each criterion that reaches the mutation proof once, unmutated,
 * in a working copy of `head`, each through its runner. A bound test
 * red here would kill every mutant, a false PASS. Resolves the first bound
 * test that is not green as `red` ({ acId, test, result, verdict, names }:
 * result notRun when the runner did not run it, else the red verdict;
 * null when every one is green) and the scratch directory that could not
 * be removed as `left`.
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
