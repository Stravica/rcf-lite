// `rcf audit separation` core (FBS-233, TAC-4153, ADR-4153). Judges
// every commit in a git range, merges included, by the strict stage
// prefix on its subject (DEFINE:, BUILD:, REVIEW:, TEST:, FINALISE:)
// against the path classes that stage owns; the role follows from the
// stage. Through 0.37.x a Hand: trailer is read only to check that it
// agrees with that role (ADR-4162).
//
// Read-only and deterministic: git is read through one spawn seam
// (`runGit`); no file write (the RCF_SPAWN_LOG seam aside, when it is
// set), no network, no chain read, and a declared generator's command
// is never run. Repository files are read through git at the commits in
// the range (rcf/separation.json at the head). The prefix parser, the
// classifier and the verdict function are pure.

import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

// The five stages in their order, each with the role it derives.
export const STAGE_ROLES = {
  DEFINE: 'test-author',
  BUILD: 'builder',
  REVIEW: 'reviewer',
  TEST: 'verifier',
  FINALISE: 'stage-keeper',
};

// Each class and the stages that own it (TAC-4153 "Default path classes
// and owners"). Neutral paths are open to DEFINE and BUILD only; REVIEW
// and TEST own only their verdict and evidence classes.
export const CLASS_OWNERS = {
  criteria: ['DEFINE'],
  rcfTest: ['DEFINE'],
  hygieneTest: ['BUILD'],
  production: ['BUILD'],
  reviewVerdict: ['REVIEW'],
  testVerdict: ['TEST'],
  verifierEvidence: ['TEST'],
  releaseEvidence: ['FINALISE'],
  chainStatus: ['DEFINE', 'FINALISE'],
  release: ['BUILD', 'FINALISE'],
  versionField: ['FINALISE'],
  lockfile: ['DEFINE', 'BUILD', 'FINALISE'],
  neutral: ['DEFINE', 'BUILD'],
  generatorOutput: ['FINALISE'],
};

// The classes rcf/separation.json may name. versionField depends on a
// commit's diff and generatorOutput on its Generated-By: trailer, so
// neither is a path class a glob can grant.
const CONFIGURABLE = Object.keys(CLASS_OWNERS).filter((c) => c !== 'versionField' && c !== 'generatorOutput');
// 0.36.x class names that changed, read with a warn line; criteria,
// production, verifierEvidence and neutral keep their names.
const RENAMED = { test: 'rcfTest', stageKeeper: 'release' };

// The 0.36.1 lockfile set: the common ecosystems' lockfiles, and any
// other basename ending .lock (flake.lock, Podfile.lock, mix.lock).
const LOCKFILES = new Set([
  'pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lockb', 'bun.lock',
  'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'uv.lock', 'composer.lock', 'go.sum',
]);
const LOCKFILE_SUFFIX = /.\.lock$/;
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'e2e']);
// A hygiene/ directory directly under one of these test roots.
const HYGIENE_ROOTS = new Set(['test', 'tests', '__tests__']);
// .test. or .spec. as a dotted basename segment, whatever follows it
// (widget.test.js, widget.test.d.ts, widget.spec.js.map).
const TEST_FILE = /\.(test|spec)\.[^.]/;
const HYGIENE_FILE = /\.hygiene\.test\.[^.]/;
const RELEASE_FILE = /^(CHANGELOG|RELEASE)/i;
const H12 = /^[0-9a-f]{12}$/;

const CONFIG_PATH = 'rcf/separation.json';
const CONFIG_SHAPE = 'expected { "classes": { <class>: [glob, ...] }, "generators": [ { "id", "command", "outputs", "checkedBy" } ] }';

