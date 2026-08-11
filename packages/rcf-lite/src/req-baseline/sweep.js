// Baseline-AC sweep planner + applier (spec §5.3, §5.4).
//
// The "open sweep candidate" property is DERIVED from the tree, not
// persisted: a candidate is open exactly when the parent REQ carries a
// shape, the baselineKey is not present as an AC on the US, and no
// baselineAcOptOuts record covers it. See open-candidates.js. This module
// walks the tree via that derivation, presents the candidates for
// operator resolution, and materialises the two durable outcomes:
// accepted keys become ACs (authoredBy: baseline), opted-out keys become
// baselineAcOptOuts entries. Skipping (or being silent) simply leaves
// the derived-open state as-is; the Stage-1 gate (gate.js) refuses build
// on any FBS binding an AC on a US that still derives an open key.
//
// Moment-4 non-interactive create (spec §5.3 moment 4): a US created
// under a classified REQ does not need any explicit auto-enqueue write
// because the derivation catches unresolved keys directly. The Stage-1
// gate remains the single unbypassable refusal surface.

import { updateDocument } from '#core/store';
import {
  BASELINE_SHAPE_KEYS,
  getBaselineSet,
} from '#core/baseline-catalog';

import { writeOptOut } from './opt-out.js';
import { openCandidatesForUs } from './open-candidates.js';

/**
 * Plan the baseline sweep across the tree.
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @param {object} opts
 * @param {string|null} [opts.reqId]
 * @param {boolean} [opts.all]
 * @returns {{ candidates: Array<{ usId: string, reqId: string, baselineKey: string, reqShape: string, canonicalText: string }> }}
 */
export function planSweep(tree, opts = {}) {
  const { reqId = null, all = false } = opts;

  /** @type {Array<{ usId: string, reqId: string, baselineKey: string, reqShape: string, canonicalText: string }>} */
  const candidates = [];

  for (const [id, kind] of tree.kindById) {
    if (kind !== 'userStory') continue;
    const us = tree.byId.get(id);
    if (!us) continue;
    if (!all && reqId && us.reqId !== reqId) continue;
    if (!all && !reqId) continue;
    for (const c of openCandidatesForUs(tree, us)) {
      candidates.push(c);
    }
  }
  return { candidates };
}

/**
 * Apply a batch of decisions.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('#core/store/walker.js').TreeModel} args.tree
 * @param {Array<{ candidate: object, action: 'accept'|'opt-out'|'skip', reason?: string }>} args.decisions
 * @param {Date} [args.now]
 * @returns {Promise<{ accepted: number, optedOut: number, left: number, optOutIds: string[], writtenAcIds: string[] } | import('#core/errors').RcfError>}
 */
export async function applySweepDecisions({ projectRoot, tree, decisions, now = new Date() }) {
  let accepted = 0;
  let optedOut = 0;
  let left = 0;
  /** @type {string[]} */
  const optOutIds = [];
  /** @type {string[]} */
  const writtenAcIds = [];

  // Group by US so each US gets one write.
  const byUs = new Map();
  for (const d of decisions) {
    const usId = d.candidate.usId;
    if (!byUs.has(usId)) byUs.set(usId, []);
    byUs.get(usId).push(d);
  }

  /** @type {Array<{ reqId: string, baselineKey: string, reason: string }>} */
  const pendingOptOuts = [];

  for (const [usId, list] of byUs) {
    const usDoc = tree.byId.get(usId);
    if (!usDoc) continue;

    const acsToAppend = [];
    for (const d of list) {
      if (d.action === 'accept') {
        const ac = composeBaselineAc({ usDoc, candidate: d.candidate, now });
        acsToAppend.push(ac);
        writtenAcIds.push(ac.id);
        accepted += 1;
      } else if (d.action === 'opt-out') {
        pendingOptOuts.push({ reqId: d.candidate.reqId, baselineKey: d.candidate.baselineKey, reason: d.reason ?? '' });
        optedOut += 1;
      } else {
        left += 1;
      }
    }

    if (acsToAppend.length === 0) continue;

    const nextAcs = [
      ...(Array.isArray(usDoc.acceptanceCriteria) ? usDoc.acceptanceCriteria : []),
      ...acsToAppend,
    ];

    const result = await updateDocument({
      projectRoot,
      tree,
      id: usId,
      patch: { acceptanceCriteria: nextAcs },
      sets: [],
      options: {},
      walkErrors: [],
    });
    if (result && result.kind && typeof result.message === 'string') return result;
  }

  for (const p of pendingOptOuts) {
    const out = await writeOptOut({
      projectRoot,
      tree,
      reqId: p.reqId,
      baselineKey: p.baselineKey,
      reason: p.reason,
      scope: 'req',
      now,
    });
    if (out && out.kind && typeof out.message === 'string') return out;
    optOutIds.push(out.id);
  }

  return { accepted, optedOut, left, optOutIds, writtenAcIds };
}

