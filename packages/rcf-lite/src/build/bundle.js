// Spec-bundle assembly (Phase 6 §D3). Pure projection of one FBS item
// and its surroundings into the seven-section bundle shape: header,
// queue and dependency context, the work, acceptance criteria with
// US/REQ ancestry, architectural context, existing test surface, and
// the build-cycle runbook parameters. No I/O, no wall clock, no
// semantic judgement (§D13): the bundle reports what the tree says.
//
// Ordering rules (§D10): acIds and every contextRequirements list
// render in authored order; dependency and dependent lists sort by
// buildOrder then fbsId; US groups order by first appearance in the
// authored acIds.

import { byBuildOrder, computeQueue } from './queue.js';
import { selectStandards } from './standards-selector.js';

/**
 * Copy `fields` from `source` onto a new object, skipping fields not
 * present. Preserves the given key order (JSON key order is
 * construction order, §D10).
 *
 * @param {object} source
 * @param {string[]} fields
 * @returns {object}
 */
function pick(source, fields) {
  const out = {};
  for (const f of fields) {
    if (source?.[f] !== undefined) out[f] = source[f];
  }
  return out;
}

/**
 * Assemble the bundle for one FBS item. The caller (handler) is
 * responsible for id classification; this function returns null when
 * the id does not resolve to an FBS document.
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @param {object} opts
 * @param {string} opts.fbsId
 * @returns {object|null} BundleResult
 */
