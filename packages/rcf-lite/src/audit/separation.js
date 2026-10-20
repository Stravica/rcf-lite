// `rcf audit separation` core (FBS-222, ADR-4149). Judges each non-merge
// commit in a git range by its `Hand:` trailer against the path classes
// it touches.
//
// Read-only and deterministic: git is read through one spawn seam
// (`runGit`, shaped like resolveGitBranch in src/cli/finalise.js); no
// file write, no network, no chain read. The classifier and the verdict
// function are pure.

import { spawn } from 'node:child_process';

// The five estate hands plus mixed (ADR-4149).
export const HANDS = ['test-author', 'builder', 'reviewer', 'verifier', 'stage-keeper', 'mixed'];

// Classes each declared hand owns; every hand may also touch neutral.
// reviewer owns none (neutral paths only). mixed owns none: it passes
// only as an exception, with a non-empty Separation-Reason: (FBS-223).
const OWNED = {
  'test-author': ['test', 'criteria'],
  builder: ['production'],
  reviewer: [],
  verifier: ['verifierEvidence'],
  'stage-keeper': ['stageKeeper'],
};

// Lockfiles of the common ecosystems; any other basename ending .lock
// (flake.lock, Podfile.lock, mix.lock) is matched by LOCKFILE_SUFFIX.
const LOCKFILES = new Set([
  'pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lockb', 'bun.lock',
  'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'uv.lock', 'composer.lock', 'go.sum',
]);
const LOCKFILE_SUFFIX = /.\.lock$/;
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'e2e']);
// .test. or .spec. as a dotted basename segment, whatever follows it
// (widget.test.js, widget.test.d.ts, widget.spec.js.map).
const TEST_FILE = /\.(test|spec)\.[^.]/;
const STAGE_KEEPER_FILE = /^(CHANGELOG|RELEASE)/i;

// The six path classes, and the override file (ADR-4149), which is read
// from the head commit relative to the working directory.
const CLASSES = ['test', 'criteria', 'production', 'verifierEvidence', 'stageKeeper', 'neutral'];
const OVERRIDE_PATH = 'rcf/separation.json';
const MIXED_NO_REASON = 'mixed without Separation-Reason';

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

/**
 * Parse the text of rcf/separation.json, `{ classes: { <class>: [glob, ...] } }`,
 * into a class table of [class, RegExp[]] pairs in CLASSES order.
 *
 * @param {string} text
 * @returns {{ ok: true, table: Array<[string, RegExp[]]> } | { ok: false, detail: string }}
 */
export function parseOverride(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return { ok: false, detail: err.message };
  }
  const classes = doc?.classes;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !classes || typeof classes !== 'object' || Array.isArray(classes)) {
    return { ok: false, detail: 'expected { "classes": { <class>: [glob, ...] } }' };
  }
  for (const [cls, globs] of Object.entries(classes)) {
    if (!CLASSES.includes(cls)) return { ok: false, detail: `unknown class ${cls}` };
    if (!Array.isArray(globs) || !globs.every((g) => typeof g === 'string' && g !== '')) {
      return { ok: false, detail: `classes.${cls} is not an array of globs` };
    }
  }
  return { ok: true, table: CLASSES.filter((c) => classes[c]).map((c) => [c, classes[c].map(globToRegExp)]) };
}

/**
 * Path class for a repo-relative path. Defaults match at any depth, so
 * `packages/x/rcf/fbs/a.json` and `rcf/fbs/a.json` class alike. An
 * override table (parseOverride) is consulted first and its globs match
 * at any depth too; the override file itself always classes criteria.
 *
 * @param {string} path
 * @param {Array<[string, RegExp[]]>} [table]
 * @returns {'test'|'criteria'|'production'|'verifierEvidence'|'stageKeeper'|'neutral'}
 */
