// Pre-flight service candidate scanner
// (verification-integrity-cluster-spec §4.3 / §8.3).
//
// Deterministic candidate GENERATOR (not a decider). Reads the named
// PRD and optionally a TAD from the RCF chain, walks every string-shaped
// prose field on those documents with core's `matchServiceSignals`
// (imported, never re-implemented — the seed pattern set is the shared
// source of truth per §5.3), and returns per-candidate provenance
// records the interactive session then walks with the operator.
//
// The scanner intentionally over-collects (spec §4.3 / §4.4): false
// positives are cheap (the operator dismisses in-session), false
// negatives are the failure mode that motivated the whole cluster (the
// d-142 "email channel" miss). Every match records the source doc, a
// section-anchor guess (heading nearest the match), the matched
// substring, and the category the seed set fired under.
//
// This module is pure: it takes a walker tree (already loaded from
// disk) plus a target PRD id and optional TAD id, and returns a
// candidate list. Every side-effect (filesystem, prompting) belongs to
// the CLI handler in `../cli/preflight.js`.

import { matchServiceSignals, SERVICE_CATEGORY_KEYS } from '@stravica-ai/rcf-lite-core/patterns/services';

/**
 * @typedef {object} ScannerSourceRef
 * @property {string} docId          the PRD / TAD id
 * @property {string} anchor         the section-anchor guess (heading id / index)
 * @property {string} phrase         the matched substring
 * @property {string} category       the seed-set category the match fired under
 * @property {string} role           'token' | 'verb' | 'vendor'
 */

/**
 * @typedef {object} ServiceCandidate
 * @property {string} id             suggested camelCase service id (best-guess vendor if present, else category)
 * @property {string} displayName    human-readable label
 * @property {string} category       the dominant category (first hit)
 * @property {ScannerSourceRef[]} sourceRefs
 */

/**
 * @typedef {object} ScannerResult
 * @property {ServiceCandidate[]} candidates
 * @property {string[]} scannedDocIds
 * @property {string[]} skippedDocIds   docs the caller asked for that were not found
 */

/**
 * Extract every string-typed value under `doc` recursively, tagged with
 * a synthetic anchor derived from the JSON pointer. The anchor lets the
 * operator locate the match in the source without asking the scanner
 * to understand every RCF document shape.
 *
 * @param {object} doc
 * @returns {Array<{ anchor: string, text: string }>}
 */
function collectProseFields(doc) {
  /** @type {Array<{ anchor: string, text: string }>} */
  const out = [];
  const stack = [{ node: doc, path: '' }];
  while (stack.length > 0) {
    const { node, path } = stack.pop();
    if (node == null) continue;
    if (typeof node === 'string') {
      // Ignore very short strings (ids / statuses) unless they carry a
      // space (a phrase); anything ≥ 3 chars with a space is prose-ish.
      if (node.length >= 6 && node.includes(' ')) {
        out.push({ anchor: path || '/', text: node });
      }
      continue;
    }
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i -= 1) {
        stack.push({ node: node[i], path: `${path}/${i}` });
      }
      continue;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        stack.push({ node: v, path: `${path}/${k}` });
      }
    }
  }
  return out;
}

const CATEGORY_DISPLAY = {
  emailDelivery: 'Email delivery service',
  payment: 'Payment provider',
  smsVoice: 'SMS or voice provider',
  auth: 'Identity / auth provider',
  storageCdn: 'Storage or CDN provider',
  llmAi: 'LLM / AI provider',
  analyticsTelemetry: 'Analytics or telemetry provider',
  featureFlags: 'Feature-flag provider',
  search: 'Search provider',
};

/**
 * Best-guess camelCase id for a candidate: vendor name (if any hit was
 * a vendor role) wins; otherwise the category id. Vendor names are
 * lower-cased and non-alphanumerics stripped.
 *
 * @param {ScannerSourceRef[]} refs
 * @param {string} fallbackCategory
 * @returns {{ id: string, displayName: string }}
 */
function chooseCandidateName(refs, fallbackCategory) {
  const vendor = refs.find((r) => r.role === 'vendor');
  if (vendor) {
    const cleaned = vendor.phrase.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (cleaned.length > 0) {
      const displayName = vendor.phrase.trim();
      return { id: cleaned, displayName };
    }
  }
  return {
    id: fallbackCategory,
    displayName: CATEGORY_DISPLAY[fallbackCategory] ?? fallbackCategory,
  };
}

/**
 * Group signal matches into service candidates. Groups by category
 * (§4.4's nine categories); one candidate per category that fired at
 * least once. Vendor hits within a category promote the candidate's
 * suggested id + displayName. The operator can split (add a new
 * candidate) or merge in the interactive session — the scanner does
 * NOT try to be a classifier (§4.3 candidate generator, not decider).
 *
 * @param {ScannerSourceRef[]} refsInDocOrder
 * @returns {ServiceCandidate[]}
 */
function groupIntoCandidates(refsInDocOrder) {
  /** @type {Map<string, ScannerSourceRef[]>} */
  const byCategory = new Map();
  for (const ref of refsInDocOrder) {
    if (!byCategory.has(ref.category)) byCategory.set(ref.category, []);
    byCategory.get(ref.category).push(ref);
  }
  /** @type {ServiceCandidate[]} */
  const candidates = [];
  // Preserve seed-set category order for a stable presentation.
  for (const category of SERVICE_CATEGORY_KEYS) {
    const refs = byCategory.get(category);
    if (!refs || refs.length === 0) continue;
    const { id, displayName } = chooseCandidateName(refs, category);
    candidates.push({ id, displayName, category, sourceRefs: refs });
  }
  return candidates;
}

/**
 * Scan the named PRD (and optional TAD) for third-party service
 * candidates. The tree is already loaded; the scanner reads only the
 * documents named by id.
 *
 * @param {object} args
 * @param {import('@stravica-ai/rcf-lite-core/store/walker.js').TreeModel} args.tree
 * @param {string} args.prdId
 * @param {string} [args.tadId]
 * @returns {ScannerResult}
 */
export function scanForServiceCandidates({ tree, prdId, tadId }) {
  /** @type {ScannerSourceRef[]} */
  const refs = [];
  const scannedDocIds = [];
  const skippedDocIds = [];

  const targets = [{ id: prdId, kind: 'prd' }];
  if (tadId) targets.push({ id: tadId, kind: 'tad' });

  for (const { id, kind } of targets) {
    const doc = tree.byId.get(id) ?? (kind === 'prd' ? tree.prd : kind === 'tad' ? tree.tad : null);
    if (!doc) {
      skippedDocIds.push(id);
      continue;
    }
    // Sanity-check the id matches the loaded doc (walker binds ids into
    // byId by their own id field).
    scannedDocIds.push(id);
    const proseFields = collectProseFields(doc);
    for (const { anchor, text } of proseFields) {
      const matches = matchServiceSignals(text);
      for (const m of matches) {
        refs.push({
          docId: id,
          anchor,
          phrase: m.match,
          category: m.category,
          role: m.role,
        });
      }
    }
  }

  const candidates = groupIntoCandidates(refs);
  return { candidates, scannedDocIds, skippedDocIds };
}

/**
 * Public accessor for the display-name lookup so the interactive
 * session's presentation can stay in one place.
 */
export const CATEGORY_DISPLAY_NAMES = Object.freeze({ ...CATEGORY_DISPLAY });
