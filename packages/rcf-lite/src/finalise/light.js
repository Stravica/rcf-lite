// Light Finalise (FBS-237, US-20001 to US-20003, TAC-4156, ADR-4157).
// Finalise ends the build cycle at complete: it reads the last round's
// recorded REVIEW, TEST and test-strength verdicts from rcf/verdicts/
// through git, checks them in the interface's order, and plans the
// write. It never reads rcf/verify-reports/, never writes verified, and
// spawns nothing but git: every read goes through the separation audit's
// spawn seam (runGit), and the separation judgement runs in-process.
//
// Check order (TAC-4156), each refusal { code, line }: a ReviewVerdict
// for the spec, REVIEW passed at H, the spec not notStarted, nothing
// after H but the REVIEW: commit adding the verdict for H and TEST: or
// FINALISE: commits, TEST PASS at H and no FAIL TestVerdict after it, a
// green --merge-suite record at the newest FINALISE: merge head after H,
// test strength at H for every touched criterion, touched criteria
// covering every criterion changed since the base (and every live
// criterion of a spec at inProgress), Code Nodes for every touched
// criterion, then the separation audit over the range.

import { readFileSync } from 'node:fs';

import { auditSeparation, parsePrefix, readObjects, runGit } from '../audit/separation.js';
import { hasNoCodeNodesDeclaration } from '../build/mark.js';

const VERDICT_PATH = /^rcf\/verdicts\/[0-9a-f]{12}\/(review|test)\.json$/;
const BASE_REFS = ['origin/main', 'main'];

const s7 = (sha) => String(sha ?? '').slice(0, 7);
const s12 = (sha) => String(sha ?? '').slice(0, 12);
const verdictAt = (head, file) => `rcf/verdicts/${s12(head)}/${file}`;
const fbsPath = (fbsId) => `rcf/fbs/${fbsId.toLowerCase()}.json`;
const refuse = (code, line) => ({ ok: false, code, line });

function parse(blob) {
  if (!blob || blob.missing) return null;
  try { return JSON.parse(blob.text); } catch { return null; }
}

/**
 * The newest ReviewVerdict reachable from HEAD whose fbsIds include the
 * spec: the commits adding rcf/verdicts/<h12>/review.json, newest first
 * (git log --topo-order), each file read at HEAD. Null when none.
 *
 * @param {Function} git
 * @param {string} fbsId
 * @returns {Promise<object|null>}
 */
export async function newestReviewFor(git, fbsId) {
  const log = await git(['log', '--topo-order', '--relative', '--diff-filter=A', '--name-only', '--format=', 'HEAD', '--', 'rcf/verdicts/']);
  if (log.code !== 0) return null;
  const paths = [...new Set(log.stdout.split('\n').filter((p) => /^rcf\/verdicts\/[0-9a-f]{12}\/review\.json$/.test(p)))];
  if (!paths.length) return null;
  for (const blob of await readObjects(git, paths.map((p) => `HEAD:./${p}`))) {
    const doc = parse(blob);
    if (!doc || !Array.isArray(doc.fbsIds) || typeof doc.head !== 'string') continue;
    if (doc.fbsIds.includes(fbsId)) return doc;
  }
  return null;
}

/**
 * The commits after the reviewed head H on the first-parent line to
 * HEAD, oldest first: { sha, merge, stage, subject, added } with added
 * the verdict files the commit adds, relative to the project root.
 *
 * @param {Function} git
 * @param {string} H
 */
async function commitsAfter(git, H) {
  const log = await git(['log', '--first-parent', '--reverse', '--relative', '--no-renames', '--name-status', '--format=%x00%H%x1f%P%x1f%s%x1f', `${H}..HEAD`]);
  if (log.code !== 0) return null;
  return log.stdout.split('\0').slice(1).map((record) => {
    const [sha, parents, subject, rest = ''] = record.split('\x1f');
    const added = rest.split('\n').filter((l) => l.startsWith('A\t')).map((l) => l.slice(2)).filter((p) => VERDICT_PATH.test(p));
    return { sha, merge: parents.split(' ').filter(Boolean).length > 1, stage: parsePrefix(subject).stage, subject, added };
  });
}

