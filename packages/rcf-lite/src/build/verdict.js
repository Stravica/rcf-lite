// `rcf build verdict review | test` core (FBS-234, US-19701, US-19702,
// TAC-4154, ADR-4154). Records a round's REVIEW and TEST verdicts as
// files under rcf/verdicts/<first 12 of the reviewed head>/, for the
// stage's own REVIEW: or TEST: commit to add:
//
//   review.json  ReviewVerdict v1, at the committed HEAD (the reviewed
//                head H)
//   test.json    TestVerdict v1, for the reviewed head H of the newest
//                review verdict reachable from HEAD; a FAIL recorded after
//                a PASS at H is keyed to HEAD instead (stage-keeper
//                ruling 3)
//
// Git-only reads through the separation audit's spawn seam (runGit), so
// RCF_SPAWN_LOG records every child and the only child is git. The
// writers never commit, never edit an existing verdict file, never run
// a suite, deploy or contact a host: the TEST verdict reads the TAP
// summary of a run the verifier made, and the bound tests of the touched
// criteria come from the chain.

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { CLASS_OWNERS, classifyPath, readObjects, runGit } from '../audit/separation.js';

const VERDICTS = 'rcf/verdicts';
const DIRTY = 'verdict refused: working tree is dirty; a verdict names a committed head';
const FINDING = /^(spec|build):(-|AC-\d+-\d+):(.+)$/s;
const FINALISE_CLASSES = new Set(Object.entries(CLASS_OWNERS).filter(([, owners]) => owners.includes('FINALISE')).map(([cls]) => cls));

const s7 = (sha) => String(sha ?? '').slice(0, 7);
const s12 = (sha) => String(sha ?? '').slice(0, 12);

/** rcf/verdicts/<h12>/<file>, relative to the project root. */
export function verdictFile(head, file) {
  return `${VERDICTS}/${s12(head)}/${file}`;
}

/**
 * Parse one --finding value, "<spec|build>:<AC id|->:<text>", into a
 * finding with its F-<n> id; null when it does not match the form.
 *
 * @param {string} text
 * @param {number} n - 1-based position among the --finding values
 * @returns {{ id: string, locus: string, acId: string|null, text: string }|null}
 */
export function parseFinding(text, n) {
  const m = FINDING.exec(text);
  if (!m || m[3].trim() === '') return null;
  return { id: `F-${n}`, locus: m[1], acId: m[2] === '-' ? null : m[2], text: m[3] };
}

/**
 * The summary block node --test prints at the end of a TAP run: the last
 * "# pass <n>", "# fail <n>", "# skipped <n>", "# todo <n>" and
 * "# cancelled <n>" lines at column 0. Null when there is no "# pass" or
 * no "# fail" line.
 *
 * @param {string} text
 * @returns {{ pass: number, fail: number, skip: number, todo: number, cancelled: number }|null}
 */
export function parseTapSummary(text) {
  const found = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^# (pass|fail|skipped|todo|cancelled) (\d+)\s*$/.exec(line);
    if (m) found[m[1]] = Number(m[2]);
  }
  if (found.pass === undefined || found.fail === undefined) return null;
  return { pass: found.pass, fail: found.fail, skip: found.skipped ?? 0, todo: found.todo ?? 0, cancelled: found.cancelled ?? 0 };
}

/**
 * The names of every test point ("ok <n> - <name>" or "not ok <n> -
 * <name>", subtests included) in a TAP text, with the directive cut off
 * and node's TAP escapes (\# and \\) undone.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
export function tapTestNames(text) {
  const names = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:not )?ok \d+ - (.*)$/.exec(line);
    if (!m) continue;
    // A directive starts at the first unescaped " # ".
    const raw = m[1].replace(/(?<!\\) # (?:SKIP|TODO)\b.*$/i, '');
    names.add(raw.replace(/\\([\\#])/g, '$1'));
  }
  return names;
}

/** True for a path inside rcf/verdicts/ or rcf/verify-reports/ at any depth. */
function verdictOrEvidence(path) {
  const segs = path.split('/');
  const at = segs.indexOf('rcf');
  return at !== -1 && (segs[at + 1] === 'verdicts' || segs[at + 1] === 'verify-reports') && segs.length > at + 2;
}