export function assembleBundle(tree, { fbsId }) {
  const fbs = tree.byId.get(fbsId);
  if (!fbs || tree.kindById.get(fbsId) !== 'fbs') return null;

  const queue = computeQueue(tree);
  const position = queue.items.findIndex((i) => i.fbsId === fbsId) + 1;
  const queueItem = queue.items[position - 1];
  const fbsById = new Map((tree.fbsItems ?? []).map((f) => [f.fbsId, f]));

  // Section 1 - header identity (order follows §D14 fbs shape, then
  // the optional estimate fields and the header's "spec last touched").
  const fbsBlock = pick(fbs, [
    'fbsId', 'title', 'buildOrder', 'executionStatus',
    'summary', 'approach', 'deliverables', 'notes',
    'estimatedSize', 'estimatedHours', 'riskLevel', 'domain', 'updatedAt',
  ]);

  // Section 2 - queue and dependency context.
  const dependencies = (fbs.dependsOnFbsIds ?? [])
    .map((depId) => fbsById.get(depId) ?? { fbsId: depId })
    .sort(byBuildOrder)
    .map((dep) => pick(dep, ['fbsId', 'title', 'executionStatus']));
  const dependents = (tree.dependentsByFbsId.get(fbsId) ?? [])
    .map((depId) => fbsById.get(depId) ?? { fbsId: depId })
    .sort(byBuildOrder)
    .map((dep) => dep.fbsId);
  const blockedBy = queueItem ? queueItem.blockedBy : [];

  // Section 4 - acceptance criteria with US/REQ ancestry. Groups order
  // by first appearance in the authored acIds; ACs within a group keep
  // the authored acIds order.
  const usOrder = [];
  const acsByUs = new Map();
  for (const acId of fbs.acIds ?? []) {
    const usId = tree.parentByChild.get(acId);
    const us = usId ? tree.byId.get(usId) : null;
    if (!us) continue; // Broken cross-links cannot occur post-walker (§D6).
    if (!acsByUs.has(usId)) {
      usOrder.push(usId);
      acsByUs.set(usId, []);
    }
    const ac = (us.acceptanceCriteria ?? []).find((a) => a.id === acId);
    if (ac) acsByUs.get(usId).push(ac);
  }

  const acceptanceCriteria = [];
  const userStories = [];
  const requirements = [];
  const seenReqs = new Set();
  for (const usId of usOrder) {
    const us = tree.byId.get(usId);
    userStories.push(pick(us, ['usId', 'title', 'asA', 'iWant', 'soThat', 'status']));
    const req = tree.byId.get(us.reqId);
    if (req && !seenReqs.has(req.reqId)) {
      seenReqs.add(req.reqId);
      requirements.push(pick(req, ['reqId', 'title', 'description', 'category', 'priority', 'rationale']));
    }
    for (const ac of acsByUs.get(usId)) {
      acceptanceCriteria.push({
        ...pick(ac, ['id', 'description', 'given', 'when', 'then', 'testable']),
        usId,
        reqId: us.reqId,
      });
    }
  }

  // Section 5 - architectural context (§D11). Omitted entirely when
  // contextRequirements is absent, EXCEPT when the FBS drives an agentic
  // standards selection off manifest.standards[] alone (0.4.4). In that
  // case a minimal context is synthesised so the standards payload has
  // somewhere to land.
  const manifestStandards = tree.manifest?.standards ?? [];
  const ctx = fbs.contextRequirements;
  let context;
  if (ctx || (manifestStandards.length > 0 && !fbs.contextRequirements)) {
    const safeCtx = ctx ?? {};
    const tacs = (safeCtx.tacIds ?? [])
      .map((id) => tree.byId.get(id))
      .filter(Boolean)
      .map((tac) => pick(tac, [
        'tacId', 'name', 'purpose', 'responsibilities', 'interfaces',
        'dependencies', 'tradeoffs', 'notes',
      ]));
    const adrs = (safeCtx.adrIds ?? [])
      .map((id) => tree.byId.get(id))
      .filter(Boolean)
      .map((adr) => pick(adr, [
        'adrId', 'title', 'status', 'context', 'decision', 'consequences',
        'alternativesConsidered',
      ]));
    const unresolvedSections = [];
    const resolveSections = (names, doc) => {
      const out = {};
      for (const name of names ?? []) {
        if (doc && Object.prototype.hasOwnProperty.call(doc, name)) {
          out[name] = doc[name];
        } else {
          unresolvedSections.push(name);
        }
      }
      return out;
    };
    const tadSections = resolveSections(safeCtx.tadSections, tree.tad);
    const prdSections = resolveSections(safeCtx.prdSections, tree.prd);

    // 0.4.4 selective retrieval. Operator-authored standardIds override
    // the agentic selection; empty selection is legitimate and never
    // blocks the assembler.
    const authoredStandardIds = Array.isArray(safeCtx.standardIds) ? safeCtx.standardIds : null;
    const selection = authoredStandardIds
      ? { standardIds: authoredStandardIds, source: 'operatorOverride' }
      : { standardIds: selectStandards(fbs, manifestStandards).standardIds, source: 'agenticSelection' };
    const standardsById = new Map(manifestStandards.map((s) => [s.slug, s]));
    const standardsPayload = selection.standardIds
      .map((slug) => standardsById.get(slug))
      .filter(Boolean)
      .map((pack) => pick(pack, ['id', 'slug', 'tags', 'summary', 'testsProvidedBy', 'provenance', 'sourcePath', 'copyPath']));

    context = {
      tacs,
      adrs,
      tadSections,
      prdSections,
      unresolvedSections,
      standardIds: selection.standardIds,
      standardsSource: selection.source,
      standards: standardsPayload,
      passThrough: {
        existingModules: safeCtx.existingModules ?? [],
        schemas: safeCtx.schemas ?? [],
        externalDocs: safeCtx.externalDocs ?? [],
        other: safeCtx.other ?? [],
      },
    };
  }

  // Section 6 - existing test surface. Presence reporting off the
  // walker maps, not a coverage verdict (§D7). The per-AC `covered`
  // flag here is PRESENCE-based (at least one TC row via tcsByAcId);
  // since w-2026-07-28-005, computeCoverage's own leaf test is stricter
  // (the TC's testPointer must resolve to a real test). `rcf coverage`
  // is the coverage surface; this section only lists what is on the
  // tree, pointers included, so the builder can see what exists.
  const tests = acceptanceCriteria.map((ac) => {
    const suites = tree.tsByAcId.get(ac.id) ?? [];
    const cases = (tree.tcsByAcId.get(ac.id) ?? []).map(({ tsId, tcId }) => {
      const ts = tree.byId.get(tsId);
      const tc = (ts?.testCases ?? []).find((c) => c.id === tcId) ?? {};
      return { tcId, tsId, ...pick(tc, ['description', 'status', 'testPointer']) };
    });
    return { acId: ac.id, covered: cases.length > 0, suites, cases };
  });

  // Section 7 - completion contract (static, parameterised by fbsId).
  const completionContract = {
    markInProgress: `rcf build mark ${fbsId} inProgress`,
    markComplete: `rcf build mark ${fbsId} complete`,
    finalise: `rcf build finalise ${fbsId} --url <deploy-url>`,
  };

  const result = {
    fbs: fbsBlock,
    queue: { position, total: queue.items.length },
    bs: tree.bs
      ? pick(tree.bs, ['bsId', 'title', 'buildPhilosophy', 'generationStrategy'])
      : null,
    prd: tree.prd ? pick(tree.prd, ['prdId', 'productName']) : null,
    blockedBy,
    dependencies,
    dependents,
    acceptanceCriteria,
    userStories,
    requirements,
    ...(context ? { context } : {}),
    tests,
    completionContract,
  };
  return result;
}