const STRICT_PREFIX = /^(DEFINE|BUILD|REVIEW|TEST|FINALISE): (?=\S)/;
// A first token that reaches for a stage: one ending ":" (define:,
// VERIFY:, DEFINE(FBS-1):) or naming a stage word in any case or
// punctuation (DEFINE:x, DEFINE, [DEFINE]).
const STAGE_WORD = /^[^A-Za-z]*(define|build|review|test|finalise|finalize)(?![A-Za-z])/i;
const USE = 'use DEFINE:, BUILD:, REVIEW:, TEST: or FINALISE:';
const MIXED_RETIRED = 'Hand: mixed is retired; commit chores as FINALISE: within its file classes';
const MERGE_FIX = 'a merge that needs a code fix is not committed in FINALISE: record TEST FAIL and merge main in the next round';

/**
 * The spawn log seam (TAC-4153): with RCF_SPAWN_LOG=<file> set, one JSON
 * line { command, args } per child process is appended to <file>; unset,
 * nothing is written. A failed append never fails the verb.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 */
export function recordSpawn(command, args, env = process.env) {
  const file = env.RCF_SPAWN_LOG;
  if (!file) return;
  try {
    appendFileSync(file, `${JSON.stringify({ command, args })}\n`);
  } catch {
    // The seam observes; it never changes the verb's outcome.
  }
}

/**
 * Glob to an anchored RegExp: `**` spans directories, `*` and `?` stay
 * inside one segment.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      i += 1;
      if (glob[i + 1] === '/') { i += 1; re += '(?:.*/)?'; } else re += '.*';
    } else if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** True when any glob matches the path or any of its tails. */
function matchesAtAnyDepth(path, globs) {
  const segs = path.split('/');
  for (let at = 0; at < segs.length; at += 1) {
    const tail = segs.slice(at).join('/');
    if (globs.some((re) => re.test(tail))) return true;
  }
  return false;
}

/**
 * Parse the text of rcf/separation.json v2, `{ classes, generators }`
 * (both optional), into a class table of [class, RegExp[]] pairs in file
 * order, the declared generators and the warn lines for 0.36.x class
 * names. The checkedBy existence check needs the head commit and is made
 * by auditSeparation.
 *
 * @param {string} text
 * @returns {{ ok: true, table: Array<[string, RegExp[]]>, generators: Array<{ id: string, outputs: RegExp[], checkedBy: string }>, warnings: string[] }
 *   | { ok: false, detail: string }}
 */
export function parseOverride(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return { ok: false, detail: err.message };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, detail: CONFIG_SHAPE };
  // Both keys are optional; present, each must have its shape.
  const classes = doc.classes === undefined ? {} : doc.classes;
  const generators = doc.generators === undefined ? [] : doc.generators;
  if (!classes || typeof classes !== 'object' || Array.isArray(classes)) return { ok: false, detail: CONFIG_SHAPE };
  const table = [];
  const warnings = [];
  for (const [name, globs] of Object.entries(classes)) {
    const cls = RENAMED[name] ?? name;
    if (!CONFIGURABLE.includes(cls)) return { ok: false, detail: `unknown class ${name}` };
    if (!Array.isArray(globs) || !globs.every((g) => typeof g === 'string' && g !== '')) {
      return { ok: false, detail: `classes.${name} is not an array of globs` };
    }
    if (cls !== name) warnings.push(`separation: class ${name} is read as ${cls}`);
    table.push([cls, globs.map(globToRegExp)]);
  }
  if (!Array.isArray(generators)) return { ok: false, detail: 'generators is not an array' };
  const declared = [];
  for (const [i, g] of generators.entries()) {
    const at = `generators[${i}]`;
    if (!g || typeof g !== 'object' || Array.isArray(g)) return { ok: false, detail: `${at} is not an object` };
    if (typeof g.id !== 'string' || g.id === '') return { ok: false, detail: `${at}.id is required` };
    if (typeof g.command !== 'string' || g.command === '') return { ok: false, detail: `${at}.command is required` };
    if (!Array.isArray(g.outputs) || g.outputs.length === 0 || !g.outputs.every((o) => typeof o === 'string' && o !== '')) {
      return { ok: false, detail: `${at}.outputs must list at least one glob` };
    }
    if (typeof g.checkedBy !== 'string' || g.checkedBy === '') return { ok: false, detail: `${at}.checkedBy is required` };
    declared.push({ id: g.id, outputs: g.outputs.map(globToRegExp), checkedBy: g.checkedBy });
  }
  return { ok: true, table, generators: declared, warnings };
}