export function classifyPath(path, table = []) {
  const segs = path.split('/');
  const name = segs[segs.length - 1];
  const dirs = segs.slice(0, -1);
  if (name === 'separation.json' && dirs[dirs.length - 1] === 'rcf') return 'criteria';
  for (const [cls, globs] of table) {
    for (let at = 0; at < segs.length; at += 1) {
      const tail = segs.slice(at).join('/');
      if (globs.some((re) => re.test(tail))) return cls;
    }
  }
  const rcfAt = dirs.indexOf('rcf');
  if (rcfAt !== -1) {
    const sub = segs.slice(rcfAt + 1);
    if (sub[0] === 'code-nodes' && sub.length > 1) return 'production';
    if (sub[0] === 'verify-reports' && sub.length > 1) return 'verifierEvidence';
    if (sub[0] === 'fbs' && sub.length > 1) return 'neutral';
    if (sub.length === 1 && sub[0] === 'manifest.json') return 'neutral';
    return 'criteria';
  }
  if (dirs.includes('.github')) return 'neutral';
  if (LOCKFILES.has(name) || LOCKFILE_SUFFIX.test(name)) return 'neutral';
  if (STAGE_KEEPER_FILE.test(name)) return 'stageKeeper';
  if (/\.md$/i.test(name)) return 'neutral';
  if (dirs.some((d) => TEST_DIRS.has(d)) || TEST_FILE.test(name)) return 'test';
  return 'production';
}

/**
 * Verdict for one commit from its declared hand (null when undeclared)
 * and its paths. `reason` is the Separation-Reason: value and `handId`
 * the Hand-Id: value (null when absent); `requireHand` fails a commit
 * with no Hand:, or a builder commit with no Hand-Id:.
 *
 * @param {string|null} hand
 * @param {string[]} paths
 * @param {{ reason?: string|null, handId?: string|null, requireHand?: boolean, table?: Array<[string, RegExp[]]> }} [opts]
 * @returns {{ classes: string[], verdict: 'pass'|'fail'|'exception', reason: string|null, offending: string[] }}
 */
export function judgeCommit(hand, paths, { reason = null, handId = null, requireHand = false, table = [] } = {}) {
  const classed = paths.map((p) => [p, classifyPath(p, table)]);
  const classes = [...new Set(classed.map(([, c]) => c))].sort();
  const nonNeutral = classed.filter(([, c]) => c !== 'neutral');
  const pass = { classes, verdict: 'pass', reason: null, offending: [] };

  if (hand !== null && !HANDS.includes(hand)) {
    return { classes, verdict: 'fail', reason: `unknown hand ${hand}`, offending: paths };
  }
  if (hand === 'mixed') {
    const text = (reason ?? '').trim();
    if (text) return { classes, verdict: 'exception', reason: text, offending: [] };
    return { classes, verdict: 'fail', reason: MIXED_NO_REASON, offending: [] };
  }
  if (hand === null) {
    const touched = new Set(nonNeutral.map(([, c]) => c));
    if (touched.size > 1) {
      return {
        classes,
        verdict: 'fail',
        reason: `undeclared commit touches ${[...touched].sort().join(' and ')}`,
        offending: nonNeutral.map(([p]) => p),
      };
    }
    if (requireHand) return { classes, verdict: 'fail', reason: 'missing Hand: trailer', offending: [] };
    return pass;
  }
  const owned = OWNED[hand];
  const foreign = nonNeutral.filter(([, c]) => !owned.includes(c));
  if (foreign.length === 0) {
    if (requireHand && hand === 'builder' && !(handId ?? '').trim()) {
      return { classes, verdict: 'fail', reason: 'missing Hand-Id: trailer', offending: [] };
    }
    return pass;
  }
  const foreignClasses = [...new Set(foreign.map(([, c]) => c))].sort();
  return {
    classes,
    verdict: 'fail',
    reason: `${hand} touches ${foreignClasses.join(' and ')}`,
    offending: foreign.map(([p]) => p),
  };
}

/**
 * The one git spawn seam. Resolves { code, stdout, stderr }; code is
 * null when git could not be spawned.
 *
 * @param {string[]} args
 * @param {{ cwd: string, deps?: { spawn?: Function } }} opts
 */
export function runGit(args, { cwd, deps = {} }) {
  const spawnFn = deps.spawn ?? spawn;
  return new Promise((resolveP) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawnFn('git', ['-c', 'core.quotePath=false', ...args], {
        cwd, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolveP({ code: null, stdout: '', stderr: err.message });
      return;
    }
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (err) => resolveP({ code: null, stdout: '', stderr: err.message }));
    child.on('close', (code) => resolveP({ code, stdout, stderr }));
  });
}

