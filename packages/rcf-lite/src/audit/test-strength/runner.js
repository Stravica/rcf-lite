// The bounded job runner of `rcf audit test-strength` (FBS-236, US-19902,
// TAC-4155, ADR-4156; FBS-242, US-19904). Mutants run in working copies
// of HEAD inside one scratch directory of the run under the OS temp
// directory (round F, AC-19904-12: /tmp/rcf-<6 chars> when a runner's Unix
// socket path there would pass the platform's limit), one working copy per
// job and one mutant at a time per job:
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
// process creates there stays in the working copy (round F, AC-19903-14:
// a workspace package link whose package entry is not committed at HEAD
// stays at the repo's own package). Each runner gets the scratch as its
// TMPDIR, and the scratch, with every working copy in it, is removed
// before the run returns, pass, fail, error or signal.

import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, posix, relative, resolve, sep } from 'node:path';

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

/**
 * The PATH of a bound test run (round E, AC-19904-9): every
 * node_modules/.bin from the test's package directory `from` up to the
 * repository root `top`, nearest first, ahead of the inherited PATH, as a
 * package script finds them. One rule for every runner kind, a runners
 * entry with "cwd": "project" included (its PATH still starts at the
 * test's package).
 */
function kindEnv(env, from, top) {
  const bins = [];
  for (let d = from; ; d = dirname(d)) {
    bins.push(join(d, 'node_modules', '.bin'));
    if (d === top || dirname(d) === d) break;
  }
  return { ...env, PATH: [...bins, env.PATH].filter(Boolean).join(delimiter) };
}

/**
 * The package directory of a bound test file (round E, AC-19903-10): the
 * nearest directory at HEAD from the file up to the rcf project root
 * holding a package.json, else the rcf project root (''), both relative
 * to the rcf project root.
 *
 * @param {string} file - project-relative path
 * @param {Set<string>} files - the project-relative paths at HEAD
 * @returns {string}
 */
export function packageDir(file, files) {
  for (let d = posix.dirname(file); d !== '.' && d !== ''; d = posix.dirname(d)) {
    if (files.has(`${d}/package.json`)) return d;
  }
  return '';
}