/**
 * The working tree's state through git: null when the cwd is not in a
 * git repository, else { head, dirty } where dirty is true for any
 * change (untracked files included) outside rcf/verdicts/.
 */
async function treeState(git) {
  const status = await git(['status', '--porcelain', '-z', '--untracked-files=all']);
  if (status.code !== 0) return null;
  const entries = status.stdout.split('\0');
  let dirty = false;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    // A rename or copy carries its old path as the next entry.
    if (entry[0] === 'R' || entry[0] === 'C') i += 1;
    const segs = entry.slice(3).split('/');
    const at = segs.indexOf('rcf');
    if (!(at !== -1 && segs[at + 1] === 'verdicts')) dirty = true;
  }
  const head = await git(['rev-parse', 'HEAD']);
  if (head.code !== 0) return null;
  return { head: head.stdout.trim(), dirty };
}

/** The chain's FBS records and live criteria, for reference checks. */
function chainIndex(tree) {
  const fbsById = new Map((tree.fbsItems ?? []).map((f) => [f.fbsId, f]));
  const retired = new Set();
  for (const us of tree.userStories ?? []) {
    for (const ac of us.acceptanceCriteria ?? []) {
      if (ac?.id && ac.supersededBy) retired.add(ac.id);
    }
  }
  return { fbsById, retired };
}

/** Lines for --fbs ids the chain does not hold, empty when all resolve. */
function unknownFbs(fbsIds, fbsById) {
  return fbsIds.filter((id) => !fbsById.has(id)).map((id) => `[error] brokenReference ${id} is not an FBS in the chain`);
}