/**
 * True for a builder hygiene test: a path under a hygiene/ directory
 * directly beneath test/, tests/ or __tests__/ (at any depth), or a
 * *.hygiene.test.* file. Hygiene tests sit outside the RCF suite.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isHygieneTestPath(path) {
  const segs = path.split('/');
  const dirs = segs.slice(0, -1);
  for (let i = 0; i + 1 < dirs.length; i += 1) {
    if (HYGIENE_ROOTS.has(dirs[i]) && dirs[i + 1] === 'hygiene') return true;
  }
  return HYGIENE_FILE.test(segs[segs.length - 1]);
}

/**
 * Path class for a repo-relative path. Configured classes come first, in
 * file order, each glob tried against every path tail; then the
 * defaults, each matching at any depth, in TAC-4153's order. The
 * override file itself always classes criteria.
 *
 * @param {string} path
 * @param {{ table?: Array<[string, RegExp[]]>, generated?: boolean, versionOnly?: boolean }} [opts]
 *   generated: a Generated-By: trailer on the commit names a declared
 *   generator whose outputs match the path; versionOnly: the commit's
 *   diff of this package.json changes only its "version" line.
 * @returns {string}
 */
export function classifyPath(path, { table = [], generated = false, versionOnly = false } = {}) {
  const segs = path.split('/');
  const name = segs[segs.length - 1];
  const dirs = segs.slice(0, -1);
  if (name === 'separation.json' && dirs[dirs.length - 1] === 'rcf') return 'criteria';
  for (const [cls, globs] of table) {
    if (matchesAtAnyDepth(path, globs)) return cls;
  }
  if (generated) return 'generatorOutput';
  const rcfAt = dirs.indexOf('rcf');
  if (rcfAt !== -1) {
    const sub = segs.slice(rcfAt + 1);
    if (sub.length === 1 && sub[0] === 'manifest.json') return 'neutral';
    if (sub[0] === 'verdicts' && sub.length === 3 && H12.test(sub[1])) {
      if (sub[2] === 'review.json') return 'reviewVerdict';
      if (sub[2] === 'test.json' || sub[2] === 'test-strength.json') return 'testVerdict';
    }
    if (sub[0] === 'verify-reports' && sub[1] === 'releases' && sub.length > 2) return 'releaseEvidence';
    if (sub[0] === 'verify-reports' && sub.length > 1) return 'verifierEvidence';
    if (sub[0] === 'fbs' && sub.length > 1) return 'chainStatus';
    if (sub[0] === 'code-nodes' && sub.length > 1) return 'production';
    return 'criteria';
  }
  if (dirs.includes('.github')) return 'neutral';
  if (LOCKFILES.has(name) || LOCKFILE_SUFFIX.test(name)) return 'lockfile';
  if (name === 'package.json' && versionOnly) return 'versionField';
  if (RELEASE_FILE.test(name) || (name === 'releases.yaml' && dirs[dirs.length - 1] === 'releases')) return 'release';
  if (/\.md$/i.test(name)) return 'neutral';
  if (isHygieneTestPath(path)) return 'hygieneTest';
  if (dirs.some((d) => TEST_DIRS.has(d)) || TEST_FILE.test(name)) return 'rcfTest';
  return 'production';
}

/**
 * The stage a subject's strict prefix names, or why it names none.
 *
 * @param {string} subject
 * @returns {{ stage: string|null, malformed: string|null }} malformed is
 *   the first token (the subject up to its first space) of a near-miss
 *   prefix, null for a subject with no prefix at all
 */
export function parsePrefix(subject) {
  const m = STRICT_PREFIX.exec(subject);
  if (m) return { stage: m[1], malformed: null };
  const token = subject.split(' ')[0];
  if (token.endsWith(':') || STAGE_WORD.test(token)) return { stage: null, malformed: token };
  return { stage: null, malformed: null };
}