/**
 * The commits after H: refuse a commit other than the REVIEW: commit
 * adding the verdict for H and TEST: or FINALISE: commits (AC-20001-4),
 * and return the test.json files they add and the newest merge head.
 */
function judgeAfterReview(after, H) {
  const reviewFile = verdictAt(H, 'review.json');
  for (const c of after) {
    const allowed = c.stage === 'TEST' || c.stage === 'FINALISE' || (c.stage === 'REVIEW' && c.added.includes(reviewFile));
    if (!allowed) {
      return refuse(4, `finalise refused: REVIEW reopened by ${s7(c.sha)} ${c.stage ? `${c.stage}:` : c.subject} after the reviewed head ${s7(H)}`);
    }
  }
  const merges = after.filter((c) => c.merge);
  return {
    ok: true,
    testFiles: after.filter((c) => c.stage === 'TEST').flatMap((c) => c.added.filter((p) => p.endsWith('/test.json'))),
    mergeHead: merges.length ? merges[merges.length - 1].sha : null,
  };
}

/**
 * TEST PASS at H and no FAIL TestVerdict after it (AC-20001-3), from the
 * test.json at H and those the TEST: commits after H add, read at HEAD.
 */
async function judgeTest(git, H, testFiles) {
  const later = testFiles.filter((p) => p !== verdictAt(H, 'test.json'));
  const [atH, ...rest] = await readObjects(git, [`HEAD:./${verdictAt(H, 'test.json')}`, ...later.map((p) => `HEAD:./${p}`)]);
  const test = parse(atH);
  if (!test) return refuse(4, `finalise refused: no TEST verdict at ${s7(H)}`);
  if (test.result !== 'PASS') return refuse(4, `finalise refused: TEST at ${s7(H)} is ${test.result}`);
  for (const doc of rest.map(parse)) {
    if (doc?.result === 'FAIL') return refuse(4, `finalise refused: TEST at ${s7(doc.head)} is FAIL; a failed verdict closes the round`);
  }
  return { ok: true };
}

/**
 * With a FINALISE: merge after H, a green BaseSuiteRecord at the newest
 * merge head M is the suite evidence (AC-20001-6, AC-20001-8).
 */
function judgeMergeSuite(M, mergeSuite) {
  if (!M) return { ok: true, info: null };
  if (mergeSuite === undefined) {
    return refuse(4, `finalise refused: merge from main after the reviewed head; pass --merge-suite <a green base-suite record at ${s7(M)}>`);
  }
  let record;
  try {
    record = JSON.parse(readFileSync(mergeSuite, 'utf8'));
  } catch {
    return refuse(2, `[error] usage --merge-suite ${mergeSuite} cannot be read as a base-suite record`);
  }
  if (record?.head !== M) return refuse(4, `finalise refused: base suite recorded at ${s7(record?.head)}, merge head is ${s7(M)}`);
  if (record.green !== true) return refuse(4, `finalise refused: base suite red at ${s7(M)}; the verifier records TEST FAIL at the merge head`);
  return { ok: true, info: M };
}

/**
 * Test strength at H for every touched criterion (AC-20002-1).
 */
async function judgeTestStrength(git, H, touched) {
  const [blob] = await readObjects(git, [`HEAD:./${verdictAt(H, 'test-strength.json')}`]);
  const record = parse(blob);
  if (!record) return refuse(4, `finalise refused: no test-strength record at ${s7(H)}`);
  const byAc = new Map((record.criteria ?? []).map((c) => [c?.acId, c]));
  const fails = touched.filter((id) => byAc.has(id) && byAc.get(id)?.result !== 'pass');
  if (fails.length) return refuse(4, `finalise refused: test-strength at ${s7(H)} fails for ${fails.join(', ')}`);
  const omits = touched.filter((id) => !byAc.has(id));
  if (omits.length) return refuse(4, `finalise refused: test-strength at ${s7(H)} omits ${omits.join(', ')}`);
  return { ok: true };
}