/** The directory a bound test runs at, relative to the rcf project root: '' for the rcf project root ("cwd": "project"), else its package directory. */
export function runDir(t) {
  return t.runner.cwd === 'project' ? '' : (t.dir ?? '');
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
async function runBound(t, { project, top, ms, env, reports, live }) {
  const report = t.runner.kind === 'vitest' ? reports.next() : '';
  // Round E (AC-19903-10, AC-19904-8): the run is at the test's package
  // directory, or at the rcf project root for a "cwd": "project" entry,
  // with <file> and the report match relative to it.
  const at = runDir(t);
  const cwd = at ? join(project, at) : project;
  const file = at ? t.file.slice(at.length + 1) : t.file;
  const argv = runnerArgv(t.runner, { ...t, file }, report);
  try {
    const r = await runTest(argv, cwd, ms, kindEnv(env, join(project, t.dir ?? ''), top), live);
    if (r.timedOut) return { verdict: 'timeout', timedOut: true };
    if (t.runner.kind === 'legacy') return { verdict: r.code !== 0 ? 'fail' : 'pass' };
    let reportText = null;
    if (report && existsSync(report)) reportText = readFileSync(report, 'utf8');
    const j = judge(readReport(t.runner.kind, { stdout: r.stdout, reportText, file }), t.name);
    return { verdict: j.status, prefix: j.prefix, names: j.names };
  } finally {
    if (report && existsSync(report)) unlinkSync(report);
  }
}

// The Unix socket path limit by platform, the terminating NUL included
// (sockaddr_un's sun_path): 104 bytes on darwin, 108 on Linux.
export const SOCKET_PATH_LIMIT = { darwin: 104, linux: 108 };
// The widest process id a runner can get: darwin's highest is 99998; Linux's
// pid_max is at most 2^22 (4194304).
const PID_WIDTH = { darwin: 5, linux: 7 };

/**
 * Where a run's scratch directories go (round F, AC-19904-12; the
 * stage-keeper's ruling C13): `prefix` for mkdtemp, tmpdir()/rcf-ts- as
 * before, unless a runner's Unix socket path under such a scratch would
 * pass the platform's limit (tsx opens its IPC socket at
 * <TMPDIR>/tsx-<uid>/<pid>.pipe, measured here with the widest pid), when
 * it is /tmp/rcf- on darwin and on Linux alike and `line` is the one stderr
 * line the run prints first; else `line` is null.
 *
 * @param {string} [tmp] - the temp directory, tmpdir()
 * @param {string} [platform]
 * @returns {{ prefix: string, line: string|null }}
 */
export function scratchPlace(tmp = tmpdir(), platform = process.platform) {
  const prefix = join(tmp, 'rcf-ts-');
  const limit = SOCKET_PATH_LIMIT[platform];
  if (!limit) return { prefix, line: null };
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  const socket = `${prefix}XXXXXX/tsx-${uid}/${'9'.repeat(PID_WIDTH[platform])}.pipe`;
  if (Buffer.byteLength(socket) < limit) return { prefix, line: null };
  return {
    prefix: '/tmp/rcf-',
    line: `test-strength: a runner's Unix socket path under ${tmp} would pass ${limit} bytes, the limit on ${platform}; the scratch directory moves to a short path`,
  };
}

// The conditions a package entry is read under, in this order (round F,
// AC-19903-14; the stage-keeper's ruling C10: Node's ESM order).
const ENTRY_CONDITIONS = ['import', 'default', 'require'];
const entryPath = (target) => posix.normalize(target).replace(/^\.\//, '');

/** An exports target resolved under ENTRY_CONDITIONS: a path, null for no entry, undefined for no match (the next condition is tried). */
function exportsTarget(target) {
  if (typeof target === 'string') return entryPath(target);
  if (Array.isArray(target)) {
    for (const t of target) {
      const r = exportsTarget(t);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  if (target === null) return null;
  if (typeof target !== 'object') return undefined;
  for (const condition of ENTRY_CONDITIONS) {
    if (!Object.hasOwn(target, condition)) continue;
    const r = exportsTarget(target[condition]);
    if (r !== undefined) return r;
  }
  return undefined;
}

/**
 * The entry of a package (round F, AC-19903-14; the stage-keeper's ruling
 * C10), from its package.json `pkg` (null when there is none): `exports`
 * first (a string is the entry; a map of subpaths is read at its "."
 * subpath, any other map is the "." subpath's conditions, resolved in the
 * order import, default, require, a nested map walked the same way; no "."
 * subpath and no matching condition is no entry), else `main`, else
 * index.js when the package directory holds one (`indexJs`; none is no
 * entry). Resolves { entry, main, exports } (`entry` relative to the
 * package directory, null for no entry; `main` true when it is main's;
 * `exports` true when the package.json has an exports field, which the
 * no-entry notice names, Review 1 F-4 and the stage-keeper's ruling 22).
 *
 * @param {object|null} pkg
 * @param {boolean} [indexJs]
 * @returns {{ entry: string|null, main: boolean, exports: boolean }}
 */
export function packageEntry(pkg, indexJs = true) {
  if (pkg && pkg.exports !== undefined) {
    const exp = pkg.exports;
    const subpaths = exp && typeof exp === 'object' && !Array.isArray(exp) && Object.keys(exp).some((k) => k.startsWith('.'));
    const target = subpaths ? (Object.hasOwn(exp, '.') ? exportsTarget(exp['.']) : null) : exportsTarget(exp);
    return { entry: target ?? null, main: false, exports: true };
  }
  if (pkg && typeof pkg.main === 'string' && pkg.main.trim()) return { entry: entryPath(pkg.main), main: true, exports: false };
  return { entry: pkg && indexJs ? 'index.js' : null, main: false, exports: false };
}

/**
 * True when a package's entry is committed at HEAD (AC-19903-14): `entry`
 * relative to the package directory `pkgDir`, both against `committed`, the
 * repository-relative paths at HEAD. A main entry is found as Node finds
 * one (the path, then with .js, .json or .node, then its index.js,
 * index.json or index.node); an exports entry or index.js only as named.
 */
function entryCommitted(committed, pkgDir, { entry, main }) {
  if (entry === null) return false;
  const at = pkgDir ? `${pkgDir}/${entry}` : entry;
  const tries = main ? [at, `${at}.js`, `${at}.json`, `${at}.node`, `${at}/index.js`, `${at}/index.json`, `${at}/index.node`] : [at];
  return tries.some((p) => committed.has(p));
}

// The dot entries of a node_modules directory a working copy links: the
// package manager's own (binaries, the pnpm store, their manifests). Any
// other dot entry is a cache and is not linked.
const LINKED_DOT = new Set(['.bin', '.pnpm', '.modules.yaml', '.package-lock.json']);

/**
 * Link the entries of the repository's node_modules directory `from` into
 * the working copy's `to`, a fresh directory (TAC-4155 responsibilities[4]):
 * an entry that is itself a symbolic link is re-pointed to its own target
 * inside the copy `dir` when that target is in the repository (`tops`, the
 * repository root as git names it and its real path); every other entry
 * links as 0.39.0 does, an absolute link to the project's own entry. Round
 * F (AC-19903-14): a link to a package in the repository outside every
 * node_modules (a workspace package), whose package entry (packageEntry,
 * read from its package.json in the copy, which is HEAD's) is not in
 * `committed`, stays at the repo's own package, an absolute link to the
 * project's own entry, and is recorded in `kept` (its link and package
 * relative to the rcf project root `project`, its entry, and whether its
 * package.json has an exports field). A scope
 * directory (@scope) is a fresh directory whose packages link by the same
 * rule; dot entries other than LINKED_DOT are not linked.
 */
function linkModules(from, to, dir, tops, keep) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    if (e.name.startsWith('.') && !LINKED_DOT.has(e.name)) continue;
    const entry = join(from, e.name);
    if (e.name.startsWith('@') && e.isDirectory()) {
      linkModules(entry, join(to, e.name), dir, tops, keep);
      continue;
    }
    let target = entry;
    if (e.isSymbolicLink()) {
      const own = resolve(dirname(entry), readlinkSync(entry));
      const top = tops.find((t) => within(own, t));
      if (top) {
        const pkgDir = relative(top, own).split(sep).join('/');
        target = join(dir, relative(top, own));
        if (keep && !pkgDir.split('/').includes('node_modules')) {
          let pkg = null;
          try { pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')); } catch { pkg = null; }
          const read = packageEntry(pkg && typeof pkg === 'object' ? pkg : null, existsSync(join(own, 'index.js')));
          if (!entryCommitted(keep.committed, pkgDir, read)) {
            target = entry;
            const named = (abs) => relative(keep.project, abs).split(sep).join('/');
            const link = named(entry);
            if (!keep.kept.has(link)) keep.kept.set(link, { link, package: named(own), entry: read.entry, exports: read.exports });
          }
        }
      }
    }
    symlinkSync(target, join(to, e.name), e.isFile() ? 'file' : 'junction');
  }
}

/**
 * Make `count` working copies of `head` in `root` (AC-19903-5): each a
 * shared clone of the repository (it writes nothing in the project's
 * .git) checked out detached at `head`, hooks off, so making one runs no
 * project code. Its node_modules, each ancestor's up to the repository
 * root and (round E, AC-19903-8, AC-19903-9) each `packages` directory's
 * (every package.json directory at HEAD outside node_modules,
 * repository-wide, relative to the repository root) is a fresh directory
 * linking the repository's entries (linkModules), so the bound tests
 * resolve the same dependencies, a workspace package linked by name
 * resolves inside the working copy, and a path any process creates under
 * node_modules lands in the working copy.
 */
async function makeWorkingCopies(git, { count, head, toplevel, prefix, root, made, packages = [], committed = null, kept = null }) {
  const segs = prefix.split('/').filter(Boolean);
  const rels = [...segs.map((_, k) => segs.slice(0, segs.length - k).join('/')), '', ...packages];
  const tops = [...new Set([toplevel, realpathSync(toplevel)])];
  // Round F (AC-19903-14): with the files at HEAD, a link whose package entry is not committed stays.
  const keep = committed && kept ? { committed, kept, project: join(toplevel, prefix) } : null;
  for (let i = 1; i <= count; i += 1) {
    const dir = join(root, `wc-${i}`);
    const clone = await git(['clone', '--quiet', '--shared', '--no-checkout', toplevel, dir]);
    if (clone.code !== 0) throw new Error(`git clone --shared failed: ${clone.stderr.trim()}`);
    made.push(dir);
    const checkout = await git(['-C', dir, '-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '--detach', head]);
    if (checkout.code !== 0) throw new Error(`git checkout failed: ${checkout.stderr.trim()}`);
    for (const rel of rels) {
      const from = join(toplevel, rel, 'node_modules');
      const to = join(dir, rel, 'node_modules');
      if (!existsSync(from) || existsSync(to)) continue;
      linkModules(from, to, dir, tops, keep);
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

/**
 * The node_modules directories on Node's module resolution path above the
 * project root (its NODE_MODULES_PATHS, a directory named node_modules
 * itself skipped), from the root's parent up to the repository root
 * `toplevel`, which holds the project and is the stop; present or not.
 *
 * @returns {string[]}
 */
export function resolutionPath(projectRoot, toplevel) {
  const top = realpathSync(toplevel);
  const segs = relative(top, realpathSync(projectRoot)).split(sep).filter(Boolean);
  const dirs = [];
  for (let k = segs.length - 1; k >= 0; k -= 1) {
    const d = join(top, ...segs.slice(0, k));
    if (basename(d) !== 'node_modules') dirs.push(join(d, 'node_modules'));
  }
  return dirs;
}

/** The real path of `path`, through the real path of its nearest existing ancestor when it does not exist. */
function realOf(path) {
  const tail = [];
  for (let d = path; ; d = dirname(d)) {
    try { return join(realpathSync(d), ...[...tail].reverse()); } catch { /* not there: its parent */ }
    if (dirname(d) === d) return path;
    tail.push(basename(d));
  }
}

const within = (path, root) => path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

/**
 * The forbidden roots (AC-19903-5, AC-19903-6; the stage-keeper's design
 * decision after re-Review 4), resolved by real path once, at the start of
 * the run: the project root, the real location of its node_modules (the
 * target, when it is a symbolic link), the real location of each
 * ancestor's node_modules up to the repository root (resolutionPath,
 * present or not), the real location of each `packages` directory's
 * node_modules a working copy links (round E, AC-19903-11; `packages`
 * relative to the repository root), and the repository's .git. Each is
 * named relative to the project root; a root inside another one is read
 * with it, the .git aside (the project tree leaves .git out).
 *
 * @returns {Array<{ name: string, real: string }>}
 */
export function forbiddenRoots(projectRoot, toplevel, packages = []) {
  const root = realpathSync(projectRoot);
  const top = realpathSync(toplevel);
  const named = (dir) => relative(root, dir).split(sep).join('/');
  const linked = packages.map((p) => join(top, p, 'node_modules')).filter((d) => existsSync(d));
  const nested = [join(root, 'node_modules'), ...resolutionPath(projectRoot, toplevel), ...linked].map((d) => ({ name: named(d), real: realOf(d) }));
  const git = { name: named(join(top, '.git')), real: realOf(join(toplevel, '.git')) };
  const roots = [{ name: '', real: root }];
  for (const r of nested) if (!roots.some((o) => within(r.real, o.real))) roots.push(r);
  return [...roots, git];
}

/**
 * The tree the backstop compares (AC-19903-5, AC-19903-6): every path
 * under each forbidden root (forbiddenRoots, resolved at the start of the
 * run) as projectTree reads it, each named relative to the project root.
 *
 * @returns {Map<string, string>}
 */
export function backstopTree(projectRoot, toplevel, roots = forbiddenRoots(projectRoot, toplevel)) {
  const seen = new Map();
  for (const { name, real } of roots) {
    if (name && existsSync(real)) seen.set(name, 'dir');
    for (const [path, v] of projectTree(real)) seen.set(name ? `${name}/${path}` : path, v);
  }
  return seen;
}

/**
 * The first path (in sorted order) new, changed or deleted between two
 * backstop trees whose real path lies under a forbidden root and outside
 * every scratch directory of the run (the working copies are in them), or
 * null.
 */
export function firstForbidden(roots, before, after, scratches = []) {
  const byName = [...roots].sort((a, b) => b.name.length - a.name.length);
  for (const path of movedPaths(before, after)) {
    const at = byName.find((r) => r.name === '' || path === r.name || path.startsWith(`${r.name}/`));
    const abs = at.name ? join(at.real, path.slice(at.name.length)) : join(at.real, path);
    const real = join(realOf(dirname(abs)), basename(abs));
    if (roots.some((r) => within(real, r.real)) && !scratches.some((s) => within(real, s))) return path;
  }
  return null;
}

/** Every path new, changed or deleted between two trees, in sorted order. */
function movedPaths(before, after) {
  const moved = [...after].filter(([path, v]) => before.get(path) !== v).map(([path]) => path);
  for (const path of before.keys()) if (!after.has(path)) moved.push(path);
  return moved.sort();
}

/** The first path (in sorted order) new, changed or deleted between two project trees, or null. */
export function firstMoved(before, after) {
  return movedPaths(before, after)[0] ?? null;
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
export async function runMutants({ git, mutants, jobs, timeoutMs, head, toplevel, prefix, packages = [], unmutated = false, scratches = [], scratchAt = scratchPlace().prefix, committed = null, kept = null }) {
  const results = new Array(mutants.length);
  if (!mutants.length) return { results, left: [] };
  const made = [];
  // The working copies, the runners' temp files and caches, and vitest's
  // report files stay in one scratch directory of this run, at `scratchAt`
  // (scratchPlace). Its name is short: a runner may open a Unix socket
  // under TMPDIR (tsx does), and a Unix socket path is capped at 104 bytes
  // on darwin and 108 on Linux, its terminating NUL included.
  const scratch = mkdtempSync(scratchAt);
  const root = realpathSync(scratch);
  scratches.push(root);
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
  let thrown = null;
  try {
    await makeWorkingCopies(git, { count: Math.min(jobs, mutants.length), head, toplevel, prefix, root, made, packages, committed, kept });
    let next = 0;
    let failure = null;
    // Workers never reject: the first error stops every worker, and the
    // scratch is removed only once all of them have stopped.
    // Each mutant's edits land in the copy's rcf project tree; each bound
    // test runs at its own directory in the copy (runBound).
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
            const ctx = { project: cwd, top: dir, env, reports, live };
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
          // A file the run cannot restore is the failure too, never a rejected worker.
          for (const [abs, bytes] of originals) {
            try { writeFileSync(abs, bytes); } catch (err) { failure = failure ?? err; }
          }
        }
      }
    };
    await Promise.all(made.map((dir) => worker(dir)));
    if (failure) throw failure;
  } catch (err) {
    thrown = err;
  } finally {
    try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); } catch { /* named below */ }
    if (existsSync(scratch)) left = [scratch];
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
  // An error leaves with the scratch it ran in and whether it is left (F-7).
  if (thrown) throw Object.assign(thrown, { scratch, left });
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
export async function runUnmutated({ git, criteria, timeoutMs, head, toplevel, prefix, packages = [], scratches, scratchAt, committed = null, kept = null }) {
  const checks = criteria.map((c) => ({ acId: c.acId, edits: new Map(), tests: c.tests }));
  const { results, left } = await runMutants({ git, mutants: checks, jobs: 1, timeoutMs, head, toplevel, prefix, packages, unmutated: true, scratches, scratchAt, committed, kept });
  const at = results.findIndex((r) => r.result !== 'survived');
  if (at < 0) return { red: null, left };
  const r = results[at];
  const test = checks[at].tests.find((t) => t.pointer === r.killedBy[0]);
  return { red: { acId: checks[at].acId, test, result: r.result, verdict: r.loadError ? 'loadError' : r.verdict, names: r.names }, left };
}