/**
 * Verdict for one commit: its stage and role from the subject prefix, the
 * classes of the paths it touches (a merge: its combined-diff paths) and
 * each cause of failure as its own item, in check order: prefix (a
 * missing or malformed prefix is the only item), Hand: agreement, Hand:
 * mixed, each path in order, then each undeclared Generated-By id.
 * Items carry no sha.
 *
 * @param {{ subject: string, merge?: boolean, hand?: string|null, generatedBy?: string[], paths?: string[], versionOnly?: Set<string> }} commit
 * @param {{ table?: Array<[string, RegExp[]]>, generators?: Array<{ id: string, outputs: RegExp[] }> }} [config]
 * @returns {{ stage: string|null, role: string|null, classes: string[], items: string[], transition: boolean }}
 */
export function judgeCommit(commit, { table = [], generators = [] } = {}) {
  const { subject, merge = false, hand = null, generatedBy = [], paths = [], versionOnly = new Set() } = commit;
  const { stage, malformed } = parsePrefix(subject);
  const role = stage ? STAGE_ROLES[stage] : null;
  const named = generators.filter((g) => generatedBy.includes(g.id));
  const classed = paths.map((p) => [p, classifyPath(p, {
    table,
    generated: named.some((g) => matchesAtAnyDepth(p, g.outputs)),
    versionOnly: versionOnly.has(p),
  })]);
  const classes = [...new Set(classed.map(([, c]) => c))].sort();
  if (!stage) {
    const item = malformed !== null ? `malformed stage prefix "${malformed}"; ${USE}` : 'no stage prefix';
    return { stage, role, classes, items: [item], transition: false };
  }
  const items = [];
  if (hand !== null && hand !== 'mixed' && hand !== role) items.push(`Hand: ${hand} disagrees with ${stage}: (role ${role})`);
  if (hand === 'mixed') items.push(MIXED_RETIRED);
  for (const [path, cls] of classed) {
    const owners = CLASS_OWNERS[cls];
    if (owners.includes(stage)) continue;
    if (merge && stage === 'FINALISE') {
      items.push(`FINALISE: merge resolution touches ${path} (class ${cls}); ${MERGE_FIX}`);
    } else if (stage === 'FINALISE' && cls === 'production' && path.split('/').pop() === 'package.json') {
      items.push(`FINALISE: changes ${path} beyond its "version" line (class production, owned by BUILD)`);
    } else {
      items.push(`${stage}: touches ${path} (class ${cls}, owned by ${owners.join(', ')})`);
    }
  }
  for (const id of generatedBy) {
    if (!generators.some((g) => g.id === id)) items.push(`Generated-By: ${id} is not declared in rcf/separation.json`);
  }
  return { stage, role, classes, items, transition: hand !== null && hand === role };
}

/**
 * True when a package.json diff changes only its "version" line: the
 * same line count, and every line that differs is a "version" line on
 * both sides. A file added, deleted or reshaped is beyond the line.
 *
 * @param {string|null} before
 * @param {string|null} after
 * @returns {boolean}
 */
function onlyVersionLine(before, after) {
  if (before === null || after === null) return false;
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length !== b.length) return false;
  const version = /^\s*"version"\s*:/;
  let changed = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    if (!version.test(a[i]) || !version.test(b[i])) return false;
    changed += 1;
  }
  return changed > 0;
}

/**
 * The one git spawn seam. Resolves { code, stdout, stderr, raw }; code
 * is null when git could not be spawned, raw is stdout as bytes. `input`
 * is written to git's stdin. Every spawn is recorded by recordSpawn.
 *
 * @param {string[]} args
 * @param {{ cwd: string, deps?: { spawn?: Function }, input?: string|null }} opts
 */