/**
 * Moment-4 auto-enqueue is a no-op today: the openness of a candidate is
 * derived by open-candidates.js from the tree state (shape-classified
 * REQ, no matching AC, no matching opt-out). A fresh US under a
 * classified REQ therefore surfaces every unresolved baseline key as
 * OPEN automatically, without a separate queue-write. The Stage-1 gate
 * (gate.js) reads the same derivation and refuses build accordingly.
 *
 * Kept exported so the create/us hook has a stable seam name and can
 * grow a queue-write in a future schemas release when a persistent
 * open-queue field lands on user-story.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('#core/store/walker.js').TreeModel} args.tree
 * @param {string} args.usId
 * @returns {Promise<{ enqueued: string[] }>}
 */
export async function applyPendingBaselinesForUs({ tree, usId }) {
  const usDoc = tree.byId.get(usId);
  if (!usDoc) return { enqueued: [] };
  const open = openCandidatesForUs(tree, usDoc);
  return { enqueued: open.map((c) => c.baselineKey) };
}

/**
 * Compose an AC to inject for a baseline candidate.
 *
 * @param {object} args
 * @param {object} args.usDoc
 * @param {{ baselineKey: string, reqShape: string, canonicalText: string, given?: string, when?: string, then?: string }} args.candidate
 * @param {Date} args.now
 * @returns {object}
 */
export function composeBaselineAc({ usDoc, candidate, now }) {
  const isoNow = now.toISOString();
  const id = nextAcId(usDoc);
  const canonicalText = candidate.canonicalText;
  const gwt = candidate.given || candidate.when || candidate.then
    ? { given: candidate.given ?? '', when: candidate.when ?? '', then: candidate.then ?? '' }
    : extractGwt(canonicalText);
  const ac = {
    id,
    description: canonicalText,
    testable: true,
    provenance: {
      authoredBy: 'baseline',
      baselineKey: candidate.baselineKey,
      injectedAt: isoNow,
      sourceReqShape: candidate.reqShape,
      acceptedByOperatorAt: isoNow,
    },
  };
  if (gwt.given) ac.given = gwt.given;
  if (gwt.when) ac.when = gwt.when;
  if (gwt.then) ac.then = gwt.then;
  return ac;
}

const AC_HIER_ID_RE = /^AC-(\d{3,})-(\d+)$/;

function nextAcId(usDoc) {
  const acs = Array.isArray(usDoc.acceptanceCriteria) ? usDoc.acceptanceCriteria : [];
  // Prefer hierarchical form matching the US id, e.g. US-201 → AC-201-1.
  const usNum = (usDoc.usId ?? '').match(/^US-(\d+)$/)?.[1];
  let maxN = 0;
  for (const ac of acs) {
    const m = (ac?.id ?? '').match(AC_HIER_ID_RE);
    if (!m) continue;
    const [, hier, tail] = m;
    if (usNum && hier !== usNum) continue;
    const n = Number.parseInt(tail, 10);
    if (Number.isFinite(n) && n > maxN) maxN = n;
  }
  return usNum ? `AC-${usNum}-${maxN + 1}` : `AC-${(Math.floor(Math.random() * 999)).toString().padStart(3, '0')}-1`;
}

function extractGwt(text) {
  const gwt = { given: '', when: '', then: '' };
  const g = text.match(/given\s+(.+?),\s*when/i);
  const w = text.match(/,\s*when\s+(.+?),\s*then/i);
  const t = text.match(/,\s*then\s+(.+)$/i);
  if (g) gwt.given = g[1].trim();
  if (w) gwt.when = w[1].trim();
  if (t) gwt.then = t[1].trim().replace(/\.\s*$/, '');
  return gwt;
}

// Kept-exported catalog constants for downstream discoverability.
void BASELINE_SHAPE_KEYS; void getBaselineSet;
