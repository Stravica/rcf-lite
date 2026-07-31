// UI-bearing FBS classifier (ui-design-gate-0.7.0-spec §4).
//
// Deterministic keyword scan over an FBS's own summary/title plus every
// in-scope AC's description/given/when/then, every parent US's
// iWant/soThat, every ancestor REQ's description/rationale, plus a
// dependsOnServices signal (auth-shaped services imply an HTML login
// page unless the operator has ruled otherwise).
//
// The classifier does NOT read source code. Design happens before code;
// source signals are unavailable at classification time and would be
// circular for an FBS classified pre-Build.
//
// Composition: `classifyFbs(tree, fbsId)` returns a `uiClassification`
// block per spec §3.1 without writing the FBS document. The caller
// (the `rcf ui-classify` verb + the `rcf build --next` runbook) is
// responsible for surfacing the verdict to the operator; writing the
// FBS document is the operator's choice via `rcf update`.
//
// Operator override precedence (§4.4): when `fbs.uiBearing` is a
// boolean, that operator ruling wins over the classifier's opinion and
// the returned block carries `verdict: operatorOverride` with the
// classifier's own evidence preserved in `signals[]` for provenance.

import { matchUiSignals } from '@stravica-ai/rcf-lite-core/patterns/ui-shapes';

/**
 * @typedef {'ui'|'notUi'|'operatorOverride'} UiClassifierVerdict
 */

/**
 * @typedef {'keyword-scan'|'operator-tag'|'inheritedFromParent'|'operatorOverride'} UiClassifierReason
 */

/**
 * @typedef {object} UiClassifierSignal
 * @property {'summary'|'ac.description'|'us.iWant'|'us.soThat'|'req.description'} source
 * @property {string} match
 * @property {string} [acId]
 */

/**
 * @typedef {object} UiClassificationBlock
 * @property {UiClassifierVerdict} verdict
 * @property {UiClassifierReason} reason
 * @property {UiClassifierSignal[]} [signals]
 * @property {string} classifiedAt
 */

const AUTH_SERVICE_CATEGORIES = new Set([
  'auth', 'oauth', 'identityProvider', 'emailAuth',
]);

/**
 * Classify an FBS as UI-bearing or not.
 *
 * @param {import('@stravica-ai/rcf-lite-core/store/walker.js').TreeModel} tree
 * @param {string} fbsId
 * @param {object} [opts]
 * @param {Date} [opts.now]
 * @returns {UiClassificationBlock|null}
 */
export function classifyFbs(tree, fbsId, opts = {}) {
  const fbs = tree?.byId?.get(fbsId);
  if (!fbs || tree.kindById?.get(fbsId) !== 'fbs') return null;
  const now = (opts.now instanceof Date ? opts.now : new Date()).toISOString();

  const signals = collectSignals(tree, fbs);

  // Operator override wins. Field on the FBS document is authoritative
  // per spec §4.4; we still preserve the classifier's evidence in
  // signals[] for provenance so the operator can see what the machine
  // would have said.
  if (typeof fbs.uiBearing === 'boolean') {
    const block = {
      verdict: 'operatorOverride',
      reason: 'operatorOverride',
      classifiedAt: now,
    };
    if (signals.length > 0) block.signals = signals;
    return block;
  }

  if (signals.length > 0) {
    return {
      verdict: 'ui',
      reason: 'keyword-scan',
      signals,
      classifiedAt: now,
    };
  }
  return {
    verdict: 'notUi',
    reason: 'keyword-scan',
    classifiedAt: now,
  };
}

/**
 * Collect UI signals for one FBS. In-order: summary, then per-AC
 * description/given/when/then with acId anchored, then parent US
 * iWant/soThat, then ancestor REQ description/rationale, then the
 * dependsOnServices auth-signal.
 *
 * @param {import('@stravica-ai/rcf-lite-core/store/walker.js').TreeModel} tree
 * @param {object} fbs
 * @returns {UiClassifierSignal[]}
 */
export function collectSignals(tree, fbs) {
  /** @type {UiClassifierSignal[]} */
  const signals = [];

  // Summary + title. Title concatenated first so a title-only signal
  // still lands under source: 'summary' (only one FBS-body source in
  // the schema; the two fields cover the same intent).
  const summaryText = [fbs.title, fbs.summary].filter(Boolean).join('. ');
  for (const m of matchUiSignals(summaryText)) {
    signals.push({ source: 'summary', match: m.match });
  }

  // ACs (in-scope for this FBS via acIds) + parents. Walker exposes
  // arrays; build local ac/us/req lookups on the fly (small trees, one
  // shot per classification, cheaper than an extra derived map on the
  // walker for a build-side classifier that runs occasionally).
  const usByAcId = new Map();
  const reqById = new Map();
  for (const us of Array.isArray(tree?.userStories) ? tree.userStories : []) {
    for (const ac of Array.isArray(us?.acceptanceCriteria) ? us.acceptanceCriteria : []) {
      if (ac?.id) usByAcId.set(ac.id, us);
    }
  }
  for (const req of Array.isArray(tree?.requirements) ? tree.requirements : []) {
    if (req?.reqId) reqById.set(req.reqId, req);
  }
  const seenUsIds = new Set();
  const seenReqIds = new Set();
  const fbsAcIds = Array.isArray(fbs.acIds) ? fbs.acIds : [];
  for (const acId of fbsAcIds) {
    const us = usByAcId.get(acId);
    const ac = us?.acceptanceCriteria?.find((a) => a.id === acId);
    if (ac) {
      const acText = [ac.description, ac.given, ac.when, ac.then].filter(Boolean).join('. ');
      for (const m of matchUiSignals(acText)) {
        signals.push({ source: 'ac.description', acId, match: m.match });
      }
    }
    if (us && !seenUsIds.has(us.usId)) {
      seenUsIds.add(us.usId);
      for (const m of matchUiSignals(us.iWant ?? '')) {
        signals.push({ source: 'us.iWant', match: m.match });
      }
      for (const m of matchUiSignals(us.soThat ?? '')) {
        signals.push({ source: 'us.soThat', match: m.match });
      }
      const req = reqById.get(us.reqId);
      if (req && !seenReqIds.has(req.reqId)) {
        seenReqIds.add(req.reqId);
        const reqText = [req.description, req.rationale].filter(Boolean).join('. ');
        for (const m of matchUiSignals(reqText)) {
          signals.push({ source: 'req.description', match: m.match });
        }
      }
    }
  }

  // Auth-shaped service dependency implies an HTML login flow (spec
  // §4.2 bullet 5); the signal is packaged as a summary-level match so
  // the operator sees it in the same list.
  for (const dep of Array.isArray(fbs.dependsOnServices) ? fbs.dependsOnServices : []) {
    const category = String(dep?.serviceCategory ?? '');
    if (AUTH_SERVICE_CATEGORIES.has(category)) {
      signals.push({ source: 'summary', match: `dependsOnServices:${category}` });
    }
  }

  return signals;
}

/**
 * True when the FBS is UI-bearing (operator-tagged true). Used by
 * downstream gates that must not silently promote the classifier's
 * `verdict: ui` into enforcement: the operator's boolean is the
 * authority per spec §4.4, and the classifier verdict is a proposal
 * the operator sees before ratifying.
 *
 * @param {object} fbs
 * @returns {boolean}
 */
export function isUiBearing(fbs) {
  if (!fbs) return false;
  if (fbs.uiBearing === true) return true;
  return false;
}