export function runGit(args, { cwd, deps = {}, input = null }) {
  const spawnFn = deps.spawn ?? spawn;
  const argv = ['-c', 'core.quotePath=false', ...args];
  recordSpawn('git', argv);
  return new Promise((resolveP) => {
    const out = [];
    const err = [];
    const failed = (message) => resolveP({ code: null, stdout: '', stderr: message, raw: Buffer.alloc(0) });
    let child;
    try {
      child = spawnFn('git', argv, { cwd, stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    } catch (e) {
      failed(e.message);
      return;
    }
    const bytes = (chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    child.stdout.on('data', (chunk) => { out.push(bytes(chunk)); });
    child.stderr.on('data', (chunk) => { err.push(bytes(chunk)); });
    child.on('error', (e) => failed(e.message));
    child.on('close', (code) => {
      const raw = Buffer.concat(out);
      resolveP({ code, stdout: raw.toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), raw });
    });
    if (input !== null) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
  });
}

/**
 * Read objects by name through one `git cat-file --batch`. Returns one
 * entry per name, in order: { sha, type, text } or { missing: true } for
 * a name that does not resolve. A name holding a line break would split
 * the batch, so it is never sent and reads missing.
 *
 * @param {(args: string[], input?: string) => Promise<{ code: number|null, raw: Buffer }>} git
 * @param {string[]} names
 */
async function readObjects(git, names) {
  const sent = names.filter((n) => !/[\r\n]/.test(n));
  const res = await git(['cat-file', '--batch'], sent.map((n) => `${n}\n`).join(''));
  const raw = res.code === 0 ? res.raw : Buffer.alloc(0);
  const out = [];
  let at = 0;
  for (const name of names) {
    if (/[\r\n]/.test(name)) { out.push({ name, missing: true }); continue; }
    const nl = raw.indexOf(10, at);
    if (nl === -1) { out.push({ name, missing: true }); continue; }
    const parts = raw.subarray(at, nl).toString('utf8').split(' ');
    at = nl + 1;
    if (parts.length === 3 && /^[0-9a-f]{40,64}$/.test(parts[0]) && /^\d+$/.test(parts[2])) {
      const size = Number(parts[2]);
      out.push({ name, sha: parts[0], type: parts[1], text: raw.subarray(at, at + size).toString('utf8') });
      at += size + 1;
    } else {
      out.push({ name, missing: true });
    }
  }
  return out;
}

/**
 * Resolve the range and judge every commit on it, oldest first. The
 * range is walked with --first-parent from the head to the base (without
 * `base`, the merge-base of origin/main and the head); a merge is a row
 * judged by its combined diff (git diff-tree --cc), and a commit
 * reachable only through a merge's second parent is never a row. A
 * shallow repository is refused: its range would be cut short. Classes
 * and generators come from rcf/separation.json in the head commit.
 * Subjects, trailers and paths come from one git log pass. Besides it,
 * git runs once to check the repository, once to read both refs and the
 * config, once for the merge-base when `base` is not given, once for the
 * generators' checkedBy files and the package.json blobs the range
 * changes (only when there are any), and once per merge.
 *
 * @param {{ cwd: string, base?: string, head?: string, deps?: object }} opts
 * @returns {Promise<{ ok: true, base: string, head: string, rows: object[], warnings: string[] }
 *   | { ok: false, error: 'notRepo' } | { ok: false, error: 'badRef'|'shallow', ref: string }
 *   | { ok: false, error: 'badOverride', path: string, detail: string }>}
 */
export async function auditSeparation({ cwd, base, head = 'HEAD', deps = {} }) {
  const git = (args, input = null) => runGit(args, { cwd, deps, input });
  const shallow = await git(['rev-parse', '--is-shallow-repository']);
  if (shallow.code !== 0) return { ok: false, error: 'notRepo' };
  if (shallow.stdout.trim() === 'true') return { ok: false, error: 'shallow', ref: base ?? 'origin/main' };

  const baseRef = base ?? 'origin/main';
  const [headObj, baseObj, configObj] = await readObjects(git,
    [`${head}^{commit}`, `${baseRef}^{commit}`, `${head}:./${CONFIG_PATH}`]);
  if (headObj.missing) return { ok: false, error: 'badRef', ref: head };
  if (baseObj.missing) return { ok: false, error: 'badRef', ref: baseRef };
  const headSha = headObj.sha;
  let baseSha = baseObj.sha;
  if (base === undefined) {
    const mb = await git(['merge-base', baseSha, headSha]);
    if (mb.code !== 0) return { ok: false, error: 'badRef', ref: 'origin/main' };
    baseSha = mb.stdout.trim();
  }

  let config = { table: [], generators: [], warnings: [] };
  if (!configObj.missing) {
    const parsed = configObj.type === 'blob' ? parseOverride(configObj.text) : { ok: false, detail: CONFIG_SHAPE };
    if (!parsed.ok) return { ok: false, error: 'badOverride', path: CONFIG_PATH, detail: parsed.detail };
    config = parsed;
  }

  const trailer = (key) => `%(trailers:key=${key},valueonly,unfold,separator=%x1e)`;
  const log = await git(['log', '--first-parent', '--reverse', '--no-renames', '--name-only', '--no-color',
    `--format=%x00%H%x1f%P%x1f${trailer('Hand')}%x1f${trailer('Generated-By')}%x1f%s%x1f`,
    `${baseSha}..${headSha}`]);
  if (log.code !== 0) return { ok: false, error: 'badRef', ref: `${baseSha}..${headSha}` };

  const values = (field) => field.split('\x1e').map((v) => v.trim()).filter(Boolean);
  const commits = log.stdout.split('\0').slice(1).map((record) => {
    const [sha, parents, hands, generated, subject, rest = ''] = record.split('\x1f');
    const handValues = values(hands);
    const merge = parents.split(' ').filter(Boolean).length > 1;
    return {
      sha, subject, merge,
      hand: handValues.length ? handValues[handValues.length - 1] : null,
      generatedBy: [...new Set(values(generated))],
      // A merge's paths are its combined diff, read below.
      paths: merge ? [] : rest.split('\n').filter(Boolean),
      versionOnly: new Set(),
    };
  });

  for (const c of commits.filter((x) => x.merge)) {
    const cc = await git(['diff-tree', '--cc', '--name-only', '--no-commit-id', c.sha]);
    c.paths = cc.code === 0 ? cc.stdout.split('\n').filter(Boolean) : [];
  }

  // One batch for the rest: each declared generator's checkedBy file at
  // the head, and the blobs of each package.json a commit changes,
  // before and after (versionField needs them).
  const checked = config.generators.map((g) => `${headSha}:./${g.checkedBy}`);
  const pairs = commits.flatMap((c) => (c.merge ? [] : c.paths
    .filter((p) => p.split('/').pop() === 'package.json' && !config.table.some(([, globs]) => matchesAtAnyDepth(p, globs)))
    .map((p) => [c, p])));
  const blobNames = pairs.flatMap(([c, p]) => [`${c.sha}^:${p}`, `${c.sha}:${p}`]);
  const found = checked.length || blobNames.length ? await readObjects(git, [...checked, ...blobNames]) : [];
  const absent = found.slice(0, checked.length).findIndex((f) => f.missing || f.type !== 'blob');
  if (absent !== -1) {
    return {
      ok: false, error: 'badOverride', path: CONFIG_PATH,
      detail: `generators[${absent}].checkedBy ${config.generators[absent].checkedBy} does not exist at ${headSha.slice(0, 7)}`,
    };
  }
  const blobs = found.slice(checked.length);
  pairs.forEach(([c, p], i) => {
    const [before, after] = [blobs[2 * i], blobs[2 * i + 1]];
    if (onlyVersionLine(before.missing ? null : before.text, after.missing ? null : after.text)) c.versionOnly.add(p);
  });

  const rows = commits.map((c) => {
    const { stage, role, classes, items, transition } = judgeCommit(c, config);
    return {
      sha: c.sha,
      subject: c.subject,
      merge: c.merge,
      stage,
      role,
      handTrailer: c.hand,
      classes,
      generators: c.generatedBy,
      verdict: items.length ? 'fail' : 'pass',
      reason: items.join('; '),
      paths: c.paths,
      items,
      transition,
    };
  });
  return { ok: true, base: baseSha, head: headSha, rows, warnings: config.warnings };
}
