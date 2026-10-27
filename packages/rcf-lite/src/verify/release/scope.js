// FBS-238 (US-20101, TAC-4157): the release scope resolver. A spec is in
// scope when it is inProgress, complete or verified and, in <since>..HEAD,
// one of its criteria's description, given, when or then changed, one of
// its criteria's test bindings changed, or its executionStatus moved to
// complete or verified. A change to a verification flag, a supersession
// field or the FBS record alone scopes nothing, and a notStarted spec is
// never in scope. Within scope each spec is classed: unflagged (any live
// criterion without a verification flag), testOnlyOnly (every live
// criterion testOnly), not complete (inProgress), else its live external
// criteria run their bound e2e tests.

import { execFileSync } from 'node:child_process';

import { recordSpawn } from '../../audit/separation.js';

const CHAIN_DIRS = ['rcf/user-stories', 'rcf/fbs', 'rcf/test-suites'];
const IN_SCOPE_STATUSES = new Set(['inProgress', 'complete', 'verified']);
const RUNNABLE_STATUSES = new Set(['complete', 'verified']);

/**
 * Run git in cwd through the spawn log seam; returns stdout.
 *
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
export function releaseGit(cwd, args) {
  recordSpawn('git', args);
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
}

// The JSON of a chain file at a commit, or null when it is absent there.
function jsonAt(cwd, rev, path) {
  try {
    return JSON.parse(releaseGit(cwd, ['show', `${rev}:./${path}`]));
  } catch {
    return null;
  }
}

const criterionText = (ac) => JSON.stringify([ac.description, ac.given, ac.when, ac.then]);

// acId -> sorted binding keys (suite, test level, test pointer) of one suite file.
function bindingsOf(ts, into) {
  for (const tc of ts?.testCases ?? []) {
    if (typeof tc?.acId !== 'string') continue;
    const list = into.get(tc.acId) ?? [];
    list.push(`${ts.id}|${ts.testLevel}|${tc.testPointer}`);
    into.set(tc.acId, list);
  }
}

/**
 * The criteria and specs <since>..HEAD changed, read from git: criteria
 * whose text or bindings changed, and specs whose executionStatus moved to
 * complete or verified.
 *
 * @param {object} p
 * @param {string} p.cwd - the project root
 * @param {string} p.since - full sha
 * @param {string} p.head - full sha
 * @returns {{ changedAcIds: Set<string>, movedFbsIds: Set<string> }}
 */
export function changedSince({ cwd, since, head }) {
  const files = releaseGit(cwd, ['diff', '--name-only', '--no-renames', '--relative', since, head, '--', ...CHAIN_DIRS])
    .split('\n').filter((f) => f.endsWith('.json'));
  const changedAcIds = new Set();
  const movedFbsIds = new Set();
  const oldBindings = new Map();
  const newBindings = new Map();
  for (const file of files) {
    const before = jsonAt(cwd, since, file);
    const after = jsonAt(cwd, head, file);
    if (file.startsWith('rcf/user-stories/')) {
      const old = new Map((before?.acceptanceCriteria ?? []).map((ac) => [ac.id, criterionText(ac)]));
      for (const ac of after?.acceptanceCriteria ?? []) {
        if (old.get(ac.id) !== criterionText(ac)) changedAcIds.add(ac.id);
      }
    } else if (file.startsWith('rcf/fbs/')) {
      const status = after?.executionStatus;
      if (after && before?.executionStatus !== status && RUNNABLE_STATUSES.has(status)) movedFbsIds.add(after.fbsId);
    } else {
      bindingsOf(before, oldBindings);
      bindingsOf(after, newBindings);
    }
  }
  for (const acId of new Set([...oldBindings.keys(), ...newBindings.keys()])) {
    const a = (oldBindings.get(acId) ?? []).sort().join('\n');
    const b = (newBindings.get(acId) ?? []).sort().join('\n');
    if (a !== b) changedAcIds.add(acId);
  }
  return { changedAcIds, movedFbsIds };
}

/**
 * Resolve the release scope over the chain tree and what changed.
 *
 * @param {object} p
 * @param {object} p.tree - walkTree output at the working tree
 * @param {Set<string>} p.changedAcIds
 * @param {Set<string>} p.movedFbsIds
 * @returns {{ fbsIds: string[], testOnlyOnly: string[], unflagged: string[], rows: Array<{ acId: string, fbsId: string, blocked: string|null, tests: Array<{ tsId: string, testPointer: string }> }> }}
 */
export function resolveReleaseScope({ tree, changedAcIds, movedFbsIds }) {
  const criteria = new Map();
  for (const us of tree.userStories ?? []) {
    for (const ac of us.acceptanceCriteria ?? []) criteria.set(ac.id, ac);
  }
  const e2e = new Map();
  for (const ts of tree.testSuites ?? []) {
    if (ts.testLevel !== 'e2e') continue;
    for (const tc of ts.testCases ?? []) {
      if (typeof tc?.testPointer !== 'string') continue;
      const list = e2e.get(tc.acId) ?? [];
      list.push({ tsId: ts.id, testPointer: tc.testPointer });
      e2e.set(tc.acId, list);
    }
  }
  const specs = [...(tree.fbsItems ?? [])]
    .filter((f) => IN_SCOPE_STATUSES.has(f.executionStatus))
    .filter((f) => movedFbsIds.has(f.fbsId) || (f.acIds ?? []).some((id) => changedAcIds.has(id)))
    .sort((a, b) => (a.buildOrder ?? 0) - (b.buildOrder ?? 0) || a.fbsId.localeCompare(b.fbsId));
  const out = { fbsIds: [], testOnlyOnly: [], unflagged: [], rows: [] };
  for (const spec of specs) {
    out.fbsIds.push(spec.fbsId);
    const live = (spec.acIds ?? []).map((id) => criteria.get(id)).filter((ac) => ac && !ac.supersededBy);
    const row = (ac, blocked) => ({ acId: ac.id, fbsId: spec.fbsId, blocked, tests: blocked ? [] : (e2e.get(ac.id) ?? []) });
    if (live.some((ac) => ac.verification === undefined)) {
      out.unflagged.push(spec.fbsId);
      for (const ac of live) out.rows.push(row(ac, 'unflagged criteria'));
      continue;
    }
    const external = live.filter((ac) => ac.verification === 'external');
    if (external.length === 0) {
      out.testOnlyOnly.push(spec.fbsId);
      continue;
    }
    for (const ac of external) {
      if (!RUNNABLE_STATUSES.has(spec.executionStatus)) out.rows.push(row(ac, 'spec not complete'));
      else if (!e2e.has(ac.id)) out.rows.push(row(ac, 'no bound e2e test'));
      else out.rows.push(row(ac, null));
    }
  }
  return out;
}