function writeVerdict(projectRoot, rel, doc) {
  const abs = join(projectRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(doc, null, 2)}\n`);
}

/**
 * Record the REVIEW verdict for the committed HEAD (rcf build verdict
 * review). Exit 0 written; 3 a broken reference (an unknown FBS, a
 * criterion no named FBS scopes, or, for a spec at inProgress, touched
 * criteria that omit a live criterion of it); 4 refused (a dirty tree,
 * or a review verdict for HEAD already present).
 *
 * @param {{ projectRoot: string, tree: object, fbsIds: string[], acIds: string[], code: string, adequacy: string,
 *   findings: object[], by?: string, deps?: object }} opts
 * @returns {Promise<{ code: number, out: string|null, err: string[] }>}
 */
export async function recordReviewVerdict({ projectRoot, tree, fbsIds, acIds, code, adequacy, findings, by = 'reviewer', deps = {} }) {
  const { fbsById, retired } = chainIndex(tree);
  const missing = unknownFbs(fbsIds, fbsById);
  if (missing.length) return { code: 3, out: null, err: missing };
  const scoped = new Set(fbsIds.flatMap((id) => fbsById.get(id).acIds ?? []));
  const unscoped = acIds.filter((id) => !scoped.has(id));
  if (unscoped.length) {
    return { code: 3, out: null, err: unscoped.map((id) => `[error] brokenReference ${id} is not scoped by ${fbsIds.join(',')}`) };
  }
  // A spec still in its build round: the verdict touches every live
  // criterion it scopes. At complete, a subset is an amend round.
  const omits = [];
  for (const id of fbsIds) {
    const fbs = fbsById.get(id);
    if (fbs.executionStatus !== 'inProgress') continue;
    const left = (fbs.acIds ?? []).filter((ac) => !retired.has(ac) && !acIds.includes(ac));
    if (left.length) omits.push(`[error] brokenReference touched criteria omit ${left.join(',')} of ${id} (inProgress)`);
  }
  if (omits.length) return { code: 3, out: null, err: omits };

  const git = (args) => runGit(args, { cwd: projectRoot, deps });
  const state = await treeState(git);
  if (!state) return { code: 4, out: null, err: ['verdict refused: not a git repository; a verdict names a committed head'] };
  if (state.dirty) return { code: 4, out: null, err: [DIRTY] };
  const rel = verdictFile(state.head, 'review.json');
  if (existsSync(join(projectRoot, rel))) {
    return { code: 4, out: null, err: [`verdict refused: a review verdict for ${s7(state.head)} already exists at ${rel}`] };
  }
  writeVerdict(projectRoot, rel, {
    verdictVersion: 1,
    stage: 'review',
    head: state.head,
    fbsIds,
    touchedAcIds: acIds,
    code,
    adequacy,
    findings,
    recordedBy: by,
    recordedAt: new Date().toISOString(),
  });
  return { code: 0, out: `verdict: review ${code}/${adequacy} at ${s7(state.head)} written to ${rel}`, err: [] };
}

/**
 * The newest review verdict reachable from HEAD whose fbsIds include
 * every id in fbsIds: the commits adding rcf/verdicts/<h12>/review.json,
 * newest first (git log --topo-order), each file read at HEAD. Two git
 * processes. Null when there is none.
 */
async function newestReview(git, fbsIds) {
  const log = await git(['log', '--topo-order', '--relative', '--diff-filter=A', '--name-only', '--format=', 'HEAD', '--', `${VERDICTS}/`]);
  if (log.code !== 0) return null;
  const paths = [...new Set(log.stdout.split('\n').filter((p) => /^rcf\/verdicts\/[0-9a-f]{12}\/review\.json$/.test(p)))];
  if (!paths.length) return null;
  for (const blob of await readObjects(git, paths.map((p) => `HEAD:./${p}`))) {
    if (blob.missing) continue;
    let doc;
    try { doc = JSON.parse(blob.text); } catch { continue; }
    if (!doc || !Array.isArray(doc.fbsIds) || typeof doc.head !== 'string') continue;
    if (fbsIds.every((id) => doc.fbsIds.includes(id))) return doc;
  }
  return null;
}

/** The parsed JSON at an absolute path, or null when absent or unparsable. */
function readVerdict(abs) {
  if (!existsSync(abs)) return null;
  try { return JSON.parse(readFileSync(abs, 'utf8')); } catch { return null; }
}

/**
 * Record the TEST verdict (rcf build verdict test) for the reviewed head
 * H of the newest review verdict reachable from HEAD that names the
 * --fbs ids. Exit 0 written; 2 usage (an unreadable --tap file, no TAP
 * summary, FAIL with 0 failing and no --reason, --fbs not equal to the
 * review verdict's fbsIds as a set); 3 an unknown FBS; 4 refused (a dirty
 * tree, a test verdict already present, and for PASS: no REVIEW
 * MERGE/PASS for H, a change after H outside rcf/verdicts/,
 * rcf/verify-reports/ and FINALISE classes, failing tests, a bound test
 * of a touched criterion missing from the TAP, or a failing test-strength
 * record at H).
 *
 * @param {{ projectRoot: string, tree: object, fbsIds: string[], result: string, tapFile: string, runtime: string,
 *   reason?: string|null, by?: string, deps?: object }} opts
 * @returns {Promise<{ code: number, out: string|null, err: string[] }>}
 */
export async function recordTestVerdict({ projectRoot, tree, fbsIds, result, tapFile, runtime, reason = null, by = 'verifier', deps = {} }) {
  let tap;
  try {
    tap = readFileSync(tapFile, 'utf8');
  } catch {
    return { code: 2, out: null, err: [`[error] usage --tap ${tapFile} cannot be read`] };
  }
  const suite = parseTapSummary(tap);
  if (!suite) return { code: 2, out: null, err: [`[error] usage --tap ${tapFile} carries no TAP summary`] };
  const failing = suite.fail + suite.cancelled;
  if (result === 'FAIL' && failing === 0 && !reason) {
    return { code: 2, out: null, err: ['[error] usage --result FAIL over a TAP summary with 0 failing needs --reason'] };
  }
  const { fbsById } = chainIndex(tree);
  const missing = unknownFbs(fbsIds, fbsById);
  if (missing.length) return { code: 3, out: null, err: missing };

  const git = (args, input = null) => runGit(args, { cwd: projectRoot, deps, input });
  const state = await treeState(git);
  if (!state) return { code: 4, out: null, err: ['verdict refused: not a git repository; a verdict names a committed head'] };
  if (state.dirty) return { code: 4, out: null, err: [DIRTY] };

  const review = await newestReview(git, fbsIds);
  if (review) {
    const same = review.fbsIds.length === new Set(fbsIds).size && fbsIds.every((id) => review.fbsIds.includes(id));
    if (!same) {
      return { code: 2, out: null, err: [`[error] usage --fbs ${fbsIds.join(',')} differs from the REVIEW verdict's fbsIds ${review.fbsIds.join(',')}`] };
    }
  }
  const H = review ? review.head : state.head;

  // One test verdict per head. A FAIL after a PASS at H is keyed to HEAD
  // (stage-keeper ruling 3), so the PASS at H stays byte-identical.
  let target = H;
  const atH = verdictFile(H, 'test.json');
  if (existsSync(join(projectRoot, atH))) {
    const prior = readVerdict(join(projectRoot, atH));
    if (result === 'FAIL' && prior?.result === 'PASS' && state.head !== H) {
      target = state.head;
    } else {
      return { code: 4, out: null, err: [`verdict refused: a test verdict for ${s7(H)} already exists at ${atH}`] };
    }
  }
  const rel = verdictFile(target, 'test.json');
  if (target !== H && existsSync(join(projectRoot, rel))) {
    return { code: 4, out: null, err: [`verdict refused: a test verdict for ${s7(target)} already exists at ${rel}`] };
  }

  if (result === 'PASS') {
    const refuse = (line) => ({ code: 4, out: null, err: [`verdict refused: ${line}`] });
    if (!review || review.code !== 'MERGE' || review.adequacy !== 'PASS') {
      return refuse(`no REVIEW MERGE with adequacy PASS recorded for ${s7(H)}`);
    }
    if (state.head !== H) {
      const diff = await git(['diff', '--name-only', '-z', '--no-renames', H, state.head]);
      const changed = diff.code === 0 ? diff.stdout.split('\0').filter(Boolean) : null;
      if (!changed || changed.some((p) => !verdictOrEvidence(p) && !FINALISE_CLASSES.has(classifyPath(p)))) {
        return refuse(`HEAD differs from the reviewed head ${s7(H)} outside rcf/verdicts/, rcf/verify-reports/ and FINALISE classes`);
      }
    }
    if (failing > 0) return refuse(`the TAP summary reports ${failing} failing; record --result FAIL`);
    const names = tapTestNames(tap);
    for (const acId of review.touchedAcIds ?? []) {
      for (const { tsId, tcId } of tree.tcsByAcId?.get(acId) ?? []) {
        const tc = (tree.byId.get(tsId)?.testCases ?? []).find((c) => c?.id === tcId);
        const pointer = typeof tc?.testPointer === 'string' ? tc.testPointer : null;
        const sep = pointer ? pointer.indexOf('::') : -1;
        if (sep < 0) continue;
        if (!names.has(pointer.slice(sep + 2))) return refuse(`the TAP summary does not include bound test ${pointer} of ${acId}`);
      }
    }
    const strength = readVerdict(join(projectRoot, verdictFile(H, 'test-strength.json')));
    if (strength?.result === 'fail') {
      const ids = (strength.criteria ?? []).filter((c) => c?.result === 'fail').map((c) => c.acId);
      return refuse(`test-strength at ${s7(H)} fails for ${ids.join(',')}; record --result FAIL`);
    }
  }

  writeVerdict(projectRoot, rel, {
    verdictVersion: 1,
    stage: 'test',
    head: target,
    fbsIds: review ? review.fbsIds : fbsIds,
    result,
    suite: { pass: suite.pass, fail: suite.fail, skip: suite.skip, todo: suite.todo, cancelled: suite.cancelled },
    runtime,
    node: process.version,
    reason: reason ?? null,
    recordedBy: by,
    recordedAt: new Date().toISOString(),
  });
  const tally = `${suite.pass} pass, ${suite.fail} fail, ${suite.skip} skip, ${suite.todo} todo`;
  return { code: 0, out: `verdict: test ${result} at ${s7(target)} (${tally}) written to ${rel}`, err: [] };
}