/**
 * Resolve the range and judge every non-merge commit in it, oldest
 * first. Without `base` the range starts at the merge-base of
 * origin/main and the head. A shallow repository is refused: its range
 * would be cut short. Class overrides come from rcf/separation.json in
 * the head commit.
 *
 * @param {{ cwd: string, base?: string, head?: string, requireHand?: boolean, deps?: object }} opts
 * @returns {Promise<{ ok: true, base: string, head: string, rows: object[] }
 *   | { ok: false, error: 'notRepo' } | { ok: false, error: 'badRef'|'shallow', ref: string }
 *   | { ok: false, error: 'badOverride', path: string, detail: string }>}
 */
export async function auditSeparation({ cwd, base, head = 'HEAD', requireHand = false, deps = {} }) {
  const git = (args) => runGit(args, { cwd, deps });
  const inRepo = await git(['rev-parse', '--git-dir']);
  if (inRepo.code !== 0) return { ok: false, error: 'notRepo' };
  const shallow = await git(['rev-parse', '--is-shallow-repository']);
  if (shallow.code === 0 && shallow.stdout.trim() === 'true') {
    return { ok: false, error: 'shallow', ref: base ?? 'origin/main' };
  }

  const resolveRef = async (ref) => {
    const res = await git(['rev-parse', '--verify', '-q', '--end-of-options', `${ref}^{commit}`]);
    return res.code === 0 ? res.stdout.trim() : null;
  };
  const headSha = await resolveRef(head);
  if (!headSha) return { ok: false, error: 'badRef', ref: head };
  let baseSha;
  if (base !== undefined) {
    baseSha = await resolveRef(base);
    if (!baseSha) return { ok: false, error: 'badRef', ref: base };
  } else {
    if (!(await resolveRef('origin/main'))) return { ok: false, error: 'badRef', ref: 'origin/main' };
    const mb = await git(['merge-base', 'origin/main', headSha]);
    if (mb.code !== 0) return { ok: false, error: 'badRef', ref: 'origin/main' };
    baseSha = mb.stdout.trim();
  }

  let table = [];
  const listed = await git(['ls-tree', '--name-only', headSha, '--', OVERRIDE_PATH]);
  if (listed.code === 0 && listed.stdout.trim()) {
    const blob = await git(['cat-file', 'blob', `${headSha}:./${OVERRIDE_PATH}`]);
    const parsed = blob.code === 0 ? parseOverride(blob.stdout) : { ok: false, detail: blob.stderr.trim() };
    if (!parsed.ok) return { ok: false, error: 'badOverride', path: OVERRIDE_PATH, detail: parsed.detail };
    table = parsed.table;
  }

  const trailer = (key) => `%(trailers:key=${key},valueonly,unfold,separator=%x1e)`;
  const log = await git(['log', '--reverse', '--no-renames', '--name-only', '--no-color',
    `--format=%x00%H%x1f%P%x1f${trailer('Hand')}%x1f${trailer('Separation-Reason')}%x1f${trailer('Hand-Id')}%x1f%s%x1f`,
    `${baseSha}..${headSha}`]);
  if (log.code !== 0) return { ok: false, error: 'badRef', ref: `${baseSha}..${headSha}` };

  const rows = [];
  for (const record of log.stdout.split('\0').slice(1)) {
    const [sha, parents, hands, reasons, handIds, subject, rest] = record.split('\x1f');
    // Merge commits are skipped: not judged, not counted, no row.
    if (parents.split(' ').filter(Boolean).length > 1) continue;
    const last = (field) => {
      const values = field.split('\x1e').map((h) => h.trim()).filter(Boolean);
      return values.length ? values[values.length - 1] : null;
    };
    const hand = last(hands);
    const paths = rest.split('\n').filter(Boolean);
    const { classes, verdict, reason, offending } = judgeCommit(hand, paths,
      { reason: last(reasons), handId: last(handIds), requireHand, table });
    rows.push({ sha, subject, hand, declared: hand !== null, classes, verdict, reason, paths, offending });
  }
  return { ok: true, base: baseSha, head: headSha, rows };
}