/**
 * The criteria of `acIds` whose record or bound test cases differ
 * between the base and H: each criterion of rcf/user-stories/ and the
 * test cases rcf/test-suites/ bind to it, compared through git show.
 *
 * @param {Function} git
 * @param {string} base
 * @param {string} H
 * @param {string[]} acIds
 * @returns {Promise<string[]|null>}
 */
export async function changedCriteria(git, base, H, acIds) {
  const diff = await git(['diff', '--name-only', '--relative', '--no-renames', base, H, '--', 'rcf/user-stories/', 'rcf/test-suites/']);
  if (diff.code !== 0) return null;
  const paths = diff.stdout.split('\n').filter((p) => p.endsWith('.json'));
  if (!paths.length) return [];
  const blobs = await readObjects(git, paths.flatMap((p) => [`${base}:./${p}`, `${H}:./${p}`]));
  const side = () => new Map();
  const [before, after] = [side(), side()];
  const add = (map, id, value) => map.set(id, [...(map.get(id) ?? []), value]);
  paths.forEach((p, i) => {
    [before, after].forEach((map, k) => {
      const doc = parse(blobs[2 * i + k]);
      if (!doc) return;
      for (const ac of doc.acceptanceCriteria ?? []) if (ac?.id) add(map, ac.id, JSON.stringify(ac));
      for (const tc of doc.testCases ?? []) if (tc?.acId) add(map, tc.acId, `${p}:${JSON.stringify(tc)}`);
    });
  });
  const key = (map, id) => JSON.stringify((map.get(id) ?? []).sort());
  return acIds.filter((id) => key(before, id) !== key(after, id));
}

/** The merge-base of HEAD with the first of origin/main and main that resolves. */
async function resolveBase(git) {
  for (const ref of BASE_REFS) {
    const mb = await git(['merge-base', ref, 'HEAD']);
    if (mb.code === 0 && mb.stdout.trim()) return mb.stdout.trim();
  }
  return null;
}

/**
 * Judge the last round for one spec and plan the outcome. Returns a
 * refusal { ok: false, code, line } or { ok: true, write, out, info }:
 * write is the status to write (complete) or null for no write, out the
 * stdout line, info an optional [info] line.
 *
 * @param {{ projectRoot: string, tree: object, fbsId: string, ciRun: string, mergeSuite?: string, deps?: object }} opts
 */
