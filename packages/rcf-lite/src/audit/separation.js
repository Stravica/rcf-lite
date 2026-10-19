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
// reviewer owns none (neutral paths only). mixed is judged like an
// undeclared commit here; its Separation-Reason: exception is FBS-223's.
const OWNED = {
  'test-author': ['test', 'criteria'],
  builder: ['production'],
  reviewer: [],
  verifier: ['verifierEvidence'],
  'stage-keeper': ['stageKeeper'],
};

const LOCKFILES = new Set([
  'pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lockb', 'bun.lock',
]);
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'e2e']);
const TEST_FILE = /\.(test|spec)\.[^.]+$/;
const STAGE_KEEPER_FILE = /^(CHANGELOG|RELEASE)/i;

/**
 * Default path class for a repo-relative path. Defaults match at any
 * depth, so `packages/x/rcf/fbs/a.json` and `rcf/fbs/a.json` class alike.
 *
 * @param {string} path
 * @returns {'test'|'criteria'|'production'|'verifierEvidence'|'stageKeeper'|'neutral'}
 */
export function classifyPath(path) {
  const segs = path.split('/');
  const name = segs[segs.length - 1];
  const dirs = segs.slice(0, -1);
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
  if (LOCKFILES.has(name)) return 'neutral';
  if (STAGE_KEEPER_FILE.test(name)) return 'stageKeeper';
  if (/\.md$/i.test(name)) return 'neutral';
  if (dirs.some((d) => TEST_DIRS.has(d)) || TEST_FILE.test(name)) return 'test';
  return 'production';
}

/**
 * Verdict for one commit from its declared hand (null when undeclared)
 * and its paths.
 *
 * @param {string|null} hand
 * @param {string[]} paths
 * @returns {{ classes: string[], verdict: 'pass'|'fail', reason: string|null, offending: string[] }}
 */
export function judgeCommit(hand, paths) {
  const classed = paths.map((p) => [p, classifyPath(p)]);
  const classes = [...new Set(classed.map(([, c]) => c))].sort();
  const nonNeutral = classed.filter(([, c]) => c !== 'neutral');
  const pass = { classes, verdict: 'pass', reason: null, offending: [] };

  if (hand !== null && !HANDS.includes(hand)) {
    return { classes, verdict: 'fail', reason: `unknown hand ${hand}`, offending: paths };
  }
  if (hand === null || hand === 'mixed') {
    const touched = new Set(nonNeutral.map(([, c]) => c));
    if (touched.size <= 1) return pass;
    return {
      classes,
      verdict: 'fail',
      reason: `${hand === null ? 'undeclared' : 'mixed'} commit touches ${[...touched].sort().join(' and ')}`,
      offending: nonNeutral.map(([p]) => p),
    };
  }
  const owned = OWNED[hand];
  const foreign = nonNeutral.filter(([, c]) => !owned.includes(c));
  if (foreign.length === 0) return pass;
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
 * origin/main and the head.
 *
 * @param {{ cwd: string, base?: string, head?: string, deps?: object }} opts
 * @returns {Promise<{ ok: true, base: string, head: string, rows: object[] }
 *   | { ok: false, error: 'notRepo' } | { ok: false, error: 'badRef', ref: string }>}
 */
export async function auditSeparation({ cwd, base, head = 'HEAD', deps = {} }) {
  const git = (args) => runGit(args, { cwd, deps });
  const inRepo = await git(['rev-parse', '--git-dir']);
  if (inRepo.code !== 0) return { ok: false, error: 'notRepo' };

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

  const log = await git(['log', '--reverse', '--no-renames', '--name-only', '--no-color',
    '--format=%x00%H%x1f%P%x1f%(trailers:key=Hand,valueonly,unfold,separator=%x1e)%x1f%s%x1f',
    `${baseSha}..${headSha}`]);
  if (log.code !== 0) return { ok: false, error: 'badRef', ref: `${baseSha}..${headSha}` };

  const rows = [];
  for (const record of log.stdout.split('\0').slice(1)) {
    const [sha, parents, hands, subject, rest] = record.split('\x1f');
    // Merge commits are skipped: not judged, not counted, no row.
    if (parents.split(' ').filter(Boolean).length > 1) continue;
    const values = hands.split('\x1e').map((h) => h.trim()).filter(Boolean);
    const hand = values.length ? values[values.length - 1] : null;
    const paths = rest.split('\n').filter(Boolean);
    const { classes, verdict, reason, offending } = judgeCommit(hand, paths);
    rows.push({ sha, subject, hand, declared: hand !== null, classes, verdict, reason, paths, offending });
  }
  return { ok: true, base: baseSha, head: headSha, rows };
}