export async function judgeFinalise({ projectRoot, tree, fbsId, ciRun, mergeSuite, deps = {} }) {
  const git = (args, input = null) => runGit(args, { cwd: projectRoot, deps, input });
  const fbs = tree.byId.get(fbsId);

  const review = await newestReviewFor(git, fbsId);
  if (!review) return refuse(4, `finalise refused: no REVIEW verdict for ${fbsId} on the branch`);
  const H = review.head;
  if (review.code !== 'MERGE' || review.adequacy !== 'PASS') {
    return refuse(4, `finalise refused: REVIEW at ${s7(H)} is ${review.code}/${review.adequacy}; a failed verdict closes the round`);
  }
  if (fbs.executionStatus === 'notStarted') {
    return refuse(4, `finalise refused: ${fbsId} is notStarted; the round's DEFINE: marks it inProgress`);
  }

  const after = await commitsAfter(git, H);
  if (!after) return refuse(4, `finalise refused: the reviewed head ${s7(H)} is not on the branch`);
  const round = judgeAfterReview(after, H);
  if (!round.ok) return round;
  const test = await judgeTest(git, H, round.testFiles);
  if (!test.ok) return test;
  const merge = judgeMergeSuite(round.mergeHead, mergeSuite);
  if (!merge.ok) return merge;

  const scoped = new Set(fbs.acIds ?? []);
  const touched = (review.touchedAcIds ?? []).filter((id) => scoped.has(id));
  const strength = await judgeTestStrength(git, H, touched);
  if (!strength.ok) return strength;

  const base = await resolveBase(git);
  if (!base) return refuse(4, `finalise refused: no merge-base with ${BASE_REFS.join(' or ')}`);
  const retired = new Set((tree.userStories ?? []).flatMap((us) => (us.acceptanceCriteria ?? []).filter((a) => a?.supersededBy).map((a) => a.id)));
  const live = (fbs.acIds ?? []).filter((id) => !retired.has(id));
  const changed = await changedCriteria(git, base, H, live);
  if (!changed) return refuse(4, `finalise refused: cannot compare the criteria at ${s7(base)} and ${s7(H)}`);
  const unchangedOmits = changed.filter((id) => !touched.includes(id));
  if (unchangedOmits.length) return refuse(4, `finalise refused: touched criteria omit ${unchangedOmits.join(', ')} changed since ${s7(base)}`);
  const [atH] = await readObjects(git, [`${H}:./${fbsPath(fbsId)}`]);
  const statusAtH = parse(atH)?.executionStatus ?? null;
  if (statusAtH === 'inProgress') {
    const left = live.filter((id) => !touched.includes(id));
    if (left.length) return refuse(4, `finalise refused: touched criteria omit ${left.join(', ')} of ${fbsId} (inProgress)`);
  }

  const missing = missingCodeNodes(tree, fbs, touched);
  if (missing.length) return refuse(3, `finalise refused: missing Code Node for ${missing.join(', ')}`);

  const sep = await auditSeparation({ cwd: projectRoot, base, deps });
  if (!sep.ok) return refuse(4, `finalise refused: separation FAIL: ${sep.error}${sep.ref ? ` ${sep.ref}` : ''}${sep.detail ? ` ${sep.detail}` : ''}`);
  const items = sep.rows.filter((r) => r.verdict === 'fail').flatMap((r) => r.items.map((item) => `${s7(r.sha)} ${item}`));
  if (items.length) return refuse(4, `finalise refused: separation FAIL: ${items.join('; ')}`);

  return planOutcome({ tree, fbs, touched, statusAtH, H, ciRun, mergeHead: merge.info, head: sep.head });
}

/**
 * Touched criteria with no Code Node (AC-20002-3, slice scope); none
 * when the spec carries the noCodeNodes declaration (RC-36).
 *
 * @param {object} tree
 * @param {object} fbs
 * @param {string[]} touched
 * @returns {string[]}
 */
export function missingCodeNodes(tree, fbs, touched) {
  if (hasNoCodeNodesDeclaration(fbs)) return [];
  return touched.filter((id) => (tree.cnByAcId?.get(id) ?? []).length === 0).sort();
}

/**
 * The outcome once every check holds: complete written from inProgress
 * or verified (an external criterion touched), complete (unchanged) when
 * this round already wrote it, the complete line with no write in an
 * amend round at complete, and verified kept when every touched
 * criterion is testOnly (AC-20003-4). Never verified written.
 */
function planOutcome({ tree, fbs, touched, statusAtH, H, ciRun, mergeHead, head }) {
  const fbsId = fbs.fbsId;
  const verification = new Map((tree.userStories ?? []).flatMap((us) => (us.acceptanceCriteria ?? []).map((a) => [a.id, a.verification])));
  const status = fbs.executionStatus;
  const info = mergeHead
    ? `[info] finalise: merge from main after the reviewed head; base suite green at ${s7(mergeHead)} is the suite evidence, ci ${ciRun} on ${s7(head)}`
    : null;
  const line = `finalise: ${fbsId} complete at ${s7(head)} (reviewed ${s7(H)}, ci ${ciRun}, touched ${touched.length} criteria)`;
  if (status === 'verified' && touched.length > 0 && touched.every((id) => verification.get(id) === 'testOnly')) {
    return { ok: true, write: null, out: `finalise: ${fbsId} verified (unchanged: touched criteria are testOnly)`, info };
  }
  if (status === 'complete' && statusAtH !== 'complete' && statusAtH !== 'verified') {
    return { ok: true, write: null, out: `finalise: ${fbsId} complete (unchanged)`, info };
  }
  return { ok: true, write: status === 'complete' ? null : 'complete', out: line, info };
}
